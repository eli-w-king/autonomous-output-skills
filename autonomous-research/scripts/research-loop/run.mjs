#!/usr/bin/env node
// One pass of the research loop over every active study. The scheduled automation's agent runs this first, then does
// the judgment work it reports (synthesis, redesign, steering) per references/research-loop.md.
//
//   node run.mjs [--study <slug>] [--no-launch] [--no-publish] [--no-ui] [--run-token <token from runlock.mjs acquire>]
//
// Per study: read steering comments on its issue (only the configured steering accounts; the loop's own comments are
// skipped);
// launch any round arm that is ready once the platforms allow it (through launch.mjs, which owns the budget check);
// harvest completed real interviews; read recruiting state; close a round at 5 completes or its time cap; write the
// report; update the issue; publish state to the private repo. Prints a JSON summary of what needs an agent.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStudies, loadStudy, loadLedger, updateStudy, studyDir, addHistory, armLabel, publishedStill } from './lib/state.mjs';
import { gateDmStatus } from './lib/gatedm.mjs';
import { withLock } from './lib/lock.mjs';
import { STATE_DIR } from './lib/env.mjs';
import { outsetEveryday, outsetRest } from './lib/outset.mjs';
import { createIssue, updateIssueBody, issueComments, comment, publishStudy, LOOP_REPO } from './lib/github.mjs';
import { CONFIG } from './lib/config.mjs';
import { hostname } from 'node:os';
import { runLockStatus, heartbeatRunLock } from './lib/runlock.mjs';
import { checkGates } from './lib/gate.mjs';
import { recordStalls } from './lib/stalls.mjs';
import { activity } from './lib/idle.mjs';
import { due as confirmationsDue } from './lib/confirm.mjs';
import { deadlineOf, recruitingStopOf, studyPhase, roundClosesAt } from './lib/deadline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const only = opt('study');
const noLaunch = argv.includes('--no-launch');
const noPublish = argv.includes('--no-publish');
const noUi = argv.includes('--no-ui');
const runToken = opt('run-token');
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const summary = { at: new Date().toISOString(), studies: [] };

// The run lock (runlock.mjs) spans a whole agent run. A run passes its token; without one, run.mjs only runs when no
// agent run is active, so a manual pass never interleaves with a scheduled run's synthesis or redesign.
{
	const skip = reason => {
		console.log(JSON.stringify({ ...summary, skipped: reason }, null, 1));
		process.exit(0);
	};
	if (runToken) {
		const hb = await heartbeatRunLock(runToken, 'run.mjs');
		if (!hb.ok) {
			skip(`run lock: ${hb.reason}`);
		}
	} else {
		const st = runLockStatus();
		if (st.active) {
			skip(`skipped: another run active (${st.label}, phase "${st.phase}", last heartbeat ${st.heartbeat_age_s} s ago)`);
		}
	}
}

const DONE = new Set(['done', 'stopped', 'handed-to-owner']);

// Nothing to research: no study running, and no ended study still waiting for an email confirmation. Exit now, before
// any browser or platform call (the run's agent then asks once for the schedule to be turned off; see idle.mjs).
{
	const act = activity(listStudies().filter(x => !only || x === only).map(slug => ({ slug, study: loadStudy(slug), ledger: loadLedger(slug) })));
	if (act.idle) {
		const out = { ...summary, idle: true, reason: 'nothing is being researched: no active study and no confirmation still open' };
		console.log(JSON.stringify(out, null, 1));
		mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(join(STATE_DIR, 'last-run.json'), JSON.stringify(out, null, 1));
		process.exit(0);
	}
}

async function steering(slug, study) {
	const out = { new: [] };
	const num = study.github?.issue?.number;
	if (!num) {
		return out;
	}
	const since = study.github.last_comment_seen_at ?? study.github.issue.created_at;
	const comments = issueComments(num, since);
	for (const c of comments) {
		if (c.fromLoop || !c.allowed) {
			continue; // the loop's own notes, and anyone not on the steering list, are never instructions
		}
		out.new.push({ id: c.id, author: c.author, at: c.at, body: c.body, url: c.url });
	}
	const newest = comments.reduce((m, c) => (c.updated > m ? c.updated : m), since ?? '');
	await updateStudy(slug, s => {
		s.github.last_comment_seen_at = newest || s.github.last_comment_seen_at;
		s.instructions ??= [];
		for (const n of out.new) {
			if (!s.instructions.some(i => i.id === n.id)) {
				s.instructions.push({ ...n, status: 'new', received_at: new Date().toISOString() });
			}
		}
	});
	for (const n of out.new) {
		comment(num, `Got it. The loop recorded this as an instruction and the run that is starting now will act on it, then reply here with what it did.`);
	}
	return out;
}

async function harvest(slug, study, everyday) {
	const round = study.rounds[study.rounds.length - 1];
	const res = [];
	for (const a of round.arms.filter(x => x.launched_at)) {
		const dir = join(studyDir(slug), 'rounds', `r${round.n}`, `arm-${a.arm}`, 'transcripts');
		mkdirSync(dir, { recursive: true });
		const all = JSON.parse(await everyday.call('list_interviews', { study_id: a.outset.study_id, interview_types: ['USER'], limit: 100 }));
		const ivs = all.interviews ?? [];
		const completed = ivs.filter(i => i.completed_at && !i.archived);
		const good = completed.filter(i => !i.is_fraud && !i.is_low_quality && Number(i.fraud_score ?? 0) <= 0.5 && !(a.exclude ?? []).includes(i.id));
		let fresh = 0;
		for (const i of good) {
			const p = join(dir, `${i.id}.json`);
			if (existsSync(p)) {
				continue;
			}
			const t = await everyday.call('get_interview_transcript', { interview_id: i.id });
			writeFileSync(p, JSON.stringify({ interview: i, transcript: JSON.parse(t) }, null, 1));
			fresh++;
		}
		const counts = {
			started: ivs.length,
			in_progress: ivs.filter(i => !i.completed_at && Number(i.progress_percentage ?? 0) > 0.05).length,
			completed: good.length,
			excluded: completed.length - good.length,
			setup_abandoned: ivs.filter(i => !i.completed_at && Number(i.progress_percentage ?? 0) <= 0.05).length,
		};
		res.push({ arm: a.arm, fresh, counts, iids: good.map(i => i.metadata?.iid).filter(Boolean), excludedIids: completed.filter(i => !good.includes(i)).map(i => i.metadata?.iid).filter(Boolean) });
	}
	await updateStudy(slug, s => {
		const r = s.rounds[s.rounds.length - 1];
		for (const h of res) {
			const a = r.arms.find(x => x.arm === h.arm);
			a.counts = h.counts;
		}
	});
	// Participant tracking ids stay local (never published): the pay-or-reject step reads them from here.
	for (const h of res) {
		const p = join(studyDir(slug), 'rounds', `r${round.n}`, `arm-${h.arm}`, 'participants.local.json');
		writeFileSync(p, JSON.stringify({ completed_iids: h.iids, excluded_iids: h.excludedIids, at: new Date().toISOString() }, null, 1));
	}
	return res;
}

async function recruiting(slug, study) {
	if (noUi) {
		return null;
	}
	const round = study.rounds[study.rounds.length - 1];
	const launched = round.arms.filter(x => x.launched_at);
	if (!launched.length) {
		return null;
	}
	const { ensureUiBrowser, uiSignedIn } = await import('./lib/ui-chrome.mjs');
	const { uiFetch } = await import('./lib/ui-browser.mjs');
	const { page } = await ensureUiBrowser({ log });
	if (!(await uiSignedIn(page))) {
		await updateStudy(slug, s => {
			s.needs_you = [...new Set([...(s.needs_you ?? []), `User Interviews is signed out on ${hostname()}. Sign in once in the loop's Chrome (profile ${CONFIG.uiProfile}); the loop never types a password.`])];
			s.status_line = 'Needs sign-in to User Interviews';
		});
		return { signedIn: false };
	}
	const out = { signedIn: true, arms: [] };
	const people = new Map();
	for (const a of launched) {
		const sum = await uiFetch(page, `/api/projects/${a.ui.project_id}/summary`);
		const attrs = sum.json?.data?.attributes ?? {};
		const status = (await uiFetch(page, `/api/projects/${a.ui.project_id}`)).json?.data?.attributes?.currentStatus;
		const rows = [];
		for (const table of ['workspace_started', 'workspace_submitted']) {
			const r = await uiFetch(page, `/api/projects/${a.ui.project_id}/workspace-participants?page%5Bnumber%5D=1&page%5Bsize%5D=50&tableName=${table}`);
			for (const p of r.json?.data ?? []) {
				rows.push({ id: p.id, participant: p.relationships?.participant?.data?.id ?? p.attributes?.participantId ?? p.id, table });
			}
		}
		for (const r of rows) {
			const k = String(r.participant);
			people.set(k, [...(people.get(k) ?? []), a.arm]);
		}
		out.arms.push({ arm: a.arm, status, approved: attrs.researcherApprovedParticipantCount, started: attrs.researcherStartedParticipantCount, submitted: attrs.researcherSubmittedParticipantCount, completed: attrs.researcherCompletedParticipantCount, paid: attrs.paidParticipantCount });
	}
	out.duplicates = [...people].filter(([, arms]) => new Set(arms).size > 1).map(([p, arms]) => ({ participant: p, arms }));
	await updateStudy(slug, s => {
		const r = s.rounds[s.rounds.length - 1];
		for (const x of out.arms) {
			r.arms.find(a => a.arm === x.arm).recruiting = x;
		}
		if (out.duplicates.length) {
			r.cross_arm_duplicates = out.duplicates;
		}
	});
	return out;
}

async function roundState(slug) {
	return updateStudy(slug, s => {
		const r = s.rounds[s.rounds.length - 1];
		if (!['recruiting'].includes(r.status)) {
			return r.status;
		}
		const cap = s.round_time_cap ?? {};
		const now = Date.now();
		const allFive = r.arms.every(a => (a.counts?.completed ?? 0) >= (s.criteria?.finish_line?.participants_per_round ?? 5));
		const firstLaunch = Math.min(...r.arms.filter(a => a.launched_at).map(a => Date.parse(a.launched_at)));
		// The study's time limit wins over the round's own cap: recruiting stops everywhere at the recruiting stop
		// (the deadline minus the response window), so the round closes then at the latest and is never extended past it.
		const stop = recruitingStopOf(s);
		const atStop = stop && now >= Date.parse(stop);
		const closesAt = roundClosesAt(s, r);
		if (allFive) {
			r.status = 'complete';
			r.completed_at = new Date().toISOString();
			r.close_reason = 'target';
			addHistory(s, `round ${r.n} complete: every arm has 5 completed interviews`);
		} else if (closesAt && now >= Date.parse(closesAt)) {
			const thin = r.arms.some(a => (a.counts?.completed ?? 0) < (cap.min_completes_per_arm_to_synthesize ?? 3));
			const hard = firstLaunch + (cap.hard_cap_hours ?? 24) * 3600e3;
			if (thin && now < hard && !atStop) {
				r.closes_at = new Date(Math.min(now + (cap.extend_hours ?? 2) * 3600e3, hard, stop ? Date.parse(stop) : Infinity)).toISOString();
				addHistory(s, `round ${r.n} extended to ${r.closes_at}: an arm has fewer than ${cap.min_completes_per_arm_to_synthesize ?? 3} completes`);
			} else {
				r.status = 'complete';
				r.completed_at = new Date().toISOString();
				r.capped = true;
				r.close_reason = atStop ? 'recruiting-stop' : 'time-cap';
				addHistory(s, atStop ? `round ${r.n} closed: the study's recruiting stopped at ${stop}` : `round ${r.n} closed at its time cap`);
			}
		}
		if (r.status === 'complete' && !r.synthesized_at) {
			s.next_action = `Synthesize round ${r.n} (score every participant, findings with verbatim quotes and links, finish line), then consolidate or finish per the plan in the same run: a redesign starts right after the synthesis, so the next round can be submitted for review while people are at work.`;
		}
		return r.status;
	});
}

function writeReport(slug) {
	const dir = studyDir(slug);
	const s = loadStudy(slug);
	// Stills for the report: each arm's stimulus files under their published names (a later round wins a shared name).
	// Copies the report no longer names are removed, so the published folder matches the report.
	const stills = join(dir, 'stills');
	const wanted = new Map();
	for (const r of s.rounds) {
		for (const a of r.arms) {
			if (!a.stimulus?.dir) {
				continue;
			}
			const src = join(dir, '..', '..', a.stimulus.dir);
			for (const f of Object.values(a.stimulus.files ?? {}).map(x => x.file)) {
				if (f && existsSync(join(src, f))) {
					wanted.set(publishedStill(s, a, f), join(src, f));
				}
			}
		}
	}
	if (wanted.size) {
		mkdirSync(stills, { recursive: true });
		for (const [name, src] of wanted) {
			const to = join(stills, name);
			if (!existsSync(to) || statSync(to).size !== statSync(src).size) {
				cpSync(src, to);
			}
		}
		for (const f of readdirSync(stills)) {
			if (!wanted.has(f)) {
				rmSync(join(stills, f), { force: true });
			}
		}
	}
	const r = spawnSync(process.execPath, [join(HERE, 'report.mjs'), '--study', slug], { encoding: 'utf8' });
	if (r.status !== 0) {
		throw new Error(`report failed: ${r.stderr}`);
	}
}

async function issue(slug) {
	const s = loadStudy(slug);
	const reportUrl = `https://github.com/${LOOP_REPO}/blob/main/private/studies/${slug}/report.md`;
	const body = [
		`**${s.title}**: research loop status. The full one-screen report, with stills, is [report.md](${reportUrl}).`,
		'',
		...(s.reminders ?? []).map(r => `> **Reminder:** ${r}`),
		'',
		`**Status:** ${s.status_line ?? s.status}`,
		...(s.needs_you?.length ? ['', '**Needs you**', ...s.needs_you.map(n => `- ${n}`)] : []),
		'',
		`**Round ${s.rounds.at(-1).n}:** ${s.rounds.at(-1).arms.map(a => `${armLabel(s, a)}: ${a.launched_at ? `${a.counts?.completed ?? 0} of ${s.criteria?.finish_line?.participants_per_round ?? 5} completed` : 'not launched'}`).join('; ')}`,
		'',
		`**Next:** ${s.next_action ?? ''}`,
		'',
		`Steering: comment here as ${CONFIG.steeringUsers.join(' or ') || 'a steering account'} and the next scheduled run treats it as instructions and replies. Comments from anyone else are ignored.`,
		'',
		`_Updated ${new Date().toISOString()}_`,
	].join('\n');
	if (!s.github?.issue?.number) {
		const created = createIssue(`Research loop: ${s.title}`, body);
		await updateStudy(slug, st => {
			st.github.issue = { ...created, created_at: new Date().toISOString() };
			st.github.last_comment_seen_at = new Date().toISOString();
		});
		return { created: created.url };
	}
	updateIssueBody(s.github.issue.number, body);
	return { updated: s.github.issue.url };
}

await withLock(join(STATE_DIR, 'locks', 'run.lock'), async () => {
	const everyday = await outsetEveryday();
	for (const slug of listStudies().filter(x => !only || x === only)) {
		const study = loadStudy(slug);
		if (DONE.has(study.status)) {
			continue;
		}
		const item = { slug, status: study.status };
		try {
			item.steering = await steering(slug, study);
			item.gate = await checkGates(slug, loadStudy(slug), everyday, { launch: !noLaunch });
			item.harvest = await harvest(slug, loadStudy(slug), everyday);
			item.recruiting = await recruiting(slug, loadStudy(slug));
			item.round = await roundState(slug);
			writeReport(slug);
			item.issue = await issue(slug);
			if (!noPublish) {
				// A failed publish only leaves the private repository's copy behind; the rest of the run (and its
				// agent_work list, which tells the agent what to do next) must not depend on it.
				try {
					item.publish = publishStudy(slug, studyDir(slug), { message: `Research loop: ${slug} run ${new Date().toISOString().slice(0, 16)}` });
				} catch (e) {
					item.publish = { pushed: false, error: e.message };
					log(`${slug}: publish failed: ${e.message}`);
				}
			}
			const s = loadStudy(slug);
			const cur = s.rounds.at(-1);
			const ledgerNow = loadLedger(slug);
			const dm = gateDmStatus(s, ledgerNow);
			item.gate_dm = dm;
			const phase = studyPhase(s);
			item.deadline = { deadline: deadlineOf(s), recruiting_stop: recruitingStopOf(s), phase };
			// A round's arm is closed out when Outset is unpublished and User Interviews has its close request (or closed).
			const closedOut = a => a.close?.outset?.state === 'closed' && ['close requested', 'closed'].includes(a.close?.ui?.state);
			const stopped = phase === 'response-window' || phase === 'past-deadline';
			const toClose = s.rounds.filter(r => r.status === 'complete' || stopped).flatMap(r => r.arms.filter(a => a.launched_at && !closedOut(a)).map(a => `round ${r.n} arm ${a.arm}`));
			const confirms = confirmationsDue(ledgerNow);
			item.agent_work = [
				...(s.instructions ?? []).filter(i => i.status === 'new').map(i => `steering instruction ${i.id} from ${i.author}: act, then reply on the issue`),
				...(dm.status === 'due' || dm.status === 'check' ? [`send the one DM about round ${dm.round}'s Outset approval (procedure step 6b: gatedm.mjs ${dm.status === 'check' ? 'says an earlier claim was never recorded as sent: look in the channel first' : 'claim, send once, record it'})`] : []),
				...(confirms.length ? [`check ${confirms.length} email confirmation${confirms.length === 1 ? '' : 's'} of close-outs or payouts (procedure step 2c)`] : []),
				...(toClose.length ? [`close out ${toClose.join(', ')}: pay or reject everyone Submitted, then close.mjs (procedure step 4c)`] : []),
				...(phase === 'past-deadline' && !DONE.has(s.status) ? [`the study reached its deadline (${deadlineOf(s)}): final close-out, final report and status (procedure step 4c, then step 5)`] : []),
				...(cur.status === 'recruiting' && cur.arms.some(a => (a.counts?.completed ?? 0) > 0) ? [`score newly completed interviews of round ${cur.n} (procedure step 4a)`] : []),
				...(cur.status === 'complete' && !cur.synthesized_at ? [`synthesize round ${cur.n}, then decide and act in this same run: for a redesign, go straight on to it and the next round's launch (procedure steps 4 to 6b)`] : []),
				...(cur.synthesized_at && s.next_action ? [s.next_action] : []),
			];
			item.needs_you = s.needs_you ?? [];
		} catch (e) {
			item.error = e.message;
			log(`${slug}: ${e.message}`);
		}
		summary.studies.push(item);
		if (runToken) {
			const hb = await heartbeatRunLock(runToken, `run.mjs: ${slug} done`);
			if (!hb.ok) {
				summary.lost_lock = hb.reason;
				log(`run lock lost (${hb.reason}); stopping before the next study`);
				break;
			}
		}
	}
	// A session waiting for an approval nobody can give is a silent stall; the morning summary lists any at the top.
	try {
		summary.stalls = recordStalls().stalls.length;
	} catch (e) {
		summary.stalls = `scan failed: ${e.message}`;
	}
	// The morning hand-off folder stays current after every run (no-op when no folder is configured).
	if (CONFIG.morningDir && !only) {
		const m = spawnSync(process.execPath, [join(HERE, 'morning.mjs')], { encoding: 'utf8', timeout: 10 * 60e3 });
		summary.morning = m.status === 0 ? 'updated' : `failed: ${(m.stderr || m.error?.message || '').slice(0, 300)}`;
	}
}, { label: 'the research loop run', timeoutMs: 5_000, staleMs: 3 * 3600e3 }).catch(e => {
	summary.skipped = /Timed out/.test(e.message) ? 'another run is in progress' : e.message;
});
console.log(JSON.stringify(summary, null, 1));
writeFileSync(join(STATE_DIR, 'last-run.json'), JSON.stringify(summary, null, 1));
process.exit(summary.studies.some(s => s.error) ? 1 : 0);

#!/usr/bin/env node
// Morning hand-off for whoever reads the loop first thing (for example an 08:00 report automation), in one folder
// (loop.config.json morning_dir):
//   morning-summary.md   per study: status, interviews done, top findings with short verbatim quotes and interview
//                        links, spend, and redesign status; then how the night went (from the study's retrospective)
//                        and every email from the research platforms' teams with what was done about it.
//   NN-*.png             at most 6 real high-resolution stills, numbered in reading order: today's product first, then
//                        each tested design by round and arm, then the consolidated redesign.
//   walkthrough-*.mp4    at most 2 short captioned walkthroughs (the stills one arm's participants see, in order),
//                        each fully decoded and under 50 MB.
//   node morning.mjs [--out <dir>] [--no-video]
// It takes its own lock, so a run that skipped (another run holds the run lock) can still refresh the folder. It
// deletes only media it wrote earlier (listed in media.json), nothing else.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listStudies, loadStudy, loadLedger, studyDir, armLabel, armSlug, capitalize, publishedStill } from './lib/state.mjs';
import { committedSpend } from './lib/budget.mjs';
import { CONFIG } from './lib/config.mjs';
import { LOOP_REPO } from './lib/github.mjs';
import { withLock } from './lib/lock.mjs';
import { STATE_DIR } from './lib/env.mjs';
import { loadMailLog, renderMail } from './lib/mail.mjs';
import { loadStalls } from './lib/stalls.mjs';
import { compareTitle, compareLines } from './lib/compare.mjs';
import { afterApproval } from './lib/gatedm.mjs';
import { limitsOf, deadlineOf, recruitingStopOf } from './lib/deadline.mjs';
import { confirmationLines } from './lib/confirm.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = opt('out') ?? CONFIG.morningDir;
if (!OUT) {
	console.error('no morning folder: set morning_dir in loop.config.json or pass --out');
	process.exit(2);
}
const NO_VIDEO = argv.includes('--no-video');
const MAX_IMAGES = 6;
const MAX_VIDEOS = 2;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const SLIDE_S = 3.5;
const FADE_S = 0.5;
const VIDEO_W = 2560;
const VIDEO_IMG_H = 1600;
const STRIP_H = 104;

const when = iso => iso ? new Date(iso).toLocaleString('en-US', { timeZone: CONFIG.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'not yet';
const money = n => { const v = Number(n ?? 0); return `$${v.toLocaleString('en-US', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
// A file another run is writing right now reads as missing rather than failing the whole hand-off.
const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const safe = s => String(s).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '');

// What each stimulus key shows, in the order participants see it.
const KEYS = {
	'before-first-look': { part: 'before', order: 0, file: 'overview', caption: 'the page as it opens' },
	'before-detail': { part: 'before', order: 1, file: 'detail', caption: 'the detail view' },
	'main-task': { part: 'after', order: 0, file: 'overview', caption: 'the design at rest' },
	'after-detail': { part: 'after', order: 1, file: 'opened', caption: 'one item opened' },
	'create-sentence': { part: 'after', order: 2, file: 'create', caption: 'creating one' },
	'act-command': { part: 'after', order: 3, file: 'act', caption: 'acting on a result' },
};
const SEQUENCE = Object.keys(KEYS);

function stillPath(slug, s, arm, key) {
	const f = arm.stimulus?.files?.[key];
	const name = typeof f === 'string' ? f : f?.file;
	if (!name || !arm.stimulus?.dir) {
		return null;
	}
	const p = join(CONFIG.home, arm.stimulus.dir, name);
	const copy = join(studyDir(slug), 'stills', publishedStill(s, arm, name));
	return existsSync(p) ? p : (existsSync(copy) ? copy : null);
}

const designLabel = (s, a) => armLabel(s, a);

/** Stills in priority order: today's product, each tested design at rest (by round and arm), the latest designs opened, today's detail view, earlier designs opened. */
function candidates(slug, s) {
	const latest = s.rounds.at(-1);
	const tested = s.rounds.flatMap(r => r.arms.map(a => ({ r, a })));
	const out = [];
	const add = (r, a, key) => {
		const src = a && stillPath(slug, s, a, key);
		if (src && !out.some(c => c.src === src)) {
			out.push({ slug, s, src, key, round: r.n, arm: KEYS[key].part === 'after' ? a : null });
		}
	};
	add(latest, latest.arms[0], 'before-first-look');
	tested.forEach(({ r, a }) => add(r, a, 'main-task'));
	latest.arms.forEach(a => add(latest, a, 'after-detail'));
	add(latest, latest.arms[0], 'before-detail');
	tested.filter(({ r }) => r !== latest).reverse().forEach(({ r, a }) => add(r, a, 'after-detail'));
	return out;
}

function fontFile() {
	const list = process.platform === 'win32'
		? ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf']
		: ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
	return list.find(existsSync) ?? null;
}

// The real stills in the order participants see them, each held a few seconds, with a caption strip above the window
// (the strip never covers the UI). Decoded in full and checked before it is listed.
function buildVideo(frames, outPath) {
	const font = fontFile();
	const tmp = mkdtempSync(join(tmpdir(), 'rl-morning-'));
	try {
		const graph = [];
		frames.forEach((f, i) => {
			writeFileSync(join(tmp, `cap${i}.txt`), f.caption);
			const text = font ? `,drawtext=fontfile='${font.replace(/:/g, '\\:')}':textfile='cap${i}.txt':fontcolor=white:fontsize=46:x=44:y=(${STRIP_H}-text_h)/2` : '';
			graph.push(`[${i}:v]scale=${VIDEO_W}:${VIDEO_IMG_H}:flags=lanczos,setsar=1,pad=${VIDEO_W}:${VIDEO_IMG_H + STRIP_H}:0:${STRIP_H}:color=0x101010,format=yuv420p${text},fps=30[v${i}]`);
		});
		let last = 'v0';
		for (let i = 1; i < frames.length; i++) {
			graph.push(`[${last}][v${i}]xfade=transition=fade:duration=${FADE_S}:offset=${(SLIDE_S - FADE_S) * i}[x${i}]`);
			last = `x${i}`;
		}
		writeFileSync(join(tmp, 'graph.txt'), graph.join(';\n'));
		const args = ['-hide_banner', '-y', '-loglevel', 'error'];
		for (const f of frames) {
			args.push('-loop', '1', '-t', String(SLIDE_S), '-i', f.src);
		}
		args.push('-/filter_complex', 'graph.txt', '-map', `[${last}]`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath);
		const r = spawnSync('ffmpeg', args, { cwd: tmp, encoding: 'utf8' });
		if (r.status !== 0) {
			throw new Error(`ffmpeg failed: ${(r.stderr || r.error?.message || '').slice(0, 400)}`);
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', outPath], { encoding: 'utf8' });
	const info = JSON.parse(probe.stdout || '{}');
	const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', outPath, '-f', 'null', '-'], { encoding: 'utf8' });
	const v = info.streams?.[0];
	const duration = Number(info.format?.duration);
	const expected = SLIDE_S * frames.length - FADE_S * (frames.length - 1);
	const bytes = statSync(outPath).size;
	if (decode.status !== 0 || decode.stderr.trim() || v?.codec_name !== 'h264' || v?.width !== VIDEO_W || v?.height !== VIDEO_IMG_H + STRIP_H || Math.abs(duration - expected) > 0.5 || bytes >= MAX_VIDEO_BYTES) {
		rmSync(outPath, { force: true });
		throw new Error(`video check failed for ${outPath}: ${JSON.stringify({ v, duration, expected, bytes, decode: decode.stderr.slice(0, 200) })}`);
	}
	return { duration: Math.round(duration * 10) / 10, width: v.width, height: v.height, mb: Math.round(bytes / 1e5) / 10 };
}

/** Bullets under a "## <heading>" section of a markdown file, continuation lines joined. */
function sectionBullets(md, heading) {
	const lines = md.split(/\r?\n/);
	const start = lines.findIndex(l => l.startsWith('## ') && l.toLowerCase().includes(heading));
	const out = [];
	for (let i = start + 1; start >= 0 && i < lines.length && !lines[i].startsWith('## '); i++) {
		if (lines[i].startsWith('- ')) {
			out.push(lines[i].slice(2).trim());
		} else if (/^\s+\S/.test(lines[i]) && out.length) {
			out[out.length - 1] += ` ${lines[i].trim()}`;
		}
	}
	return out;
}

function sectionText(md, heading) {
	const lines = md.split(/\r?\n/);
	const start = lines.findIndex(l => l.startsWith('## ') && l.toLowerCase().includes(heading));
	if (start < 0) {
		return '';
	}
	const body = [];
	for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) {
		body.push(lines[i]);
	}
	return body.join('\n').trim();
}

// "**Lead.** Long text. More." becomes "**Lead.** Long text."
const condense = b => {
	const m = b.match(/^\*\*(.+?)\*\*\s*(.*)$/);
	const first = (m ? m[2] : b).split(/(?<=[.!?])\s/)[0];
	return m ? `**${m[1].replace(/[.:]$/, '')}.** ${first}` : first;
};

function redesignStatus(slug, s) {
	const latest = s.rounds.at(-1);
	const notesFor = n => `rounds/r${n}/design-notes.md`;
	if (s.rounds.length > 1) {
		const launched = latest.arms.filter(a => a.launched_at);
		const notes = existsSync(join(studyDir(slug), notesFor(latest.n))) ? ` What changed and why: ${notesFor(latest.n)} in the study folder.` : '';
		return `Built. Round ${latest.n} tests ${latest.arms.map(a => designLabel(s, a)).join(' and ')}, consolidated from round ${latest.n - 1}; ${launched.length ? `launched ${when(launched[0].launched_at)}` : 'not launched yet'}.${notes}`;
	}
	if (existsSync(join(studyDir(slug), notesFor(latest.n + 1)))) {
		return `Being built for round ${latest.n + 1} (notes so far: ${notesFor(latest.n + 1)} in the study folder).`;
	}
	if (latest.synthesized_at) {
		return `Round ${latest.n} is synthesized; the consolidated design is next.`;
	}
	if (latest.status === 'complete') {
		return `Round ${latest.n} is complete; synthesis comes first, then the consolidated design.`;
	}
	return `Not started; it follows round ${latest.n}'s results.`;
}

async function main() {
	mkdirSync(OUT, { recursive: true });
	const MEDIA_LOG = join(OUT, 'media.json');
	const previous = readJson(MEDIA_LOG) ?? { files: [] };
	const studies = listStudies().map(slug => ({ slug, s: loadStudy(slug), ledger: loadLedger(slug) })).filter(x => x.s.status !== 'stopped');
	const many = studies.length > 1;

	// Stills.
	const chosen = studies.flatMap(({ slug, s }) => candidates(slug, s)).slice(0, MAX_IMAGES);
	const studyIndex = slug => studies.findIndex(x => x.slug === slug);
	chosen.sort((x, y) => studyIndex(x.slug) - studyIndex(y.slug)
		|| (KEYS[x.key].part === 'before' ? 0 : 1) - (KEYS[y.key].part === 'before' ? 0 : 1)
		|| (x.arm ? x.round - y.round || x.arm.arm.localeCompare(y.arm.arm) : 0)
		|| KEYS[x.key].order - KEYS[y.key].order);
	const images = chosen.map((c, i) => {
		const k = KEYS[c.key];
		const who = c.arm ? `after-${c.round > 1 ? `round${c.round}-` : ''}${safe(armSlug(c.s, c.arm))}` : 'before-today';
		const name = `${String(i + 1).padStart(2, '0')}-${many ? `${safe(c.slug)}-` : ''}${who}-${k.file}.png`;
		const caption = c.arm
			? `After: ${designLabel(c.s, c.arm)}, tested in round ${c.round}: ${k.caption}.`
			: `Before: today's product, ${k.caption}. Participants see today's product before the design.`;
		return { name, src: c.src, caption, sha256: sha(c.src) };
	});

	// Walkthroughs: the latest round's designs first, then earlier rounds.
	const videos = [];
	if (!NO_VIDEO) {
		const plan = studies.flatMap(({ slug, s }) => [...s.rounds].reverse().flatMap(r => r.arms.map(a => ({ slug, s, r, a }))));
		for (const { slug, s, r, a } of plan) {
			if (videos.length >= MAX_VIDEOS) {
				break;
			}
			const frames = [];
			for (const key of SEQUENCE) {
				const p = stillPath(slug, s, a, key);
				if (p && !frames.some(f => f.src === p)) {
					frames.push({ src: p, key });
				}
			}
			if (frames.length < 2) {
				continue;
			}
			frames.forEach((f, i) => {
				const k = KEYS[f.key];
				f.caption = `${i + 1}/${frames.length}   ${k.part === 'before' ? "BEFORE   Today's product" : `AFTER   ${designLabel(s, a)}`}: ${k.caption}`;
			});
			const name = `walkthrough-${many ? `${safe(slug)}-` : ''}${r.n > 1 ? `round${r.n}-` : ''}${safe(armSlug(s, a))}.mp4`;
			const key = createHash('sha256').update(JSON.stringify([SLIDE_S, FADE_S, VIDEO_W, VIDEO_IMG_H, STRIP_H, frames.map(f => [sha(f.src), f.caption])])).digest('hex');
			const out = join(OUT, name);
			const known = previous.files.find(f => f.name === name && f.key === key);
			try {
				const meta = known && existsSync(out) ? known.meta : buildVideo(frames, out);
				videos.push({ name, key, meta, caption: `What ${designLabel(s, a)} participants see in round ${r.n}, in order: ${frames.length} real stills, today's product first (${meta.duration} s, ${meta.mb} MB).` });
			} catch (e) {
				console.error(e.message);
			}
		}
	}

	for (const img of images) {
		const dest = join(OUT, img.name);
		if (!existsSync(dest) || sha(dest) !== img.sha256) {
			copyFileSync(img.src, dest);
		}
	}
	const keep = new Set([...images.map(i => i.name), ...videos.map(v => v.name)]);
	for (const f of previous.files) {
		if (!keep.has(f.name) && /^[\w.-]+$/.test(f.name)) {
			rmSync(join(OUT, f.name), { force: true });
		}
	}

	// The summary.
	const lines = [];
	const L = s => lines.push(s ?? '');
	const total = studies.reduce((t, x) => t + committedSpend(x.ledger), 0);
	L('# Research loop: morning summary');
	L();
	// A stalled session first of all: a session waiting for an approval nobody can give hangs silently, and an
	// automation run that hangs can block that automation's later runs.
	const stallScan = loadStalls();
	if (stallScan?.stalls?.length) {
		L('## Stalled sessions: waiting for an approval nobody can give');
		L();
		for (const st of stallScan.stalls) {
			L(`- Session ${st.session.slice(0, 8)} ("${st.prompt}"): waiting since ${when(st.since)} (${st.minutes} min) for ${st.kind}: ${st.what}. Approve or stop it in the Agents window.`);
		}
		L();
	}
	// The Outset publish gate first, while any arm waits on it: the study links, the gate status and each study's exact
	// state. The API can neither request a review nor see the review queue, so whether Submit for review was clicked is
	// what someone recorded (gate.mjs --review: the arm's outset_gate.review_requested_at or not_submitted_confirmed_at).
	const gateShown = new Set();
	const reviewKind = g => g.state === 'awaiting-admin-approval' ? (g.review_requested_at ? 'submitted' : 'not-submitted') : g.state;
	const GATE_HEAD = {
		'not-submitted': 'not recorded as submitted for review',
		submitted: 'submitted for review, waiting for an admin to approve',
		live: 'open, recruiting launches on the next check',
		publishable: 'open, recruiting launches on the next check',
		'not-ready': 'not ready to publish',
	};
	for (const { slug, s, ledger } of studies) {
		const r = s.rounds.at(-1);
		const gated = r.arms.filter(a => !a.launched_at && a.outset_gate);
		if (!gated.length) {
			continue;
		}
		const kinds = new Set(gated.map(a => reviewKind(a.outset_gate)));
		const heads = [...new Set([...kinds].map(k => GATE_HEAD[k] ?? k))];
		const open = kinds.has('live') || kinds.has('publishable');
		L(`## Outset publish gate${many ? ` (${s.title})` : ''}: ${heads.length === 1 ? heads[0] : open ? 'open for some studies, see each one' : 'waiting on Submit for review and an admin\'s approval'}`);
		L();
		for (const a of gated) {
			const g = a.outset_gate;
			const k = reviewKind(g);
			const tries = ledger.entries.filter(e => e.type === 'blocked' && e.arm === a.arm && Number(e.round) === r.n && /approval/i.test(e.reason ?? '')).map(e => when(e.at));
			const state = k === 'not-submitted' ? `not recorded as submitted (${g.review_note ?? 'Outset\'s API can\'t show it'})`
				: k === 'submitted' ? `submitted for review ${when(g.review_requested_at)}, waiting for an admin to approve${g.review_note ? ` (${g.review_note})` : ''}`
					: k === 'live' ? 'approved and live; its recruiting launches on the next check'
						: k === 'publishable' ? 'approved; the loop publishes it and launches recruiting on the next check'
							: `not ready (${(g.issues ?? []).join(', ')})`;
			const waiting = k === 'not-submitted' || k === 'submitted';
			const list = xs => xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
			L(`- **${capitalize(armLabel(s, a))}: ${state}.** ${a.outset?.study_url ?? ''}`);
			L(`  ${waiting ? `Publishing has needed an admin's approval since ${when(g.since)}; gate` : 'Gate'} checked ${when(g.checked_at)}.${tries.length ? ` Publish was tried through the API at ${list(tries)}; Outset refused ${tries.length > 1 ? 'each try' : 'it'} pending approval.` : ''}`);
			if (a.outset?.study_url) {
				gateShown.add(a.outset.study_url);
			}
		}
		if (kinds.has('not-submitted')) {
			L();
			L('**Do this first: click Submit for review** in Outset on each study above that is not recorded as submitted; then an admin approves it. If the page says it\'s already submitted, clicking again is harmless. Outset\'s API cannot submit a study for review or show the review queue, so the loop cannot do this step or see it done. The state above changes when someone records the click (for example a comment on the study\'s issue) or when an admin approves.');
		}
		if (r.gate_dm?.sent_at) {
			L();
			L(`A DM about it went to you at ${when(r.gate_dm.sent_at)}.`);
		}
		// Notes for this round's gate only (for example who was asked to approve), local and never published; without
		// them, what happens after approval comes from the study's state.
		const help = join(studyDir(slug), 'rounds', `r${r.n}`, 'gate-help.local.md');
		if (existsSync(help)) {
			L();
			L(readFileSync(help, 'utf8').trim());
		} else if (kinds.has('not-submitted') || kinds.has('submitted')) {
			L();
			L(afterApproval(s, ledger, r));
		}
		L();
	}
	// A launch the loop stopped on purpose (a failed participant link check) goes first, above everything else.
	const alerts = studies.flatMap(x => (x.s.launch_alerts ?? []).map(a => `${x.s.title}: ${a.text}`));
	if (alerts.length) {
		L('## Launch stopped');
		L();
		alerts.forEach(a => L(`- ${a}`));
		L();
	}
	L(`Generated ${when(new Date().toISOString())} (${CONFIG.timezone}). Spent so far: ${money(total)} across ${studies.length} ${studies.length === 1 ? 'study' : 'studies'}.${stallScan && !stallScan.stalls?.length ? ` No session is waiting for an approval (${stallScan.scanned} checked ${when(stallScan.at)}).` : ''}`);
	L();
	const needs = studies.flatMap(x => (x.s.needs_you ?? [])
		.filter(n => !(x.s.launch_alerts ?? []).some(a => a.text === n))
		.filter(n => ![...gateShown].some(url => n.includes(url)))
		.map(n => `${x.s.title}: ${n}`));
	if (needs.length) {
		L('## Do this first');
		needs.forEach(n => L(`- ${n}`));
		L();
	}
	for (const { slug, s, ledger } of studies) {
		const latest = s.rounds.at(-1);
		const per = s.criteria?.finish_line?.participants_per_round ?? 5;
		L(`## ${s.title}`);
		L();
		L(`**Status:** round ${latest.n} of at most ${s.budget?.max_rounds ?? 3}. ${s.status_line ?? s.status}.`);
		const ends = deadlineOf(s);
		if (ends) {
			L(`**Ends:** ${when(ends)}, ${limitsOf(s).study_hours} hours after the first launch, whether or not the finish line is met. Recruiting stops ${when(recruitingStopOf(s))}.`);
		}
		const launchedArms = s.rounds.flatMap(r => r.arms).filter(a => a.launched_at);
		const roundsDone = s.rounds.map(r => r.arms.some(a => a.launched_at)
			? `round ${r.n}: ${r.arms.reduce((n, a) => n + (a.counts?.completed ?? 0), 0)} of ${per * r.arms.length} (${r.arms.map(a => `${armLabel(s, a)}: ${a.counts?.completed ?? 0} of ${per}${a.counts?.in_progress ? `, ${a.counts.in_progress} in progress` : ''}`).join('; ')})`
			: `round ${r.n}: not launched yet`);
		L(`**Interviews done:** ${launchedArms.length ? roundsDone.join('; ') : `none yet; round ${latest.n} has not launched`}.`);
		L();
		for (const r of s.rounds) {
			for (const a of r.arms) {
				const an = readJson(join(studyDir(slug), 'rounds', `r${r.n}`, `arm-${a.arm}`, 'analysis.json'));
				const fl = an?.finish_line;
				const rec = a.recruiting;
				const state = a.launched_at
					? `launched ${when(a.launched_at)}; ${a.counts?.completed ?? 0} of ${per} interviews done${rec ? `; User Interviews: ${rec.approved ?? 0} approved, ${rec.submitted ?? 0} submitted` : ''}`
					: 'not launched';
				L(`- **Round ${r.n}, ${designLabel(s, a)}**: ${state}.${fl ? ` Finish line: ${fl.main_task_without_help} of ${fl.n} without help, ${fl.blocking} blocking, taste ${fl.taste}; ${fl.met ? 'met' : 'not met'}.` : ''}`);
				for (const f of (an?.findings ?? []).slice(0, 3)) {
					const q = [...(f.quotes ?? [])].filter(x => x?.text).sort((x, y) => x.text.length - y.text.length)[0];
					const known = [f.prior === 'new' ? 'new' : f.prior ? `prior ${f.prior}` : null, f.answers ? `answers ${f.answers}` : null].filter(Boolean);
					L(`  - ${f.claim} (${f.count}${known.length ? `; ${known.join(', ')}` : ''})${q ? `: "${q.text}" ([${q.label}](${q.url}))` : ''}`);
				}
			}
		}
		L();
		{
			const cmp = compareLines(s.rounds.flatMap(r => r.arms.map(a => ({ label: `Round ${r.n}, ${armLabel(s, a)}`, analysis: readJson(join(studyDir(slug), 'rounds', `r${r.n}`, `arm-${a.arm}`, 'analysis.json')) }))), { maxPages: 2 });
			L(`**${compareTitle()}:**${cmp.length ? '' : ` not yet. Round ${latest.n}'s synthesis sets each finding against it (confirms, contradicts, extends or new), with links.`}`);
			cmp.forEach(l => L(l));
			L();
		}
		L(`**Redesign:** ${redesignStatus(slug, s)}`);
		const launches = ledger.entries.filter(e => e.type === 'launch');
		L(`**Spend:** ${money(committedSpend(ledger))} committed of the ${money(s.budget?.program_cap_usd ?? 1000)} ceiling${launches.length ? ` (${launches.map(e => `round ${e.round} ${e.arm} ${money(e.cost_usd_with_allowance)}`).join(', ')})` : ''}.`);
		const confirmations = confirmationLines(ledger);
		if (confirmations.length) {
			L(`**Email confirmations:** ${confirmations.join('; ')}.`);
		}
		L(`**Next:** ${s.next_action ?? 'nothing scheduled'}`);
		L();
		const links = [`[report](https://github.com/${LOOP_REPO}/blob/main/private/studies/${slug}/report.md)`];
		if (s.github?.issue?.url) {
			links.push(`[issue](${s.github.issue.url})`);
		}
		if (existsSync(join(studyDir(slug), 'retrospective.md'))) {
			links.push(`[retrospective](https://github.com/${LOOP_REPO}/blob/main/private/studies/${slug}/retrospective.md)`);
		}
		for (const a of latest.arms) {
			if (a.outset?.study_url) {
				links.push(`[Outset, ${armLabel(s, a)}](${a.outset.study_url})`);
			}
			if (a.ui?.url) {
				links.push(`[User Interviews, ${armLabel(s, a)}](${a.ui.url})`);
			}
		}
		L(`Links: ${links.join(' · ')}`);
		L();
		const retro = existsSync(join(studyDir(slug), 'retrospective.md')) ? readFileSync(join(studyDir(slug), 'retrospective.md'), 'utf8') : null;
		if (retro) {
			L(`### How the night went`);
			L();
			const headline = sectionText(retro, 'headline').split(/\n\s*\n/)[0];
			if (headline) {
				L(headline.replace(/\s*\n\s*/g, ' '));
				L();
			}
			const good = sectionBullets(retro, 'what went well');
			const bad = sectionBullets(retro, 'what did not go well');
			if (good.length) {
				L('Went well:');
				good.forEach(b => L(`- ${condense(b)}`));
				L();
			}
			if (bad.length) {
				L("Didn't go well:");
				bad.forEach(b => L(`- ${condense(b)}`));
				L();
			}
		}
		for (const r of s.reminders ?? []) {
			L(`Reminder: ${r}`);
		}
		if (s.reminders?.length) {
			L();
		}
	}
	L('## Emails from Outset and User Interviews');
	L();
	L(renderMail(loadMailLog()));
	L();
	L('## Media in this folder');
	L();
	images.forEach(i => L(`- ${i.name}: ${i.caption}`));
	videos.forEach(v => L(`- ${v.name}: ${v.caption}`));
	if (!images.length && !videos.length) {
		L('- none yet');
	}
	L();
	const text = lines.join('\n').replace(/[\u2013\u2014]/g, '-');
	writeFileSync(join(OUT, 'morning-summary.md'), text);
	writeFileSync(MEDIA_LOG, JSON.stringify({
		at: new Date().toISOString(),
		files: [...images.map(i => ({ name: i.name, sha256: i.sha256, caption: i.caption, source: i.src })), ...videos.map(v => ({ name: v.name, key: v.key, meta: v.meta, caption: v.caption }))],
	}, null, 1));
	return { out: OUT, chars: text.length, images: images.map(i => i.name), videos: videos.map(v => ({ name: v.name, ...v.meta })) };
}

const result = await withLock(join(STATE_DIR, 'locks', 'morning.lock'), main, { label: 'the morning folder lock', timeoutMs: 5 * 60e3, staleMs: 30 * 60e3 });
console.log(JSON.stringify(result, null, 1));

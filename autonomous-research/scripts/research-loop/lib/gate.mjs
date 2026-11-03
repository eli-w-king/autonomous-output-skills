// The publish gate for each arm of a study's current round. Is its Outset study live, publishable, waiting for an
// organization admin's approval, or not ready? The state of each arm is recorded in study.json (`outset_gate`, with
// when it was last checked and since when it has held). On request, each arm whose study is live or publishable
// launches through launch.mjs: budget check, a lock per arm, the participant check, and a ledger re-read before the
// click. run.mjs (every run) and gate.mjs (the quick gate checks) share this, so the decision lives in one place.
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateStudy, addHistory } from './state.mjs';
import { outsetRest } from './outset.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');

export function runLaunch(slug, round, arm) {
	const r = spawnSync(process.execPath, [join(SCRIPTS, 'launch.mjs'), '--study', slug, '--round', String(round), '--arm', arm], { encoding: 'utf8', timeout: 20 * 60_000 });
	return { code: r.status, out: (r.stdout || '').trim().split('\n').slice(-4).join(' | '), err: (r.stderr || '').trim().slice(-300) };
}

export async function checkGates(slug, study, everyday, { launch = true } = {}) {
	const round = study.rounds[study.rounds.length - 1];
	const now = new Date().toISOString();
	const out = [];
	const seen = {};
	for (const a of round.arms) {
		if (a.launched_at || !a.stimulus?.verified_at) {
			continue;
		}
		const rest = await outsetRest(`/v1/studies/${a.outset.study_id}/`);
		const v = JSON.parse(await everyday.call('validate_study', { study_id: a.outset.study_id }));
		const issues = (v.issues ?? []).map(i => i.code);
		const state = rest.body?.active ? 'live'
			: v.ready_to_publish ? 'publishable'
				: issues.length && issues.every(c => c === 'approval_required') ? 'awaiting-admin-approval'
					: 'not-ready';
		seen[a.arm] = { state, issues };
		const entry = { arm: a.arm, outset: state, ...(state === 'not-ready' ? { issues } : {}) };
		if (launch && (state === 'live' || state === 'publishable')) {
			entry.launch = runLaunch(slug, round.n, a.arm);
		}
		out.push(entry);
	}
	if (Object.keys(seen).length) {
		await updateStudy(slug, s => {
			const r = s.rounds[s.rounds.length - 1];
			for (const a of r.arms) {
				const g = seen[a.arm];
				if (!g) {
					continue;
				}
				const prev = a.outset_gate ?? {};
				a.outset_gate = { ...prev, state: g.state, issues: g.issues, checked_at: now, since: prev.state === g.state ? (prev.since ?? now) : now };
				if (prev.state && prev.state !== g.state) {
					addHistory(s, `round ${r.n} arm ${a.arm}: the Outset gate went from ${prev.state} to ${g.state}`);
				}
			}
		});
	}
	return out;
}

export const REVIEW_STATES = ['submitted', 'not-submitted'];

/**
 * Record whether Submit for review was clicked for arms of the current round. Outset's API can neither request a review
 * nor show the review queue (a study's language status, such as REVIEWED, is the translation review), so this is
 * recorded from whoever knows: the owner, a coordinating chat, or an Outset email. `submitted` sets the arm's
 * outset_gate.review_requested_at; `not-submitted` clears it and records when, so the arm reads "not recorded as
 * submitted". An optional short note (for example why nothing is recorded) is shown with the state; recording again
 * without one removes the old note.
 */
export async function recordReview(slug, arms, { state, at = new Date().toISOString(), by = 'unknown', note }) {
	if (!REVIEW_STATES.includes(state)) {
		throw new Error(`the review state must be ${REVIEW_STATES.join(' or ')}, not "${state}"`);
	}
	if (Number.isNaN(new Date(at).getTime())) {
		throw new Error(`not a time: "${at}"`);
	}
	return updateStudy(slug, s => {
		const r = s.rounds[s.rounds.length - 1];
		const unknown = (arms ?? []).filter(x => !r.arms.some(a => a.arm === x));
		if (unknown.length) {
			throw new Error(`round ${r.n} has no arm ${unknown.join(', ')}`);
		}
		const done = [];
		for (const a of r.arms.filter(x => !arms?.length || arms.includes(x.arm))) {
			const g = a.outset_gate ??= {};
			if (state === 'submitted') {
				g.review_requested_at = new Date(at).toISOString();
				delete g.not_submitted_confirmed_at;
			} else {
				delete g.review_requested_at;
				g.not_submitted_confirmed_at = new Date(at).toISOString();
			}
			g.review_recorded_by = by;
			if (note) {
				g.review_note = note;
			} else {
				delete g.review_note;
			}
			addHistory(s, `round ${r.n} arm ${a.arm}: Submit for review recorded as ${state} (${by})`);
			done.push(a.arm);
		}
		return done;
	});
}
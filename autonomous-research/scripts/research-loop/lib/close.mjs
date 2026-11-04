// Closing a finished round's arm on both platforms, guarded like the launcher: a guard on when it may happen, a dry
// run, a ledger entry for every check and action, and a read-back of every change. close.mjs runs it against the real
// platforms; the tests run it against a fake one.
//
// When: a round's projects close when the round is complete (its participant target or its time cap), when the study's
// recruiting stops (the deadline minus the response window), at the deadline, or once the study has ended. Never while
// a round is still recruiting before then.
// Before: step 4b has paid or rejected every Submitted participant. User Interviews enforces the same thing itself: its
// close pre-check refuses while any participation is unmarked or a session is scheduled.
// Order, per arm:
//   1. Outset: unpublish through the launch connection, so no new interview starts (interviews under way are not
//      interrupted); read back `active: false`. Outset's permanent Close lives only in its web app (and Outset closes
//      a study by itself after 30 days); unpublishing is what stops new interviews from the API.
//   2. User Interviews: the close pre-check, then a close request (the app's own "Close project"), which stops
//      recruiting; read back status 9, Pending Close Request. User Interviews' team then finishes the close.
import { studyPhase, recruitingStopOf, deadlineOf } from './deadline.mjs';

export const UI_STATUS = Object.freeze({ DRAFT: 0, LAUNCHED: 1, CURRENTLY_RECRUITING: 2, DONE_RECRUITING: 4, COMPLETE_REQUESTED_PAYMENT: 5, COMPLETE_CHARGED: 6, COMPLETE_CANCELED: 7, COMPLETE_DECLINED: 8, PENDING_CLOSE_REQUEST: 9 });
/** User Interviews project statuses that mean recruiting has ended: Completed (5 to 8) or Pending Close Request (9). */
export const UI_CLOSED = new Set([5, 6, 7, 8, 9]);
/** "Do you consider this project a success?" in User Interviews' close request. */
export const UI_SUCCESS = Object.freeze({ yes: 1, no: 2 });
const ENDED = new Set(['done', 'stopped', 'handed-to-owner']);
const CODE_RANK = { 0: 0, 4: 1, 5: 2, 1: 3 };
const worst = (a, b) => (CODE_RANK[b] > CODE_RANK[a] ? b : a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Whether an arm may be closed now, and why; or why not. */
export function closeGuard(study, round, arm, now = Date.now()) {
	if (!arm?.launched_at) {
		return { ok: false, nothing: true, reason: `arm ${arm?.arm ?? '?'} never launched, so there is nothing to close` };
	}
	if (ENDED.has(study.status)) {
		return { ok: true, reason: 'study-ended' };
	}
	const phase = studyPhase(study, now);
	if (phase === 'past-deadline') {
		return { ok: true, reason: 'deadline' };
	}
	if (phase === 'response-window') {
		return { ok: true, reason: 'recruiting-stop' };
	}
	if (round?.status === 'complete') {
		return { ok: true, reason: 'round-complete' };
	}
	return {
		ok: false,
		reason: `round ${round?.n} is still ${round?.status ?? 'open'}; its projects close when the round is complete, when recruiting stops (${recruitingStopOf(study) ?? 'no deadline yet'}) or at the deadline (${deadlineOf(study) ?? 'none yet'})`,
	};
}

const paidCount = (ledger, roundN, armName) => (ledger?.entries ?? []).filter(e => e.type === 'payment' && Number(e.round) === Number(roundN) && e.arm === armName).length;

/** The text User Interviews' project coordinator reads with the close request: plain facts, no names. */
export function closeDetails(study, round, arm, ledger, reason) {
	const target = study.criteria?.finish_line?.participants_per_round ?? 5;
	const completed = arm.counts?.completed ?? 0;
	const paid = paidCount(ledger, round.n, arm.arm);
	const why = {
		'round-complete': round.capped ? 'reached its time limit' : 'reached its participant target',
		'recruiting-stop': 'reached the point where the study stops recruiting',
		deadline: 'reached the study\'s deadline',
		'study-ended': 'ended',
	}[reason] ?? 'ended';
	return `This round of the study ${why}. ${completed} of ${target} participants completed it, and ${paid} ${paid === 1 ? 'was' : 'were'} paid. We no longer need to recruit for this project.`;
}

/** Yes when the arm has at least the round's minimum of completed interviews to synthesize (3 by default), else No. */
export function successAnswer(study, arm) {
	const min = study.round_time_cap?.min_completes_per_arm_to_synthesize ?? 3;
	return (arm.counts?.completed ?? 0) >= min ? UI_SUCCESS.yes : UI_SUCCESS.no;
}

/** What to do on each platform, from what the platforms report now. */
export function planClose({ ui, outset, only = 'all' }) {
	const steps = [];
	if (only !== 'ui') {
		steps.push(outset?.active === false
			? { platform: 'outset', action: 'none', why: 'already unpublished (no new interviews can start)' }
			: { platform: 'outset', action: 'unpublish', why: 'stop new interviews from starting' });
	}
	if (only !== 'outset') {
		const submitted = Number(ui?.tabs?.submitted ?? 0);
		if (ui?.signed_in === false) {
			steps.push({ platform: 'user-interviews', action: 'blocked', why: 'User Interviews needs a sign-in (the loop never types a password)' });
		} else if (UI_CLOSED.has(Number(ui?.status_id))) {
			steps.push({ platform: 'user-interviews', action: 'none', why: `already ${ui.status ?? `status ${ui.status_id}`}` });
		} else if (submitted > 0) {
			steps.push({ platform: 'user-interviews', action: 'blocked', why: `${submitted} Submitted participant${submitted === 1 ? '' : 's'} to pay or reject first (step 4b)` });
		} else if (!ui?.precheck?.ok) {
			steps.push({ platform: 'user-interviews', action: 'blocked', why: `User Interviews will not close it yet: ${(ui?.precheck?.errors ?? ['its close check failed']).join('; ')}` });
		} else {
			steps.push({ platform: 'user-interviews', action: 'close-request', why: 'stop recruiting' });
		}
	}
	return steps;
}

async function readBack(fn, ok, { tries = 3, waitMs = 2000 } = {}) {
	let last;
	for (let i = 0; i < tries; i++) {
		last = await fn();
		if (ok(last)) {
			return { ok: true, state: last };
		}
		if (i < tries - 1) {
			await sleep(waitMs);
		}
	}
	return { ok: false, state: last };
}

/**
 * Plan and, unless `dryRun`, carry out the close of one arm.
 *   platform.uiState(arm)        -> { signed_in, status_id, status, tabs: { submitted, started, ... }, precheck: { ok, errors } }
 *   platform.uiClose(arm, attrs) -> resolves when User Interviews accepted the close request, throws otherwise
 *   platform.outsetState(arm)    -> { active }
 *   platform.outsetClose(arm)    -> resolves when unpublish_study returned, throws otherwise
 *   record(entry)                -> appends to the study's ledger
 *   update(fn)                   -> updates study.json (fn gets the study)
 * Returns { code, reason, steps }. Codes: 0 closed or nothing left to close; 3 refused (not allowed now); 4 blocked by a
 * platform (for example a participant to mark first; run it again later); 5 an action failed or its read-back did not
 * confirm it; 1 error.
 */
export async function closeArm({ study, ledger, roundN, armName, now = Date.now(), dryRun = false, only = 'all', success, platform, record, update, readBackOpts }) {
	const round = (study.rounds ?? []).find(r => Number(r.n) === Number(roundN));
	const arm = round?.arms?.find(a => a.arm === armName);
	if (!arm) {
		throw new Error(`round ${roundN} has no arm ${armName}`);
	}
	const base = { round: Number(roundN), arm: armName, outset_study: arm.outset?.study_id ?? null, ui_project: arm.ui?.project_id ?? null, dry_run: dryRun };
	const guard = closeGuard(study, round, arm, now);
	if (!guard.ok) {
		await record({ type: dryRun ? 'close-dry-run' : 'close-refused', ...base, reasons: [guard.reason] });
		return { code: guard.nothing ? 0 : 3, reason: guard.reason, steps: [] };
	}
	const outset = only !== 'ui' ? await platform.outsetState(arm) : null;
	const ui = only !== 'outset' ? await platform.uiState(arm) : null;
	const steps = planClose({ ui, outset, only });
	const before = {
		...(outset ? { outset_before: { active: outset.active } } : {}),
		...(ui ? { ui_before: { status_id: ui.status_id ?? null, status: ui.status ?? null, tabs: ui.tabs ?? null, precheck: ui.precheck ?? null } } : {}),
	};
	await record({ type: dryRun ? 'close-dry-run' : 'close-check', ...base, reason: guard.reason, plan: steps, ...before });
	if (dryRun) {
		return { code: steps.some(s => s.action === 'blocked') ? 4 : 0, reason: guard.reason, steps };
	}

	let code = 0;
	const at = () => new Date().toISOString();
	const setClose = (key, value) => update(s => {
		const a = s.rounds.find(r => Number(r.n) === Number(roundN)).arms.find(x => x.arm === armName);
		a.close = { ...(a.close ?? {}), reason: guard.reason, [key]: value };
		s.history ??= [];
		s.history.push({ at: value.at, event: `round ${roundN} arm ${armName}: ${key === 'outset' ? 'Outset' : 'User Interviews'} ${value.state}${value.why ? ` (${value.why})` : ''}` });
	});

	for (const step of steps) {
		if (step.platform === 'outset' && step.action === 'unpublish') {
			try {
				await platform.outsetClose(arm);
				const rb = await readBack(() => platform.outsetState(arm), st => st?.active === false, readBackOpts);
				if (rb.ok) {
					await record({ type: 'close', platform: 'outset', ...base, reason: guard.reason, before: { active: true }, after: { active: false }, how: 'unpublish_study (launch connection); read back active false' });
					await setClose('outset', { state: 'closed', at: at(), how: 'unpublished' });
				} else {
					await record({ type: 'close-unverified', platform: 'outset', ...base, after: rb.state ?? null });
					await setClose('outset', { state: 'unverified', at: at(), why: 'unpublish returned, but the study still reads active' });
					code = worst(code, 5);
				}
			} catch (e) {
				await record({ type: 'close-failed', platform: 'outset', ...base, error: String(e.message).slice(0, 400) });
				code = worst(code, 5);
			}
		} else if (step.platform === 'user-interviews' && step.action === 'close-request') {
			const attrs = { details: closeDetails(study, round, arm, ledger, guard.reason), projectConsideredSuccessfulId: success ?? successAnswer(study, arm) };
			try {
				await platform.uiClose(arm, attrs);
				const rb = await readBack(() => platform.uiState(arm), st => UI_CLOSED.has(Number(st?.status_id)), readBackOpts);
				if (rb.ok) {
					await record({ type: 'close', platform: 'user-interviews', ...base, reason: guard.reason, before: { status_id: ui.status_id, status: ui.status }, after: { status_id: rb.state.status_id, status: rb.state.status }, answer: attrs, how: 'close request (the app\'s Close project); read back the project status' });
					await setClose('ui', { state: rb.state.status_id === UI_STATUS.PENDING_CLOSE_REQUEST ? 'close requested' : 'closed', status: rb.state.status ?? null, at: at() });
				} else {
					await record({ type: 'close-unverified', platform: 'user-interviews', ...base, after: { status_id: rb.state?.status_id ?? null, status: rb.state?.status ?? null } });
					await setClose('ui', { state: 'unverified', at: at(), why: 'the close request returned, but the project status did not change' });
					code = worst(code, 5);
				}
			} catch (e) {
				await record({ type: 'close-failed', platform: 'user-interviews', ...base, error: String(e.message).slice(0, 400) });
				code = worst(code, 5);
			}
		} else if (step.action === 'blocked') {
			await record({ type: 'close-blocked', platform: step.platform, ...base, why: step.why });
			await setClose(step.platform === 'outset' ? 'outset' : 'ui', { state: 'blocked', at: at(), why: step.why });
			code = worst(code, 4);
		}
	}
	return { code, reason: guard.reason, steps };
}

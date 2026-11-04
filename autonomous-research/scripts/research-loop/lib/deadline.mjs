// When a study and its rounds must end. Every study ends at its deadline: `deadline_at` in study.json when set, otherwise
// its first launch plus the study limit (72 hours by default). Recruiting stops everywhere a response window (6 hours by
// default) before the deadline, so interviews already under way can finish and be paid. A round may launch only when
// its full time cap fits before recruiting stops. Pure functions over study.json; times are ISO strings.
const H = 3600e3;
const ms = t => (t == null || t === '' ? NaN : typeof t === 'number' ? t : Date.parse(t));
const iso = t => new Date(t).toISOString();

export const LIMIT_DEFAULTS = Object.freeze({ study_hours: 72, response_window_hours: 6 });

export function limitsOf(study) {
	return { ...LIMIT_DEFAULTS, ...(study?.limits ?? {}) };
}

/** The first launch of any arm in any round, or null before any launch. */
export function firstLaunch(study) {
	const ts = (study?.rounds ?? []).flatMap(r => r.arms ?? []).map(a => ms(a.launched_at)).filter(Number.isFinite);
	return ts.length ? iso(Math.min(...ts)) : null;
}

/** The study's deadline, or null before its first launch when none is set. */
export function deadlineOf(study) {
	if (Number.isFinite(ms(study?.deadline_at))) {
		return iso(ms(study.deadline_at));
	}
	const first = firstLaunch(study);
	return first ? iso(ms(first) + limitsOf(study).study_hours * H) : null;
}

/** When recruiting stops everywhere: the deadline minus the response window. */
export function recruitingStopOf(study) {
	const d = deadlineOf(study);
	return d ? iso(ms(d) - limitsOf(study).response_window_hours * H) : null;
}

/** `not-started` (no deadline yet), `open`, `response-window` (recruiting stopped) or `past-deadline`. */
export function studyPhase(study, now = Date.now()) {
	const d = deadlineOf(study);
	if (!d) {
		return 'not-started';
	}
	if (ms(now) >= ms(d)) {
		return 'past-deadline';
	}
	return ms(now) >= ms(recruitingStopOf(study)) ? 'response-window' : 'open';
}

/**
 * Whether an arm may launch now under the study's time limits. A round recruits for up to its time cap
 * (`round_time_cap.hours_after_launch`, 10 by default), so it may launch only when that whole cap ends at or before the
 * recruiting stop. Before any launch and without `deadline_at` there is no deadline yet, so the first launch passes.
 */
export function launchWindow(study, now = Date.now()) {
	const deadline = deadlineOf(study);
	const stop = recruitingStopOf(study);
	if (!deadline) {
		return { ok: true, deadline: null, recruiting_stop: null, latest_launch: null };
	}
	const capH = Number(study.round_time_cap?.hours_after_launch ?? 10);
	const latest = iso(ms(stop) - capH * H);
	const base = { deadline, recruiting_stop: stop, latest_launch: latest };
	if (ms(now) >= ms(deadline)) {
		return { ok: false, ...base, reason: `the study ended at its deadline (${deadline})` };
	}
	if (ms(now) >= ms(stop)) {
		return { ok: false, ...base, reason: `recruiting stopped at ${stop}, ${limitsOf(study).response_window_hours} hours before the study's deadline (${deadline})` };
	}
	if (ms(now) > ms(latest)) {
		return { ok: false, ...base, reason: `a round needs its ${capH} hour time cap before recruiting stops at ${stop}; the latest launch was ${latest}` };
	}
	return { ok: true, ...base };
}

/** When a recruiting round closes: its own `closes_at`, but never after the recruiting stop. */
export function roundClosesAt(study, round) {
	const own = ms(round?.closes_at);
	const stop = ms(recruitingStopOf(study));
	const t = [own, stop].filter(Number.isFinite);
	return t.length ? iso(Math.min(...t)) : null;
}

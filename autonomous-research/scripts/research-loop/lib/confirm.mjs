// Confirmations of close-outs and payouts, checked on runs after the event (never by waiting inside a chat).
// First by email: the run's agent searches the owner's mailbox for mail from each platform (the same Work IQ search as
// the email check), and this module matches it against what the loop did, found or not, in the ledger (`confirm`
// entries). When no email has come after two checks, the run checks the platform itself, read only, with the calls
// close.mjs and run.mjs already make (a User Interviews project's status and paid count, an Outset study's `active`),
// and records the result (`confirm-platform` entries): "confirmed on the platform" when it matches the ledger, and a
// "Needs you" note only when it does not. A search or a read that failed (Work IQ answering 429, a signed-out browser,
// an HTTP error) is not a check; the next run tries again. Subjects are not stored: a payout email can name a
// participant, and the ledger is published.
import { CONFIG } from './config.mjs';
import { UI_CLOSED } from './close.mjs';

export const CONFIRM = Object.freeze({ min_age_minutes: 20, max_checks: 2 });
const PLATFORM = {
	outset: { name: 'Outset', domain: 'outset.ai' },
	'user-interviews': { name: 'User Interviews', domain: 'userinterviews.com' },
};
const dayOf = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: CONFIG.timezone });
const when = iso => new Date(iso).toLocaleString('en-US', { timeZone: CONFIG.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** What should be confirmed, from the ledger: one per close, and one per User Interviews project and day of payouts. */
export function expectations(ledger) {
	const groups = new Map();
	for (const e of ledger?.entries ?? []) {
		if (e.type === 'close' && PLATFORM[e.platform]) {
			const ref = String(e.platform === 'outset' ? e.outset_study : e.ui_project);
			const key = `close:${e.platform}:${ref}`;
			if (!groups.has(key)) {
				groups.set(key, { key, kind: 'close', platform: e.platform, ref, round: e.round, arm: e.arm, since: e.at, count: 1 });
			}
		} else if (e.type === 'payment' && e.ui_project) {
			const t = e.paid_at ?? e.at;
			const key = `payout:user-interviews:${e.ui_project}:${dayOf(t)}`;
			const g = groups.get(key);
			if (g) {
				g.count++;
				g.since = Date.parse(t) < Date.parse(g.since) ? t : g.since;
			} else {
				groups.set(key, { key, kind: 'payout', platform: 'user-interviews', ref: String(e.ui_project), round: e.round, arm: e.arm, since: t, day: dayOf(t), count: 1 });
			}
		}
	}
	for (const g of groups.values()) {
		const checks = (ledger.entries ?? []).filter(e => e.type === 'confirm' && e.key === g.key);
		g.found = checks.find(c => c.found) ?? null;
		g.checks = checks.filter(c => !c.found).length;
		g.platform_check = (ledger.entries ?? []).filter(e => e.type === 'confirm-platform' && e.key === g.key).at(-1) ?? null;
	}
	return [...groups.values()];
}

/** Still waiting for an email: not found and fewer than the maximum checks. */
export const emailPending = (ledger, opts = CONFIRM) => expectations(ledger).filter(g => !g.found && g.checks < opts.max_checks);

/** No email after the last check and not checked on the platform yet: the run checks the platform itself. */
export const platformDue = (ledger, opts = CONFIRM) => expectations(ledger).filter(g => !g.found && g.checks >= opts.max_checks && !g.platform_check);

/** Still open either way (this keeps the schedule running for a study that has ended). */
export const pending = (ledger, opts = CONFIRM) => [...emailPending(ledger, opts), ...platformDue(ledger, opts)];

/** Due for an email check on this run: still waiting, and the event happened a little while ago (a later run). */
export function due(ledger, now = Date.now(), opts = CONFIRM) {
	return emailPending(ledger, opts).filter(g => now - Date.parse(g.since) >= opts.min_age_minutes * 60e3);
}

export function label(g, names = {}) {
	const what = names[g.key] ? ` (${names[g.key]})` : '';
	return g.kind === 'close'
		? `closing ${g.platform === 'outset' ? `Outset study ${g.ref.slice(0, 8)}` : `User Interviews project ${g.ref}`}${what}`
		: `${g.count} payout${g.count === 1 ? '' : 's'} in User Interviews project ${g.ref} on ${g.day}${what}`;
}

/** Every message in a saved Work IQ fetch result ({ results: [{ data: { value: [...] } }] }). */
export function messagesOf(fetchResult) {
	const all = (fetchResult?.results ?? [fetchResult]).flatMap(r => r?.data?.value ?? r?.value ?? []);
	return [...new Map(all.filter(m => m?.id).map(m => [m.id, m])).values()];
}

const fromDomain = (m, domain) => {
	const d = String(m.from?.emailAddress?.address ?? '').toLowerCase().split('@')[1] ?? '';
	return d === domain || d.endsWith(`.${domain}`);
};

/** The email that confirms a group, or null. `name` is the study or project name the platform puts in its subject. */
export function matchConfirmation(g, messages, name = '') {
	const { domain } = PLATFORM[g.platform];
	const after = Date.parse(g.since) - 5 * 60e3;
	const has = (s, x) => Boolean(x) && s.toLowerCase().includes(String(x).toLowerCase());
	const test = g.kind === 'payout'
		? s => /\b(paid|payment|payout|incentive|reward|receipt|invoice|charge)/i.test(s)
		: g.platform === 'outset'
			? s => /has completed|\bclosed\b|\bended\b/i.test(s) && (has(s, name) || has(s, g.ref))
			: s => /clos|complet|ended|wrap|finish/i.test(s) && (has(s, g.ref) || has(s, name));
	return messages
		.filter(m => fromDomain(m, domain) && Date.parse(m.receivedDateTime) >= after && test(String(m.subject ?? '')))
		.sort((a, b) => Date.parse(a.receivedDateTime) - Date.parse(b.receivedDateTime))[0] ?? null;
}

/**
 * Check the due groups against the messages. Returns ledger entries to append, and the keys that just reached the
 * last check without an email (`platform_next`): the run checks those on the platform next (checkOnPlatform). No note.
 * `names` maps a group key to the name its platform uses in subjects.
 */
export function checkDue(ledger, messages, { now = Date.now(), names = {}, opts = CONFIRM } = {}) {
	const entries = [];
	const platformNext = [];
	for (const g of due(ledger, now, opts)) {
		const m = matchConfirmation(g, messages, names[g.key]);
		const check = g.checks + 1;
		entries.push({
			type: 'confirm', key: g.key, kind: g.kind, platform: g.platform, ref: g.ref, round: g.round, arm: g.arm, count: g.count,
			found: Boolean(m), check, ...(m ? { received_at: m.receivedDateTime, from_domain: PLATFORM[g.platform].domain } : {}),
		});
		if (!m && check >= opts.max_checks) {
			platformNext.push(g.key);
		}
	}
	return { entries, platform_next: platformNext };
}

/** The platform reads a check needs: one per User Interviews project and one per Outset study. */
export function platformReads(groups) {
	return [...new Map(groups.map(g => [`${g.platform}:${g.ref}`, { platform: g.platform, ref: g.ref }])).values()];
}

/** What the ledger says the platform should show for a group. */
export function expectedOnPlatform(g, ledger) {
	if (g.kind === 'payout') {
		return { paid: (ledger?.entries ?? []).filter(e => e.type === 'payment' && String(e.ui_project) === g.ref).length };
	}
	return g.platform === 'outset' ? { active: false } : { recruiting_ended: true };
}

const asInt = v => (v == null || v === '' || !Number.isInteger(Number(v)) ? null : Number(v));

/**
 * Compare one read of a platform with the ledger: { ok, observed, expected, mismatch? }, or null when the read cannot
 * answer (an error, or the field missing), which is not a check. A payout group matches when the project's paid count
 * equals the ledger's payments for that project; a User Interviews close when the project's status means recruiting
 * has ended (Completed, or Pending Close Request); an Outset close when the study is not active.
 */
export function comparePlatform(g, ledger, read) {
	if (!read || read.error) {
		return null;
	}
	const expected = expectedOnPlatform(g, ledger);
	if (g.kind === 'payout') {
		const paid = asInt(read.paid);
		if (paid === null) {
			return null;
		}
		return paid === expected.paid ? { ok: true, observed: { paid }, expected }
			: { ok: false, observed: { paid }, expected, mismatch: `User Interviews shows ${paid} paid in project ${g.ref}, and the ledger has ${expected.paid} payment${expected.paid === 1 ? '' : 's'} there` };
	}
	if (g.platform === 'outset') {
		if (typeof read.active !== 'boolean') {
			return null;
		}
		return !read.active ? { ok: true, observed: { active: false }, expected }
			: { ok: false, observed: { active: true }, expected, mismatch: `Outset study ${g.ref.slice(0, 8)} is still active (open to new interviews), and the ledger says it was closed on ${when(g.since)}` };
	}
	const statusId = asInt(read.status_id);
	if (statusId === null) {
		return null;
	}
	const observed = { status_id: statusId, status: read.status ?? null };
	return UI_CLOSED.has(statusId) ? { ok: true, observed, expected }
		: { ok: false, observed, expected, mismatch: `User Interviews project ${g.ref} shows "${read.status ?? `status ${statusId}`}", and the ledger says its close was requested on ${when(g.since)}` };
}

/** The "Needs you" note when a platform does not match the ledger. */
export function disagreementNote(g, names, mismatch, at) {
	return `${PLATFORM[g.platform].name} does not match the ledger for ${label(g, names)}: ${mismatch} (checked ${when(at)}; no email came either). Please check it in ${PLATFORM[g.platform].name}.`;
}

/**
 * Check the groups due on the platform against reads keyed `${platform}:${ref}` ({ status_id, status, paid } for a User
 * Interviews project, { active } for an Outset study, or { error }). Returns ledger entries, notes (only where the
 * platform disagrees with the ledger), and what was skipped because its read failed (recorded nowhere, so the next run
 * tries again).
 */
export function checkOnPlatform(ledger, reads, { now = Date.now(), names = {}, opts = CONFIRM } = {}) {
	const entries = [];
	const notes = [];
	const skipped = [];
	const at = new Date(now).toISOString();
	for (const g of platformDue(ledger, opts)) {
		const read = reads[`${g.platform}:${g.ref}`];
		const c = comparePlatform(g, ledger, read);
		if (!c) {
			skipped.push({ key: g.key, why: read?.error ?? 'the platform did not answer this' });
			continue;
		}
		entries.push({
			type: 'confirm-platform', key: g.key, kind: g.kind, platform: g.platform, ref: g.ref, round: g.round, arm: g.arm, count: g.count,
			ok: c.ok, observed: c.observed, expected: c.expected, ...(c.ok ? {} : { mismatch: c.mismatch }), checked_at: at, ...(read.how ? { how: read.how } : {}),
		});
		if (!c.ok) {
			notes.push(disagreementNote(g, names, c.mismatch, at));
		}
	}
	return { entries, notes, skipped };
}

const observedText = (g, o) => (g.kind === 'payout' ? `${o.paid} paid, as the ledger says`
	: g.platform === 'outset' ? 'not active, so no new interview starts' : `"${o.status ?? `status ${o.status_id}`}"`);

/** One line per expected confirmation, for the report. */
export function confirmationLines(ledger, names = {}, opts = CONFIRM) {
	return expectations(ledger).map(g => {
		const p = PLATFORM[g.platform].name;
		const pc = g.platform_check;
		const state = g.found ? `confirmed by email from ${p} (received ${when(g.found.received_at)})`
			: pc?.ok ? `no email after ${g.checks} checks; confirmed on the platform (${when(pc.checked_at ?? pc.at)}): ${observedText(g, pc.observed)}`
				: pc ? `no email after ${g.checks} checks, and ${p} does not match the ledger: ${pc.mismatch}`
					: g.checks >= opts.max_checks ? `no email from ${p} after ${g.checks} checks; the next run checks ${p} itself`
						: g.checks ? `not found yet (${g.checks} of ${opts.max_checks} checks)` : 'not checked yet (next run)';
		return `${label(g, names)}: ${state}`;
	});
}

/** One short line for the morning summary: how many are confirmed and how, then anything still open or not matching. */
export function confirmationSummary(ledger, names = {}, opts = CONFIRM) {
	const groups = expectations(ledger);
	if (!groups.length) {
		return null;
	}
	const lines = confirmationLines(ledger, names, opts);
	const byEmail = groups.filter(g => g.found).length;
	const onPlatform = groups.filter(g => !g.found && g.platform_check?.ok).length;
	const parts = [];
	if (byEmail + onPlatform) {
		const how = [byEmail ? `${byEmail} by email` : null, onPlatform ? `${onPlatform} on the platform${byEmail ? '' : ' (no email came)'}` : null].filter(Boolean).join(', ');
		parts.push(`${byEmail + onPlatform} of ${groups.length} confirmed, ${how}`);
	}
	groups.forEach((g, i) => {
		if (!g.found && !g.platform_check?.ok) {
			parts.push(lines[i]);
		}
	});
	return parts.join('; ');
}

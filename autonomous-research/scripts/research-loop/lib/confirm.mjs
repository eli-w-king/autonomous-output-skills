// Email confirmations of close-outs and payouts. On a run after the event (never by waiting inside a chat), the run's
// agent searches the owner's mailbox for mail from each platform (the same Work IQ search as the email check), and this
// module matches it against what the loop did: found or not, recorded in the ledger (`confirm` entries), shown in the
// report, and a "Needs you" note when a confirmation is still missing after two checks. A search that failed (for
// example Work IQ answering 429) is not a check; the next run tries again. Subjects are not stored: a payout email can
// name a participant, and the ledger is published.
import { CONFIG } from './config.mjs';

export const CONFIRM = Object.freeze({ min_age_minutes: 20, max_checks: 2 });
const PLATFORM = {
	outset: { name: 'Outset', domain: 'outset.ai' },
	'user-interviews': { name: 'User Interviews', domain: 'userinterviews.com' },
};
const dayOf = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: CONFIG.timezone });
const when = iso => new Date(iso).toLocaleString('en-US', { timeZone: CONFIG.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** What should arrive by email, from the ledger: one per close, and one per User Interviews project and day of payouts. */
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
	}
	return [...groups.values()];
}

/** Still open: not found and fewer than the maximum checks. */
export const pending = (ledger, opts = CONFIRM) => expectations(ledger).filter(g => !g.found && g.checks < opts.max_checks);

/** Due on this run: open, and the event happened at least a little while ago (so on a later run than the event). */
export function due(ledger, now = Date.now(), opts = CONFIRM) {
	return pending(ledger, opts).filter(g => now - Date.parse(g.since) >= opts.min_age_minutes * 60e3);
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

/** The "Needs you" note for a confirmation still missing after the last check. */
export function missingNote(g, names = {}, at = new Date().toISOString(), opts = CONFIRM) {
	const p = PLATFORM[g.platform];
	return `No email confirmation from ${p.name} for ${label(g, names)} after ${opts.max_checks} checks (the last at ${when(at)}). The ledger has the action and its read-back; check ${p.name} if you want to be sure.`;
}

/**
 * Check the due groups against the messages. Returns ledger entries to append and notes to add; the caller writes them.
 * `names` maps a group key to the name its platform uses in subjects.
 */
export function checkDue(ledger, messages, { now = Date.now(), names = {}, opts = CONFIRM } = {}) {
	const entries = [];
	const notes = [];
	for (const g of due(ledger, now, opts)) {
		const m = matchConfirmation(g, messages, names[g.key]);
		const check = g.checks + 1;
		entries.push({
			type: 'confirm', key: g.key, kind: g.kind, platform: g.platform, ref: g.ref, round: g.round, arm: g.arm, count: g.count,
			found: Boolean(m), check, ...(m ? { received_at: m.receivedDateTime, from_domain: PLATFORM[g.platform].domain } : {}),
		});
		if (!m && check >= opts.max_checks) {
			notes.push(missingNote(g, names, new Date(now).toISOString(), opts));
		}
	}
	return { entries, notes };
}

/** One line per expected confirmation, for the report. */
export function confirmationLines(ledger, names = {}, opts = CONFIRM) {
	return expectations(ledger).map(g => {
		const p = PLATFORM[g.platform].name;
		const state = g.found ? `confirmed by email from ${p} (received ${when(g.found.received_at)})`
			: g.checks >= opts.max_checks ? `no email from ${p} after ${g.checks} checks`
				: g.checks ? `not found yet (${g.checks} of ${opts.max_checks} checks)` : 'not checked yet (next run)';
		return `${label(g, names)}: ${state}`;
	});
}

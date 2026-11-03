// The loop's log of email from the research platforms' teams (Outset and User Interviews by default). Each run's agent
// reads the owner's mailbox through Work IQ; this log keeps what was already handled and what was done about it, so a
// run knows what is new, a reply is never sent twice, and the morning summary and the retrospective can list every
// email with its action. Local only, never published: it can name people, so it stays on the machine.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG } from './config.mjs';
import { withLock } from './lock.mjs';

export const MAIL_LOG = CONFIG.mailLog;
export const MAIL_DOMAINS = CONFIG.mailDomains;
const OVERLAP_MS = 15 * 60_000;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

export function loadMailLog() {
	try {
		return JSON.parse(readFileSync(MAIL_LOG, 'utf8'));
	} catch {
		return { start: CONFIG.mailStart ?? new Date(Date.now() - 24 * 3600e3).toISOString(), last_checked_at: null, entries: [] };
	}
}

function save(log) {
	mkdirSync(dirname(MAIL_LOG), { recursive: true });
	const tmp = `${MAIL_LOG}.tmp-${process.pid}`;
	writeFileSync(tmp, JSON.stringify(log, null, 1));
	renameSync(tmp, MAIL_LOG);
}

export async function updateMailLog(fn) {
	return withLock(`${MAIL_LOG}.lock`, () => {
		const log = loadMailLog();
		const out = fn(log);
		save(log);
		return out;
	}, { label: 'the mail log lock', timeoutMs: 30_000, staleMs: 120_000 });
}

/** Where the next search starts: a little before the last check, so mail delivered late is not missed. */
export function searchSince(log = loadMailLog()) {
	const from = log.last_checked_at ? Date.parse(log.last_checked_at) - OVERLAP_MS : Date.parse(log.start);
	return new Date(Math.max(from, Date.parse(log.start))).toISOString();
}

export const watchedDomain = address => {
	const domain = String(address ?? '').toLowerCase().split('@')[1] ?? '';
	return MAIL_DOMAINS.find(d => domain === d || domain.endsWith(`.${d}`)) ?? null;
};

/** New messages from the watched domains in a saved Work IQ fetch result ({ results: [{ data: { value: [...] } }] }). */
export function newMessages(fetchResult, log = loadMailLog()) {
	const seen = new Set(log.entries.map(e => e.id));
	const since = Date.parse(searchSince(log));
	const all = (fetchResult?.results ?? [fetchResult]).flatMap(r => r?.data?.value ?? r?.value ?? []);
	const unique = [...new Map(all.map(m => [m.id, m])).values()];
	return unique
		.filter(m => watchedDomain(m.from?.emailAddress?.address) && !seen.has(m.id) && Date.parse(m.receivedDateTime) >= since)
		.sort((a, b) => Date.parse(a.receivedDateTime) - Date.parse(b.receivedDateTime))
		.map(m => ({ id: m.id, received_at: m.receivedDateTime, from_domain: watchedDomain(m.from.emailAddress.address), subject: m.subject }));
}

const CATEGORIES = ['problem', 'status', 'sign-in', 'unrelated'];
const scrub = s => (s == null ? s : String(s).replace(EMAIL, '<email>'));

/** Validate and clean one entry; email addresses never go into the log. */
export function cleanEntry(e) {
	const problems = [];
	for (const k of ['id', 'received_at', 'from_domain', 'subject', 'category', 'action']) {
		if (!e?.[k]) {
			problems.push(`missing ${k}`);
		}
	}
	if (e?.category && !CATEGORIES.includes(e.category)) {
		problems.push(`category must be one of ${CATEGORIES.join(', ')}`);
	}
	if (problems.length) {
		throw new Error(`mail entry: ${problems.join('; ')}`);
	}
	return {
		id: e.id,
		received_at: e.received_at,
		from_domain: e.from_domain,
		sender_role: scrub(e.sender_role ?? null),
		subject: scrub(e.subject),
		category: e.category,
		about: e.about ?? null,
		verified: scrub(e.verified ?? null),
		action: scrub(e.action),
		reply: e.reply ? { status: e.reply.status ?? 'drafted', text: scrub(e.reply.text ?? ''), at: e.reply.at ?? null } : null,
		logged_at: new Date().toISOString(),
	};
}

export function renderMail(log = loadMailLog(), { timezone = CONFIG.timezone } = {}) {
	const when = iso => new Date(iso).toLocaleString('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const lines = [];
	const relevant = log.entries.filter(e => e.category !== 'unrelated');
	for (const e of relevant) {
		const reply = e.reply ? ` Reply ${e.reply.status === 'sent' ? 'sent' : e.reply.status === 'sending' ? 'attempted (outcome unknown)' : e.reply.status}: "${e.reply.text}".` : '';
		lines.push(`- ${when(e.received_at)}, ${e.sender_role ?? e.from_domain}: "${e.subject}" (${e.category}${e.about ? `, ${e.about}` : ''}). ${e.verified ? `Checked: ${e.verified}. ` : ''}Did: ${e.action}.${reply}`);
	}
	const other = log.entries.length - relevant.length;
	if (other) {
		lines.push(`- ${other} other ${other === 1 ? 'email' : 'emails'} from these domains (newsletters, surveys, receipts): no action.`);
	}
	if (!lines.length) {
		lines.push(`- None from ${MAIL_DOMAINS.join(' or ')} since ${when(log.start)}${log.last_checked_at ? ` (last checked ${when(log.last_checked_at)})` : ' (not checked yet)'}.`);
	} else if (log.last_checked_at) {
		lines.push(`- Last checked ${when(log.last_checked_at)}.`);
	}
	return lines.join('\n');
}

export const mailLogExists = () => existsSync(MAIL_LOG);

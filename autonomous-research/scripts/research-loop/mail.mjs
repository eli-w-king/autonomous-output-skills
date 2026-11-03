#!/usr/bin/env node
// Email from the research platforms' teams: what is new, what was done, and replies (see lib/mail.mjs).
//
//   node mail.mjs since                          where to search from, the watched domains, ids already handled
//   node mail.mjs new --file <saved fetch>       new messages from the watched domains in a saved Work IQ fetch result
//   node mail.mjs add --file <entry.json>        record one email and what was done (and a ledger line if it is about a study)
//   node mail.mjs reply --id <id> --status sending|sent|failed [--note <text>]
//                                                exit 3 on "sending" when a reply is already sending or sent: never send twice
//   node mail.mjs checked [--at <iso>]           a check finished; the next search starts 15 minutes before this
//   node mail.mjs render                         the list for the morning summary and the retrospective
//
// entry.json: { id, received_at, from_domain, sender_role, subject, category: problem|status|sign-in|unrelated,
//               about: <study slug> | null, verified, action, reply: null | { status: "drafted", text } }
// No email addresses (they are replaced) and no participant names in any field.
import { readFileSync } from 'node:fs';
import { loadMailLog, updateMailLog, searchSince, newMessages, cleanEntry, renderMail, MAIL_DOMAINS, MAIL_LOG } from './lib/mail.mjs';
import { appendLedger, listStudies } from './lib/state.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const out = obj => console.log(JSON.stringify(obj, null, 1));
const readJson = f => JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));

if (cmd === 'since') {
	const log = loadMailLog();
	out({ since: searchSince(log), domains: MAIL_DOMAINS, handled_ids: log.entries.map(e => e.id), last_checked_at: log.last_checked_at, log: MAIL_LOG });
} else if (cmd === 'new') {
	const file = opt('file');
	if (!file) {
		console.error('usage: mail.mjs new --file <saved Work IQ fetch output>');
		process.exit(2);
	}
	out(newMessages(readJson(file)));
} else if (cmd === 'add') {
	const entry = cleanEntry(readJson(opt('file')));
	if (entry.about && !listStudies().includes(entry.about)) {
		console.error(`unknown study ${entry.about}`);
		process.exit(2);
	}
	const added = await updateMailLog(log => {
		if (log.entries.some(e => e.id === entry.id)) {
			return false;
		}
		log.entries.push(entry);
		return true;
	});
	if (added && entry.about && entry.category !== 'unrelated') {
		await appendLedger(entry.about, { type: 'email', from_domain: entry.from_domain, sender_role: entry.sender_role, subject: entry.subject, category: entry.category, action: entry.action, reply_status: entry.reply?.status ?? null });
	}
	out({ added, id: entry.id });
} else if (cmd === 'reply') {
	const id = opt('id'), status = opt('status');
	if (!id || !['sending', 'sent', 'failed'].includes(status)) {
		console.error('usage: mail.mjs reply --id <id> --status sending|sent|failed [--note <text>]');
		process.exit(2);
	}
	const r = await updateMailLog(log => {
		const e = log.entries.find(x => x.id === id);
		if (!e?.reply) {
			return { ok: false, reason: 'no drafted reply for this email; add it first' };
		}
		if (status === 'sending' && ['sending', 'sent'].includes(e.reply.status)) {
			return { ok: false, reason: `a reply is already ${e.reply.status}; never send twice` };
		}
		e.reply.status = status;
		e.reply.at = new Date().toISOString();
		if (opt('note')) {
			e.reply.note = opt('note');
		}
		return { ok: true, status };
	});
	out(r);
	process.exit(r.ok ? 0 : 3);
} else if (cmd === 'checked') {
	const at = opt('at') ?? new Date().toISOString();
	await updateMailLog(log => { log.last_checked_at = at; });
	out({ last_checked_at: at, next_since: searchSince(loadMailLog()) });
} else if (cmd === 'render') {
	console.log(renderMail());
} else {
	console.error('usage: mail.mjs since|new|add|reply|checked|render (see the header)');
	process.exit(2);
}

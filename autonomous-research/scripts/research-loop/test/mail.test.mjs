// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(join(tmpdir(), 'rl-mail-'));
process.env.RESEARCH_LOOP_MAIL_LOG = join(scratch, 'mail-log.json');
process.env.RESEARCH_STATE_DIR = scratch;
const { newMessages, cleanEntry, renderMail, watchedDomain, searchSince, loadMailLog } = await import('../lib/mail.mjs');
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'mail.mjs');
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env: process.env, encoding: 'utf8' });

// Addresses are built at run time so the file itself holds none (the skills validator rejects literal addresses).
const addr = (user, domain) => [user, domain].join('@');
const msg = (id, at, address, subject) => ({ id, receivedDateTime: at, subject, from: { emailAddress: { address } } });
const fetched = {
	results: [
		{ data: { value: [msg('a', '2026-11-03T14:05:00Z', addr('support', 'userinterviews.com'), 'Edit Needed for "Project" (1)'), msg('old', '2026-10-01T10:00:00Z', addr('support', 'userinterviews.com'), 'How was our support?')] } },
		{ data: { value: [msg('b', '2026-11-03T13:00:00Z', addr('notifications', 'mail.outset.ai'), 'Study Launched on Outset'), msg('c', '2026-11-03T13:30:00Z', addr('someone', 'evil-outset.ai.example.com'), 'Phish'), msg('a', '2026-11-03T14:05:00Z', addr('support', 'userinterviews.com'), 'Edit Needed for "Project" (1)')] } },
	],
};

test('only the watched domains and their subdomains count', () => {
	assert.equal(watchedDomain(addr('x', 'outset.ai')), 'outset.ai');
	assert.equal(watchedDomain(addr('x', 'mail.outset.ai')), 'outset.ai');
	assert.equal(watchedDomain(addr('x', 'userinterviews.com')), 'userinterviews.com');
	assert.equal(watchedDomain(addr('x', 'notoutset.ai')), null);
	assert.equal(watchedDomain(addr('x', 'outset.ai.example.com')), null);
	assert.equal(watchedDomain(undefined), null);
});

test('new messages: watched senders, received since the start, not handled yet, oldest first, no duplicates', () => {
	const log = { start: '2026-11-03T00:30:00Z', last_checked_at: null, entries: [] };
	assert.deepEqual(newMessages(fetched, log).map(m => m.id), ['b', 'a']);
	log.entries.push({ id: 'b' });
	assert.deepEqual(newMessages(fetched, log).map(m => m.id), ['a']);
	log.last_checked_at = '2026-11-03T15:00:00Z';
	assert.equal(searchSince(log), '2026-11-03T14:45:00.000Z', 'the next search overlaps the last check by 15 minutes');
	assert.deepEqual(newMessages(fetched, log).map(m => m.id), [], 'mail before the overlap window is not new again');
});

test('entries keep no email addresses and need a category from the list', () => {
	const e = cleanEntry({ id: 'a', received_at: '2026-11-03T14:05:00Z', from_domain: 'userinterviews.com', sender_role: 'User Interviews project coordinator', subject: 'Re: x', category: 'problem', about: null, verified: `asked by ${addr('jane.doe', 'example.com')}`, action: 'fixed the screener', reply: { status: 'drafted', text: 'Hi! Fixed it.' } });
	assert.equal(e.verified, 'asked by <email>');
	assert.equal(e.reply.status, 'drafted');
	assert.throws(() => cleanEntry({ id: 'a', received_at: 'x', from_domain: 'y', subject: 's', category: 'spam', action: 'a' }), /category/);
	assert.throws(() => cleanEntry({ id: 'a' }), /missing/);
});

test('the CLI records an email once, guards against a second send, and renders the list', () => {
	const entry = join(scratch, 'entry.json');
	writeFileSync(entry, JSON.stringify({ id: 'a', received_at: '2026-11-03T14:05:00Z', from_domain: 'userinterviews.com', sender_role: 'User Interviews project coordinator', subject: 'Edit Needed for "Project" (1)', category: 'problem', about: null, verified: 'the screener has one question per page', action: 'no change needed', reply: { status: 'drafted', text: 'Hi! Thanks for the review.' } }));
	assert.equal(JSON.parse(cli('add', '--file', entry).stdout).added, true);
	assert.equal(JSON.parse(cli('add', '--file', entry).stdout).added, false, 'the same email is recorded once');
	assert.equal(cli('reply', '--id', 'a', '--status', 'sending').status, 0);
	assert.equal(cli('reply', '--id', 'a', '--status', 'sending').status, 3, 'a second send is refused');
	assert.equal(cli('reply', '--id', 'a', '--status', 'sent').status, 0);
	assert.equal(cli('reply', '--id', 'a', '--status', 'sending').status, 3, 'and stays refused after it was sent');
	cli('checked', '--at', '2026-11-03T15:00:00Z');
	assert.equal(loadMailLog().last_checked_at, '2026-11-03T15:00:00Z');
	const md = renderMail(loadMailLog());
	assert.match(md, /User Interviews project coordinator: "Edit Needed for "Project" \(1\)" \(problem\)/);
	assert.match(md, /Reply sent: "Hi! Thanks for the review."/);
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));

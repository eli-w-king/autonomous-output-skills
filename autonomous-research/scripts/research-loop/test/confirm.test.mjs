// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A scratch installation, set before the modules read their environment.
const scratch = mkdtempSync(join(tmpdir(), 'rl-confirm-'));
writeFileSync(join(scratch, 'loop.config.json'), JSON.stringify({ home: scratch, timezone: 'America/Los_Angeles', schedule: { name: 'Loop schedule', id: 'auto-1' } }));
process.env.RESEARCH_LOOP_CONFIG = join(scratch, 'loop.config.json');
process.env.RESEARCH_STATE_DIR = join(scratch, 'state');
const { expectations, due, checkDue, matchConfirmation, messagesOf, confirmationLines, CONFIRM } = await import('../lib/confirm.mjs');
const { activity, disableRequest } = await import('../lib/idle.mjs');
const { parseNameStatus, pageLink } = await import('../lib/wiki.mjs');

const t0 = Date.parse('2026-01-05T20:00:00Z');
const iso = m => new Date(t0 + m * 60e3).toISOString();
const ledger = { entries: [
	{ type: 'payment', round: 1, arm: 'A', ui_project: '101', paid_at: iso(0), at: iso(0) },
	{ type: 'payment', round: 1, arm: 'A', ui_project: '101', paid_at: iso(5), at: iso(5) },
	{ type: 'close', platform: 'outset', round: 1, arm: 'A', outset_study: 'abcdef12-3456', ui_project: '101', at: iso(60) },
	{ type: 'close', platform: 'user-interviews', round: 1, arm: 'A', outset_study: 'abcdef12-3456', ui_project: '101', at: iso(61) },
] };
// Addresses are built at run time, so the file itself holds none.
const addr = (user, domain) => [user, domain].join('@');
const msg = (id, minutes, address, subject) => ({ id, receivedDateTime: iso(minutes), from: { emailAddress: { address } }, subject });

test('each close and each project-day of payouts is one expected confirmation', () => {
	const g = expectations(ledger);
	assert.deepEqual(g.map(x => x.key), ['payout:user-interviews:101:2026-01-05', 'close:outset:abcdef12-3456', 'close:user-interviews:101']);
	assert.equal(g[0].count, 2);
	assert.equal(g[0].since, iso(0));
});

test('a confirmation is due only on a later run, and only until found or checked twice', () => {
	assert.equal(due(ledger, t0 + 10 * 60e3).length, 0);
	assert.deepEqual(due(ledger, t0 + 30 * 60e3).map(g => g.kind), ['payout']);
	assert.equal(due(ledger, t0 + 90 * 60e3).length, 3);
	const checked = { entries: [...ledger.entries, { type: 'confirm', key: 'close:outset:abcdef12-3456', found: true, received_at: iso(70) }, { type: 'confirm', key: 'payout:user-interviews:101:2026-01-05', found: false }, { type: 'confirm', key: 'payout:user-interviews:101:2026-01-05', found: false }] };
	assert.deepEqual(due(checked, t0 + 300 * 60e3).map(g => g.key), ['close:user-interviews:101']);
});

test('only mail from the platform, after the event, with a matching subject confirms it', () => {
	const [payout, outsetClose, uiClose] = expectations(ledger);
	const messages = [
		msg('m1', -60, addr('projects', 'userinterviews.com'), 'Your payment receipt'),
		msg('m2', 30, addr('someone', 'example.com'), 'You were paid'),
		msg('m3', 31, addr('billing', 'userinterviews.com'), 'Incentive payment receipt'),
		msg('m4', 120, addr('info', 'outset.ai'), 'Outset - Study A has completed'),
		msg('m5', 125, addr('info', 'outset.ai'), 'Outset - Another study has completed'),
		msg('m6', 130, addr('projects', 'userinterviews.com'), 'Your project (101) has been closed'),
	];
	assert.equal(matchConfirmation(payout, messages).id, 'm3');
	assert.equal(matchConfirmation(outsetClose, messages, 'Study A').id, 'm4');
	assert.equal(matchConfirmation(outsetClose, messages, 'Study Z'), null);
	assert.equal(matchConfirmation(uiClose, messages).id, 'm6');
});

test('found or not goes to the ledger without the subject; two misses add one Needs you note', () => {
	const messages = [msg('m4', 120, addr('info', 'outset.ai'), 'Outset - Study A has completed')];
	const now = t0 + 200 * 60e3;
	const names = { 'close:outset:abcdef12-3456': 'Study A' };
	const first = checkDue(ledger, messages, { now, names });
	assert.deepEqual(first.entries.map(e => [e.kind, e.platform, e.found, e.check]), [['payout', 'user-interviews', false, 1], ['close', 'outset', true, 1], ['close', 'user-interviews', false, 1]]);
	assert.ok(first.entries.every(e => !('subject' in e)));
	assert.equal(first.notes.length, 0);
	const after = { entries: [...ledger.entries, ...first.entries] };
	const second = checkDue(after, messages, { now: now + 120 * 60e3, names });
	assert.equal(second.entries.length, 2);
	assert.equal(second.notes.length, 2);
	assert.match(second.notes[0], /^No email confirmation from User Interviews for 2 payouts in User Interviews project 101 on 2026-01-05 after 2 checks/);
	assert.doesNotMatch(second.notes.join(' '), /[\u2013\u2014]/);
	const done = { entries: [...after.entries, ...second.entries] };
	assert.equal(checkDue(done, messages, { now: now + 500 * 60e3, names }).entries.length, 0);
	const lines = confirmationLines(done, names);
	assert.match(lines[0], /no email from User Interviews after 2 checks/);
	assert.match(lines[1], /confirmed by email from Outset/);
	assert.equal(CONFIRM.max_checks, 2);
});

test('a saved Work IQ result yields its messages once each', () => {
	const r = { results: [{ data: { value: [msg('a', 1, addr('x', 'outset.ai'), 's'), msg('b', 2, addr('y', 'outset.ai'), 't')] } }, { data: { value: [msg('a', 1, addr('x', 'outset.ai'), 's')] } }] };
	assert.deepEqual(messagesOf(r).map(m => m.id), ['a', 'b']);
});

test('the loop is idle only with no study running and no confirmation still open', () => {
	const running = { slug: 's1', study: { status: 'recruiting' }, ledger: { entries: [] } };
	const endedOpen = { slug: 's2', study: { status: 'done' }, ledger };
	const endedClosed = { slug: 's3', study: { status: 'handed-to-owner' }, ledger: { entries: [] } };
	assert.deepEqual(activity([running, endedClosed]), { idle: false, active: ['s1'], confirming: [] });
	assert.deepEqual(activity([endedOpen, endedClosed]), { idle: false, active: [], confirming: ['s2'] });
	assert.equal(activity([endedClosed]).idle, true);
	assert.equal(activity([]).idle, true);
	assert.equal(disableRequest({ name: 'Loop schedule', id: 'auto-1' }, ['s3']), 'Research loop: nothing is being researched now (s3 ended). Please disable the automation "Loop schedule" (auto-1). Starting a new study turns it back on.');
});

test('changed wiki pages are listed with encoded links', () => {
	assert.deepEqual(parseNameStatus('M\twiki/sources/A b.md\nA\twiki/concepts/C.md\nR100\twiki/old.md\twiki/new.md\n'), [
		{ status: 'M', path: 'wiki/sources/A b.md' }, { status: 'A', path: 'wiki/concepts/C.md' }, { status: 'R', path: 'wiki/new.md' },
	]);
	assert.equal(pageLink('https://example.invalid/blob/main/', 'wiki/sources/A b (2026).md'), 'https://example.invalid/blob/main/wiki/sources/A%20b%20(2026).md');
});

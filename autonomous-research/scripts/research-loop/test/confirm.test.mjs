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
const { expectations, due, checkDue, matchConfirmation, messagesOf, confirmationLines, confirmationSummary, CONFIRM, platformDue, pending, platformReads, checkOnPlatform, comparePlatform } = await import('../lib/confirm.mjs');
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

test('found or not goes to the ledger without the subject; two misses add no note and send it to the platform check', () => {
	const messages = [msg('m4', 120, addr('info', 'outset.ai'), 'Outset - Study A has completed')];
	const now = t0 + 200 * 60e3;
	const names = { 'close:outset:abcdef12-3456': 'Study A' };
	const first = checkDue(ledger, messages, { now, names });
	assert.deepEqual(first.entries.map(e => [e.kind, e.platform, e.found, e.check]), [['payout', 'user-interviews', false, 1], ['close', 'outset', true, 1], ['close', 'user-interviews', false, 1]]);
	assert.ok(first.entries.every(e => !('subject' in e)));
	assert.deepEqual(first.platform_next, []);
	assert.equal('notes' in first, false);
	const after = { entries: [...ledger.entries, ...first.entries] };
	const second = checkDue(after, messages, { now: now + 120 * 60e3, names });
	assert.equal(second.entries.length, 2);
	assert.deepEqual(second.platform_next, ['payout:user-interviews:101:2026-01-05', 'close:user-interviews:101']);
	const done = { entries: [...after.entries, ...second.entries] };
	assert.equal(checkDue(done, messages, { now: now + 500 * 60e3, names }).entries.length, 0);
	assert.deepEqual(platformDue(done).map(g => g.key), ['payout:user-interviews:101:2026-01-05', 'close:user-interviews:101']);
	assert.deepEqual(pending(done).map(g => g.key), ['payout:user-interviews:101:2026-01-05', 'close:user-interviews:101']);
	const lines = confirmationLines(done, names);
	assert.match(lines[0], /no email from User Interviews after 2 checks; the next run checks User Interviews itself/);
	assert.match(lines[1], /confirmed by email from Outset/);
	assert.equal(CONFIRM.max_checks, 2);
});

// The same ledger after two empty email checks for every group: everything is due on the platform.
const twoMisses = { entries: [...ledger.entries, ...expectations(ledger).flatMap(g => [1, 2].map(check => ({ type: 'confirm', key: g.key, kind: g.kind, platform: g.platform, ref: g.ref, found: false, check })))] };

test('when no email came, the platform itself confirms what matches the ledger, with no note', () => {
	assert.deepEqual(platformReads(platformDue(twoMisses)), [{ platform: 'user-interviews', ref: '101' }, { platform: 'outset', ref: 'abcdef12-3456' }]);
	const reads = {
		'user-interviews:101': { status_id: 6, status: 'Project Complete - Charged', paid: 2, how: 'read only' },
		'outset:abcdef12-3456': { active: false },
	};
	const now = t0 + 600 * 60e3;
	const r = checkOnPlatform(twoMisses, reads, { now });
	assert.deepEqual(r.entries.map(e => [e.type, e.key, e.ok]), [
		['confirm-platform', 'payout:user-interviews:101:2026-01-05', true],
		['confirm-platform', 'close:outset:abcdef12-3456', true],
		['confirm-platform', 'close:user-interviews:101', true],
	]);
	assert.deepEqual(r.entries[0].observed, { paid: 2 });
	assert.deepEqual(r.entries[0].expected, { paid: 2 });
	assert.equal(r.notes.length, 0);
	assert.equal(r.skipped.length, 0);
	const done = { entries: [...twoMisses.entries, ...r.entries] };
	assert.equal(platformDue(done).length, 0);
	assert.equal(pending(done).length, 0);
	const lines = confirmationLines(done);
	assert.match(lines[0], /^2 payouts in User Interviews project 101 on 2026-01-05: no email after 2 checks; confirmed on the platform \(Jan 5, 10:00 PM\): 2 paid, as the ledger says$/);
	assert.match(lines[1], /closing Outset study abcdef12: no email after 2 checks; confirmed on the platform .*: not active, so no new interview starts/);
	assert.match(lines[2], /closing User Interviews project 101: .*confirmed on the platform .*: "Project Complete - Charged"/);
	assert.equal(confirmationSummary(done), '3 of 3 confirmed, 3 on the platform (no email came)');
	// Pending Close Request counts as closed too: recruiting has ended.
	assert.equal(comparePlatform(expectations(twoMisses)[2], twoMisses, { status_id: '9', status: 'Pending Close Request' }).ok, true);
});

test('a platform that disagrees with the ledger gets a note; a failed read is not a check', () => {
	const now = t0 + 600 * 60e3;
	const wrong = checkOnPlatform(twoMisses, {
		'user-interviews:101': { status_id: 2, status: 'Currently Recruiting', paid: 1 },
		'outset:abcdef12-3456': { active: true },
	}, { now });
	assert.deepEqual(wrong.entries.map(e => e.ok), [false, false, false]);
	assert.equal(wrong.notes.length, 3);
	assert.match(wrong.notes[0], /^User Interviews does not match the ledger for 2 payouts in User Interviews project 101 on 2026-01-05: User Interviews shows 1 paid in project 101, and the ledger has 2 payments there \(checked Jan 5, 10:00 PM; no email came either\)\. Please check it in User Interviews\.$/);
	assert.match(wrong.notes[1], /Outset study abcdef12 is still active/);
	assert.match(wrong.notes[2], /shows "Currently Recruiting", and the ledger says its close was requested/);
	assert.doesNotMatch(wrong.notes.join(' '), /[\u2013\u2014]/);
	const after = { entries: [...twoMisses.entries, ...wrong.entries] };
	assert.match(confirmationLines(after)[0], /User Interviews does not match the ledger: User Interviews shows 1 paid/);
	assert.match(confirmationSummary(after), /^2 payouts in User Interviews project 101/);

	const failed = checkOnPlatform(twoMisses, { 'user-interviews:101': { error: 'User Interviews is signed out in the loop\'s Chrome' }, 'outset:abcdef12-3456': { active: null } }, { now });
	assert.equal(failed.entries.length, 0);
	assert.equal(failed.notes.length, 0);
	assert.deepEqual(failed.skipped.map(s => s.why), ['User Interviews is signed out in the loop\'s Chrome', 'the platform did not answer this', 'User Interviews is signed out in the loop\'s Chrome']);
	assert.equal(platformDue(twoMisses).length, 3);
});

test('a saved Work IQ result yields its messages once each', () => {
	const r = { results: [{ data: { value: [msg('a', 1, addr('x', 'outset.ai'), 's'), msg('b', 2, addr('y', 'outset.ai'), 't')] } }, { data: { value: [msg('a', 1, addr('x', 'outset.ai'), 's')] } }] };
	assert.deepEqual(messagesOf(r).map(m => m.id), ['a', 'b']);
});

test('the loop is idle only with no study running and no confirmation still open', () => {
	const running = { slug: 's1', study: { status: 'recruiting' }, ledger: { entries: [] } };
	const endedOpen = { slug: 's2', study: { status: 'done' }, ledger };
	const endedClosed = { slug: 's3', study: { status: 'handed-to-owner' }, ledger: { entries: [] } };
	assert.deepEqual(activity([running, endedClosed]), { idle: false, active: ['s1'], confirming: [], contributing: [] });
	assert.deepEqual(activity([endedOpen, endedClosed]), { idle: false, active: [], confirming: ['s2'], contributing: [] });
	assert.equal(activity([endedClosed]).idle, true);
	assert.equal(activity([]).idle, true);
	// No email after two checks keeps it open until the platform has been checked.
	assert.deepEqual(activity([{ slug: 's4', study: { status: 'done' }, ledger: twoMisses }]).confirming, ['s4']);
	assert.equal(disableRequest({ name: 'Loop schedule', id: 'auto-1' }, ['s3']), 'Research loop: nothing is being researched now (s3 ended). Please disable the automation "Loop schedule" (auto-1). Starting a new study turns it back on.');
});

test('changed wiki pages are listed with encoded links', () => {
	assert.deepEqual(parseNameStatus('M\twiki/sources/A b.md\nA\twiki/concepts/C.md\nR100\twiki/old.md\twiki/new.md\n'), [
		{ status: 'M', path: 'wiki/sources/A b.md' }, { status: 'A', path: 'wiki/concepts/C.md' }, { status: 'R', path: 'wiki/new.md' },
	]);
	assert.equal(pageLink('https://example.invalid/blob/main/', 'wiki/sources/A b (2026).md'), 'https://example.invalid/blob/main/wiki/sources/A%20b%20(2026).md');
});

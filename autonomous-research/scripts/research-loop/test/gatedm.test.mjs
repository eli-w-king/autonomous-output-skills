// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A scratch installation (config, studies, state), set before the modules read their environment.
const scratch = mkdtempSync(join(tmpdir(), 'rl-gatedm-'));
writeFileSync(join(scratch, 'loop.config.json'), JSON.stringify({ home: scratch, gate_dm: { channel: 'C-TEST', next_run: 'within 2 hours' } }));
process.env.RESEARCH_LOOP_CONFIG = join(scratch, 'loop.config.json');
process.env.RESEARCH_LOOP_STUDIES = join(scratch, 'studies');
process.env.RESEARCH_STATE_DIR = join(scratch, 'state');
mkdirSync(join(scratch, 'studies', 's1'), { recursive: true });
mkdirSync(join(scratch, 'state'), { recursive: true });
const { gatedArms, gateDmStatus, gateDmText, gateNeedsLine, gateNeedsPrefix, claimGateDm, recordGateDmSent, releaseGateDm } = await import('../lib/gatedm.mjs');
const { CONFIG } = await import('../lib/config.mjs');
assert.equal(CONFIG.gateDm.channel, 'C-TEST');

const url = id => `https://outset.example/project/p/survey/${id}/guide`;
const cost = { known: true, base_usd: 206, with_allowance_usd: 226.6, count: 5 };
const study = () => ({
	slug: 's1',
	title: 'A study',
	status: 'awaiting-outset-approval',
	budget: { per_round_per_arm_usd: 250 },
	designs: { d1: { label: 'study A (first)' }, d2: { label: 'study B (second)' }, d3: { label: 'the consolidated design' } },
	rounds: [
		{ n: 1, arms: [{ arm: 'A', design: 'd1', launched_at: '2026-01-01T17:00:00Z', outset: { study_url: url('a') } }, { arm: 'B', design: 'd2', launched_at: '2026-01-01T17:01:00Z', outset: { study_url: url('b') } }], gate_dm: { sent_at: '2026-01-01T03:54:00Z' } },
		{ n: 2, arms: [{ arm: 'C', design: 'd3', outset: { study_url: url('c') } }] },
	],
});
const ledger = { entries: [
	{ type: 'check', round: 2, arm: 'C', cost },
	{ type: 'blocked', round: 2, arm: 'C', reason: 'Outset publish needs org admin approval' },
] };

test('a new round blocked on approval is due once; launched, approved or other refusals are not', () => {
	const s = study();
	assert.deepEqual(gateDmStatus(s, ledger), { status: 'due', round: 2, arms: ['C'] });
	assert.equal(gateDmStatus(s, { entries: [{ type: 'blocked', round: 2, arm: 'C', reason: 'Outset publish failed' }] }).status, 'none');
	s.rounds[1].arms[0].outset_gate = { state: 'live' };
	assert.equal(gateDmStatus(s, ledger).status, 'none');
	s.rounds[1].arms[0].outset_gate = { state: 'awaiting-admin-approval' };
	assert.equal(gateDmStatus(s, { entries: [] }).status, 'due');
	s.rounds[1].arms[0].launched_at = '2026-01-02T18:00:00Z';
	assert.equal(gateDmStatus(s, ledger).status, 'none');
	assert.deepEqual(gatedArms(ledger, s.rounds[0]), []);
});

test('the retest text has the link, the one step, what happens after approval and its cost, and no dashes', () => {
	const text = gateDmText(study(), ledger);
	const lines = text.split('\n');
	assert.equal(lines[0], 'Research loop: the round 2 retest of "A study" is ready in Outset, and it needs an admin\'s approval before it can go live.');
	assert.ok(text.includes(`1. Click Submit for review on it in Outset: ${url('c')}`));
	assert.ok(text.includes('2. Once an admin approves it, the loop starts recruiting in User Interviews on its next run (within 2 hours), after checking the participant link and every image: 5 participants, $206 (up to $226.60 with tax), under the $250 cap.'));
	assert.equal(lines.at(-1), 'Nothing is spent until then.');
	assert.doesNotMatch(text, /[\u2013\u2014]/);
});

test('a first round with two waiting arms lists each one with its link and the total', () => {
	const s = study();
	s.rounds = [{ n: 1, arms: s.rounds[0].arms.map(a => ({ ...a, launched_at: undefined })) }];
	const l = { entries: ['A', 'B'].flatMap(arm => [{ type: 'check', round: 1, arm, cost }, { type: 'blocked', round: 1, arm, reason: 'Outset publish needs org admin approval' }]) };
	const text = gateDmText(s, l);
	assert.ok(text.startsWith('Research loop: round 1 of "A study" is ready in Outset'));
	assert.ok(text.includes(`   Study A (first): ${url('a')}`) && text.includes(`   Study B (second): ${url('b')}`));
	assert.ok(text.includes('Once an admin approves each one,') && text.includes('5 participants each, $412 in total (up to $453.20 with tax), under the $250 cap per study.'));
});

test('the Needs you line names the arm and its link under a prefix launch.mjs can drop', () => {
	const s = study();
	const line = gateNeedsLine(s, 2, s.rounds[1].arms[0]);
	assert.ok(line.startsWith(gateNeedsPrefix(2)));
	assert.ok(line.includes('the consolidated design') && line.includes(url('c')) && line.includes('click Submit for review'));
});

test('claim, send and record: one send per round, ever, and a claim without a send can be released', async () => {
	const file = join(scratch, 'studies', 's1', 'study.json');
	writeFileSync(file, JSON.stringify(study()));
	const r2 = () => JSON.parse(readFileSync(file, 'utf8')).rounds[1];
	assert.deepEqual(await claimGateDm('s1', 2, { by: 'run 1' }), { claimed: true });
	assert.equal((await claimGateDm('s1', 2, { by: 'run 2' })).claimed, false);
	assert.equal(gateDmStatus(JSON.parse(readFileSync(file, 'utf8')), ledger).status, 'check');
	assert.equal((await releaseGateDm('s1', 2, { reason: 'not in the channel' })).released, true);
	assert.equal(gateDmStatus(JSON.parse(readFileSync(file, 'utf8')), ledger).status, 'due');
	assert.equal((await claimGateDm('s1', 2, { by: 'run 2' })).claimed, true);
	assert.deepEqual(await recordGateDmSent('s1', 2, { ts: '123.456', permalink: 'https://chat.example/p123', by: 'run 2' }), { recorded: true });
	assert.equal(r2().gate_dm.channel, 'C-TEST');
	assert.equal(r2().gate_dm.ts, '123.456');
	assert.equal(gateDmStatus(JSON.parse(readFileSync(file, 'utf8')), ledger).status, 'sent');
	assert.equal((await recordGateDmSent('s1', 2, { ts: '999' })).recorded, false);
	assert.equal((await claimGateDm('s1', 2)).claimed, false);
	assert.equal((await releaseGateDm('s1', 2, { reason: 'test' })).released, false);
	assert.equal(r2().gate_dm.ts, '123.456');
	await assert.rejects(claimGateDm('s1', 9), /no round 9/);
	await assert.rejects(releaseGateDm('s1', 2, {}), /say why/);
});

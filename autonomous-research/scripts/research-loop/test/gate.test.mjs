// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A scratch studies folder and state folder, set before the modules read their environment.
const scratch = mkdtempSync(join(tmpdir(), 'rl-gate-'));
process.env.RESEARCH_LOOP_STUDIES = join(scratch, 'studies');
process.env.RESEARCH_STATE_DIR = join(scratch, 'state');
mkdirSync(join(scratch, 'studies', 's1'), { recursive: true });
mkdirSync(join(scratch, 'state'), { recursive: true });
const studyFile = join(scratch, 'studies', 's1', 'study.json');
writeFileSync(studyFile, JSON.stringify({
	slug: 's1',
	status: 'active',
	rounds: [{ n: 1, arms: [
		{ arm: 'A', design: 'd1', outset_gate: { state: 'awaiting-admin-approval', since: '2026-01-01T00:00:00Z' } },
		{ arm: 'B', design: 'd2' },
	] }],
}));
const { recordReview } = await import('../lib/gate.mjs');
const arms = () => JSON.parse(readFileSync(studyFile, 'utf8')).rounds[0].arms;

test('submitted records the click time and who said so, and keeps the gate state', async () => {
	const done = await recordReview('s1', ['A'], { state: 'submitted', at: '2026-01-02T15:00:00Z', by: 'owner', note: 'owner, on the issue' });
	assert.deepEqual(done, ['A']);
	const [a, b] = arms();
	assert.equal(a.outset_gate.review_requested_at, '2026-01-02T15:00:00.000Z');
	assert.equal(a.outset_gate.review_recorded_by, 'owner');
	assert.equal(a.outset_gate.review_note, 'owner, on the issue');
	assert.equal(a.outset_gate.state, 'awaiting-admin-approval');
	assert.equal(a.outset_gate.since, '2026-01-01T00:00:00Z');
	assert.equal(b.outset_gate, undefined);
});

test('not-submitted clears a recorded click and its old note, and records when, for every arm by default', async () => {
	const done = await recordReview('s1', undefined, { state: 'not-submitted', at: '2026-01-02T16:00:00Z', by: 'coordinator' });
	assert.deepEqual(done, ['A', 'B']);
	for (const a of arms()) {
		assert.equal(a.outset_gate.review_requested_at, undefined);
		assert.equal(a.outset_gate.review_note, undefined);
		assert.equal(a.outset_gate.not_submitted_confirmed_at, '2026-01-02T16:00:00.000Z');
		assert.equal(a.outset_gate.review_recorded_by, 'coordinator');
	}
	const history = JSON.parse(readFileSync(studyFile, 'utf8')).history.map(h => h.event);
	assert.ok(history.some(e => /arm B: Submit for review recorded as not-submitted/.test(e)));
	await recordReview('s1', ['B'], { state: 'not-submitted', by: 'coordinator', note: 'two clicks are unconfirmed' });
	assert.equal(arms()[1].outset_gate.review_note, 'two clicks are unconfirmed');
	assert.equal(arms()[0].outset_gate.review_note, undefined);
});

test('an unknown arm, an unknown state or a bad time changes nothing', async () => {
	const before = readFileSync(studyFile, 'utf8');
	await assert.rejects(recordReview('s1', ['C'], { state: 'submitted' }), /no arm C/);
	await assert.rejects(recordReview('s1', ['A'], { state: 'in-queue' }), /submitted or not-submitted/);
	await assert.rejects(recordReview('s1', ['A'], { state: 'submitted', at: 'this morning' }), /not a time/);
	assert.equal(readFileSync(studyFile, 'utf8'), before);
});

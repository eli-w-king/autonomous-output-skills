// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlineOf, recruitingStopOf, studyPhase, launchWindow, roundClosesAt, firstLaunch } from '../lib/deadline.mjs';
import { checkLaunch } from '../lib/budget.mjs';

const H = 3600e3;
const launched = '2026-01-05T17:00:00.000Z';
const study = (over = {}) => ({
	round_time_cap: { hours_after_launch: 10 },
	budget: { per_round_per_arm_usd: 250, program_cap_usd: 1000, max_rounds: 3 },
	criteria: { finish_line: { participants_per_round: 5 } },
	rounds: [{ n: 1, status: 'recruiting', closes_at: '2026-01-06T03:00:00.000Z', arms: [{ arm: 'A', launched_at: launched }, { arm: 'B', launched_at: '2026-01-05T17:00:30.000Z' }] }],
	...over,
});
const at = h => new Date(Date.parse(launched) + h * H).toISOString();

test('the deadline is the first launch plus 72 hours, or deadline_at when set; none before any launch', () => {
	assert.equal(firstLaunch(study()), launched);
	assert.equal(deadlineOf(study()), at(72));
	assert.equal(recruitingStopOf(study()), at(66));
	assert.equal(deadlineOf(study({ deadline_at: '2026-01-08T17:00:00Z' })), '2026-01-08T17:00:00.000Z');
	assert.equal(deadlineOf(study({ limits: { study_hours: 48 } })), at(48));
	assert.equal(recruitingStopOf(study({ limits: { response_window_hours: 2 } })), at(70));
	assert.equal(deadlineOf(study({ rounds: [{ n: 1, arms: [{ arm: 'A' }] }] })), null);
	assert.equal(studyPhase(study({ rounds: [] })), 'not-started');
});

test('the phase moves from open to the response window to past the deadline', () => {
	assert.equal(studyPhase(study(), at(1)), 'open');
	assert.equal(studyPhase(study(), at(65.99)), 'open');
	assert.equal(studyPhase(study(), at(66)), 'response-window');
	assert.equal(studyPhase(study(), at(71.99)), 'response-window');
	assert.equal(studyPhase(study(), at(72)), 'past-deadline');
});

test('a round launches only if its 10 hour cap ends by the recruiting stop', () => {
	assert.equal(launchWindow(study({ rounds: [] }), at(0)).ok, true);
	assert.equal(launchWindow(study(), at(20)).ok, true);
	const last = launchWindow(study(), at(56));
	assert.equal(last.ok, true);
	assert.equal(last.latest_launch, at(56));
	const late = launchWindow(study(), at(56.01));
	assert.equal(late.ok, false);
	assert.match(late.reason, /needs its 10 hour time cap before recruiting stops/);
	assert.match(launchWindow(study(), at(66)).reason, /recruiting stopped/);
	assert.match(launchWindow(study(), at(80)).reason, /ended at its deadline/);
});

test('the launcher\'s budget check refuses a round that cannot finish before recruiting stops', () => {
	const cost = { known: true, base_usd: 206, with_allowance_usd: 226.6, count: 5 };
	const ledger = { entries: [{ type: 'launch', round: 1, arm: 'A', cost_usd_with_allowance: 226.6 }, { type: 'launch', round: 1, arm: 'B', cost_usd_with_allowance: 226.6 }] };
	assert.equal(checkLaunch({ study: study(), ledger, round: 2, arm: 'C', cost, now: Date.parse(at(30)) }).ok, true);
	const late = checkLaunch({ study: study(), ledger, round: 2, arm: 'C', cost, now: Date.parse(at(60)) });
	assert.equal(late.ok, false);
	assert.ok(late.reasons.some(r => /recruiting stops/.test(r)));
});

test('a round never stays open past the recruiting stop', () => {
	const s = study();
	assert.equal(roundClosesAt(s, s.rounds[0]), '2026-01-06T03:00:00.000Z');
	assert.equal(roundClosesAt(s, { closes_at: at(70) }), at(66));
	assert.equal(roundClosesAt(study({ rounds: [] }), { closes_at: at(5) }), at(5));
});

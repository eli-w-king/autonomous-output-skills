// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allInCost, checkLaunch, committedSpend } from '../lib/budget.mjs';

const quote = (finalCost = 206, incentive = 40, n = 5, fee = 6) => ({
	ui: { finalCost, incentiveAmount: incentive, requestedParticipants: n, totalProcessingFee: fee, totalRecruitFees: 0 },
	outset: { mode: 'self', recruitment_usd: 0, evidence: 'self-recruitment' },
});
const study = (budget = { per_round_per_arm_usd: 250, max_rounds: 3, program_cap_usd: 1000 }) => ({ budget, criteria: { finish_line: { participants_per_round: 5 } } });
const ledger = (entries = []) => ({ entries });
const launch = (round, arm, cost) => ({ type: 'launch', round, arm, cost_usd: cost / 1.1, cost_usd_with_allowance: cost });

test('all-in cost adds the platform quote, survey-side recruitment and a tax allowance', () => {
	const c = allInCost(quote());
	assert.equal(c.known, true);
	assert.equal(c.base_usd, 206);
	assert.equal(c.with_allowance_usd, 226.6);
	assert.equal(c.count, 5);
	assert.deepEqual(c.parts, { ui_incentives: 200, ui_processing: 6, ui_recruit: 0, outset_recruitment: 0, tax_allowance: 20.6 });
});

test('cost is unknown without either platform number, or when the quote does not add up', () => {
	assert.equal(allInCost({ ui: null, outset: quote().outset }).known, false);
	assert.equal(allInCost({ ui: quote().ui, outset: { mode: 'panel', recruitment_usd: null } }).known, false);
	assert.equal(allInCost({ ui: quote().ui, outset: { mode: 'panel', recruitment_usd: '' } }).known, false);
	assert.equal(allInCost({ ui: { ...quote().ui, finalCost: null }, outset: quote().outset }).known, false);
	assert.equal(allInCost({ ui: { ...quote().ui, incentiveAmount: null }, outset: quote().outset }).known, false);
	assert.equal(allInCost(quote(300)).known, false);
	assert.equal(allInCost(undefined).known, false);
	assert.equal(allInCost({ ui: { ...quote().ui, finalCost: '206.00', incentiveAmount: '40.0' }, outset: quote().outset }).known, true, 'numeric strings from the API are fine');
});

test('a quote inside every cap passes', () => {
	const r = checkLaunch({ study: study(), ledger: ledger(), round: 1, arm: 'A', cost: allInCost(quote()) });
	assert.equal(r.ok, true, r.reasons.join('; '));
});

test('over the per-round cap is refused, counting the tax allowance', () => {
	const r = checkLaunch({ study: study(), ledger: ledger(), round: 1, arm: 'A', cost: allInCost(quote(230, 46, 5, 0)) });
	assert.equal(r.ok, false);
	assert.match(r.reasons.join(), /per-round cap/);
});

test('an unknown cost is refused', () => {
	const r = checkLaunch({ study: study(), ledger: ledger(), round: 1, arm: 'A', cost: allInCost({}) });
	assert.equal(r.ok, false);
	assert.match(r.reasons.join(), /cost unknown/);
});

test('a missing or invalid cap is refused, never treated as no limit', () => {
	for (const budget of [{ max_rounds: 3, program_cap_usd: 1000 }, { per_round_per_arm_usd: 250, max_rounds: 3 }, { per_round_per_arm_usd: 'x', max_rounds: 3, program_cap_usd: 1000 }, { per_round_per_arm_usd: 250, program_cap_usd: 1000, max_rounds: 0 }, {}]) {
		const r = checkLaunch({ study: study(budget), ledger: ledger(), round: 1, arm: 'A', cost: allInCost(quote()) });
		assert.equal(r.ok, false, JSON.stringify(budget));
		assert.match(r.reasons.join(), /cap .* is missing or invalid/);
	}
});

test('a round past the limit, and a second launch of the same arm, are refused', () => {
	assert.equal(checkLaunch({ study: study(), ledger: ledger(), round: 4, arm: 'C', cost: allInCost(quote()) }).ok, false);
	const again = checkLaunch({ study: study(), ledger: ledger([launch(1, 'A', 226.6)]), round: 1, arm: 'A', cost: allInCost(quote()) });
	assert.equal(again.ok, false);
	assert.match(again.reasons.join(), /already launched/);
});

test('the program ceiling counts every launch with its allowance', () => {
	const spent = ledger([launch(1, 'A', 226.6), launch(1, 'B', 226.6), launch(2, 'C', 226.6)]);
	assert.equal(Math.round(committedSpend(spent) * 100) / 100, 679.8);
	assert.equal(checkLaunch({ study: study(), ledger: spent, round: 3, arm: 'C', cost: allInCost(quote()) }).ok, true);
	const tight = checkLaunch({ study: study({ per_round_per_arm_usd: 250, max_rounds: 3, program_cap_usd: 800 }), ledger: spent, round: 3, arm: 'C', cost: allInCost(quote()) });
	assert.equal(tight.ok, false);
	assert.match(tight.reasons.join(), /program cap/);
});

test('participant counts outside 1 to the per-arm limit are refused', () => {
	assert.equal(checkLaunch({ study: study(), ledger: ledger(), round: 1, arm: 'A', cost: allInCost(quote(246, 40, 6, 6)) }).ok, false);
	assert.equal(checkLaunch({ study: study(), ledger: ledger(), round: 1, arm: 'A', cost: allInCost(quote(6, 40, 0, 6)) }).ok, false);
});

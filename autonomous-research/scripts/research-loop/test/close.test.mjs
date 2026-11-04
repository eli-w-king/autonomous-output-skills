// node --test loop/scripts/test
// Close-out logic against a fake platform: no real project is ever touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeArm, closeGuard, planClose, closeDetails, successAnswer, UI_STATUS } from '../lib/close.mjs';

const H = 3600e3;
const launched = '2026-01-05T17:00:00.000Z';
const at = h => Date.parse(launched) + h * H;
function makeStudy(roundStatus = 'complete', over = {}) {
	return {
		status: 'recruiting',
		criteria: { finish_line: { participants_per_round: 5 } },
		round_time_cap: { hours_after_launch: 10, min_completes_per_arm_to_synthesize: 3 },
		rounds: [{ n: 1, status: roundStatus, capped: true, arms: [
			{ arm: 'A', launched_at: launched, counts: { completed: 4 }, outset: { study_id: 'o-a' }, ui: { project_id: '101' } },
			{ arm: 'B', launched_at: launched, counts: { completed: 2 }, outset: { study_id: 'o-b' }, ui: { project_id: '102' } },
			{ arm: 'C', outset: { study_id: 'o-c' }, ui: { project_id: '103' } },
		] }],
		...over,
	};
}
const ledger = { entries: [1, 2, 3, 4].map(i => ({ type: 'payment', round: 1, arm: 'A', interview_id: `i${i}` })) };

/** A fake platform whose state changes only through the calls the closer makes. */
function fakePlatform({ ui = {}, outset = {}, closeWorks = true, unpublishWorks = true } = {}) {
	const state = {
		ui: { signed_in: true, status_id: UI_STATUS.LAUNCHED, status: 'Launched', tabs: { submitted: 0, started: 0 }, precheck: { ok: true, errors: [] }, ...ui },
		outset: { active: true, ...outset },
	};
	const calls = [];
	return {
		calls,
		state,
		platform: {
			uiState: async arm => { calls.push(['uiState', arm.arm]); return { ...state.ui }; },
			uiClose: async (arm, attrs) => {
				calls.push(['uiClose', arm.arm, attrs]);
				if (closeWorks) {
					state.ui = { ...state.ui, status_id: UI_STATUS.PENDING_CLOSE_REQUEST, status: 'Pending Close Request' };
				}
			},
			outsetState: async arm => { calls.push(['outsetState', arm.arm]); return { ...state.outset }; },
			outsetClose: async arm => {
				calls.push(['outsetClose', arm.arm]);
				if (unpublishWorks) {
					state.outset = { active: false };
				}
			},
		},
	};
}
function harness(study) {
	const records = [];
	return {
		records,
		record: async e => { records.push(e); },
		update: async fn => { fn(study); },
	};
}
const fast = { tries: 2, waitMs: 1 };

test('nothing closes while a round is still recruiting before the recruiting stop; the refusal is recorded', async () => {
	const study = makeStudy('recruiting');
	const fake = fakePlatform();
	const h = harness(study);
	const res = await closeArm({ study, ledger, roundN: 1, armName: 'A', now: at(5), platform: fake.platform, ...h });
	assert.equal(res.code, 3);
	assert.match(res.reason, /still recruiting/);
	assert.deepEqual(fake.calls, []);
	assert.equal(h.records[0].type, 'close-refused');
	const dry = await closeArm({ study, ledger, roundN: 1, armName: 'A', now: at(5), dryRun: true, platform: fake.platform, ...h });
	assert.equal(dry.code, 3);
	assert.equal(h.records[1].type, 'close-dry-run');
});

test('the guard opens at round end, at the recruiting stop, at the deadline and once the study ended', () => {
	const r = s => s.rounds[0];
	const a = s => s.rounds[0].arms[0];
	assert.equal(closeGuard(makeStudy('complete'), r(makeStudy()), a(makeStudy()), at(11)).reason, 'round-complete');
	const recruiting = makeStudy('recruiting');
	assert.equal(closeGuard(recruiting, r(recruiting), a(recruiting), at(66)).reason, 'recruiting-stop');
	assert.equal(closeGuard(recruiting, r(recruiting), a(recruiting), at(72)).reason, 'deadline');
	const ended = makeStudy('recruiting', { status: 'handed-to-owner' });
	assert.equal(closeGuard(ended, r(ended), a(ended), at(5)).reason, 'study-ended');
	const never = makeStudy();
	const g = closeGuard(never, r(never), never.rounds[0].arms[2], at(11));
	assert.equal(g.ok, false);
	assert.equal(g.nothing, true);
});

test('a dry run reads both platforms, plans Outset then User Interviews, and changes nothing', async () => {
	const study = makeStudy();
	const fake = fakePlatform();
	const h = harness(study);
	const res = await closeArm({ study, ledger, roundN: 1, armName: 'A', now: at(11), dryRun: true, platform: fake.platform, ...h });
	assert.equal(res.code, 0);
	assert.deepEqual(res.steps.map(s => `${s.platform}:${s.action}`), ['outset:unpublish', 'user-interviews:close-request']);
	assert.deepEqual(fake.calls.map(c => c[0]), ['outsetState', 'uiState']);
	assert.equal(fake.state.outset.active, true);
	assert.equal(h.records.length, 1);
	assert.equal(h.records[0].type, 'close-dry-run');
	assert.equal(h.records[0].ui_before.status, 'Launched');
});

test('a real close unpublishes Outset, requests the User Interviews close, reads both back and records each', async () => {
	const study = makeStudy();
	const fake = fakePlatform();
	const h = harness(study);
	const res = await closeArm({ study, ledger, roundN: 1, armName: 'A', now: at(11), platform: fake.platform, readBackOpts: fast, ...h });
	assert.equal(res.code, 0);
	const actions = fake.calls.filter(c => c[0] === 'outsetClose' || c[0] === 'uiClose').map(c => c[0]);
	assert.deepEqual(actions, ['outsetClose', 'uiClose']);
	const attrs = fake.calls.find(c => c[0] === 'uiClose')[2];
	assert.equal(attrs.projectConsideredSuccessfulId, 1);
	assert.match(attrs.details, /4 of 5 participants completed it, and 4 were paid/);
	assert.doesNotMatch(attrs.details, /[\u2013\u2014]/);
	const closes = h.records.filter(r => r.type === 'close');
	assert.deepEqual(closes.map(r => r.platform), ['outset', 'user-interviews']);
	assert.deepEqual(closes[0].after, { active: false });
	assert.equal(closes[1].after.status_id, UI_STATUS.PENDING_CLOSE_REQUEST);
	const arm = study.rounds[0].arms[0];
	assert.equal(arm.close.outset.state, 'closed');
	assert.equal(arm.close.ui.state, 'close requested');
	assert.equal(arm.close.reason, 'round-complete');
});

test('a second run finds both closed and does nothing', async () => {
	const study = makeStudy();
	const fake = fakePlatform({ ui: { status_id: UI_STATUS.PENDING_CLOSE_REQUEST, status: 'Pending Close Request' }, outset: { active: false } });
	const h = harness(study);
	const res = await closeArm({ study, ledger, roundN: 1, armName: 'A', now: at(12), platform: fake.platform, ...h });
	assert.equal(res.code, 0);
	assert.deepEqual(res.steps.map(s => s.action), ['none', 'none']);
	assert.ok(!fake.calls.some(c => c[0] === 'outsetClose' || c[0] === 'uiClose'));
});

test('unmarked participation or Submitted participants block User Interviews, while Outset still closes', async () => {
	for (const ui of [{ precheck: { ok: false, errors: ['1 unmarked participation'] } }, { tabs: { submitted: 2 } }]) {
		const study = makeStudy();
		const fake = fakePlatform({ ui });
		const h = harness(study);
		const res = await closeArm({ study, ledger, roundN: 1, armName: 'A', now: at(11), platform: fake.platform, readBackOpts: fast, ...h });
		assert.equal(res.code, 4);
		assert.ok(fake.calls.some(c => c[0] === 'outsetClose'));
		assert.ok(!fake.calls.some(c => c[0] === 'uiClose'));
		assert.equal(h.records.find(r => r.type === 'close-blocked').platform, 'user-interviews');
		assert.equal(study.rounds[0].arms[0].close.ui.state, 'blocked');
	}
	const signedOut = fakePlatform({ ui: { signed_in: false } });
	const s2 = makeStudy();
	const r2 = await closeArm({ study: s2, ledger, roundN: 1, armName: 'A', now: at(11), platform: signedOut.platform, readBackOpts: fast, ...harness(s2) });
	assert.equal(r2.code, 4);
	assert.match(r2.steps[1].why, /sign-in/);
});

test('a close whose read-back does not confirm it is reported, not assumed', async () => {
	const study = makeStudy();
	const fake = fakePlatform({ unpublishWorks: false, closeWorks: false });
	const h = harness(study);
	const res = await closeArm({ study, ledger, roundN: 1, armName: 'A', now: at(11), platform: fake.platform, readBackOpts: fast, ...h });
	assert.equal(res.code, 5);
	assert.deepEqual(h.records.filter(r => r.type === 'close-unverified').map(r => r.platform), ['outset', 'user-interviews']);
	assert.equal(h.records.filter(r => r.type === 'close').length, 0);
});

test('only one platform when asked; the success answer and the details follow the facts', () => {
	assert.deepEqual(planClose({ outset: { active: true }, ui: null, only: 'outset' }).map(s => s.platform), ['outset']);
	assert.deepEqual(planClose({ outset: null, ui: { signed_in: true, status_id: 1, tabs: {}, precheck: { ok: true } }, only: 'ui' }).map(s => s.platform), ['user-interviews']);
	const s = makeStudy();
	assert.equal(successAnswer(s, s.rounds[0].arms[0]), 1);
	assert.equal(successAnswer(s, s.rounds[0].arms[1]), 2);
	assert.match(closeDetails(s, s.rounds[0], s.rounds[0].arms[1], { entries: [] }, 'deadline'), /reached the study's deadline\. 2 of 5 participants completed it, and 0 were paid\./);
});

#!/usr/bin/env node
// The guarded launcher: the only code that uses the Outset launch connection or clicks Launch in User Interviews.
//
//   node launch.mjs --study <slug> --round <n> --arm <A>              check, then launch when everything passes
//   node launch.mjs --study <slug> --round <n> --arm <A> --dry-run    check and record, launch nothing
//   node launch.mjs ... --dry-run --simulate-cost 260|unknown          prove the refusal path (dry runs only)
//
// Order: compute the all-in cost from the platforms, check every cap, record the check in the ledger, refuse when
// over a cap or unknown. Then, under a lock per arm (two launchers can never both click): publish the Outset study
// (launch connection) and verify it is live; check what a participant gets (lib/preflight.mjs: the link shows the
// welcome page and every question serves its exact image; nothing is clicked) and stop when that fails; launch the
// User Interviews project with the payment method the study names (user_interviews.payment), re-reading the ledger
// and every cap right before the click that commits money; verify; record the launch (study, round, cost, count,
// time). Exit codes: 0 launched (or dry run passed), 3 refused, 4 blocked by a gate (Outset's publish approval, a
// failed participant check), 5 partly launched, 1 error.
import { loadStudy, loadLedger, appendLedger, updateStudy, findArm, addHistory } from './lib/state.mjs';
import { gateNeedsLine, gateNeedsPrefix } from './lib/gatedm.mjs';
import { allInCost, checkLaunch } from './lib/budget.mjs';
import { outsetEveryday, outsetLaunchConnection, outsetRest } from './lib/outset.mjs';
import { ensureUiBrowser, uiSignedIn } from './lib/ui-chrome.mjs';
import { uiFetch, jsClick } from './lib/ui-browser.mjs';
import { preflightArm } from './lib/preflight.mjs';
import { withLock } from './lib/lock.mjs';
import { STATE_DIR } from './lib/env.mjs';
import { CONFIG } from './lib/config.mjs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const slug = opt('study'), roundN = Number(opt('round')), armName = opt('arm');
const dryRun = argv.includes('--dry-run');
const simulate = opt('simulate-cost');
if (!slug || !roundN || !armName) {
	console.error('usage: launch.mjs --study <slug> --round <n> --arm <A> [--dry-run] [--simulate-cost <usd|unknown>]');
	process.exit(2);
}
if (simulate && !dryRun) {
	console.error('--simulate-cost only works with --dry-run');
	process.exit(2);
}
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const study = loadStudy(slug);
const { arm } = findArm(study, roundN, armName);
const outsetId = arm.outset.study_id;
const uiId = arm.ui.project_id;

// 1. Preconditions that are not money.
const pre = [];
if (!arm.stimulus?.verified_at) {
	pre.push('stimulus is not attached and verified');
}
if (arm.launched_at) {
	pre.push(`already launched at ${arm.launched_at}`);
}

// 2. The all-in cost, from the platforms.
const everyday = await outsetEveryday();
const status = JSON.parse(await everyday.call('get_recruitment_status', { study_id: outsetId }));
const surveyState = JSON.parse(await everyday.call('get_survey_state', { survey_id: outsetId }));
let outsetQuote = null;
if (surveyState.survey.recruit_mode === 'self' && !status.automated_recruitment && !status.has_incentive) {
	outsetQuote = { mode: 'self', recruitment_usd: 0, evidence: 'recruit_mode self, no automated recruitment, no Outset incentive' };
} else {
	const est = JSON.parse(await everyday.call('estimate_recruitment_cost', { study_id: outsetId }).catch(() => '{}'));
	const v = Number(est.expected_total_cost_usd ?? est.total_cost_usd);
	outsetQuote = { mode: 'panel', recruitment_usd: Number.isFinite(v) ? v : null, evidence: 'estimate_recruitment_cost' };
}
const { page } = await ensureUiBrowser({ log: say });
if (!(await uiSignedIn(page))) {
	await updateStudy(slug, s => { s.status = 'needs-sign-in'; addHistory(s, 'User Interviews needs a sign-in; launch stopped'); });
	await appendLedger(slug, { type: 'blocked', round: roundN, arm: armName, reason: 'User Interviews needs sign-in' });
	say('User Interviews is signed out. The loop never types a password; marked needs-sign-in.');
	process.exit(4);
}
const costRes = await uiFetch(page, `/api/projects/${uiId}/expected-cost-details`);
const uiQuote = costRes.status === 200 ? costRes.json?.data?.attributes ?? null : null;
let cost = allInCost({ ui: uiQuote, outset: outsetQuote }, study.budget?.tax_allowance ?? 0.1);
if (simulate === 'unknown') {
	cost = allInCost({ ui: null, outset: outsetQuote });
} else if (simulate) {
	const usd = Number(simulate);
	cost = allInCost({ ui: { finalCost: usd, incentiveAmount: usd / 5, requestedParticipants: 5, totalProcessingFee: 0, totalRecruitFees: 0 }, outset: { recruitment_usd: 0 } }, study.budget?.tax_allowance ?? 0.1);
}
const check = checkLaunch({ study, ledger: loadLedger(slug), round: roundN, arm: armName, cost });
const reasons = [...check.reasons, ...(simulate ? [] : pre)];
const record = { round: roundN, arm: armName, study: outsetId, ui_project: uiId, cost, committed_before_usd: check.committed_usd, dry_run: dryRun, simulated: simulate ?? null };
if (reasons.length) {
	// A launch the ledger records but the study does not (a crash between the two writes) is repaired, not refused,
	// so the arm's interviews are still harvested.
	const prior = loadLedger(slug).entries.find(e => e.type === 'launch' && Number(e.round) === roundN && e.arm === armName);
	if (prior && !arm.launched_at && !dryRun && !simulate) {
		await markLaunched(prior.at ?? new Date().toISOString(), prior.cost ?? cost);
		say(`the ledger already records this launch (${prior.at}); study state repaired, nothing clicked`);
		process.exit(0);
	}
	await appendLedger(slug, { type: 'refused', ...record, reasons });
	say(`REFUSED: ${reasons.join(' | ')}`);
	process.exit(3);
}
await appendLedger(slug, { type: dryRun ? 'dry-run-check' : 'check', ...record });
say(`budget check passed: $${cost.base_usd} (up to $${cost.with_allowance_usd} with the tax allowance), committed so far $${check.committed_usd}`);
if (dryRun) {
	process.exit(0);
}

// Steps 3 to 6 run under a lock per arm, so a scheduled run and a manual one can never both launch it.
const LAUNCH_LOCK = join(STATE_DIR, 'locks', `launch-${slug}-r${roundN}-${armName}.lock`);
const code = await withLock(LAUNCH_LOCK, launchLocked, { label: `the launch lock for ${slug} round ${roundN} arm ${armName}`, timeoutMs: 5_000, staleMs: 45 * 60e3 }).catch(async e => {
	if (!/Timed out/.test(e.message)) {
		throw e;
	}
	await appendLedger(slug, { type: 'refused', ...record, reasons: ['another launcher is running for this arm'] });
	say('REFUSED: another launcher is running for this arm');
	return 3;
});
process.exit(code);

async function markLaunched(launchedAt, armCost) {
	await updateStudy(slug, s => {
		const { round, arm: a } = findArm(s, roundN, armName);
		a.launched_at ??= launchedAt;
		a.cost ??= armCost;
		const url = a.outset?.study_url;
		s.needs_you = (s.needs_you ?? []).filter(n => !(n.startsWith(gateNeedsPrefix(roundN)) && url && n.includes(url)));
		round.status = 'recruiting';
		const capH = s.round_time_cap?.hours_after_launch ?? 10;
		round.closes_at ??= new Date(Date.parse(a.launched_at) + capH * 3600e3).toISOString();
		s.status = 'recruiting';
		addHistory(s, `launched round ${roundN} arm ${armName}`, { cost_usd: armCost?.base_usd });
	});
}

function refreshMorning() {
	if (CONFIG.morningDir) {
		spawnSync(process.execPath, [join(HERE, 'morning.mjs')], { encoding: 'utf8', timeout: 10 * 60e3 });
	}
}

async function launchLocked() {
	// 3. Outset first.
	const rest = await outsetRest(`/v1/studies/${outsetId}/`);
	if (!rest.body?.active) {
		const launchConn = await outsetLaunchConnection();
		try {
			const r = await launchConn.call('publish_study', { study_id: outsetId });
			say(`publish_study: ${r.slice(0, 200).replace(/\s+/g, ' ')}`);
		} catch (e) {
			const approval = /approval|ROLE_CONFIGURATION|review/i.test(e.message);
			await appendLedger(slug, { type: 'blocked', round: roundN, arm: armName, reason: approval ? 'Outset publish needs org admin approval' : 'Outset publish failed', detail: e.message.slice(0, 500) });
			await updateStudy(slug, s => {
				s.status = approval ? 'awaiting-outset-approval' : 'launch-failed';
				addHistory(s, `publish_study refused for arm ${armName}`, { detail: e.message.slice(0, 300) });
				// The one step only a person can take shows under "Needs you" in the report, the issue and the morning
				// summary until the arm launches. The owner's one DM about it is procedure step 6b (lib/gatedm.mjs).
				if (approval) {
					const { arm: a } = findArm(s, roundN, armName);
					// The gate state, right away (the gate check keeps it current from here), so the morning summary's gate
					// block and the owner's one DM (step 6b) see this arm without waiting for another run.
					if (a.outset_gate?.state !== 'awaiting-admin-approval') {
						const now = new Date().toISOString();
						a.outset_gate = { ...(a.outset_gate ?? {}), state: 'awaiting-admin-approval', issues: ['approval_required'], since: now, checked_at: now };
					}
					const line = gateNeedsLine(s, roundN, a);
					if (!(s.needs_you ?? []).includes(line)) {
						s.needs_you = [...(s.needs_you ?? []), line];
					}
				}
			});
			say(`Outset publish blocked: ${e.message.slice(0, 300)}`);
			return approval ? 4 : 1;
		}
	}
	const after = await outsetRest(`/v1/studies/${outsetId}/`);
	if (!after.body?.active) {
		say('Outset study is still not active after publishing; not launching recruitment.');
		return 1;
	}

	// 4. What a participant gets, checked before anyone is recruited (it stands in for a test interview): the link shows
	// the welcome page, not "Study closed", and every question serves its exact image. Nothing is clicked.
	const pf = await preflightArm(slug, roundN, armName, everyday);
	const alertPrefix = `Round ${roundN} arm ${armName}: the participant link check failed`;
	await updateStudy(slug, s => {
		const { arm: a } = findArm(s, roundN, armName);
		if (pf.created_interviews.length) {
			a.exclude = [...new Set([...(a.exclude ?? []), ...pf.created_interviews])];
		}
		const previous = (s.launch_alerts ?? []).find(x => Number(x.round) === roundN && x.arm === armName);
		s.launch_alerts = (s.launch_alerts ?? []).filter(x => x !== previous);
		s.needs_you = (s.needs_you ?? []).filter(n => !n.startsWith(alertPrefix));
		if (!pf.ok) {
			const text = `${alertPrefix}, so recruiting did not launch: ${pf.problems.join('; ')}. The Outset study is published, but nobody has the link yet. The next run checks again; details in rounds/r${roundN}/arm-${armName}/preflight.json and preflight.png.`;
			s.launch_alerts.push({ round: roundN, arm: armName, at: pf.at, text });
			s.needs_you.unshift(text);
			if (previous?.text !== text) {
				addHistory(s, `participant link check failed for round ${roundN} arm ${armName}`, { problems: pf.problems });
			}
		} else {
			addHistory(s, `participant link check passed for round ${roundN} arm ${armName}`, { welcome: pf.page.welcome, start_button: pf.page.startButton, image_questions: pf.images.questions_checked });
		}
	});
	if (!pf.ok) {
		await appendLedger(slug, { type: 'blocked', round: roundN, arm: armName, reason: 'participant link check failed', detail: pf.problems.join('; ').slice(0, 500) });
		say(`participant link check FAILED: ${pf.problems.join(' | ')}; not launching recruitment`);
		refreshMorning();
		return 4;
	}
	say(`participant link check passed: welcome ${pf.page.welcome}, start button ${pf.page.startButton}, ${pf.images.questions_checked} image questions`);

	// 5. Then User Interviews.
	await page.goto(`https://www.userinterviews.com/projects/${uiId}/research-design/recruitment`, { waitUntil: 'domcontentloaded' });
	await page.waitForTimeout(6000);
	const beforeAttrs = (await uiFetch(page, `/api/projects/${uiId}`)).json?.data?.attributes ?? {};
	const before = beforeAttrs.currentStatus;
	// Only the loop launches its projects. One that is already past New was launched by an earlier attempt whose status
	// read came too early (or by a person): the money is committed either way, so record it and do not click again.
	const foundLive = Boolean(beforeAttrs.isActive || (before && before !== 'New'));
	const pay = study.user_interviews?.payment ?? {};
	let now = beforeAttrs;
	if (foundLive) {
		say(`User Interviews project is already past New (${before}, isActive ${beforeAttrs.isActive}); recording the launch without clicking`);
	} else {
		await jsClick(page.getByRole('button', { name: 'Launch', exact: true }));
		await page.waitForTimeout(2500);
		let picked = false;
		for (const r of await page.$$('input[type="radio"]')) {
			const label = await r.evaluate(el => (el.closest('label')?.innerText || el.parentElement?.innerText || '').trim());
			if (/Prepaid balance/i.test(label)) {
				await r.evaluate(el => el.click());
				picked = true;
				break;
			}
		}
		await page.waitForTimeout(1200);
		// Choosing "Prepaid balance" reveals a react-select of balances; pick the one the study names (the owner's usual one).
		// Its options render only while it is open, so open it first (verified read-only on 2026-11-02).
		const balanceCtl = page.locator('[class*="Select__control"]').filter({ hasText: 'Select a prepaid balance' }).first();
		if (picked && await balanceCtl.count()) {
			await jsClick(balanceCtl);
			await page.waitForTimeout(800);
			const choice = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${pay.option_id}:`) });
			if (!(await choice.count())) {
				say(`prepaid balance ${pay.option_id} is not offered; not launching`);
				return 1;
			}
			await jsClick(choice);
			await page.waitForTimeout(800);
		}
		const balanceShown = (await page.locator('[class*="Select__control"]').filter({ hasText: new RegExp(`${pay.option_id}:`) }).count()) > 0;
		if (!picked || !balanceShown) {
			say('could not select the prepaid balance payment method; not launching');
			return 1;
		}
		if (await page.getByRole('button', { name: 'Launch project', exact: true }).isDisabled()) {
			say('Launch project is disabled after choosing the payment method; not launching');
			return 1;
		}
		// Right before the click that commits money: read the ledger and the study again and check every cap again.
		const fresh = loadStudy(slug);
		const recheck = checkLaunch({ study: fresh, ledger: loadLedger(slug), round: roundN, arm: armName, cost });
		const already = findArm(fresh, roundN, armName).arm.launched_at;
		if (!recheck.ok || already) {
			const why = [...recheck.reasons, ...(already ? [`the study says this arm launched at ${already}`] : [])];
			await appendLedger(slug, { type: 'refused', ...record, reasons: why.map(r => `re-check right before the click: ${r}`) });
			say(`REFUSED at the last moment: ${why.join(' | ')}`);
			return 3;
		}
		await jsClick(page.getByRole('button', { name: 'Launch project', exact: true }));
		await page.waitForTimeout(4000);
		const confirm = page.getByRole('dialog').getByRole('button', { name: /^(Launch|Confirm|Yes, launch)/i });
		if (await confirm.count()) {
			await jsClick(confirm);
			await page.waitForTimeout(4000);
		}
		// The status can change a little after the click; read it for up to a minute.
		for (let i = 0; i < 12; i++) {
			now = (await uiFetch(page, `/api/projects/${uiId}`)).json?.data?.attributes;
			if (now?.isActive || (now?.currentStatus && now.currentStatus !== before)) {
				break;
			}
			await page.waitForTimeout(5000);
		}
		say(`User Interviews status: ${before} -> ${now?.currentStatus} (isActive ${now?.isActive})`);
		if (!now?.isActive && now?.currentStatus === before) {
			await appendLedger(slug, { type: 'blocked', round: roundN, arm: armName, reason: 'User Interviews launch did not take', detail: `status ${now?.currentStatus}` });
			await updateStudy(slug, s => { addHistory(s, `User Interviews launch did not take for arm ${armName}; Outset is live`); });
			return 5;
		}
	}

	// 6. Record the launch, once.
	const prior = loadLedger(slug).entries.find(e => e.type === 'launch' && Number(e.round) === roundN && e.arm === armName);
	const launchedAt = prior?.at ?? new Date().toISOString();
	if (!prior) {
		await appendLedger(slug, { type: 'launch', ...record, cost_usd: cost.base_usd, cost_usd_with_allowance: cost.with_allowance_usd, count: cost.count, payment: `prepaid balance ${pay.option_id ?? ''}`.trim(), ui_status: now?.currentStatus ?? null, found_live: foundLive });
	}
	await markLaunched(launchedAt, cost);
	say(`LAUNCHED round ${roundN} arm ${armName}: $${cost.base_usd}, ${cost.count} participants`);
	return 0;
}

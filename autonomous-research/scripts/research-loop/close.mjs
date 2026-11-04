// The guarded closer: the only code that closes a round's projects. It ends a round's recruiting on both platforms once
// the round is over (lib/close.mjs has the rules and the order), with a dry run, a ledger entry for every check and
// action, and a read-back of every change. Like launch.mjs, it is the only other code that uses the Outset launch
// connection, and only for unpublish_study.
//
//   node close.mjs --study <slug> --round <n> --arm <A> [--dry-run] [--only outset|ui] [--success yes|no]
//   node close.mjs --study <slug> --round <n> --all [--dry-run]       every launched arm of the round, in order
//
// Before closing, step 4b pays or rejects every Submitted participant; User Interviews refuses to close while any
// participation is unmarked, and so does this script. Exit codes: 0 closed (or nothing left to close), 2 usage,
// 3 refused (not allowed now, or another closer is running), 4 blocked by a platform (mark participants, sign in, then
// run it again), 5 an action failed or its read-back did not confirm it, 1 error.
import { join } from 'node:path';
import { loadStudy, loadLedger, appendLedger, updateStudy } from './lib/state.mjs';
import { closeArm, UI_SUCCESS } from './lib/close.mjs';
import { outsetLaunchConnection, outsetRest } from './lib/outset.mjs';
import { ensureUiBrowser, uiSignedIn } from './lib/ui-chrome.mjs';
import { uiFetch, gotoWithBackoff } from './lib/ui-browser.mjs';
import { withLock } from './lib/lock.mjs';
import { STATE_DIR } from './lib/env.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const slug = opt('study'), roundN = Number(opt('round'));
const dryRun = argv.includes('--dry-run');
const only = opt('only') ?? 'all';
const successArg = opt('success');
if (!slug || !roundN || (!opt('arm') && !argv.includes('--all')) || !['all', 'ui', 'outset'].includes(only) || (successArg && !UI_SUCCESS[successArg])) {
	console.error('usage: close.mjs --study <slug> --round <n> (--arm <A> | --all) [--dry-run] [--only outset|ui] [--success yes|no]');
	process.exit(2);
}
const say = m => console.log(`[close ${slug} r${roundN}] ${m}`);

// The real platforms. User Interviews through its web app's own JSON API in the loop's signed-in Chrome; Outset through
// REST for reading and the launch connection for unpublish_study.
let uiPage = null;
let launchConn = null;
const TAB = /(Applied|Marked potential|Approved|Started|Submitted|Completed|Removed) \((\d+)\)/g;
const platform = {
	async uiState(arm) {
		const pid = arm.ui?.project_id;
		if (!pid) {
			throw new Error(`arm ${arm.arm} has no User Interviews project id`);
		}
		uiPage ??= (await ensureUiBrowser({ log: say })).page;
		if (!(await uiSignedIn(uiPage))) {
			return { signed_in: false };
		}
		await gotoWithBackoff(uiPage, `https://www.userinterviews.com/projects/${pid}/participant-management/completed`);
		await uiPage.waitForTimeout(4000);
		const text = await uiPage.evaluate(() => document.body.innerText);
		const tabs = Object.fromEntries([...text.matchAll(TAB)].map(m => [m[1].toLowerCase().replace(/ /g, '_'), Number(m[2])]));
		const p = await uiFetch(uiPage, `/api/projects/${pid}`);
		if (p.status !== 200) {
			throw new Error(`reading project ${pid}: HTTP ${p.status}`);
		}
		const a = p.json?.data?.attributes ?? {};
		// The app's own check before it offers "Close project": 200 when it may close, 422 with the reasons otherwise.
		const c = await uiFetch(uiPage, `/api/projects/${pid}/status_updates/new.json?statusTypeId=9`);
		const precheck = c.status === 200 ? { ok: true, errors: [] }
			: { ok: false, errors: (c.json?.errors ?? []).map(e => e.detail ?? e.code).filter(Boolean).concat(c.json?.errors?.length ? [] : [`HTTP ${c.status}`]) };
		return { signed_in: true, status_id: a.latestStatusTypeId, status: a.currentStatus, project_status: a.projectStatus, is_active: a.isActive, tabs, precheck };
	},
	async uiClose(arm, attrs) {
		const pid = arm.ui.project_id;
		const r = await uiFetch(uiPage, `/api/projects/${pid}/close_requests.json`, { method: 'POST', body: { data: { attributes: attrs } } });
		if (r.status >= 300) {
			throw new Error(`close request for project ${pid}: HTTP ${r.status} ${JSON.stringify(r.json ?? r.text ?? '').slice(0, 300)}`);
		}
		return { status: r.status };
	},
	async outsetState(arm) {
		const r = await outsetRest(`/v1/studies/${arm.outset.study_id}/`);
		if (r.status !== 200) {
			throw new Error(`reading Outset study ${arm.outset.study_id}: HTTP ${r.status}`);
		}
		return { active: r.body?.active === true };
	},
	async outsetClose(arm) {
		launchConn ??= await outsetLaunchConnection();
		const out = await launchConn.call('unpublish_study', { study_id: arm.outset.study_id });
		say(`unpublish_study: ${String(out).slice(0, 200).replace(/\s+/g, ' ')}`);
	},
};

const study0 = loadStudy(slug);
const round0 = study0.rounds.find(r => Number(r.n) === roundN);
if (!round0) {
	console.error(`no round ${roundN} in ${slug}`);
	process.exit(2);
}
const arms = opt('arm') ? [opt('arm')] : round0.arms.filter(a => a.launched_at).map(a => a.arm);
let exit = 0;
const rank = { 0: 0, 4: 1, 3: 2, 5: 3, 1: 4 };
for (const armName of arms) {
	const lock = join(STATE_DIR, 'locks', `close-${slug}-r${roundN}-${armName}.lock`);
	const res = await withLock(lock, async () => {
		// Re-read inside the lock: another closer may have just finished this arm.
		const study = loadStudy(slug);
		return closeArm({
			study, ledger: loadLedger(slug), roundN, armName, dryRun, only,
			success: successArg ? UI_SUCCESS[successArg] : undefined,
			platform,
			record: entry => appendLedger(slug, entry),
			update: fn => updateStudy(slug, fn),
		});
	}, { label: `the close lock for ${slug} round ${roundN} arm ${armName}`, timeoutMs: 5_000, staleMs: 30 * 60e3 }).catch(async e => {
		if (/Timed out/.test(e.message)) {
			await appendLedger(slug, { type: 'close-refused', round: roundN, arm: armName, reasons: ['another closer is running for this arm'] });
			return { code: 3, reason: 'another closer is running for this arm', steps: [] };
		}
		return { code: 1, reason: e.message, steps: [] };
	});
	say(`arm ${armName}${dryRun ? ' (dry run)' : ''}: ${res.reason}`);
	for (const s of res.steps) {
		say(`  ${s.platform}: ${s.action} (${s.why})`);
	}
	say(`  exit ${res.code}`);
	exit = rank[res.code] > rank[exit] ? res.code : exit;
}
process.exit(exit);

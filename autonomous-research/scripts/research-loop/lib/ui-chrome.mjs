// The loop's own Chrome for User Interviews: the dedicated profile, a fixed CDP port, off-screen, detached.
// ensureUiBrowser() starts it when needed, never touches any other Chrome, and closes only a Chrome that holds this
// same profile (one Chrome per profile; a window left open would block the launch). It never types a password: when
// the session has expired it reports signedIn: false and the run marks the study "needs sign-in".
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { connectUi, targetIdOf, pageByTarget, UI_CDP_PORT } from './ui-browser.mjs';
import { STATE_DIR } from './env.mjs';
import { CONFIG } from './config.mjs';

export const UI_PROFILE = CONFIG.uiProfile;
const RECEIPT = join(STATE_DIR, 'ui-chrome.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function chromePath() {
	if (process.env.CHROME_PATH) {
		return process.env.CHROME_PATH;
	}
	if (process.platform === 'win32') {
		const p = join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe');
		return existsSync(p) ? p : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
	}
	return process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome';
}

async function cdpUp(port = UI_CDP_PORT) {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
		return r.ok;
	} catch {
		return false;
	}
}

/** Main Chrome processes (not renderers) whose command line uses this profile. */
function chromesOnProfile() {
	const needle = UI_PROFILE.toLowerCase();
	if (process.platform === 'win32') {
		const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
			"Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"], { encoding: 'utf8' });
		return out.split(/\r?\n/).filter(Boolean).map(l => l.split('\t')).filter(([, c]) => (c ?? '').toLowerCase().includes(needle)).map(([pid, c]) => ({ pid: Number(pid), cmd: c }));
	}
	const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
	return out.split('\n').map(l => l.trim()).filter(l => l.toLowerCase().includes(needle) && !l.includes('--type=')).map(l => ({ pid: Number(l.split(/\s+/)[0]), cmd: l }));
}

function readReceipt() {
	try {
		return JSON.parse(readFileSync(RECEIPT, 'utf8'));
	} catch {
		return null;
	}
}

export async function ensureUiBrowser({ log = () => { } } = {}) {
	const port = UI_CDP_PORT;
	let receipt = readReceipt();
	const onProfile = chromesOnProfile();
	const ours = onProfile.filter(p => p.cmd.includes(`--remote-debugging-port=${port}`));
	if (!(await cdpUp(port)) || !ours.length) {
		for (const p of onProfile) {
			// Only Chrome on this dedicated profile; never any other browser.
			log(`closing Chrome ${p.pid} that holds the User Interviews profile`);
			try { process.kill(p.pid); } catch { /* already gone */ }
		}
		if (onProfile.length) {
			await sleep(3000);
		}
		mkdirSync(dirname(RECEIPT), { recursive: true });
		const args = [
			`--user-data-dir=${UI_PROFILE}`, `--remote-debugging-port=${port}`, `--remote-allow-origins=http://127.0.0.1:${port}`,
			'--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble',
			'--window-position=-3000,-3000', '--window-size=1440,1000',
			'--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
			'about:blank',
		];
		const child = spawn(chromePath(), args, { detached: true, stdio: 'ignore', windowsHide: false });
		child.unref();
		for (let i = 0; i < 30 && !(await cdpUp(port)); i++) {
			await sleep(1000);
		}
		if (!(await cdpUp(port))) {
			throw new Error('the User Interviews Chrome did not start');
		}
		receipt = { purpose: 'User Interviews browser (research loop)', pid: child.pid, port, profile: UI_PROFILE, started: new Date().toISOString(), tab: null };
		writeFileSync(RECEIPT, JSON.stringify(receipt, null, 1));
		log(`started Chrome ${child.pid} on port ${port}`);
	}
	const { browser, ctx } = await connectUi(port);
	if (receipt && !receipt.pid && ours[0]) {
		receipt.pid = ours[0].pid;
		writeFileSync(RECEIPT, JSON.stringify(receipt, null, 1));
	}
	let page = receipt?.tab ? await pageByTarget(ctx, receipt.tab) : null;
	if (!page) {
		page = ctx.pages().find(p => /userinterviews\.com/.test(p.url())) ?? ctx.pages()[0] ?? await ctx.newPage();
		receipt = { ...(receipt ?? { purpose: 'User Interviews browser (research loop)', port, profile: UI_PROFILE }), tab: await targetIdOf(ctx, page) };
		writeFileSync(RECEIPT, JSON.stringify(receipt, null, 1));
	}
	return { browser, ctx, page, receipt };
}

/** True when the researcher app loads; false when User Interviews asks for a sign-in. Never types anything. */
export async function uiSignedIn(page) {
	await page.goto('https://www.userinterviews.com/researcher', { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await page.waitForTimeout(4000);
	const url = page.url();
	if (/sign_?in|login|accounts\/(new|sign)/i.test(url)) {
		return false;
	}
	return (await page.locator('input[type="password"]').count()) === 0;
}


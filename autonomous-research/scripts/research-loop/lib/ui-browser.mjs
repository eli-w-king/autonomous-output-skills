// Drive the User Interviews web app from the loop's own Chrome over CDP.
// The Chrome is launched by ui-chrome.mjs on the dedicated profile with a fixed CDP port; this module never
// launches or closes a browser, and only ever uses pages it opened itself (tracked by CDP target id).
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { CONFIG } from './config.mjs';

const require = createRequire(import.meta.url);
const CANDIDATES = [CONFIG.playwrightCore, 'playwright-core'].filter(Boolean);

export function loadPlaywright() {
	for (const c of CANDIDATES) {
		try {
			if (/[\\/]/.test(c) && !existsSync(c)) {
				continue;
			}
			return require(c);
		} catch { /* try the next */ }
	}
	throw new Error('playwright-core not found; set playwright_core in loop.config.json or PLAYWRIGHT_CORE_PATH');
}

export const UI_CDP_PORT = CONFIG.uiCdpPort;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function connectUi(port = UI_CDP_PORT) {
	const { chromium } = loadPlaywright();
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	const ctx = browser.contexts()[0];
	return { browser, ctx };
}

export async function targetIdOf(ctx, page) {
	const s = await ctx.newCDPSession(page);
	try {
		const { targetInfo } = await s.send('Target.getTargetInfo');
		return targetInfo.targetId.toUpperCase();
	} finally {
		await s.detach().catch(() => { });
	}
}

export async function pageByTarget(ctx, id) {
	for (const p of ctx.pages()) {
		if ((await targetIdOf(ctx, p).catch(() => '')) === String(id).toUpperCase()) {
			return p;
		}
	}
	return null;
}

/** Signed-in check without typing anything: the researcher app loads instead of the sign-in form. */
export async function signedIn(page) {
	const url = page.url();
	if (/\/accounts\/sign_?in|\/login/i.test(url)) {
		return false;
	}
	const pw = await page.locator('input[type="password"]').count().catch(() => 0);
	return pw === 0;
}

/** Navigate with backoff on HTTP 429 (User Interviews rate-limits automation, then serves a hanging shell). */
export async function gotoWithBackoff(page, url, { tries = 4 } = {}) {
	for (let i = 0; i < tries; i++) {
		const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(e => ({ status: () => 0, error: e }));
		const status = res?.status?.() ?? 0;
		if (status === 429) {
			const wait = 120_000 * (i + 1);
			console.error(`HTTP 429 from User Interviews; backing off ${wait / 1000}s`);
			await sleep(wait);
			continue;
		}
		return status;
	}
	throw Object.assign(new Error('User Interviews kept answering 429'), { code: 'RATE_LIMITED' });
}

/**
 * The app's own JSON API with the page's cookies and CSRF token (same origin). Backs off on HTTP 429 (a rate-limited
 * request was not processed, so retrying it is safe) and returns the last answer when the retries run out.
 */
export async function uiFetch(page, path, { method = 'GET', body, tries = 4 } = {}) {
	for (let i = 0; ; i++) {
		const r = await uiFetchOnce(page, path, method, body);
		if (r.status !== 429 || i >= tries - 1) {
			return r;
		}
		const wait = 60_000 * 2 ** i;
		console.error(`HTTP 429 from User Interviews on ${method} ${path}; backing off ${wait / 1000}s`);
		await sleep(wait);
	}
}

async function uiFetchOnce(page, path, method, body) {
	return page.evaluate(async ({ path, method, body }) => {
		const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
		const res = await fetch(path, {
			method,
			credentials: 'include',
			headers: {
				accept: 'application/json, application/vnd.api+json',
				...(body ? { 'content-type': 'application/json' } : {}),
				...(csrf ? { 'x-csrf-token': csrf } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await res.text();
		let json = null;
		try { json = JSON.parse(text); } catch { /* not JSON */ }
		return { status: res.status, json, text: json ? undefined : text.slice(0, 2000) };
	}, { path, method, body });
}

/**
 * Click by dispatching pointer and mouse events on the element. The app renders inside an inner scroll container,
 * so Playwright's actionability check often says "outside of the viewport" for real, visible controls (and for
 * react-select's zero-size inputs and options). Dispatched events reach React's handlers regardless.
 */
export async function jsClick(locator) {
	await locator.first().evaluate(el => {
		el.scrollIntoView?.({ block: 'center' });
		for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
			el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
		}
	});
}

/** Focus an input, textarea or rich-text editor and replace its text by typing. */
export async function focusType(page, locator, text) {
	await locator.first().evaluate(el => {
		el.scrollIntoView?.({ block: 'center' });
		el.focus();
	});
	await page.keyboard.press('Control+A');
	await page.keyboard.press('Delete');
	await page.keyboard.type(text, { delay: 2 });
}

/** Open a react-select (by its input id) if closed, pick the option whose text matches, return the control's text. */
export async function reactSelectPick(page, inputId, optionText) {
	const control = page.locator(`#${inputId}`).locator('xpath=ancestor::*[contains(@class,"control")][1]');
	if (!(await page.locator('[role="option"]').count())) {
		await jsClick(control);
		await page.waitForTimeout(600);
	}
	const opt = page.locator('[role="option"]').filter({ hasText: optionText instanceof RegExp ? optionText : new RegExp(`^${optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
	if (!(await opt.count())) {
		const have = await page.locator('[role="option"]').allInnerTexts();
		throw new Error(`option ${optionText} not found; options: ${have.join(' | ')}`);
	}
	await jsClick(opt);
	await page.waitForTimeout(500);
	return (await control.innerText()).replace(/\s+/g, ' ').trim();
}


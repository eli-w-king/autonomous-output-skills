#!/usr/bin/env node
// Long-lived CDP driver for recording demos of Code OSS (or any Chromium/Electron page).
// One process keeps one Playwright connection, so focus emulation, open menus, and hovers survive
// between steps. Drive it with small HTTP calls or with take modules (see take-template.mjs).
//
//   DRIVER_PORT=47400 VSCODE_REPO=<vscode checkout> node demo-driver.mjs
//
// Routes (POST, JSON body, JSON reply {ok, result|error}):
//   /connect {port, live?}         attach to the page on CDP port (live: true skips the cursor)
//   /preflight {}                  list visible toasts, hovers, menus, dialogs, overlays (must be [])
//   /cursor {} /hide-cursor {}     show or remove the demo pointer overlay
//   /move {x, y, duration?}        glide the pointer
//   /click {selector|x,y, ...}     glide, settle, press, release
//   /row {label, container?}       click an action-list row (model, effort, menu item) by label
//   /type {text, delay?}           human-paced typing into the focused element
//   /focus-chat {}                 focus the chat input (Monaco edit context)
//   /press {key}                   press one key (for example F7 to clear notifications)
//   /wait {selector|text, gone?, timeout?}   wait until something appears (or disappears)
//   /start-recording {dir, maxWidth?, maxHeight?, quality?, maxSeconds?}  (dir must be new or a past take)
//   /mark {name}                   timestamp a moment (idle ranges for speed-ramp.mjs, key beats)
//   /stop-recording {}             writes <dir>/frames.json (frames + marks)
//   /screenshot {path, clip?}      full-resolution still of the page (or a clip rect)
//   /eval {expr}                   evaluate an expression in the page
//   /run {module, ...}             run a take module's default export with the helpers below
//
// The pointer overlay is not product UI. It exists only so viewers can follow the clicks, and the
// overlay ignores pointer events. Real Playwright mouse events still drive every hover and click,
// because Code OSS menus and hovers only react to real pointer input.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

function loadPlaywright() {
	const bases = [process.env.VSCODE_REPO, process.cwd()].filter(Boolean).map(dir => path.join(dir, 'package.json'));
	bases.push(import.meta.url);
	for (const base of bases) {
		try {
			return createRequire(base)('playwright-core');
		} catch { }
	}
	throw new Error('playwright-core not found. Set VSCODE_REPO to a vscode checkout with node_modules, or npm i playwright-core next to this script.');
}
const { chromium } = loadPlaywright();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const RING = process.env.DEMO_RING ?? 'blue';

let browser;
let page;
let cdp;
let pointer = { x: 900, y: 560 };
let recording;

const CURSOR_JS = (x, y, ring) => `(() => {
	document.getElementById('demo-cursor')?.remove();
	document.getElementById('demo-cursor-ring')?.remove();
	const cursor = document.createElement('div');
	cursor.id = 'demo-cursor';
	cursor.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:32px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45));';
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('width', '24');
	svg.setAttribute('height', '32');
	svg.setAttribute('viewBox', '0 0 24 32');
	const arrow = document.createElementNS(ns, 'path');
	arrow.setAttribute('d', 'M3 2.5 L3 24.5 L8.6 19.3 L12.4 28.2 L16 26.6 L12.2 17.8 L19.6 17.8 Z');
	arrow.setAttribute('fill', '#111');
	arrow.setAttribute('stroke', '#fff');
	arrow.setAttribute('stroke-width', '1.7');
	arrow.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(arrow);
	cursor.appendChild(svg);
	const ring = document.createElement('div');
	ring.id = 'demo-cursor-ring';
	ring.style.cssText = ${JSON.stringify(ring === 'blue'
		? 'position:fixed;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2px solid rgba(0,120,212,0.55);background:rgba(0,120,212,0.12);box-sizing:border-box;z-index:2147483646;pointer-events:none;opacity:0;'
		: 'position:fixed;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(255,255,255,0.32);z-index:2147483646;pointer-events:none;opacity:0;')};
	document.body.append(ring, cursor);
	const place = (x, y) => { window.__demoLast = { x, y }; cursor.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)'; };
	place(${x}, ${y});
	window.__demoPlace = place;
	if (!window.__demoCursorListeners) {
		window.__demoCursorListeners = true;
		// The driver places the pointer itself. Trusted mouse input anywhere else did not come from it
		// (for example the user's real cursor crossing the window), so keep it away from the app.
		window.__demoJumps = [];
		const strayTypes = ['pointermove', 'pointerdown', 'pointerup', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
			'mousemove', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel'];
		for (const type of strayTypes) {
			window.addEventListener(type, e => {
				const last = window.__demoLast;
				if (!e.isTrusted || !last || Math.hypot(e.clientX - last.x, e.clientY - last.y) <= 3) {
					return;
				}
				e.stopImmediatePropagation();
				e.preventDefault();
				if (window.__demoJumps.length < 200) {
					window.__demoJumps.push({ type, x: Math.round(e.clientX), y: Math.round(e.clientY), t: Math.round(performance.now()) });
				}
			}, true);
		}
		window.addEventListener('pointerdown', e => {
			document.getElementById('demo-cursor-ring')?.animate([
				{ opacity: 0.9, transform: 'translate(' + e.clientX + 'px,' + e.clientY + 'px) scale(0.45)' },
				{ opacity: 0, transform: 'translate(' + e.clientX + 'px,' + e.clientY + 'px) scale(1.3)' },
			], { duration: 420, easing: 'ease-out' });
		}, true);
	}
	return 'cursor ready';
})()`;

async function injectCursor() {
	return page.evaluate(CURSOR_JS(pointer.x, pointer.y, RING));
}

async function hideCursor() {
	return page.evaluate(() => {
		for (const id of ['demo-cursor', 'demo-cursor-ring']) {
			document.getElementById(id)?.remove();
		}
		window.__demoPlace = undefined;
		return 'cursor hidden';
	});
}

async function connect(port, live = false) {
	const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(15000) });
	if (!response.ok) {
		throw new Error(`CDP discovery returned HTTP ${response.status}`);
	}
	const { webSocketDebuggerUrl } = await response.json();
	if (typeof webSocketDebuggerUrl !== 'string' || !webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${port}/`)) {
		throw new Error('CDP discovery did not return a local debugger URL for that port');
	}
	if (browser?.isConnected()) {
		await browser.close().catch(() => { });
	}
	browser = await chromium.connectOverCDP(webSocketDebuggerUrl);
	let pages = [];
	for (let attempt = 0; attempt < 120 && !pages.length; attempt++) {
		pages = browser.contexts().flatMap(context => context.pages()).filter(candidate => !candidate.url().startsWith('devtools://'));
		if (!pages.length) {
			await sleep(500);
		}
	}
	// Code OSS: the workbench (editor window) or sessions (Agents window) page. Anything else: the first page.
	page = pages.find(candidate => /workbench|sessions/.test(candidate.url())) ?? pages[0];
	if (!page) {
		throw new Error('no page found on that CDP port');
	}
	cdp = await page.context().newCDPSession(page);
	// The demo window is usually non-focusable; focus emulation keeps focus rings, carets, and menus alive.
	await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
	if (!live) {
		await injectCursor();
	}
	return { url: page.url(), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })) };
}

const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

async function glide(x, y, duration = 600) {
	const start = { ...pointer };
	const steps = Math.max(10, Math.round(duration / 14));
	for (let index = 1; index <= steps; index++) {
		const progress = ease(index / steps);
		const next = [start.x + (x - start.x) * progress, start.y + (y - start.y) * progress];
		await page.evaluate(([px, py]) => window.__demoPlace?.(px, py), next);
		await page.mouse.move(next[0], next[1]);
		await sleep(duration / steps);
	}
	pointer = { x, y };
}

async function clickAt(x, y, options = {}) {
	await glide(x, y, options.duration ?? 600);
	await sleep(options.settle ?? 150);
	await page.mouse.down();
	await sleep(70);
	await page.mouse.up();
}

/** The center (or an offset point) of the nth VISIBLE element matching a selector, in CSS pixels. */
async function point(selector, options = {}) {
	const rect = await page.evaluate(([selector, index]) => {
		const elements = [...document.querySelectorAll(selector)].filter(element => {
			const r = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
		});
		const element = elements[index < 0 ? elements.length + index : index];
		if (!element) {
			return undefined;
		}
		const r = element.getBoundingClientRect();
		return { x: r.x, y: r.y, width: r.width, height: r.height };
	}, [selector, options.index ?? 0]);
	if (!rect) {
		throw new Error(`No visible element for ${selector}`);
	}
	return {
		x: Math.round(rect.x + (options.fx ?? 0.5) * rect.width + (options.dx ?? 0)),
		y: Math.round(rect.y + (options.fy ?? 0.5) * rect.height + (options.dy ?? 0)),
		rect,
	};
}

async function click(selector, options = {}) {
	const target = await point(selector, options);
	await clickAt(target.x, target.y, options);
	return target;
}

/** The row in an open action list (model picker, effort, menus) whose label matches. */
async function rowPoint(label, options = {}) {
	const rect = await page.evaluate(([label, container]) => {
		const rows = [...document.querySelectorAll(`${container} .monaco-list-row`)].filter(r => r.getBoundingClientRect().height > 0);
		const text = r => (r.querySelector('.title, .action-label, .label')?.textContent ?? r.textContent ?? '').trim();
		const row = rows.find(r => text(r) === label) ?? rows.find(r => (r.textContent ?? '').trim().startsWith(label));
		if (!row) {
			return undefined;
		}
		const r = row.getBoundingClientRect();
		return { x: r.x, y: r.y, width: r.width, height: r.height };
	}, [label, options.container ?? '.action-widget']);
	if (!rect) {
		throw new Error(`No visible row labelled ${label}`);
	}
	return { x: Math.round(rect.x + Math.min(90, rect.width * 0.35)), y: Math.round(rect.y + rect.height / 2), rect };
}

async function clickRow(label, options = {}) {
	const target = await rowPoint(label, options);
	await clickAt(target.x, target.y, options);
	return target;
}

/** Monaco takes keystrokes through its edit context, which has to hold focus first. */
async function focusChatInput() {
	return page.evaluate(() => {
		const inputs = [...document.querySelectorAll('.interactive-input-editor .native-edit-context, .interactive-input-editor textarea, .sessions-chat-editor .native-edit-context')];
		const input = inputs.find(element => element.getBoundingClientRect().width > 0) ?? inputs[0];
		input?.focus();
		return !!input;
	});
}

async function typeText(text, delay = 38) {
	for (const character of text) {
		await page.keyboard.type(character);
		await sleep(delay + Math.round(Math.random() * 30));
	}
}

/** Waits until a selector (or a text) is visible, or with gone: true until it is not. */
async function waitFor({ selector, text, gone = false, timeout = 60000, interval = 250 }) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const visible = await page.evaluate(([selector, text]) => {
			const isVisible = element => {
				const r = element.getBoundingClientRect();
				return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== 'hidden';
			};
			if (selector) {
				return [...document.querySelectorAll(selector)].some(isVisible);
			}
			return document.body.innerText.includes(text);
		}, [selector, text]);
		if (visible !== gone) {
			return { waited: timeout - (deadline - Date.now()) };
		}
		await sleep(interval);
	}
	throw new Error(`timed out waiting for ${selector ?? JSON.stringify(text)}${gone ? ' to disappear' : ''}`);
}

/** Everything visible that must not be on camera at the start of a take. Expect []. */
async function preflight() {
	return page.evaluate(() => {
		const checks = {
			toast: '.notifications-toasts .notification-toast',
			notificationCenter: '.notifications-center.visible',
			hover: '.monaco-hover:not(.hidden)',
			contextMenu: '.context-view .monaco-menu',
			actionWidget: '.context-view .action-widget',
			quickInput: '.quick-input-widget',
			dialog: '.monaco-dialog-box',
			modalEditorBlock: '.monaco-modal-editor-block',
		};
		const isVisible = element => {
			const r = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
		};
		const found = [];
		for (const [kind, selector] of Object.entries(checks)) {
			for (const element of document.querySelectorAll(selector)) {
				if (isVisible(element)) {
					found.push({ kind, text: (element.innerText ?? '').trim().slice(0, 140) });
				}
			}
		}
		return found;
	});
}

async function startRecording(dir, options = {}) {
	if (recording) {
		throw new Error('already recording');
	}
	// Only ever clear a take directory this driver created (it holds a .demo-take marker).
	dir = path.resolve(dir);
	if (fs.existsSync(dir) && fs.readdirSync(dir).length && !fs.existsSync(path.join(dir, '.demo-take'))) {
		throw new Error(`${dir} is not empty and was not created by the driver; use a new take directory`);
	}
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, '.demo-take'), '');
	const maxSeconds = options.maxSeconds ?? 3600;
	const frames = [];
	const handler = ({ data, metadata, sessionId }) => {
		if (recording && Date.now() / 1000 - recording.startedAt > maxSeconds) {
			stopRecording().catch(() => { });
			return;
		}
		const file = `f${String(frames.length).padStart(6, '0')}.jpg`;
		fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
		frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
		cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => { });
	};
	cdp.on('Page.screencastFrame', handler);
	await cdp.send('Page.startScreencast', {
		format: 'jpeg',
		quality: options.quality ?? 92,
		maxWidth: options.maxWidth ?? 2880,
		maxHeight: options.maxHeight ?? 2880,
		everyNthFrame: 1,
	});
	recording = { dir, frames, handler, marks: [], startedAt: Date.now() / 1000 };
	return { dir };
}

function mark(name) {
	if (!recording) {
		throw new Error('mark() needs an active recording');
	}
	const entry = { name, t: Date.now() / 1000 };
	recording.marks.push(entry);
	return entry;
}

async function stopRecording() {
	if (!recording) {
		return undefined;
	}
	const stoppedAt = Date.now() / 1000;
	const { dir, frames, marks, startedAt, handler } = recording;
	recording = undefined;
	cdp.off('Page.screencastFrame', handler);
	await cdp.send('Page.stopScreencast').catch(() => { });
	const origin = frames[0]?.t ?? startedAt;
	// `video` is the mark's time on the encoded timeline (encode-screencast.py starts at the first frame).
	const timeline = marks.map(m => ({ ...m, video: Math.max(0, +(m.t - origin).toFixed(3)) }));
	fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ startedAt, stoppedAt, frames, marks: timeline }, null, 1));
	return { dir, count: frames.length, seconds: +(stoppedAt - startedAt).toFixed(2), marks: timeline };
}

const helpers = () => ({
	page, cdp, sleep, glide, clickAt, click, point, rowPoint, clickRow, focusChatInput, typeText,
	waitFor, preflight, startRecording, stopRecording, mark, injectCursor, hideCursor,
	hold: seconds => sleep(seconds * 1000),
	press: key => page.keyboard.press(key),
	get pointer() { return pointer; },
});

const routes = {
	'/connect': body => connect(body.port, body.live === true),
	'/preflight': () => preflight(),
	'/cursor': () => injectCursor(),
	'/hide-cursor': () => hideCursor(),
	'/move': async body => { await glide(body.x, body.y, body.duration); return pointer; },
	'/click': body => body.selector ? click(body.selector, body) : clickAt(body.x, body.y, body).then(() => pointer),
	'/row': body => clickRow(body.label, body),
	'/type': async body => { await typeText(body.text, body.delay); return 'typed'; },
	'/focus-chat': () => focusChatInput(),
	'/press': async body => { await page.keyboard.press(body.key); return 'pressed'; },
	'/wait': body => waitFor(body),
	'/start-recording': body => startRecording(body.dir, body),
	'/mark': body => mark(body.name),
	'/stop-recording': () => stopRecording(),
	'/screenshot': async body => {
		await page.screenshot({ path: body.path, clip: body.clip, animations: 'allow' });
		return { path: body.path };
	},
	'/eval': body => page.evaluate(body.expr),
	'/run': async body => {
		const module = await import(`${pathToFileURL(path.resolve(body.module)).href}?t=${Date.now()}`);
		const wasRecording = !!recording;
		try {
			return await module.default(helpers(), body);
		} catch (error) {
			// A failed take must not leave the screencast running.
			if (!wasRecording && recording) {
				await stopRecording().catch(() => { });
			}
			throw error;
		}
	},
};

const port = Number(process.env.DRIVER_PORT ?? 47400);
http.createServer((request, response) => {
	let raw = '';
	request.on('data', chunk => raw += chunk);
	request.on('end', async () => {
		try {
			const route = routes[request.url];
			if (!route) {
				throw new Error(`Unknown route ${request.url}`);
			}
			if (request.url !== '/connect' && !page) {
				throw new Error('not connected: POST /connect {port} first');
			}
			const result = await route(raw ? JSON.parse(raw) : {});
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ ok: true, result: result ?? null }));
		} catch (error) {
			response.writeHead(500, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ ok: false, error: String(error?.stack ?? error) }));
		}
	});
}).listen(port, '127.0.0.1', () => console.log(`demo driver listening on http://127.0.0.1:${port}`));

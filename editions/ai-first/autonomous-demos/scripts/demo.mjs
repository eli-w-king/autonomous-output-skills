#!/usr/bin/env node
/* Demo tools for the AI-First edition of autonomous-demos: a short narrated walkthrough of the real app, and
 * screenshots. Playwright core drives the installed Chrome or Edge headless (no browser download and no window), the
 * frames come from the browser's own screencast, and a small ffmpeg encodes them. macOS and Windows.
 *
 *   node demo.mjs check
 *   node demo.mjs shot --url <url> --out <file.png> [--url <url> --out <file.png>]... [--width 1280] [--height 800]
 *                      [--wait <selector>]
 *   node demo.mjs record <plan.json> --out <folder> [--name demo] [--voice <name>] [--audio <file> | --silent]
 *                        [--max-mb 25] [--scratch <folder>] [--keep-scratch]
 *
 * The plan:
 *   { "url": "http://localhost:5173/", "width": 1280, "height": 720, "waitFor": "<selector>",
 *     "beats": [ { "say": "One or two short sentences.", "do": [ <action>, ... ] }, ... ] }
 *   Actions: {"click": "<selector>" or [x, y]}, {"drag": [[x1, y1], [x2, y2]]}, {"move": "<selector>" or [x, y]},
 *            {"type": "text"}, {"press": "Enter"}, {"goto": "<url>"}, {"wait": "<selector>"}, {"hold": seconds},
 *            {"poster": true}. Selectors are Playwright selectors. Each beat lasts at least as long as its narration.
 *
 * record writes <name>.mp4 (H.264 and AAC, or WebM when this ffmpeg has no H.264), <name>.vtt captions and a
 * <name>.jpg poster to --out, and prints JSON with the length, the size, console errors and a contact sheet to look
 * at. Narration is macOS say or Windows SAPI, or --audio with the person's own recording.
 *
 * Tools: <workshop folder>/tools/demo/demo-tools.json when the workshop setup wrote it. The folder is
 * $AI_FIRST_WORKSHOP, else the one in <COPILOT_HOME or ~/.copilot>/ai-first-workshop.json (the setup writes it for a
 * folder other than ~/ai-first-workshop), else ~/ai-first-workshop. Otherwise Playwright from $PLAYWRIGHT_DIR, this folder, the workshop folder or the global npm folder, and
 * ffmpeg from $FFMPEG, the workshop folder or PATH. Scratch files go to the system temp folder (or --scratch) and are
 * removed afterwards, except the contact sheet. Exit codes: 0 ok, 1 failed, 2 usage error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const RATE = 22050;
const requireHere = createRequire(import.meta.url);
const expand = p => (p === '~' || /^~[\\/]/.test(p || '')) ? path.join(os.homedir(), p.slice(1)) : p;
const COPILOT = process.env.COPILOT_HOME ? path.resolve(expand(process.env.COPILOT_HOME)) : path.join(os.homedir(), '.copilot');
const pointedFolder = () => {
	try {
		const folder = JSON.parse(fs.readFileSync(path.join(COPILOT, 'ai-first-workshop.json'), 'utf8')).folder;
		return typeof folder === 'string' && folder.trim() ? folder : null;
	} catch {
		return null;
	}
};
const WORKSHOP = path.resolve(expand(process.env.AI_FIRST_WORKSHOP || pointedFolder() || path.join(os.homedir(), 'ai-first-workshop')));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = () => Date.now() / 1000;
const firstLine = text => String(text || '').trim().split('\n')[0].slice(0, 300);
const print = value => console.log(JSON.stringify(value, null, 1));
// On Windows a browser that just closed can hold its profile for a moment; retry, and never fail a run over cleanup.
const remove = target => {
	try {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	} catch { /* left for the system's temp cleanup */ }
};

function parseArgs(argv) {
	const out = { _: [], url: [], out: [] };
	for (let i = 0; i < argv.length; i++) {
		const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
		if (!m) { out._.push(argv[i]); continue; }
		const flag = ['silent', 'keep-scratch', 'help'].includes(m[1]);
		const value = flag ? true : (m[2] ?? argv[++i]);
		if (value === undefined) { throw new Usage(`--${m[1]} needs a value`); }
		if (m[1] === 'url' || m[1] === 'out') { out[m[1]].push(value); } else { out[m[1]] = value; }
	}
	return out;
}

class Usage extends Error { }

// ---------------------------------------------------------------- finding the tools

function setupFile() {
	const file = path.join(WORKSHOP, 'tools', 'demo', 'demo-tools.json');
	try {
		return { file, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
	} catch {
		return null;
	}
}

const SETUP = setupFile();
if (SETUP?.browsersPath && !process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(SETUP.browsersPath)) {
	// Playwright reads this when it loads, for the headless shell the setup installs when there's no Chrome or Edge.
	process.env.PLAYWRIGHT_BROWSERS_PATH = SETUP.browsersPath;
}

function subfolders(dir) {
	try {
		return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(dir, d.name));
	} catch {
		return [];
	}
}

function packageVersion(file, name) {
	for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
			if (pkg.name === name) { return pkg.version; }
		} catch { /* keep looking */ }
	}
	return 'unknown';
}

function npmGlobalRoot() {
	// npm is npm.cmd on Windows, which needs a shell.
	const r = spawnSync(WIN ? 'npm.cmd root -g' : 'npm', WIN ? [] : ['root', '-g'], { encoding: 'utf8', shell: WIN, timeout: 30000 });
	return r.status === 0 ? r.stdout.trim() : '';
}

function loadPlaywright() {
	if (SETUP?.playwrightCore) {
		try {
			const mod = requireHere(SETUP.playwrightCore);
			if (mod?.chromium) {
				return { mod, from: SETUP.playwrightCore, version: packageVersion(path.join(SETUP.playwrightCore, 'x'), 'playwright-core') };
			}
		} catch { /* fall back to looking around */ }
	}
	const tools = path.join(WORKSHOP, 'tools');
	const bases = [process.env.PLAYWRIGHT_DIR, process.cwd(), path.join(tools, 'demo'), tools, ...subfolders(tools), WORKSHOP,
		...subfolders(WORKSHOP)].filter(Boolean);
	const seen = new Set();
	const tryBase = base => {
		const resolved = path.resolve(expand(base));
		if (seen.has(resolved)) { return null; }
		seen.add(resolved);
		const req = createRequire(path.join(resolved, 'noop.js'));
		for (const name of ['playwright-core', 'playwright']) {
			try {
				const file = req.resolve(name);
				const mod = req(name);
				if (mod?.chromium) { return { mod, from: path.dirname(file), version: packageVersion(file, name) }; }
			} catch { /* not here */ }
		}
		return null;
	};
	for (const base of bases) {
		const found = tryBase(base);
		if (found) { return found; }
	}
	const global = npmGlobalRoot();
	return global ? tryBase(global) : null;
}

function findFfmpeg() {
	const exe = WIN ? 'ffmpeg.exe' : 'ffmpeg';
	const tools = path.join(WORKSHOP, 'tools');
	const candidates = [process.env.FFMPEG, SETUP?.ffmpeg, path.join(tools, 'demo', exe), path.join(tools, 'bin', exe),
		...[path.join(tools, 'demo'), ...subfolders(tools)].map(d => path.join(d, 'node_modules', 'ffmpeg-static', exe))];
	for (const c of candidates) {
		if (c && fs.existsSync(c)) { return c; }
	}
	const r = spawnSync(WIN ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
	if (r.status === 0 && r.stdout.trim()) { return r.stdout.trim().split(/\r?\n/)[0]; }
	// Homebrew's folder isn't on the PATH an app like VS Code starts with.
	return MAC ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(c => fs.existsSync(c)) || null : null;
}

function ffmpeg(ff, args) {
	const r = spawnSync(ff, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	if (r.status !== 0) { throw new Error(`ffmpeg failed: ${firstLine(r.stderr) || r.error?.message}`); }
	return r;
}

function encoders(ff) {
	const r = spawnSync(ff, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
	const text = r.stdout || '';
	const has = name => new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(text);
	return { h264: has('libx264'), vp9: has('libvpx-vp9'), vp8: has('libvpx'), opus: has('libopus') };
}

async function openBrowser(pw, { width, height, profile }) {
	const attempts = [];
	if (SETUP?.executablePath) { attempts.push({ executablePath: SETUP.executablePath }); }
	if (SETUP?.channel) { attempts.push({ channel: SETUP.channel }); }
	for (const channel of WIN ? ['msedge', 'chrome'] : ['chrome', 'msedge']) {
		if (channel !== SETUP?.channel) { attempts.push({ channel }); }
	}
	attempts.push({});
	const errors = [];
	for (const how of attempts) {
		const label = how.channel || how.executablePath || 'Playwright headless shell';
		try {
			remove(profile);
			const context = await pw.chromium.launchPersistentContext(profile, {
				...how, headless: true, viewport: { width, height }, deviceScaleFactor: 1,
				args: ['--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-notifications'],
			});
			return { context, browser: label };
		} catch (error) {
			errors.push(`${label}: ${firstLine(error.message)}`);
		}
	}
	throw new Error(`no browser started (${errors.join('; ')})`);
}

function watchErrors(page, sink) {
	page.on('console', message => { if (message.type() === 'error') { sink.push(firstLine(message.text())); } });
	page.on('pageerror', error => sink.push(`page error: ${firstLine(error.message)}`));
}

function scratchRoot(args) {
	const root = path.resolve(expand(args.scratch || path.join(os.tmpdir(), 'ai-first-demo')));
	fs.mkdirSync(root, { recursive: true });
	return root;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

// ---------------------------------------------------------------- check and shot

async function check(args) {
	const report = { ok: false, node: process.version, setup: SETUP?.file || null, voice: MAC ? 'say' : WIN ? 'SAPI' : null };
	const pw = loadPlaywright();
	report.playwright = pw ? { from: pw.from, version: pw.version } : null;
	const ff = findFfmpeg();
	report.ffmpeg = ff ? { path: ff, ...encoders(ff) } : null;
	if (pw) {
		const profile = path.join(scratchRoot(args), `check-${stamp()}`);
		try {
			const { context, browser } = await openBrowser(pw.mod, { width: 640, height: 400, profile });
			report.browser = browser;
			await context.close();
		} catch (error) {
			report.browserError = firstLine(error.message);
		} finally {
			remove(profile);
		}
	}
	report.ok = Boolean(pw && ff && report.browser && (report.ffmpeg.h264 || report.ffmpeg.vp9 || report.ffmpeg.vp8));
	if (!report.ok) {
		report.fix = !pw ? 'no Playwright found: run the workshop setup again, or npm install playwright-core in a folder and set PLAYWRIGHT_DIR to it'
			: !ff ? 'no ffmpeg found: run the workshop setup again, or set FFMPEG to an ffmpeg binary'
				: !report.browser ? 'no browser started: install Chrome or Edge' : 'this ffmpeg has no H.264 or VP9 encoder';
	}
	print(report);
	return report.ok ? 0 : 1;
}

async function shot(args) {
	if (!args.url.length || args.url.length !== args.out.length) { throw new Usage('shot needs --url and --out pairs'); }
	const pw = loadPlaywright();
	if (!pw) { throw new Error('no Playwright found; run demo.mjs check'); }
	const width = Number(args.width || 1280), height = Number(args.height || 800);
	const profile = path.join(scratchRoot(args), `shot-${stamp()}`);
	const { context, browser } = await openBrowser(pw.mod, { width, height, profile });
	const shots = [];
	try {
		const page = context.pages()[0] || await context.newPage();
		for (let i = 0; i < args.url.length; i++) {
			const errors = [];
			const onConsole = message => { if (message.type() === 'error') { errors.push(firstLine(message.text())); } };
			const onError = error => errors.push(`page error: ${firstLine(error.message)}`);
			page.on('console', onConsole);
			page.on('pageerror', onError);
			const out = path.resolve(expand(args.out[i]));
			await page.goto(args.url[i], { waitUntil: 'load', timeout: 60000 });
			if (args.wait) { await page.locator(args.wait).first().waitFor({ state: 'visible', timeout: 20000 }); }
			await sleep(Number(args.delay || 800));
			fs.mkdirSync(path.dirname(out), { recursive: true });
			await page.screenshot({ path: out });
			page.off('console', onConsole);
			page.off('pageerror', onError);
			shots.push({ url: args.url[i], out, bytes: fs.statSync(out).size, errors });
		}
	} finally {
		await context.close().catch(() => { });
		remove(profile);
	}
	print({ ok: true, browser, width, height, shots });
	return 0;
}

// ---------------------------------------------------------------- narration

function readWav(file) {
	const b = fs.readFileSync(file);
	if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') { throw new Error(`${file} is not a WAV file`); }
	let offset = 12, fmt, data;
	while (offset + 8 <= b.length) {
		const id = b.toString('ascii', offset, offset + 4);
		let size = b.readUInt32LE(offset + 4);
		const body = offset + 8;
		// A writer that streams may leave the data size at 0 or the maximum: the data then runs to the end.
		if (body + size > b.length || (id === 'data' && size === 0)) { size = b.length - body; }
		if (id === 'fmt ') {
			fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
		} else if (id === 'data') {
			data = b.subarray(body, body + size);
		}
		offset = body + size + (size % 2);
	}
	if (!fmt || !data) { throw new Error(`${file} has no audio`); }
	return { ...fmt, data, seconds: data.length / (fmt.rate * fmt.channels * (fmt.bits / 8)) };
}

function writeWav(file, pcm) {
	const h = Buffer.alloc(44);
	h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8, 'ascii');
	h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
	h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
	h.write('data', 36, 'ascii'); h.writeUInt32LE(pcm.length, 40);
	fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

function powershell(script, env) {
	// -EncodedCommand avoids every quoting problem between Node, the command line and PowerShell.
	return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
		Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });
}

function speak(text, wav, voice, ff) {
	const txt = wav.replace(/\.wav$/, '.txt');
	fs.writeFileSync(txt, text, 'utf8');
	let r;
	if (MAC) {
		r = spawnSync('say', [...(voice ? ['-v', voice] : []), '-o', wav, '--file-format=WAVE', `--data-format=LEI16@${RATE}`, '-f', txt], { encoding: 'utf8' });
	} else if (WIN) {
		r = powershell([
			"$ErrorActionPreference = 'Stop'",
			'Add-Type -AssemblyName System.Speech',
			'$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
			'if ($env:DEMO_VOICE) { $s.SelectVoice($env:DEMO_VOICE) }',
			`$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)`,
			'$s.SetOutputToWaveFile($env:DEMO_WAV, $f)',
			'$s.Speak([IO.File]::ReadAllText($env:DEMO_TEXT))',
			'$s.Dispose()',
		].join('\n'), { DEMO_WAV: wav, DEMO_TEXT: txt, DEMO_VOICE: voice || '' });
	} else {
		throw new Error('there is no system voice here; use --audio <file> or --silent');
	}
	if (r.status !== 0 || !fs.existsSync(wav)) { throw new Error(`the system voice failed: ${firstLine(r.stderr) || r.error?.message}`); }
	let clip = readWav(wav);
	if (clip.format !== 1 || clip.rate !== RATE || clip.channels !== 1 || clip.bits !== 16) {
		const fixed = wav.replace(/\.wav$/, '-pcm.wav');
		ffmpeg(ff, ['-y', '-v', 'error', '-i', wav, '-ar', String(RATE), '-ac', '1', '-c:a', 'pcm_s16le', fixed]);
		clip = readWav(fixed);
	}
	return clip;
}

const estimate = text => Math.max(1.2, String(text || '').trim().split(/\s+/).filter(Boolean).length / 2.6);

// ---------------------------------------------------------------- recording

const CURSOR = `(() => {
	if (window.top !== window || window.__demoCursor) { return; }
	window.__demoCursor = true;
	const add = () => {
		const ns = 'http://www.w3.org/2000/svg';
		const cursor = document.createElement('div');
		cursor.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:32px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('width', '24'); svg.setAttribute('height', '32'); svg.setAttribute('viewBox', '0 0 24 32');
		const arrow = document.createElementNS(ns, 'path');
		arrow.setAttribute('d', 'M3 2.5 L3 24.5 L8.6 19.3 L12.4 28.2 L16 26.6 L12.2 17.8 L19.6 17.8 Z');
		arrow.setAttribute('fill', '#111'); arrow.setAttribute('stroke', '#fff'); arrow.setAttribute('stroke-width', '1.7'); arrow.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(arrow);
		cursor.appendChild(svg);
		const ring = document.createElement('div');
		ring.style.cssText = 'position:fixed;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2px solid rgba(0,120,212,0.6);background:rgba(0,120,212,0.12);box-sizing:border-box;z-index:2147483646;pointer-events:none;opacity:0;';
		document.documentElement.append(ring, cursor);
		const place = (x, y) => { cursor.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)'; };
		addEventListener('pointermove', e => place(e.clientX, e.clientY), true);
		addEventListener('pointerdown', e => {
			place(e.clientX, e.clientY);
			ring.animate([
				{ opacity: 0.9, transform: 'translate(' + e.clientX + 'px,' + e.clientY + 'px) scale(0.45)' },
				{ opacity: 0, transform: 'translate(' + e.clientX + 'px,' + e.clientY + 'px) scale(1.3)' },
			], { duration: 420, easing: 'ease-out' });
		}, true);
	};
	if (document.body) { add(); } else { addEventListener('DOMContentLoaded', add); }
})();`;

const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

async function glide(page, state, x, y, ms) {
	const from = { ...state.pointer };
	const duration = ms ?? Math.min(900, Math.max(350, 250 + Math.hypot(x - from.x, y - from.y) * 0.6));
	const began = Date.now();
	for (let p = 0; p < 1;) {
		await sleep(12);
		p = Math.min(1, (Date.now() - began) / duration);
		const e = ease(p);
		await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
	}
	state.pointer = { x, y };
}

async function pointOf(page, target) {
	if (Array.isArray(target)) { return { x: Number(target[0]), y: Number(target[1]) }; }
	const locator = page.locator(String(target)).first();
	await locator.waitFor({ state: 'visible', timeout: 15000 });
	await locator.scrollIntoViewIfNeeded().catch(() => { });
	const box = await locator.boundingBox();
	if (!box) { throw new Error(`can't find where ${target} is`); }
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function act(page, state, action, base) {
	const kind = Object.keys(action || {})[0];
	const value = action?.[kind];
	if (kind === 'click' || kind === 'move') {
		const p = await pointOf(page, value);
		await glide(page, state, p.x, p.y);
		if (kind === 'click') {
			await sleep(140);
			await page.mouse.down();
			await sleep(70);
			await page.mouse.up();
			await sleep(250);
		}
	} else if (kind === 'drag') {
		const [[x1, y1], [x2, y2]] = value;
		await glide(page, state, x1, y1);
		await sleep(120);
		await page.mouse.down();
		await glide(page, state, x2, y2, 800);
		await sleep(80);
		await page.mouse.up();
		await sleep(250);
	} else if (kind === 'type') {
		await page.keyboard.type(String(value), { delay: 55 });
	} else if (kind === 'press') {
		await page.keyboard.press(String(value));
		await sleep(200);
	} else if (kind === 'goto') {
		await page.goto(new URL(String(value), base).href, { waitUntil: 'load', timeout: 60000 });
		// The new page has a new pointer overlay; a small move puts it back under the pointer.
		await page.mouse.move(state.pointer.x + 1, state.pointer.y);
		await page.mouse.move(state.pointer.x, state.pointer.y);
	} else if (kind === 'wait') {
		await page.locator(String(value)).first().waitFor({ state: 'visible', timeout: 15000 });
	} else if (kind === 'hold') {
		await sleep(Number(value) * 1000);
	} else if (kind === 'poster') {
		state.posterAt = now();
	} else {
		throw new Error(`unknown action ${JSON.stringify(action)}`);
	}
}

const vttTime = s => {
	const ms = Math.max(0, Math.round(s * 1000));
	const two = n => String(n).padStart(2, '0');
	return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, '0')}`;
};

function wrap(text, width = 60) {
	const lines = [''];
	for (const word of String(text).trim().split(/\s+/)) {
		const last = lines.length - 1;
		if (lines[last] && (lines[last] + ' ' + word).length > width) { lines.push(word); } else { lines[last] = lines[last] ? `${lines[last]} ${word}` : word; }
	}
	return lines.join('\n');
}

async function record(args) {
	const planFile = args._[1];
	if (!planFile || !args.out.length) { throw new Usage('record needs <plan.json> and --out <folder>'); }
	const plan = JSON.parse(fs.readFileSync(path.resolve(expand(planFile)), 'utf8'));
	if (!plan.url || !Array.isArray(plan.beats) || !plan.beats.length) { throw new Usage('the plan needs a url and at least one beat'); }
	const width = Number(plan.width || 1280), height = Number(plan.height || 720);
	const name = String(args.name || 'demo').replace(/[^\w.-]+/g, '-');
	const outDir = path.resolve(expand(args.out[0]));
	const maxMb = Number(args['max-mb'] || 25);
	const pw = loadPlaywright();
	const ff = findFfmpeg();
	if (!pw || !ff) { throw new Error(`no ${!pw ? 'Playwright' : 'ffmpeg'} found; run demo.mjs check`); }
	const enc = encoders(ff);
	if (!enc.h264 && !enc.vp9 && !enc.vp8) { throw new Error('this ffmpeg has no H.264 or VP9 encoder'); }
	const root = scratchRoot(args);
	const work = path.join(root, `${name}-${stamp()}`);
	const framesDir = path.join(work, 'frames');
	fs.mkdirSync(framesDir, { recursive: true });
	const notes = [];
	let context;
	try {
		// 1. Narration first, so each beat knows how long it has to be.
		const voiceOn = !args.silent && !args.audio;
		const clips = plan.beats.map((beat, i) => (voiceOn && beat.say) ? speak(beat.say, path.join(work, `say-${i}.wav`), args.voice, ff) : null);

		// 2. The take: a fresh profile, the app, a visible pointer, and the browser's screencast.
		const opened = await openBrowser(pw.mod, { width, height, profile: path.join(work, 'profile') });
		context = opened.context;
		await context.addInitScript(CURSOR);
		const page = context.pages()[0] || await context.newPage();
		const errors = [];
		watchErrors(page, errors);
		await page.goto(plan.url, { waitUntil: 'load', timeout: 60000 });
		if (plan.waitFor) { await page.locator(plan.waitFor).first().waitFor({ state: 'visible', timeout: 30000 }); }
		await sleep(800);
		const state = { pointer: { x: Math.round(width * 0.55), y: Math.round(height * 0.6) } };
		await page.mouse.move(state.pointer.x + 1, state.pointer.y);
		await page.mouse.move(state.pointer.x, state.pointer.y);
		const cdp = await context.newCDPSession(page);
		const frames = [];
		cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
			const file = `f${String(frames.length).padStart(6, '0')}.jpg`;
			fs.writeFileSync(path.join(framesDir, file), Buffer.from(data, 'base64'));
			frames.push({ file, t: metadata?.timestamp, received: now() });
			cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => { });
		});
		await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
		const t0 = now();
		await sleep(1000);
		const cues = [];
		for (const [i, beat] of plan.beats.entries()) {
			const start = now() - t0;
			for (const action of beat.do || []) { await act(page, state, action, plan.url); }
			const spoken = clips[i]?.seconds ?? (beat.say ? estimate(beat.say) : 0);
			const left = spoken + 0.5 - (now() - t0 - start);
			if (left > 0) { await sleep(left * 1000); }
			if (beat.say) { cues.push({ start, end: start + spoken, text: beat.say, clip: clips[i] }); }
		}
		await sleep(1500);
		const tEnd = now();
		await cdp.send('Page.stopScreencast').catch(() => { });
		await sleep(200);
		const posterAt = state.posterAt ?? tEnd;
		await context.close();
		context = undefined;
		if (!frames.length) { throw new Error('the browser sent no frames'); }

		// 3. Encode: each frame is held until the next one's timestamp, so the video keeps real time. The browser's
		// frame times are on the same clock as ours; if they ever aren't, use the times the frames arrived.
		const browserClock = frames.every(f => typeof f.t === 'number' && Math.abs(f.t - f.received) < 5);
		frames.forEach(f => { f.t = browserClock ? f.t : f.received; });
		frames.sort((a, b) => a.t - b.t);
		while (frames.length > 1 && frames[frames.length - 1].t > tEnd) { frames.pop(); }
		const total = tEnd - t0;
		const lines = ['ffconcat version 1.0'];
		frames.forEach((frame, i) => {
			const start = i === 0 ? t0 : frame.t;
			const end = i + 1 < frames.length ? frames[i + 1].t : tEnd;
			lines.push(`file '${frame.file}'`, `duration ${Math.max(end - start, 1 / 240).toFixed(4)}`);
		});
		lines.push(`file '${frames[frames.length - 1].file}'`);
		const concat = path.join(framesDir, 'concat.txt');
		fs.writeFileSync(concat, lines.join('\n') + '\n');
		let audio = null;
		if (args.audio) {
			audio = path.resolve(expand(args.audio));
		} else if (voiceOn && cues.some(c => c.clip)) {
			const pcm = Buffer.alloc(Math.ceil(total * RATE) * 2);
			for (const cue of cues) {
				if (cue.clip) { cue.clip.data.copy(pcm, Math.min(pcm.length, Math.round(cue.start * RATE) * 2)); }
			}
			audio = path.join(work, 'narration.wav');
			writeWav(audio, pcm);
		}
		fs.mkdirSync(outDir, { recursive: true });
		const mp4 = enc.h264;
		const video = path.join(outDir, `${name}.${mp4 ? 'mp4' : 'webm'}`);
		const encode = quality => {
			const a = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', concat];
			if (audio) { a.push('-i', audio); }
			a.push('-map', '0:v:0');
			if (audio) { a.push('-map', '1:a:0'); }
			a.push('-vf', `scale=${width}:${height}:flags=lanczos:out_range=tv,fps=30,format=yuv420p`, '-t', total.toFixed(3));
			if (mp4) {
				a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(quality), '-profile:v', 'high', '-movflags', '+faststart');
				if (audio) { a.push('-c:a', 'aac', '-b:a', '96k'); }
			} else {
				a.push(...(enc.vp9 ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(quality + 10)] : ['-c:v', 'libvpx', '-b:v', '2M', '-crf', String(quality - 16)]),
					'-deadline', 'good', '-cpu-used', '4');
				if (audio) { a.push(...(enc.opus ? ['-c:a', 'libopus', '-b:a', '96k'] : ['-c:a', 'opus', '-strict', '-2'])); }
			}
			ffmpeg(ff, [...a, video]);
			return fs.statSync(video).size / 1048576;
		};
		let quality = 26;
		let mb = encode(quality);
		while (mb > maxMb && quality < 38) {
			quality += 6;
			mb = encode(quality);
		}
		if (mb > maxMb) { notes.push(`the video is ${mb.toFixed(1)} MB, over ${maxMb} MB: shorten the plan`); }
		const decode = spawnSync(ff, ['-v', 'error', '-i', video, '-f', 'null', '-'], { encoding: 'utf8' });
		const decodes = decode.status === 0 && !decode.stderr.trim();

		// 4. Captions, the poster and a contact sheet to look at.
		const captions = path.join(outDir, `${name}.vtt`);
		fs.writeFileSync(captions, 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${wrap(c.text)}\n`).join('\n'));
		const posterFrame = [...frames].reverse().find(f => f.t <= posterAt) || frames[frames.length - 1];
		const poster = path.join(outDir, `${name}.jpg`);
		fs.copyFileSync(path.join(framesDir, posterFrame.file), poster);
		const contact = path.join(root, `${name}-${stamp()}-contact.jpg`);
		try {
			ffmpeg(ff, ['-y', '-v', 'error', '-i', video, '-vf', `fps=${(4 / total).toFixed(5)},scale=640:-2,tile=2x2`, '-frames:v', '1', contact]);
		} catch (error) {
			notes.push(`no contact sheet: ${firstLine(error.message)}`);
		}
		if (total > 60) { notes.push(`the video is ${total.toFixed(0)} seconds; keep it under 60`); }
		if (errors.length) { notes.push('the app logged errors while recording: fix them and record again'); }
		print({
			ok: decodes, video, captions, poster, contact: fs.existsSync(contact) ? contact : null, seconds: +total.toFixed(1),
			mb: +mb.toFixed(2), width, height, browser: opened.browser, voice: args.audio ? 'your recording' : voiceOn ? (args.voice || 'system default') : 'none',
			frames: frames.length, decodes, consoleErrors: errors, notes,
		});
		return decodes ? 0 : 1;
	} finally {
		if (context) { await context.close().catch(() => { }); }
		if (!args['keep-scratch']) { remove(work); }
	}
}

// ---------------------------------------------------------------- main

async function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		print({ ok: false, error: error.message });
		return 2;
	}
	const command = args._[0];
	if (args.help || !['check', 'shot', 'record'].includes(command)) {
		const lines = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n');
		console.log(lines.slice(1, lines.findIndex(l => l.trim() === '*/')).map(l => l.replace(/^\/?\s?\*\s?/, '')).join('\n'));
		return args.help ? 0 : 2;
	}
	try {
		return await (command === 'check' ? check(args) : command === 'shot' ? shot(args) : record(args));
	} catch (error) {
		print({ ok: false, error: firstLine(error.message) });
		return error instanceof Usage ? 2 : 1;
	}
}

process.exitCode = await main();

#!/usr/bin/env node
/* One headless screenshot of a page, with a Playwright that is already installed: the practice repo's own (Excalidraw
 * ships playwright as a dev dependency), then the current folder's, then the global one. It drives the system Chrome
 * or Edge (channel "chrome" or "msedge"), so no browser is downloaded, and it never shows a window.
 *
 *   node screenshot.mjs --url <url> --out <file.png> [--repo <dir>] [--width 1440] [--height 900]
 *                       [--wait-for <css selector>] [--timeout <ms>]
 *
 * Prints JSON: ok, out, bytes, width, height, title, browser, playwright (version and where it came from).
 * Exit codes: 0 ok, 1 error, 2 usage error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const opt = { width: 1440, height: 900, timeout: 60000 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	const m = /^--(url|out|repo|width|height|wait-for|timeout)(?:=(.*))?$/.exec(argv[i]);
	if (argv[i] === '-h' || argv[i] === '--help') {
		const lines = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n');
		console.log(lines.slice(1, lines.findIndex(l => l.trim() === '*/')).map(l => l.replace(/^\/?\s?\*\s?/, '')).join('\n'));
		process.exit(0);
	}
	if (!m) { console.log(JSON.stringify({ ok: false, error: `unknown argument ${argv[i]}` })); process.exit(2); }
	opt[m[1]] = m[2] ?? argv[++i];
}
if (!opt.url || !opt.out) { console.log(JSON.stringify({ ok: false, error: '--url and --out are required' })); process.exit(2); }
const width = Number(opt.width), height = Number(opt.height), timeout = Number(opt.timeout);
// Windows PowerShell passes ~ through to native commands as is, so expand it here.
const expandHome = p => (p === '~' || /^~[\\/]/.test(p || '')) ? path.join(os.homedir(), p.slice(1)) : p;
opt.out = expandHome(opt.out);
if (opt.repo) { opt.repo = expandHome(opt.repo); }
const firstLine = text => String(text || '').trim().split('\n')[0];

function versionOf(req, name) {
	let dir = path.dirname(req.resolve(name));
	while (dir !== path.dirname(dir)) {
		const file = path.join(dir, 'package.json');
		if (fs.existsSync(file)) {
			const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
			if (pkg.name === name) { return pkg.version; }
		}
		dir = path.dirname(dir);
	}
	return 'unknown';
}

function loadPlaywright() {
	const bases = [];
	if (opt.repo) { bases.push(path.join(path.resolve(opt.repo), 'package.json')); }
	bases.push(path.join(process.cwd(), 'package.json'));
	const win = process.platform === 'win32';
	const npm = spawnSync(win ? 'npm.cmd root -g' : 'npm', win ? [] : ['root', '-g'], { encoding: 'utf8', shell: win, timeout: 30000 });
	if (npm.status === 0 && npm.stdout.trim()) { bases.push(path.join(npm.stdout.trim(), 'noop.js')); }
	for (const base of bases) {
		const req = createRequire(base);
		for (const name of ['playwright', 'playwright-core']) {
			try {
				const mod = req(name);
				if (mod && mod.chromium) { return { chromium: mod.chromium, name, version: versionOf(req, name), from: path.dirname(base) }; }
			} catch { /* not installed here */ }
		}
	}
	return null;
}

const pw = loadPlaywright();
if (!pw) {
	console.log(JSON.stringify({ ok: false, error: 'no Playwright found in the practice repo, this folder or the global npm folder; install the practice repo first' }));
	process.exit(1);
}
const channels = process.platform === 'win32' ? ['msedge', 'chrome', undefined] : ['chrome', 'msedge', undefined];
const tried = [];
let browser, used;
for (const channel of channels) {
	try {
		browser = await pw.chromium.launch({ channel, headless: true });
		used = channel || 'Playwright chromium';
		break;
	} catch (error) {
		tried.push(`${channel || 'Playwright chromium'}: ${firstLine(error.message)}`);
	}
}
if (!browser) {
	console.log(JSON.stringify({ ok: false, error: 'no browser could start headless', tried }));
	process.exit(1);
}
try {
	const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
	const page = await context.newPage();
	await page.goto(opt.url, { waitUntil: 'load', timeout });
	if (opt['wait-for']) { await page.waitForSelector(opt['wait-for'], { state: 'visible', timeout }); }
	await page.waitForTimeout(1000); // fonts and the canvas settle
	const out = path.resolve(opt.out);
	fs.mkdirSync(path.dirname(out), { recursive: true });
	await page.screenshot({ path: out });
	const title = await page.title();
	const png = fs.readFileSync(out);
	const result = {
		ok: png.length > 5000 && png.readUInt32BE(16) === width,
		out, bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20), title, browser: used,
		playwright: `${pw.name} ${pw.version} from ${pw.from}`,
	};
	console.log(JSON.stringify(result));
	process.exitCode = result.ok ? 0 : 1;
} catch (error) {
	console.log(JSON.stringify({ ok: false, error: firstLine(error.message), browser: used }));
	process.exitCode = 1;
} finally {
	await browser.close();
}

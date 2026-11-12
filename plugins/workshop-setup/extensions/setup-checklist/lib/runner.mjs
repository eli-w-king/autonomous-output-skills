// Runs autonomous-setup's check-setup.py and turns its JSON into the compact form the checklist keeps.
// The check is read-only; this module only finds it, runs it without a shell and with a timeout, and reads the output.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SetupError } from './errors.mjs';
import { tilde } from './store.mjs';

const SCRIPT_PARTS = ['autonomous-setup', 'scripts', 'check-setup.py'];
const MAX_OUTPUT = 16 * 1024 * 1024;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const clip = (value, max) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)).slice(0, max);

export function scriptCandidates({ skillsDir, copilotHome }) {
	if (skillsDir) {
		return [
			path.join(skillsDir, ...SCRIPT_PARTS),
			path.join(skillsDir, 'scripts', 'check-setup.py'),
			path.join(skillsDir, 'check-setup.py'),
		];
	}
	return [
		path.join(copilotHome, 'autonomous-output-skills', ...SCRIPT_PARTS),
		path.join(copilotHome, 'skills', ...SCRIPT_PARTS),
	];
}

export async function locateScript(options, fs = fsp) {
	const tried = scriptCandidates(options);
	for (const file of tried) {
		try {
			if ((await fs.stat(file)).isFile()) {
				return file;
			}
		} catch {
			// Not there; try the next one.
		}
	}
	const where = tried.map((file) => tilde(file)).join(', ');
	throw new SetupError('check_not_found', `Can't find check-setup.py. Looked in ${where}. Clone the skills first, or open the canvas with skillsDir set to the folder that has autonomous-setup in it.`);
}

// Runs a program without a shell. Resolves with { code, stdout, stderr, timedOut } or { error } when it can't start.
export function execProgram(command, args, { timeoutMs, env, cwd }) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
		} catch (error) {
			resolve({ error });
			return;
		}
		const out = [];
		const err = [];
		let size = 0;
		let timedOut = false;
		let settled = false;
		const finish = (result) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve(result);
			}
		};
		const collect = (chunks) => (chunk) => {
			size += chunk.length;
			if (size <= MAX_OUTPUT) {
				chunks.push(chunk);
			}
		};
		child.stdout.on('data', collect(out));
		child.stderr.on('data', collect(err));
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		child.on('error', (error) => finish({ error }));
		child.on('close', (code) => finish({
			code,
			timedOut,
			stdout: Buffer.concat(out).toString('utf8'),
			stderr: Buffer.concat(err).toString('utf8'),
		}));
	});
}

async function isFile(fs, file) {
	try {
		return (await fs.stat(file)).isFile();
	} catch {
		return false;
	}
}

// Pythons to try, in order. On a Mac, /usr/bin/python3 is a stub that opens an install dialog until the Command Line
// Tools are installed, so it's only used once they are.
export async function pythonCandidates({ platform = process.platform, env = process.env, fs = fsp, cltInstalled }) {
	if (platform === 'win32') {
		return [{ command: 'python', args: [] }, { command: 'py', args: ['-3'] }];
	}
	if (platform !== 'darwin') {
		return [{ command: 'python3', args: [] }];
	}
	const dirs = [...String(env.PATH || '').split(':').filter(Boolean), '/opt/homebrew/bin', '/usr/local/bin',
		'/Library/Frameworks/Python.framework/Versions/Current/bin', '/usr/bin'];
	const seen = new Set();
	const out = [];
	for (const dir of dirs) {
		const file = path.join(dir, 'python3');
		if (seen.has(file) || !(await isFile(fs, file))) {
			continue;
		}
		seen.add(file);
		if (dir === '/usr/bin' && !(await cltInstalled())) {
			continue;
		}
		out.push({ command: file, args: [] });
	}
	return out;
}

export function parseCheckOutput(stdout, stderr = '') {
	const text = String(stdout || '').trim();
	const start = text.indexOf('{');
	let data = null;
	if (start >= 0) {
		try {
			data = JSON.parse(text.slice(start));
		} catch {
			data = null;
		}
	}
	if (!isObject(data) || !isObject(data.items)) {
		const line = firstLine(stderr) || firstLine(text) || 'no output';
		throw new SetupError('check_failed', `The setup check didn't return a result: ${line}`);
	}
	return data;
}

export function firstLine(text) {
	const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	// Python tracebacks end with the line that names the error.
	if (lines.length && lines[0].startsWith('Traceback')) {
		return lines[lines.length - 1].slice(0, 300);
	}
	return (lines[0] || '').slice(0, 300);
}

function stringList(value, limit = 50) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((entry) => (isObject(entry) ? entry.key : entry)).filter((key) => typeof key === 'string').slice(0, limit).map((key) => key.slice(0, 200));
}

// Keeps what the checklist needs from the check's JSON: each item's result and detail, the recorded steps, and the OS.
export function compactCheck(data, receivedAt) {
	const items = {};
	for (const [id, item] of Object.entries(data.items || {})) {
		if (!isId(id) || !isObject(item)) {
			continue;
		}
		const entry = {
			ok: item.ok === true ? true : item.ok === false ? false : null,
			required: item.required !== false,
			detail: clip(item.detail, 300),
		};
		if (item.later === true || item.when === 'workshop' || item.stage === 'workshop') {
			entry.later = true;
		}
		if (typeof item.title === 'string' && item.title.trim()) {
			entry.title = clip(item.title.trim(), 80);
		}
		if (id === 'settings') {
			entry.keys = { matching: stringList(item.matching), missing: stringList(item.missing), different: stringList(item.different) };
		}
		items[id] = entry;
	}
	const steps = {};
	for (const [id, step] of Object.entries(isObject(data.steps) ? data.steps : {})) {
		if (isId(id) && isObject(step) && typeof step.status === 'string') {
			steps[id] = { status: clip(step.status, 32), note: step.note ? clip(step.note, 300) : null, at: typeof step.at === 'string' ? clip(step.at, 64) : null };
		}
	}
	const osInfo = isObject(data.os) ? { name: clip(data.os.name, 200) || null, version: clip(data.os.version, 100) || null } : null;
	return { at: typeof data.time === 'string' ? data.time.slice(0, 64) : null, receivedAt, os: osInfo, items, steps };
}

export class CheckRunner {
	constructor({ copilotHome, platform = process.platform, env = process.env, fs = fsp, exec = execProgram, timeoutMs = 240000, quickTimeoutMs = 90000 }) {
		this.copilotHome = copilotHome;
		this.platform = platform;
		this.env = env;
		this.fs = fs;
		this.exec = exec;
		this.timeoutMs = timeoutMs;
		this.quickTimeoutMs = quickTimeoutMs;
		this.clt = null;
	}

	async cltInstalled() {
		if (this.clt === null) {
			const result = await this.exec('/usr/bin/xcode-select', ['-p'], { timeoutMs: 10000, env: this.env });
			const dir = (result.stdout || '').trim();
			this.clt = !result.error && result.code === 0 && !!dir && (await this.fs.stat(dir).then(() => true, () => false));
		}
		return this.clt;
	}

	// Resolves with { data, script } or throws SetupError.
	async run({ skillsDir = null, quick = false } = {}) {
		const script = await locateScript({ skillsDir, copilotHome: this.copilotHome }, this.fs);
		const pythons = await pythonCandidates({ platform: this.platform, env: this.env, fs: this.fs, cltInstalled: () => this.cltInstalled() });
		const env = { ...this.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
		const args = [script, '--format', 'json', ...(quick ? ['--quick'] : [])];
		const timeoutMs = quick ? this.quickTimeoutMs : this.timeoutMs;
		for (const python of pythons) {
			const result = await this.exec(python.command, [...python.args, ...args], { timeoutMs, env, cwd: path.dirname(script) });
			if (result.error) {
				if (result.error.code === 'ENOENT') {
					continue;
				}
				throw new SetupError('check_failed', `Couldn't start ${python.command}: ${result.error.message}`);
			}
			// 9009 is the Windows Store alias for Python when Python isn't installed.
			if (this.platform === 'win32' && result.code === 9009) {
				continue;
			}
			if (result.timedOut) {
				throw new SetupError('check_timeout', `The setup check didn't finish in ${Math.round(timeoutMs / 1000)} seconds. Try again, or ask for a quick check.`);
			}
			const data = parseCheckOutput(result.stdout, result.stderr);
			return { data, script };
		}
		const fix = this.platform === 'win32' ? 'winget install --id Python.Python.3.13 -e'
			: this.platform === 'darwin' ? 'xcode-select --install' : 'install python3';
		throw new SetupError('python_missing', `Python isn't installed yet, so the setup check can't run. Install it first (${fix}), then check again.`);
	}
}


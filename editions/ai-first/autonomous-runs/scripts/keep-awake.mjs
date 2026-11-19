#!/usr/bin/env node
/* Keep this laptop awake for a long run, without changing any settings (AI-First edition of autonomous-runs).
 *
 *   node keep-awake.mjs start [--hours 10]   start it in the background; prints its process id and end time
 *   node keep-awake.mjs status               is it running?
 *   node keep-awake.mjs stop                 stop the one this script started (and nothing else)
 *
 * macOS: caffeinate -is, so the system doesn't sleep while plugged in. Windows: a hidden PowerShell that asks the
 * system to stay awake until it's stopped or the hours run out. The screen can still turn off; keep the lid open.
 * State: <COPILOT_HOME or ~/.copilot>/keep-awake.json. Prints JSON. Exit codes: 0 ok, 1 failed, 2 usage error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const expand = p => (p === '~' || /^~[\\/]/.test(p || '')) ? path.join(os.homedir(), p.slice(1)) : p;
const HOME = process.env.COPILOT_HOME ? path.resolve(expand(process.env.COPILOT_HOME)) : path.join(os.homedir(), '.copilot');
const STATE = path.join(HOME, 'keep-awake.json');
const print = value => console.log(JSON.stringify(value, null, 1));

function load() {
	try {
		return JSON.parse(fs.readFileSync(STATE, 'utf8'));
	} catch {
		return null;
	}
}

// Running, not past its end time, and still the program this script started: a process id can be reused later.
function ours(state) {
	if (!state?.pid || Date.now() > Date.parse(state.until) + 60000) { return false; }
	try {
		process.kill(state.pid, 0);
	} catch (error) {
		if (error.code !== 'EPERM') { return false; }
	}
	const r = WIN
		? spawnSync('tasklist', ['/FI', `PID eq ${state.pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
		: spawnSync('ps', ['-p', String(state.pid), '-o', 'comm='], { encoding: 'utf8' });
	return (r.stdout || '').toLowerCase().includes(WIN ? 'powershell' : 'caffeinate');
}

function start(hours) {
	const existing = load();
	if (ours(existing)) {
		print({ ok: true, running: true, already: true, pid: existing.pid, until: existing.until });
		return 0;
	}
	const seconds = Math.round(hours * 3600);
	let pid = 0;
	if (MAC) {
		const child = spawn('caffeinate', ['-is', '-t', String(seconds)], { detached: true, stdio: 'ignore' });
		child.unref();
		pid = child.pid || 0;
	} else if (WIN) {
		// 0x80000001: keep the system awake (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) for as long as this process runs.
		const script = [
			"$k = Add-Type -Name Awake -Namespace KeepAwake -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint flags);'",
			'[void]$k::SetThreadExecutionState([uint32]2147483649)',
			`Start-Sleep -Seconds ${seconds}`,
		].join('\n');
		const encoded = Buffer.from(script, 'utf16le').toString('base64');
		// Not spawn's detached: that gives PowerShell no console, and it exits before running anything. Start-Process
		// gives it its own hidden window and hands back its process id.
		const launcher = `$p = Start-Process -FilePath powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; $p.Id`;
		const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', launcher], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
		pid = Number(String(r.stdout || '').trim().split(/\s+/).pop()) || 0;
	} else {
		print({ ok: false, error: 'keep-awake works on macOS and Windows' });
		return 1;
	}
	const state = { pid, started: new Date().toISOString(), until: new Date(Date.now() + seconds * 1000).toISOString() };
	// Only say it's running once it is.
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
	if (!pid || !ours(state)) {
		print({ ok: false, error: 'it started but stopped right away, so this laptop may still sleep', pid: pid || null });
		return 1;
	}
	fs.mkdirSync(HOME, { recursive: true });
	fs.writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
	print({ ok: true, running: true, ...state });
	return 0;
}

function stop() {
	const state = load();
	if (ours(state)) {
		try {
			process.kill(state.pid);
		} catch (error) {
			print({ ok: false, error: `could not stop process ${state.pid}: ${error.message}` });
			return 1;
		}
	}
	fs.rmSync(STATE, { force: true });
	print({ ok: true, running: false, stopped: state?.pid ?? null });
	return 0;
}

const [command, flag, value] = process.argv.slice(2);
const hours = flag === '--hours' ? Number(value) : 10;
if (command === 'start' && hours > 0 && hours <= 48) {
	process.exitCode = start(hours);
} else if (command === 'stop') {
	process.exitCode = stop();
} else if (command === 'status') {
	const state = load();
	print({ ok: true, running: ours(state), ...(state || {}) });
} else {
	print({ ok: false, error: 'usage: keep-awake.mjs start [--hours <up to 48>] | status | stop' });
	process.exitCode = 2;
}

#!/usr/bin/env node
// The run lock from the command line. The first thing every run does, and the last.
//
//   node runlock.mjs acquire [--label <who>]            exit 0 and a token; exit 3 when another run is active (the skip
//                                                        is logged in the run log, so the caller just ends)
//   node runlock.mjs heartbeat --token <t> [--phase <p>] exit 0; exit 4 when another run took the lock (stop working)
//   node runlock.mjs exec --token <t> [--phase <p>] -- <command> [args...]   (or -- "<one command line>")
//                                                        runs the command through the shell and heartbeats every
//                                                        5 minutes while it runs; exits with the command's code
//   node runlock.mjs release --token <t>
//   node runlock.mjs status
import { spawn } from 'node:child_process';
import { acquireRunLock, heartbeatRunLock, releaseRunLock, runLockStatus, appendRunLog, STALE_MS } from './lib/runlock.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const dashes = argv.indexOf('--');
const flags = dashes >= 0 ? argv.slice(0, dashes) : argv;
const opt = n => { const i = flags.indexOf(`--${n}`); return i >= 0 ? flags[i + 1] : undefined; };
const out = obj => console.log(JSON.stringify(obj, null, 1));
const token = opt('token');

if (cmd === 'acquire') {
	const r = await acquireRunLock({ label: opt('label') ?? 'run', phase: opt('phase') ?? 'starting' });
	if (!r.acquired) {
		const h = r.holder;
		appendRunLog(`skipped: another run active (${h.label}, phase "${h.phase}", last heartbeat ${h.heartbeat_age_s} s ago)`);
		out({ acquired: false, message: 'skipped: another run active', holder: h });
		process.exit(3);
	}
	if (r.stole_from) {
		appendRunLog(`${opt('label') ?? 'run'} took a stale run lock from ${r.stole_from.label} (phase "${r.stole_from.phase}", no heartbeat for ${Math.round(r.stole_from.heartbeat_age_s / 60)} min)`);
	}
	out({ acquired: true, token: r.token, stale_after_min: STALE_MS / 60_000, stole_from: r.stole_from });
	process.exit(0);
} else if (cmd === 'heartbeat') {
	const r = await heartbeatRunLock(token, opt('phase'));
	out(r);
	process.exit(r.ok ? 0 : 4);
} else if (cmd === 'release') {
	const r = await releaseRunLock(token);
	out(r);
	process.exit(0);
} else if (cmd === 'status') {
	out(runLockStatus());
	process.exit(0);
} else if (cmd === 'exec') {
	// Either one argument that is a whole command line, or a command and its arguments (each quoted for the shell).
	const rest = dashes >= 0 ? argv.slice(dashes + 1) : [];
	const quote = a => /^[\w@%+=:,./\\-]+$/.test(a) ? a
		: process.platform === 'win32' ? `"${a.replace(/"/g, '\\"')}"` : `'${a.replace(/'/g, `'\\''`)}'`;
	const line = rest.length === 1 ? rest[0] : rest.map(quote).join(' ');
	if (!token || !line) {
		console.error('usage: runlock.mjs exec --token <t> [--phase <p>] -- <command line>');
		process.exit(2);
	}
	const phase = opt('phase') ?? line.slice(0, 80);
	const first = await heartbeatRunLock(token, phase);
	if (!first.ok) {
		out(first);
		process.exit(4);
	}
	let lost = false;
	const timer = setInterval(async () => {
		const r = await heartbeatRunLock(token, phase).catch(e => ({ ok: false, reason: e.message }));
		if (!r.ok && !lost) {
			lost = true;
			console.error(`run lock lost while running (${r.reason}); the command keeps running, but stop changing state after it`);
		}
	}, 5 * 60_000);
	const child = spawn(line, { shell: true, stdio: 'inherit' });
	child.on('exit', code => {
		clearInterval(timer);
		process.exit(lost ? 4 : (code ?? 1));
	});
} else {
	console.error('usage: runlock.mjs acquire|heartbeat|exec|release|status (see the header)');
	process.exit(2);
}

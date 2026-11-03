// The run lock: one agent run of the loop at a time on this machine, held for the whole run (run.mjs, synthesis,
// a redesign build), not just for one script. A run takes it first. Another run that finds it held with a heartbeat
// younger than the stale limit (default 20 minutes) logs "skipped: another run active" and ends. A lock whose
// heartbeat is older than that is stolen, and the steal is recorded. Long steps keep it alive with heartbeat, or run
// under `runlock.mjs exec`, which heartbeats while its command runs.
//
// The lock is a small JSON file; every read-modify-write of it happens under a short mutex (lock.mjs), so two runs
// that start at the same moment cannot both take it.
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { withLock } from './lock.mjs';
import { STATE_DIR } from './env.mjs';
import { CONFIG } from './config.mjs';

export const RUN_LOCK = join(STATE_DIR, 'locks', 'agent-run.json');
const MUTEX = join(STATE_DIR, 'locks', 'agent-run.mutex');
const STEALS = join(STATE_DIR, 'run-lock.log');
export const STALE_MS = Number(process.env.RUN_LOCK_STALE_MIN || 20) * 60_000;
const MUTEX_OPTS = { label: 'the run lock mutex', timeoutMs: 30_000, staleMs: 60_000 };

function read() {
	try {
		return JSON.parse(readFileSync(RUN_LOCK, 'utf8'));
	} catch {
		return null;
	}
}

function write(lock) {
	mkdirSync(dirname(RUN_LOCK), { recursive: true });
	const tmp = `${RUN_LOCK}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(lock, null, 1));
	renameSync(tmp, RUN_LOCK);
}

const heartbeatAge = lock => Date.now() - Date.parse(lock?.heartbeat_at ?? 0);
export const isActive = lock => Boolean(lock?.token) && heartbeatAge(lock) < STALE_MS;
const describe = lock => lock ? { label: lock.label, host: lock.host, acquired_at: lock.acquired_at, heartbeat_at: lock.heartbeat_at, phase: lock.phase, heartbeat_age_s: Math.round(heartbeatAge(lock) / 1000) } : null;

/** The current holder, without its token. */
export function runLockStatus() {
	const lock = read();
	return lock ? { ...describe(lock), active: isActive(lock) } : { active: false };
}

/** Take the lock. Returns { acquired: true, token } or { acquired: false, holder }. */
export async function acquireRunLock({ label = 'run', phase = 'starting' } = {}) {
	return withLock(MUTEX, () => {
		const current = read();
		if (current && isActive(current)) {
			return { acquired: false, holder: describe(current) };
		}
		const now = new Date().toISOString();
		const token = randomBytes(12).toString('hex');
		const stoleFrom = current?.token ? describe(current) : null;
		write({ token, label, host: hostname(), acquired_at: now, heartbeat_at: now, phase, stole_from: stoleFrom });
		if (stoleFrom) {
			mkdirSync(dirname(STEALS), { recursive: true });
			appendFileSync(STEALS, `${now} ${label} stole the run lock from ${JSON.stringify(stoleFrom)}\n`);
		}
		return { acquired: true, token, stole_from: stoleFrom };
	}, MUTEX_OPTS);
}

/** Refresh the heartbeat. ok: false when the lock is gone or another run holds it (this run went quiet too long). */
export async function heartbeatRunLock(token, phase) {
	return withLock(MUTEX, () => {
		const current = read();
		if (!current || current.token !== token) {
			return { ok: false, reason: current?.token ? 'another run holds the lock' : 'the lock is not held', holder: describe(current) };
		}
		current.heartbeat_at = new Date().toISOString();
		if (phase) {
			current.phase = phase;
		}
		write(current);
		return { ok: true };
	}, MUTEX_OPTS);
}

export async function releaseRunLock(token) {
	return withLock(MUTEX, () => {
		const current = read();
		if (!current || current.token !== token) {
			return { ok: false, reason: current?.token ? 'another run holds the lock' : 'the lock is not held' };
		}
		unlinkSync(RUN_LOCK);
		return { ok: true };
	}, MUTEX_OPTS);
}

/** One line in the loop's run log (progress.md under "RUN LOG" by default), when that file exists. */
export function appendRunLog(text) {
	const file = CONFIG.runLog;
	if (!file || !existsSync(file)) {
		return false;
	}
	const d = new Date();
	const local = d.toLocaleString('sv-SE', { timeZone: CONFIG.timezone }).slice(0, 16);
	const zone = new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timezone, timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? '';
	const raw = readFileSync(file, 'utf8');
	const eol = raw.includes('\r\n') ? '\r\n' : '\n';
	appendFileSync(file, `${raw.endsWith('\n') ? '' : eol}- ${local} ${zone}: ${text}${eol}`);
	return true;
}

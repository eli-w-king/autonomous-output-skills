// Cross-process file lock. One holder at a time per lock path, on one machine.
// Used for anything that read-modify-writes shared files: the credentials file
// (rotating OAuth refresh tokens), a study's state, and the spend ledger.
import { openSync, closeSync, writeSync, readFileSync, unlinkSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname } from 'node:os';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === 'EPERM';
	}
}

function readHolder(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * Run fn while holding an exclusive lock file.
 * A lock whose holder process is gone (same host) or that is older than staleMs is broken.
 */
export async function withLock(path, fn, { timeoutMs = 180_000, staleMs = 15 * 60_000, label = path } = {}) {
	mkdirSync(dirname(path), { recursive: true });
	const started = Date.now();
	let fd;
	for (let attempt = 0; ; attempt++) {
		try {
			fd = openSync(path, 'wx');
			writeSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }));
			break;
		} catch (e) {
			if (e.code !== 'EEXIST') {
				throw e;
			}
			let st;
			try {
				st = statSync(path);
			} catch {
				continue; // released between our attempts
			}
			const holder = readHolder(path);
			const dead = holder?.pid && holder.host === hostname() && !pidAlive(holder.pid);
			if (dead || Date.now() - st.mtimeMs > staleMs) {
				// Move it aside first so two waiters cannot both delete a fresh lock.
				const aside = `${path}.stale-${process.pid}-${Date.now()}`;
				try {
					const again = statSync(path);
					if (again.mtimeMs === st.mtimeMs) {
						renameSync(path, aside);
						unlinkSync(aside);
					}
				} catch { /* someone else handled it */ }
				continue;
			}
			if (Date.now() - started > timeoutMs) {
				throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label} (held by pid ${holder?.pid ?? '?'} on ${holder?.host ?? '?'})`);
			}
			await sleep(Math.min(200 * 2 ** Math.min(attempt, 4), 2_000));
		}
	}
	try {
		return await fn();
	} finally {
		try { closeSync(fd); } catch { /* ignore */ }
		try { unlinkSync(path); } catch { /* ignore */ }
	}
}

// Credentials and machine-local state for the research loop.
//
// Secrets live in one env file (default ~/.copilot/research.env), read from disk and never printed.
// In cloud mode the job writes that file from repository secrets before the run and writes rotated
// tokens back to the secrets after it (see references/research-loop.md, "Cloud only").
//
// Outset OAuth refresh tokens ROTATE on every use. Rotation is the one dangerous write here, so it:
//   1. takes an exclusive lock (one refresher per machine at a time),
//   2. re-reads the env file inside the lock (another process may have rotated it),
//   3. writes the new token to a recovery file BEFORE touching the env file,
//   4. replaces the env file atomically (temp file + rename) and verifies it,
//   5. deletes the recovery file and releases the lock.
// A crash between 3 and 5 is repaired by the next caller: the recovery file is applied only when the
// env file still holds the token it replaced, so a newer rotation is never overwritten.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { withLock } from './lock.mjs';

export const ENV_PATH = process.env.RESEARCH_ENV_FILE || join(homedir(), '.copilot', 'research.env');
export const STATE_DIR = process.env.RESEARCH_STATE_DIR || join(homedir(), '.copilot', 'research-state');
export const TOKEN_LOCK = join(STATE_DIR, 'outset-token.lock');
const PENDING = join(STATE_DIR, 'outset-token.pending.json');

const hash = s => createHash('sha256').update(String(s ?? '')).digest('hex');

export function parseEnv(text) {
	const out = {};
	for (const line of text.split(/\r?\n/)) {
		const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
		if (m) {
			out[m[1]] = m[2].trim();
		}
	}
	return out;
}

/** Env file values win over process.env (the file holds the latest rotation). */
export function loadEnv() {
	const fromFile = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, 'utf8')) : {};
	const fromProcess = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (/^(OUTSET|MARVIN|USERINTERVIEWS)_/.test(k) && v) {
			fromProcess[k] = v;
		}
	}
	return { ...fromProcess, ...fromFile };
}

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function replaceFile(path, text) {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, text, { mode: 0o600 });
	for (let i = 0; ; i++) {
		try {
			renameSync(tmp, path);
			return;
		} catch (e) {
			if (i >= 8) {
				// Last resort: write in place so a rotated token is never lost.
				writeFileSync(path, text, { mode: 0o600 });
				try { unlinkSync(tmp); } catch { /* ignore */ }
				return;
			}
			sleepSync(150 * (i + 1));
		}
	}
}

/** Set keys in the env file, preserving every other line and the file's line endings. Caller holds TOKEN_LOCK. */
function writeEnvKeys(updates) {
	const raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
	const eol = raw.includes('\r\n') ? '\r\n' : '\n';
	const lines = raw.length ? raw.split(/\r?\n/) : [];
	for (const [k, v] of Object.entries(updates)) {
		if (/[\r\n]/.test(v)) {
			throw new Error(`refusing to write a multi-line value for ${k}`);
		}
		const i = lines.findIndex(l => l.startsWith(`${k}=`));
		if (i >= 0) {
			lines[i] = `${k}=${v}`;
		} else {
			let end = lines.length;
			while (end > 0 && lines[end - 1] === '') {
				end--;
			}
			lines.splice(end, 0, `${k}=${v}`);
		}
	}
	let text = lines.join(eol);
	if (!text.endsWith(eol)) {
		text += eol;
	}
	replaceFile(ENV_PATH, text);
	const check = parseEnv(readFileSync(ENV_PATH, 'utf8'));
	for (const [k, v] of Object.entries(updates)) {
		if (check[k] !== v) {
			throw new Error(`env write did not stick for ${k}`);
		}
	}
}

function recoverPending() {
	if (!existsSync(PENDING)) {
		return;
	}
	let p;
	try {
		p = JSON.parse(readFileSync(PENDING, 'utf8'));
	} catch {
		return;
	}
	const env = loadEnv();
	if (p?.key && p.value && hash(env[p.key]) === p.replacedHash) {
		writeEnvKeys({ [p.key]: p.value });
	}
	unlinkSync(PENDING);
}

/**
 * Rotate an OAuth refresh token safely.
 * refresh(clientId, refreshToken) must POST the refresh and return the token JSON.
 * Returns the token JSON (access_token, refresh_token, expires_in, scope).
 */
export async function rotateRefreshToken({ clientIdKey, tokenKey }, refresh) {
	return withLock(TOKEN_LOCK, () => rotateLocked({ clientIdKey, tokenKey }, refresh), { label: 'the Outset token lock' });
}

/**
 * The access token for a connection, shared by every process on this machine.
 * A refresh revokes the access token other processes hold, so processes must not each refresh on start: the current
 * access token is cached (STATE_DIR, user-only) and reused until close to expiry. On a 401, pass the rejected token:
 * if another process already refreshed since, its new token is returned instead of refreshing again.
 */
export async function sharedAccessToken({ clientIdKey, tokenKey, kind }, refresh, { rejected = null } = {}) {
	const cachePath = join(STATE_DIR, `outset-access-${kind}.json`);
	return withLock(TOKEN_LOCK, async () => {
		let cache = null;
		try {
			cache = JSON.parse(readFileSync(cachePath, 'utf8'));
		} catch { /* none yet */ }
		const fresh = cache?.access_token && Date.parse(cache.expires_at) - Date.now() > 120_000;
		if (fresh && (!rejected || cache.access_token !== rejected)) {
			return cache;
		}
		const json = await rotateLocked({ clientIdKey, tokenKey }, refresh);
		const next = {
			access_token: json.access_token,
			expires_at: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000).toISOString(),
			scope: json.scope ?? '',
			obtained_at: new Date().toISOString(),
		};
		mkdirSync(STATE_DIR, { recursive: true });
		replaceFile(cachePath, JSON.stringify(next));
		return next;
	}, { label: 'the Outset token lock' });
}

async function rotateLocked({ clientIdKey, tokenKey }, refresh) {
	recoverPending();
	const env = loadEnv();
	const clientId = env[clientIdKey];
	const token = env[tokenKey];
	if (!clientId || !token) {
		throw new Error(`${clientIdKey} or ${tokenKey} is missing from ${ENV_PATH}`);
	}
	const json = await refresh(clientId, token);
	if (!json?.access_token) {
		const why = json?.error ? `${json.error}${json.error_description ? `: ${json.error_description}` : ''}` : 'no access_token';
		const err = new Error(`Outset refresh failed for ${tokenKey} (${why}). A person must re-authorize this connection.`);
		err.code = json?.error === 'invalid_grant' ? 'NEEDS_REAUTH' : 'REFRESH_FAILED';
		throw err;
	}
	if (json.refresh_token && json.refresh_token !== token) {
		mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(PENDING, JSON.stringify({ key: tokenKey, value: json.refresh_token, replacedHash: hash(token), at: new Date().toISOString() }), { mode: 0o600 });
		writeEnvKeys({ [tokenKey]: json.refresh_token });
		unlinkSync(PENDING);
	}
	return json;
}

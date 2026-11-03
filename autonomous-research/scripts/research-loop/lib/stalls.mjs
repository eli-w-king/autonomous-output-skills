// Stall scan: agent sessions on this machine waiting for an approval nobody is there to give. A
// `permission.requested` event with no `permission.completed` for the same requestId after 10 minutes is a stall:
// the session hangs, and an automation run can block its automation's later runs. Every scheduled run scans, so a
// stall is never silent; the morning summary lists any it finds at the very top. Read-only: it only reads the
// sessions' events.jsonl, and it shows a request's stated intention, never the full command.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { STATE_DIR } from './env.mjs';

export const SESSION_ROOT = process.env.COPILOT_SESSION_STATE || join(homedir(), '.copilot', 'session-state');
export const STALLS_FILE = join(STATE_DIR, 'stalls.json');

export function scanStalls({ olderThanMin = 10, windowHours = 72, root = SESSION_ROOT } = {}) {
	const now = Date.now();
	const stalls = [];
	let scanned = 0;
	for (const d of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
		if (!d.isDirectory() || d.name.startsWith('.')) {
			continue;
		}
		const f = join(root, d.name, 'events.jsonl');
		if (!existsSync(f) || now - statSync(f).mtimeMs > windowHours * 3600e3) {
			continue;
		}
		scanned++;
		const requested = new Map();
		const completed = new Set();
		let prompt = null;
		for (const line of readFileSync(f, 'utf8').split('\n')) {
			// Parse only the lines that matter; session logs can be large.
			const isPerm = line.includes('"permission.');
			if (!isPerm && (prompt !== null || !line.includes('"user.message"'))) {
				continue;
			}
			let e;
			try {
				e = JSON.parse(line);
			} catch {
				continue;
			}
			if (e.type === 'user.message' && prompt === null) {
				prompt = String(e.data?.content ?? '').replace(/\s+/g, ' ').slice(0, 70);
			} else if (e.type === 'permission.requested') {
				const pr = e.data?.permissionRequest ?? {};
				const what = pr.intention || (pr.possiblePaths?.length ? `${pr.kind} ${basename(String(pr.possiblePaths[0]))}` : pr.kind) || 'an approval';
				requested.set(e.data?.requestId, { at: e.timestamp, kind: pr.kind ?? '?', what: String(what).slice(0, 100) });
			} else if (e.type === 'permission.completed') {
				completed.add(e.data?.requestId);
			}
		}
		for (const [id, r] of requested) {
			const age = (now - Date.parse(r.at)) / 60_000;
			if (!completed.has(id) && age >= olderThanMin) {
				stalls.push({ session: d.name, prompt: prompt ?? '', since: r.at, minutes: Math.round(age), kind: r.kind, what: r.what });
			}
		}
	}
	stalls.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
	return { at: new Date(now).toISOString(), scanned, stalls };
}

/** Scan and save the result for the morning summary. */
export function recordStalls(opts) {
	const result = scanStalls(opts);
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(STALLS_FILE, JSON.stringify(result, null, 1));
	return result;
}

export function loadStalls() {
	try {
		return JSON.parse(readFileSync(STALLS_FILE, 'utf8'));
	} catch {
		return null;
	}
}

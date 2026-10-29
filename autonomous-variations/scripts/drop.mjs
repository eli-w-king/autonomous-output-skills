#!/usr/bin/env node
/* drop.mjs: the client for a lab's file drop, which is drop-server.mjs on the hub (reached through a dev tunnel), or
 * a plain folder when the lab runs on one box and on the hub itself. No dependencies (Node 22).
 *
 * Settings: drop.json next to this script, or the file named by DROP_CONFIG. Keep both in the lab home, outside
 * every repo (for example ~/.lab/<lab>/), and never print, commit or message the key.
 *   { "url": "https://<tunnel>-4650.<region>.devtunnels.ms", "key": "<lab key>", "base": "<a commit every box has>" }
 *   { "dir": "<the drop folder on this box>", "base": "<a commit every box has>" }
 * Next to drop.json it keeps outbox/ (waiting to be delivered), sent/ (delivered bundles) and in/ (received bundles).
 *
 *   node drop.mjs ls                          list the drop: name, size, sha256, mtime
 *   node drop.mjs get <name> [out]            download one file (into in/ unless out is given), check its SHA-256
 *   node drop.mjs put <file> [name]           deliver one file through the outbox
 *   node drop.mjs send <kind> <ref> [repo]    bundle <ref> on top of the base as <kind>-<sha7>.bundle and deliver it
 *                                             with <kind>-latest.txt (commit, bundle name, SHA-256); --full bundles
 *                                             the whole history, for a box that cannot fetch the repo
 *   node drop.mjs recv <kind> [repo]          download <kind>-latest.txt and its bundle and check the SHA-256; with a
 *                                             repo, also run git bundle verify and fetch it into refs/lab/<kind>
 *   node drop.mjs wait <name>...              return once every named file is on the drop
 *   node drop.mjs wait --change [name...]     return once a named file (with none named, any file) changes; --state
 *                                             <file> remembers what was seen, so no change is missed between waits
 *   node drop.mjs pull <dir>                  mirror the drop into a folder, bundles first
 *   node drop.mjs flush [--loop <seconds>]    deliver the outbox; --loop keeps trying forever (one per box, detached)
 *
 * wait and pull take --match <regex> to limit the files; wait takes --every <seconds> (default 30) and --timeout
 * <seconds> (default 0, no limit). Kinds are lowercase letters and digits starting with a letter: kit, base, v01, a3.
 * Exit codes: 0 done, 1 error, 2 timed out, 3 queued in the outbox because the drop could not be reached. 3 is not a
 * failure: the next flush (or the box's flush loop) delivers it.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const die = (msg, code = 1) => { console.error(`drop: ${msg}`); process.exit(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const rand = () => crypto.randomBytes(4).toString('hex');
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const usage = code => {
	const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
	const head = lines.slice(1, lines.findIndex(l => l.trim() === '*/'));
	console.log(head.map(l => l.replace(/^\/\* ?/, '').replace(/^ \* ?/, '').replace(/^ \*$/, '')).join('\n').trim());
	process.exit(code);
};

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = [], flags = {};
const VALUE_FLAGS = new Set(['loop', 'state', 'match', 'every', 'timeout', 'base']);
for (let i = 1; i < argv.length; i++) {
	const a = argv[i];
	if (a === '--full' || a === '--change') { flags[a.slice(2)] = true; continue; }
	if (a === '-h' || a === '--help') { usage(0); }
	const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
	if (!m) { pos.push(a); continue; }
	if (!VALUE_FLAGS.has(m[1])) { die(`unknown option ${a}`); }
	flags[m[1]] = m[2] ?? argv[++i];
	if (flags[m[1]] === undefined) { die(`${a} needs a value`); }
}
if (!cmd || cmd === '-h' || cmd === '--help') { usage(cmd ? 0 : 2); }

const CONFIG = path.resolve(process.env.DROP_CONFIG || path.join(path.dirname(fileURLToPath(import.meta.url)), 'drop.json'));
let cfg;
try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, '')); } catch (e) {
	die(`cannot read ${CONFIG} (${e.code || e.message}). Copy drop.mjs into the lab home next to drop.json, or set DROP_CONFIG.`);
}
const HOME = path.dirname(CONFIG);
const OUTBOX = path.join(HOME, 'outbox'), SENT = path.join(HOME, 'sent'), IN = path.join(HOME, 'in');
if (spawnSync('git', ['-C', HOME, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stdout?.trim() === 'true') {
	console.error(`drop: warning: ${CONFIG} is inside a git repository; move the lab home out of every repo`);
}
const DIR = cfg.dir ? path.resolve(HOME, cfg.dir) : null;
const URL_BASE = cfg.url ? String(cfg.url).replace(/\/+$/, '') : null;
if (!DIR && !(URL_BASE && cfg.key)) { die(`${CONFIG} needs "url" and "key", or "dir"`); }

// The drop's name rules; keep them in step with drop-server.mjs.
const BUNDLE = /^[a-z][a-z0-9]{0,23}-[0-9a-f]{7,40}\.bundle$/;
const TEXT = /^[a-z0-9][a-z0-9.-]{0,79}\.(?:txt|md|json|mjs|py|sh)$/;
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/;
const allowed = n => (BUNDLE.test(n) || TEXT.test(n)) && !n.includes('..') && !RESERVED.test(n);
const KIND = /^[a-z][a-z0-9]{0,23}$/;
const NAME_RULE = 'lowercase letters, digits, dots and dashes ending in .txt .md .json .mjs .py or .sh, or <kind>-<sha>.bundle';

class Unreachable extends Error {}
class Rejected extends Error {}

const localHashes = new Map();
const hashLocal = file => {
	const st = fs.statSync(file);
	const known = localHashes.get(file);
	if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) { return known.sha; }
	const sha = sha256(fs.readFileSync(file));
	localHashes.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha });
	return sha;
};
const writeAtomic = (file, buf) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = path.join(path.dirname(file), `.tmp-${rand()}-${path.basename(file)}`);
	fs.writeFileSync(tmp, buf);
	fs.renameSync(tmp, file);
};
const createOnly = (tmp, file) => {
	try { fs.linkSync(tmp, file); } catch (e) {
		if (e.code === 'EEXIST') { fs.rmSync(tmp, { force: true }); throw e; }
		fs.copyFileSync(tmp, file, fs.constants.COPYFILE_EXCL);
	}
	fs.rmSync(tmp, { force: true });
};

async function call(method, name, body) {
	const headers = { 'X-Lab-Key': cfg.key, 'X-Tunnel-Skip-AntiPhishing-Page': 'true' };
	if (cfg.token) { headers['X-Tunnel-Authorization'] = `tunnel ${cfg.token}`; }
	if (body) { headers['content-type'] = 'application/octet-stream'; }
	const timeout = body && body.length > 1e6 ? 30 * 60e3 : 5 * 60e3;
	let last;
	for (let attempt = 1; attempt <= 3; attempt++) {
		let res;
		try {
			res = await fetch(`${URL_BASE}/x/${encodeURIComponent(name)}`, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
		} catch (e) {
			last = new Unreachable(`cannot reach the drop (${e.cause?.code || e.name || e.message})`);
			await sleep(1500 * attempt);
			continue;
		}
		if (res.status >= 300 && res.status < 400) { throw new Unreachable(`the tunnel answered ${res.status}, a sign-in page: the drop's port lost anonymous access; tell the hub`); }
		if (res.status === 401) { die('the drop refused the key (401). Check drop.json, and do not retry: repeated bad keys lock this address out.'); }
		if (res.status === 429) { throw new Unreachable('this address is locked out after bad keys; fix drop.json and wait 15 minutes'); }
		if (res.status >= 500) { last = new Unreachable(`the drop or its tunnel is down (HTTP ${res.status})`); await sleep(1500 * attempt); continue; }
		return res;
	}
	throw last;
}

// Both backends: list() -> [{ name, size, mtime, sha256 }], get(name) -> Buffer or null, head(name) -> sha256 or null,
// put(name, buf) -> { sha256, theirs } where theirs is the drop's sha256 when a write-once bundle was already there.
const backend = DIR ? {
	async list() {
		if (!fs.existsSync(DIR)) { return []; }
		return fs.readdirSync(DIR).filter(allowed).sort().flatMap(name => {
			const file = path.join(DIR, name);
			const st = fs.statSync(file);
			return st.isFile() ? [{ name, size: st.size, mtime: st.mtime.toISOString(), sha256: hashLocal(file) }] : [];
		});
	},
	async get(name) { const file = path.join(DIR, name); return fs.existsSync(file) ? fs.readFileSync(file) : null; },
	async head(name) { const file = path.join(DIR, name); return fs.existsSync(file) ? hashLocal(file) : null; },
	async put(name, buf) {
		const file = path.join(DIR, name);
		fs.mkdirSync(DIR, { recursive: true });
		if (!BUNDLE.test(name)) { writeAtomic(file, buf); return { sha256: sha256(buf) }; }
		const tmp = `${file}.part-${rand()}`;
		fs.writeFileSync(tmp, buf);
		try { createOnly(tmp, file); } catch (e) {
			if (e.code === 'EEXIST') { return { sha256: sha256(buf), theirs: hashLocal(file) }; }
			throw e;
		}
		return { sha256: sha256(buf) };
	},
} : {
	async list() {
		const res = await call('GET', '');
		if (res.status !== 200) { throw new Rejected(`list: HTTP ${res.status} ${await res.text()}`); }
		return res.json();
	},
	async get(name) {
		const res = await call('GET', name);
		if (res.status === 404) { return null; }
		if (res.status !== 200) { throw new Rejected(`GET ${name}: HTTP ${res.status} ${await res.text()}`); }
		const buf = Buffer.from(await res.arrayBuffer());
		const want = res.headers.get('x-sha256');
		if (want && want !== sha256(buf)) { throw new Unreachable(`GET ${name}: the SHA-256 changed in transit`); }
		return buf;
	},
	async head(name) {
		const res = await call('HEAD', name);
		if (res.status === 404) { return null; }
		if (res.status !== 200) { throw new Rejected(`HEAD ${name}: HTTP ${res.status}`); }
		return res.headers.get('x-sha256');
	},
	async put(name, buf) {
		const res = await call('PUT', name, buf);
		const text = await res.text();
		let body = {};
		try { body = JSON.parse(text); } catch { /* not JSON */ }
		if (res.status === 201) {
			if (body.sha256 !== sha256(buf)) { throw new Unreachable(`PUT ${name}: the drop stored different bytes; retrying`); }
			return { sha256: body.sha256 };
		}
		if (res.status === 409 && body.sha256) { return { sha256: sha256(buf), theirs: body.sha256 }; }
		throw new Rejected(`PUT ${name}: HTTP ${res.status} ${text.trim()}`);
	},
};

// The outbox: send and put queue files here first, so nothing is lost when the hub cannot be reached, and flush
// delivers them in order: bundles before the pointers that name them. One flush at a time per box (a lock file).
const LOCK = path.join(OUTBOX, '.flush.lock');
const queue = (name, buf) => {
	fs.rmSync(path.join(OUTBOX, 'rejected', name), { force: true });
	writeAtomic(path.join(OUTBOX, name), buf);
};
const pending = () => {
	if (!fs.existsSync(OUTBOX)) { return []; }
	return fs.readdirSync(OUTBOX)
		.filter(n => !n.startsWith('.') && allowed(n) && fs.statSync(path.join(OUTBOX, n)).isFile())
		.map(n => ({ name: n, bundle: BUNDLE.test(n), mtimeMs: fs.statSync(path.join(OUTBOX, n)).mtimeMs }))
		.sort((a, b) => (b.bundle - a.bundle) || (a.mtimeMs - b.mtimeMs));
};
let holding = false;
const tryLock = (depth = 0) => {
	fs.mkdirSync(OUTBOX, { recursive: true });
	try {
		const fd = fs.openSync(LOCK, 'wx');
		fs.writeSync(fd, `${process.pid} ${stamp()}\n`);
		fs.closeSync(fd);
		holding = true;
		return true;
	} catch (e) {
		if (e.code !== 'EEXIST' || depth > 2) { if (e.code === 'EEXIST') { return false; } throw e; }
	}
	let stale = false;
	try {
		const pid = Number(fs.readFileSync(LOCK, 'utf8').split(' ')[0]);
		let alive = true;
		try { process.kill(pid, 0); } catch (k) { alive = k.code === 'EPERM'; }
		stale = !alive || Date.now() - fs.statSync(LOCK).mtimeMs > 2 * 3600e3;
	} catch { stale = true; }
	if (!stale) { return false; }
	fs.rmSync(LOCK, { force: true });
	return tryLock(depth + 1);
};
const unlock = () => { if (holding) { fs.rmSync(LOCK, { force: true }); holding = false; } };
for (const sig of ['SIGINT', 'SIGTERM']) { process.on(sig, () => { unlock(); process.exit(130); }); }

// Deliver everything in the outbox, in rounds until nothing moves. Throws Unreachable when the drop cannot be
// reached; whatever is left stays queued. Returns the names delivered and rejected.
async function flushOnce(say = console.log) {
	const done = { delivered: [], rejected: [] };
	for (let round = 0; round < 3; round++) {
		let moved = 0;
		for (const { name, bundle } of pending()) {
			const file = path.join(OUTBOX, name);
			const orig = fs.readFileSync(file);
			let buf = orig;
			if (name.endsWith('-latest.txt')) {
				// A pointer goes out only once its bundle is on the drop, and always with the drop's SHA-256 for it.
				const [commit, bundleName] = orig.toString('utf8').split(/\r?\n/).map(s => s.trim());
				const there = BUNDLE.test(bundleName || '') ? await backend.head(bundleName) : null;
				if (!there) {
					const keep = path.join(SENT, bundleName || '');
					if (bundleName && fs.existsSync(keep) && !fs.existsSync(path.join(OUTBOX, bundleName))) {
						fs.copyFileSync(keep, path.join(OUTBOX, bundleName));
						say(`${stamp()} ${bundleName} is missing on the drop; queued it again`);
						moved++;
					} else {
						say(`${stamp()} ${name} waits for ${bundleName || '(no bundle named)'}`);
					}
					continue;
				}
				buf = Buffer.from(`${commit}\n${bundleName}\n${there}\n`);
			}
			let r;
			try { r = await backend.put(name, buf); } catch (e) {
				if (!(e instanceof Rejected)) { throw e; }
				fs.mkdirSync(path.join(OUTBOX, 'rejected'), { recursive: true });
				fs.renameSync(file, path.join(OUTBOX, 'rejected', name));
				say(`${stamp()} rejected ${name}, moved to outbox/rejected: ${e.message}`);
				done.rejected.push(name);
				continue;
			}
			if (r.theirs && r.theirs !== r.sha256) { say(`${stamp()} ${name} was already on the drop with other bytes; pointers use the drop's copy`); }
			if (bundle) {
				fs.mkdirSync(SENT, { recursive: true });
				fs.renameSync(file, path.join(SENT, name));
			} else if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === sha256(orig)) {
				fs.rmSync(file, { force: true });
			}
			moved++;
			done.delivered.push(name);
			say(`${stamp()} delivered ${name} ${r.theirs || r.sha256}`);
		}
		if (!moved || !pending().length) { break; }
	}
	return { ...done, left: pending().length };
}

// send and put: flush now unless another flush on this box is running; then it stays queued for that one.
async function deliver(names) {
	const until = Date.now() + 60e3;
	while (!tryLock()) {
		if (Date.now() > until) { console.log(`queued ${names.join(' and ')}: another flush on this box is delivering the outbox`); process.exit(3); }
		await sleep(2000);
	}
	let problem = null, result = { rejected: [] };
	try { result = await flushOnce(() => {}); } catch (e) {
		if (!(e instanceof Unreachable)) { unlock(); throw e; }
		problem = e.message;
	}
	unlock();
	// Another session's flush on this box may have delivered, or rejected, these files.
	const rejected = names.filter(n => result.rejected.includes(n) || fs.existsSync(path.join(OUTBOX, 'rejected', n)));
	if (rejected.length) { die(`the drop rejected ${rejected.join(' and ')}; it is in ${path.join(OUTBOX, 'rejected')}`); }
	const left = names.filter(n => fs.existsSync(path.join(OUTBOX, n)));
	if (problem || left.length) {
		console.log(`queued ${(left.length ? left : names).join(' and ')} in ${OUTBOX}: ${problem || 'waiting for its bundle to reach the drop'}. The box's flush loop (or drop.mjs flush) delivers it when the drop answers.`);
		process.exit(3);
	}
}

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOr = (repo, ...args) => { try { return git(repo, ...args); } catch { return ''; } };

async function main() {
	if (cmd === 'ls') {
		for (const f of await backend.list()) { console.log(`${f.name}\t${f.size}\t${f.sha256}\t${f.mtime}`); }
	} else if (cmd === 'get') {
		const [name, out] = pos;
		if (!name) { usage(2); }
		const buf = await backend.get(name);
		if (!buf) { die(`no such file on the drop: ${name}`); }
		const file = out ? path.resolve(out) : path.join(IN, name);
		writeAtomic(file, buf);
		console.log(`${file}\t${buf.length}\t${sha256(buf)}`);
	} else if (cmd === 'put') {
		const [file, nameArg] = pos;
		if (!file) { usage(2); }
		const name = nameArg || path.basename(file);
		if (!allowed(name)) { die(`name not allowed on the drop: ${name} (${NAME_RULE})`); }
		const buf = fs.readFileSync(file);
		queue(name, buf);
		await deliver([name]);
		console.log(`delivered ${name}\t${buf.length}\t${sha256(buf)}`);
	} else if (cmd === 'send') {
		const [kind, ref, repoArg] = pos;
		if (!kind || !ref) { usage(2); }
		if (!KIND.test(kind)) { die(`kind must be lowercase letters and digits, starting with a letter (kit, base, v01): ${kind}`); }
		const repo = path.resolve(repoArg || '.');
		const commit = gitOr(repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) || die(`not a commit in ${repo}: ${ref}`);
		const base = flags.full ? '' : (flags.base || process.env.DROP_BASE || cfg.base || '');
		if (!flags.full && !base) { die('no base: set "base" in drop.json to a commit every box has, pass --base <commit>, or use --full'); }
		if (base) {
			const baseCommit = gitOr(repo, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`) || die(`this repo lacks the base ${base}; fetch it (or recv the base bundle) first`);
			if (gitOr(repo, 'rev-list', '--count', `${baseCommit}..${commit}`) === '0') { die(`${ref} adds nothing to the base ${base.slice(0, 9)}; commit first`); }
		}
		const name = `${kind}-${commit.slice(0, 7)}.bundle`;
		let file = [path.join(OUTBOX, name), path.join(SENT, name)].find(f => fs.existsSync(f));
		if (!file) {
			// A bundle needs a ref, not a bare commit; refs/drop/<kind> is the one ref inside every bundle sent.
			git(repo, 'update-ref', `refs/drop/${kind}`, commit);
			fs.mkdirSync(OUTBOX, { recursive: true });
			const tmp = path.join(OUTBOX, `.tmp-${rand()}-${name}`);
			git(repo, 'bundle', 'create', tmp, `refs/drop/${kind}`, ...(base ? [`^${base}`] : []));
			file = path.join(OUTBOX, name);
			fs.renameSync(tmp, file);
		}
		const size = fs.statSync(file).size;
		queue(`${kind}-latest.txt`, Buffer.from(`${commit}\n${name}\n${hashLocal(file)}\n`));
		await deliver([name, `${kind}-latest.txt`]);
		console.log(`sent ${name}\tcommit ${commit}\tsha256 ${(await backend.head(name)) || hashLocal(file)}\t${size} bytes`);
	} else if (cmd === 'recv') {
		const [kind, repoArg] = pos;
		if (!kind) { usage(2); }
		if (!KIND.test(kind)) { die(`not a kind: ${kind}`); }
		const ptr = await backend.get(`${kind}-latest.txt`);
		if (!ptr) { die(`no ${kind}-latest.txt on the drop yet`); }
		const [commit, name, sum] = ptr.toString('utf8').split(/\r?\n/).map(s => s.trim().toLowerCase());
		if (!/^[0-9a-f]{40}$/.test(commit || '') || !BUNDLE.test(name || '') || !name.startsWith(`${kind}-`) || !/^[0-9a-f]{64}$/.test(sum || '')) {
			die(`${kind}-latest.txt is malformed`);
		}
		const local = path.join(IN, name);
		if (!(fs.existsSync(local) && hashLocal(local) === sum)) {
			const buf = await backend.get(name);
			if (!buf) { die(`${name} is not on the drop`); }
			if (sha256(buf) !== sum) { die(`${name} does not match the SHA-256 in ${kind}-latest.txt`); }
			writeAtomic(local, buf);
		}
		console.log(`${local}\tcommit ${commit}\tsha256 ${sum}`);
		if (repoArg) {
			const repo = path.resolve(repoArg);
			const v = spawnSync('git', ['-C', repo, 'bundle', 'verify', local], { encoding: 'utf8' });
			if (v.status !== 0) { die(`git bundle verify failed; this repo may lack the bundle's base:\n${(v.stderr || v.stdout).trim()}`); }
			const head = git(repo, 'bundle', 'list-heads', local).split('\n').map(l => l.trim().split(/\s+/)).find(([s]) => s === commit)?.[1];
			if (!head) { die(`${name} has no ref at ${commit}`); }
			for (let attempt = 1; ; attempt++) {
				// Other sessions on this box may fetch the same kit at the same moment and hold the ref lock.
				try { git(repo, 'fetch', '--quiet', local, `+${head}:refs/lab/${kind}`); break; } catch (e) {
					if (attempt >= 5) { die(`git fetch failed: ${String(e.stderr || e.message).trim()}`); }
					await sleep(1000 * attempt);
				}
			}
			if (gitOr(repo, 'rev-parse', `refs/lab/${kind}`) !== commit) { die(`refs/lab/${kind} does not match ${commit}`); }
			console.log(`refs/lab/${kind} = ${commit}`);
		}
	} else if (cmd === 'wait') {
		const names = pos;
		if (!flags.change && !names.length) { usage(2); }
		const every = Number(flags.every || 30) * 1000;
		const deadline = Number(flags.timeout || 0) > 0 ? Date.now() + Number(flags.timeout) * 1000 : Infinity;
		const match = flags.match ? new RegExp(flags.match) : null;
		const stateFile = flags.state ? path.resolve(flags.state) : null;
		let seen = null;
		if (flags.change && stateFile) { seen = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {}; }
		let warned = '';
		for (;;) {
			let files = null;
			try { files = await backend.list(); warned = ''; } catch (e) {
				if (!(e instanceof Unreachable) && !(e instanceof Rejected)) { throw e; }
				if (warned !== e.message) { console.error(`drop: ${e.message}; still waiting`); warned = e.message; }
			}
			if (files) {
				const now = Object.fromEntries(files.filter(f => (!names.length || names.includes(f.name)) && (!match || match.test(f.name))).map(f => [f.name, f.sha256]));
				if (!flags.change) {
					if (names.every(n => n in now)) { for (const n of names) { console.log(`${n}\t${now[n]}`); } return; }
				} else if (seen === null) {
					seen = now;
				} else {
					const changed = Object.keys(now).filter(n => now[n] !== seen[n]);
					const gone = Object.keys(seen).filter(n => !(n in now));
					if (changed.length || gone.length) {
						for (const n of changed) { console.log(`${n}\t${now[n]}`); }
						for (const n of gone) { console.log(`${n}\tremoved`); }
						if (stateFile) { writeAtomic(stateFile, Buffer.from(JSON.stringify(now, null, 1) + '\n')); }
						return;
					}
				}
			}
			if (Date.now() >= deadline) { die('timed out', 2); }
			await sleep(Math.max(0, Math.min(every, deadline - Date.now())));
		}
	} else if (cmd === 'pull') {
		const [outArg] = pos;
		if (!outArg) { usage(2); }
		const out = path.resolve(outArg);
		const match = flags.match ? new RegExp(flags.match) : null;
		const files = (await backend.list()).filter(f => !match || match.test(f.name))
			.sort((a, b) => (BUNDLE.test(b.name) - BUNDLE.test(a.name)) || a.name.localeCompare(b.name));
		let got = 0;
		for (const f of files) {
			const file = path.join(out, f.name);
			if (fs.existsSync(file) && fs.statSync(file).size === f.size && (BUNDLE.test(f.name) || hashLocal(file) === f.sha256)) { continue; }
			const buf = await backend.get(f.name);
			if (!buf) { continue; }
			if (BUNDLE.test(f.name) && sha256(buf) !== f.sha256) { die(`${f.name}: SHA-256 mismatch`); }
			writeAtomic(file, buf);
			got++;
		}
		console.log(`pulled ${got} file(s) into ${out}; ${files.length} on the drop`);
	} else if (cmd === 'flush') {
		const loop = flags.loop ? Number(flags.loop) : 0;
		if (flags.loop && !(loop > 0)) { die('--loop needs a number of seconds'); }
		let lastNote = '';
		const note = msg => { if (msg !== lastNote) { console.log(`${stamp()} ${msg}`); lastNote = msg; } };
		do {
			if (tryLock()) {
				try {
					const r = await flushOnce();
					note(`outbox: ${r.left} left`);
				} catch (e) {
					if (!(e instanceof Unreachable)) { unlock(); throw e; }
					note(`waiting for the drop: ${e.message} (${pending().length} queued)`);
				}
				unlock();
			}
			if (loop) { await sleep(loop * 1000); }
		} while (loop);
		if (pending().length) { process.exit(3); }
	} else {
		die(`unknown command ${cmd}; run with --help`);
	}
}

main().catch(e => {
	unlock();
	die(e instanceof Unreachable || e instanceof Rejected ? e.message : String(e.stderr || e.stack || e).trim());
});

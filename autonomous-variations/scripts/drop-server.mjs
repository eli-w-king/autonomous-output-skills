#!/usr/bin/env node
/* A small authenticated file drop for a lab that spans machines. It carries git bundles and small text files
 * (briefs, pointers, reports, requests) and nothing else. Run it on the hub, a dev box, never on the laptop: it
 * listens on 127.0.0.1 and other boxes reach it through a dev tunnel whose port allows anonymous connections, so
 * the lab key is the gate. No dependencies (Node 22). The client is drop.mjs.
 *
 *   DROP_DIR=<folder> DROP_KEY_FILE=<file> node drop-server.mjs
 *
 * Environment
 *   DROP_DIR        the folder that holds the files (required; created when missing)
 *   DROP_KEY_FILE   a file holding the lab key, 24 or more characters (or DROP_KEY with the key itself)
 *   DROP_PORT       the port (default 4650)
 *   DROP_HOST       the address to listen on (default 127.0.0.1; the tunnel connects locally)
 *   DROP_MAX_MB     the largest upload, in MB (default 300)
 *   DROP_LOCKOUT    bad keys from one client in 15 minutes before it is locked out (default 50; boxes often
 *                   share an egress address, and a low limit locks out your own tests)
 *
 * HTTP, every request with the X-Lab-Key header
 *   GET  /x/          list the files: name, size, mtime, sha256
 *   GET  /x/<name>    download one (HEAD returns only its size and X-SHA256)
 *   PUT  /x/<name>    upload one. Bundles are write-once (409 with the existing sha256); other files may be replaced.
 *
 * Names: <kind>-<7 to 40 hex>.bundle, where <kind> is lowercase letters and digits starting with a letter (kit, base,
 * v01, a3), or a text file of lowercase letters, digits, dots and dashes ending in .txt, .md, .json, .mjs, .py or .sh.
 * Keep these rules in step with drop.mjs.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const env = process.env;
const DIR = env.DROP_DIR ? path.resolve(env.DROP_DIR) : '';
const KEY = (env.DROP_KEY_FILE ? fs.readFileSync(env.DROP_KEY_FILE, 'utf8') : env.DROP_KEY || '').trim();
const PORT = Number(env.DROP_PORT || 4650);
const HOST = env.DROP_HOST || '127.0.0.1';
const MAX = Number(env.DROP_MAX_MB || 300) * 1024 * 1024;
const LOCKOUT = Number(env.DROP_LOCKOUT || 50);
const WINDOW = 15 * 60e3;
if (!DIR || KEY.length < 24) {
	console.error('drop-server: set DROP_DIR, and DROP_KEY_FILE (or DROP_KEY) with a key of 24 or more characters');
	process.exit(1);
}
fs.mkdirSync(DIR, { recursive: true });
for (const f of fs.readdirSync(DIR)) {
	if (f.includes('.part-')) { fs.rmSync(path.join(DIR, f), { force: true }); }
}

const BUNDLE = /^[a-z][a-z0-9]{0,23}-[0-9a-f]{7,40}\.bundle$/;
const TEXT = /^[a-z0-9][a-z0-9.-]{0,79}\.(?:txt|md|json|mjs|py|sh)$/;
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/;
const allowed = name => (BUNDLE.test(name) || TEXT.test(name)) && !name.includes('..') && !RESERVED.test(name);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const keyBuf = Buffer.from(KEY);
const authed = req => {
	const k = Buffer.from(String(req.headers['x-lab-key'] || ''));
	return k.length === keyBuf.length && crypto.timingSafeEqual(k, keyBuf);
};

// The tunnel admits anonymous connections, so lock out a client after repeated bad keys. The tunnel appends the
// address it saw to X-Forwarded-For, so the last entry is the one a client cannot forge.
const fails = new Map();
const clientOf = req => {
	const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
	return fwd.length ? fwd[fwd.length - 1] : String(req.socket.remoteAddress || '');
};
const lockedOut = who => { const f = fails.get(who); return !!f && f.count >= LOCKOUT && Date.now() - f.since < WINDOW; };
const noteFail = who => {
	const f = fails.get(who);
	if (!f || Date.now() - f.since > WINDOW) { fails.set(who, { count: 1, since: Date.now() }); } else { f.count++; }
};

const hashes = new Map();
const hashFile = file => {
	const st = fs.statSync(file);
	const known = hashes.get(file);
	if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) { return Promise.resolve(known.sha256); }
	return new Promise((resolve, reject) => {
		const h = crypto.createHash('sha256');
		fs.createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => {
			const sha256 = h.digest('hex');
			hashes.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha256 });
			resolve(sha256);
		});
	});
};
const send = (res, code, body) => {
	res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	res.end(JSON.stringify(body) + '\n');
};

// Bundles are write-once: a hard link creates the name only if it does not exist yet.
const createOnly = (tmp, file) => {
	try {
		fs.linkSync(tmp, file);
	} catch (e) {
		if (e.code === 'EEXIST') { throw e; }
		fs.copyFileSync(tmp, file, fs.constants.COPYFILE_EXCL);
	}
	fs.rmSync(tmp, { force: true });
};

async function receive(req, res, name, file, who) {
	const bundle = BUNDLE.test(name);
	const declared = Number(req.headers['content-length'] || 0);
	if (declared > MAX) { send(res, 413, { error: 'too large', max: MAX }); req.destroy(); return; }
	if (bundle && fs.existsSync(file)) {
		const sha256 = await hashFile(file);
		req.resume();
		req.on('end', () => send(res, 409, { error: 'bundles are write-once; use a new name', name, sha256 }));
		return;
	}
	const tmp = `${file}.part-${crypto.randomBytes(4).toString('hex')}`;
	const out = fs.createWriteStream(tmp);
	const h = crypto.createHash('sha256');
	let size = 0, failed = false;
	const fail = (code, body) => {
		if (failed) { return; }
		failed = true;
		out.destroy();
		fs.rmSync(tmp, { force: true });
		if (!res.headersSent) { send(res, code, body); }
		req.destroy();
	};
	req.on('data', d => {
		size += d.length;
		if (size > MAX) { fail(413, { error: 'too large', max: MAX }); return; }
		h.update(d);
	});
	req.on('aborted', () => fail(400, { error: 'upload aborted' }));
	out.on('error', e => fail(500, { error: String(e) }));
	out.on('finish', async () => {
		if (failed) { return; }
		const sha256 = h.digest('hex');
		try {
			if (bundle) { createOnly(tmp, file); } else { fs.renameSync(tmp, file); }
		} catch (e) {
			fs.rmSync(tmp, { force: true });
			if (e.code === 'EEXIST') { return send(res, 409, { error: 'bundles are write-once; use a new name', name, sha256: await hashFile(file) }); }
			throw e;
		}
		log('PUT', name, size, sha256, who);
		send(res, 201, { name, size, sha256 });
	});
	req.pipe(out);
}

const server = http.createServer(async (req, res) => {
	const who = clientOf(req);
	try {
		if (lockedOut(who)) { log('429', req.method, req.url, who); return send(res, 429, { error: 'too many bad keys; wait 15 minutes' }); }
		if (!authed(req)) { noteFail(who); log('401', req.method, req.url, who); return send(res, 401, { error: 'unauthorized' }); }
		const url = new URL(req.url, 'http://drop');
		if (!url.pathname.startsWith('/x/')) { return send(res, 404, { error: 'not found' }); }
		const name = decodeURIComponent(url.pathname.slice(3));
		if (name === '' && req.method === 'GET') {
			const files = [];
			for (const f of fs.readdirSync(DIR).sort()) {
				const full = path.join(DIR, f);
				if (!allowed(f) || !fs.statSync(full).isFile()) { continue; }
				const st = fs.statSync(full);
				files.push({ name: f, size: st.size, mtime: st.mtime.toISOString(), sha256: await hashFile(full) });
			}
			return send(res, 200, files);
		}
		if (!allowed(name)) { return send(res, 400, { error: 'name not allowed', name }); }
		const file = path.join(DIR, name);
		if (req.method === 'GET' || req.method === 'HEAD') {
			if (!fs.existsSync(file)) { return send(res, 404, { error: 'no such file', name }); }
			const st = fs.statSync(file);
			res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'x-sha256': await hashFile(file), 'cache-control': 'no-store' });
			if (req.method === 'HEAD') { return res.end(); }
			log('GET', name, st.size, who);
			return fs.createReadStream(file).pipe(res);
		}
		if (req.method === 'PUT') { return await receive(req, res, name, file, who); }
		return send(res, 405, { error: 'method not allowed' });
	} catch (e) {
		log('ERR', req.method, req.url, e);
		if (!res.headersSent) { send(res, 500, { error: 'server error' }); }
	}
});
server.requestTimeout = 30 * 60e3;
server.headersTimeout = 60e3;
server.listen(PORT, HOST, () => log(`lab drop on ${HOST}:${PORT}, folder ${DIR}`));
for (const sig of ['SIGINT', 'SIGTERM']) { process.on(sig, () => server.close(() => process.exit(0))); }

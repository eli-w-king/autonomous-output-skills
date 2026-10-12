#!/usr/bin/env node
/* Check a variation lab's manifest.json and stills against the review page contract.
 *
 *   node check-manifest.mjs <lab dir | manifest.json>... [options]
 *
 * Options
 *   --live              also check that the lab's server answers at http://127.0.0.1:<port><path>
 *   --desktop=<WxH>     the desktop still size (default 1440x900); 2x and 3x captures pass too
 *   --phone=<WxH>       the phone still size (default 390x844); 2x and 3x captures pass too
 *   --allow-dashes      do not fail on em or en dashes in the manifest's text
 *   --ignore=<a,b>      more lab paths that never change what the page shows (for example sheets,tools)
 *
 * Errors: a missing or malformed field, duplicate ids, a baseline, pick or family that names no variation, a missing
 * still or one of the wrong size, a commit the repository does not have, dashes in the text, or (with --live) a
 * server that does not answer. Warnings: lab files changed or uncommitted since the commit the stills show (retake
 * them), or a commit outside the current branch. Exits 1 when any lab has an error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opts = {};
const targets = [];
for (const a of argv) {
	const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
	if (m) { opts[m[1]] = m[2] ?? true; } else { targets.push(a); }
}
if (opts.help || opts.h || targets.length === 0) {
	const lines = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n');
	const head = lines.slice(1, lines.findIndex(l => l.trim() === '*/'));
	console.log(head.map(l => l.replace(/^\/\* ?/, '').replace(/^ \* ?/, '').replace(/^ \*$/, '')).join('\n').trim());
	process.exit(targets.length === 0 && !opts.help && !opts.h ? 2 : 0);
}

function size(spec, fallback) {
	const m = /^(\d+)x(\d+)$/.exec(String(spec ?? fallback));
	if (!m) { console.error(`bad size: ${spec} (use WxH, for example 1440x900)`); process.exit(2); }
	return [Number(m[1]), Number(m[2])];
}
const SIZES = { desktop: size(opts.desktop, '1440x900'), phone: size(opts.phone, '390x844') };
const DASH = /[\u2013\u2014]/;

function imageSize(file) {
	const b = fs.readFileSync(file);
	if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') {
		return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
	}
	if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) { i++; continue; }
			const marker = b[i + 1];
			if (marker === 0xff) { i++; continue; }
			if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
			const len = b.readUInt16BE(i + 2);
			const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
			if (sof) { return { type: 'jpeg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; }
			i += 2 + len;
		}
	}
	return null;
}

function git(cwd, ...args) {
	try {
		// No optional locks: labs belong to other agents, and a status refresh must never write to their index.
		const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
		return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return null;
	}
}

async function answers(url) {
	try {
		const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
		return res.status < 400 ? null : `HTTP ${res.status}`;
	} catch (e) {
		return e.cause?.code || e.name || 'no answer';
	}
}

async function check(target) {
	const errors = [];
	const warnings = [];
	const isFile = fs.existsSync(target) && fs.statSync(target).isFile();
	const dir = path.resolve(isFile ? path.dirname(target) : target);
	const file = isFile ? path.resolve(target) : path.join(dir, 'manifest.json');
	let m;
	try {
		m = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		errors.push(`${path.relative(process.cwd(), file) || file}: ${e.code === 'ENOENT' ? 'not found' : e.message}`);
		return { name: target, errors, warnings };
	}
	const name = typeof m.lab === 'string' && m.lab ? m.lab : target;
	const text = (v) => typeof v === 'string' && v.trim().length > 0;
	const dashes = (where, v) => {
		if (!opts['allow-dashes'] && typeof v === 'string' && DASH.test(v)) { errors.push(`${where} has an em or en dash`); }
	};

	for (const k of ['lab', 'title', 'question', 'path', 'commit', 'updated']) {
		if (!text(m[k])) { errors.push(`"${k}" must be a non-empty string`); }
	}
	if (text(m.path) && !m.path.startsWith('/')) { warnings.push(`"path" should start with "/" (it is joined to the lab's origin)`); }
	if (m.port !== undefined && !(Number.isInteger(m.port) && m.port > 0 && m.port < 65536)) { errors.push(`"port" must be a port number`); }
	if (text(m.updated) && Number.isNaN(Date.parse(m.updated))) { errors.push(`"updated" is not an ISO time: ${m.updated}`); }
	dashes('"question"', m.question);
	dashes('"title"', m.title);
	if (m.params !== undefined) {
		if (typeof m.params !== 'object' || m.params === null || Array.isArray(m.params)) { errors.push(`"params" must be an object of descriptions`); }
		else { for (const [k, v] of Object.entries(m.params)) { dashes(`params.${k}`, v); } }
	}

	let families = null;
	if (m.families !== undefined) {
		if (!Array.isArray(m.families)) { errors.push(`"families" must be an array`); }
		else {
			families = new Set();
			m.families.forEach((f, i) => {
				if (!text(f?.id) || !text(f?.title)) { errors.push(`families[${i}] needs an id and a title`); return; }
				if (families.has(f.id)) { errors.push(`family "${f.id}" is listed twice`); }
				families.add(f.id);
				dashes(`family "${f.id}"`, f.title);
			});
		}
	}

	const ids = new Set();
	let stills = 0;
	if (!Array.isArray(m.variations) || m.variations.length === 0) {
		errors.push(`"variations" must be a non-empty array`);
	} else {
		m.variations.forEach((v, i) => {
			const at = text(v?.id) ? `variation "${v.id}"` : `variations[${i}]`;
			if (typeof v?.id === 'number') { errors.push(`${at}: "id" must be a string ("${v.id}"), as ?v= reads it`); }
			else if (!text(v?.id)) { errors.push(`${at}: needs an "id"`); }
			else if (ids.has(v.id)) { errors.push(`${at}: the id is used twice`); }
			if (text(v?.id)) { ids.add(v.id); }
			if (!text(v?.title)) { errors.push(`${at}: needs a "title" (a short name)`); }
			if (!text(v?.summary)) { errors.push(`${at}: needs a "summary" (one or two plain sentences)`); }
			dashes(`${at} title`, v?.title);
			dashes(`${at} summary`, v?.summary);
			if (families) {
				if (v?.family === undefined) { warnings.push(`${at}: no "family", but the lab lists families`); }
				else if (!families.has(v.family)) { errors.push(`${at}: family "${v.family}" is not in "families"`); }
			}
			for (const device of ['desktop', 'phone']) {
				const rel = v?.still?.[device];
				if (!text(rel)) { errors.push(`${at}: needs still.${device}`); continue; }
				const abs = path.resolve(dir, rel);
				if (!fs.existsSync(abs)) { errors.push(`${at}: still.${device} not found: ${rel}`); continue; }
				const img = imageSize(abs);
				if (!img) { errors.push(`${at}: still.${device} is not a PNG or JPEG: ${rel}`); continue; }
				const [ew, eh] = SIZES[device];
				const k = img.w / ew;
				if (!(Number.isInteger(k) && k >= 1 && k <= 3 && img.h === eh * k)) {
					errors.push(`${at}: still.${device} is ${img.w}x${img.h}, expected ${ew}x${eh} (or 2x, 3x): ${rel}`);
				}
				stills++;
			}
		});
	}
	for (const k of ['baseline', 'picked']) {
		if (m[k] !== undefined && m[k] !== null && !ids.has(m[k])) {
			errors.push(`"${k}" is "${m[k]}", which is not a variation id (use null when there is none)`);
		}
	}

	if (text(m.commit)) {
		const top = git(dir, 'rev-parse', '--show-toplevel');
		if (top === null) {
			warnings.push(`not in a git repository, so the commit was not checked`);
		} else if (git(dir, 'rev-parse', '--verify', '--quiet', `${m.commit}^{commit}`) === null) {
			errors.push(`commit ${m.commit} is not in this repository`);
		} else {
			if (git(dir, 'merge-base', '--is-ancestor', m.commit, 'HEAD') === null) {
				warnings.push(`commit ${m.commit} is not in the current branch's history`);
			}
			const ignore = typeof opts.ignore === 'string' ? opts.ignore.split(',').filter(Boolean) : [];
			const skip = ['stills', 'manifest.json', '*.md', ...ignore].map(p => `:(exclude)${p}`);
			const few = (list) => list.slice(0, 4).join(', ') + (list.length > 4 ? ', ...' : '');
			const changed = git(dir, 'diff', '--name-only', '--relative', m.commit, 'HEAD', '--', '.', ...skip);
			if (changed) {
				const list = changed.split('\n');
				warnings.push(`${list.length} lab file(s) changed since ${m.commit}, the commit the stills show (${few(list)}): retake the stills if the page changed`);
			}
			const dirty = git(dir, 'status', '--porcelain', '--', '.', ...skip);
			if (dirty) {
				const list = dirty.split('\n').map(l => path.basename(l.trim().replace(/^\S+\s+/, '')));
				warnings.push(`uncommitted changes in the lab (${few(list)}): commit, then retake the stills`);
			}
		}
	}

	if (opts.live) {
		if (!Number.isInteger(m.port) || !text(m.path)) { errors.push(`--live needs "port" and "path"`); }
		else {
			const url = `http://127.0.0.1:${m.port}${m.path}`;
			const why = await answers(url);
			if (why) { errors.push(`the server does not answer at ${url} (${why})`); }
		}
	}

	return { name, errors, warnings, ids: ids.size, stills, commit: m.commit };
}

let failed = 0;
for (const t of targets) {
	const r = await check(t);
	for (const e of r.errors) { console.log(`error: ${r.name}: ${e}`); }
	for (const w of r.warnings) { console.log(`warn: ${r.name}: ${w}`); }
	if (r.errors.length) {
		failed++;
		console.log(`FAIL ${r.name}: ${r.errors.length} error(s)`);
	} else {
		const extra = r.warnings.length ? ` (${r.warnings.length} warning(s))` : '';
		console.log(`ok ${r.name}: ${r.ids} variations, ${r.stills} stills, commit ${r.commit}${extra}`);
	}
}
process.exit(failed ? 1 : 0);

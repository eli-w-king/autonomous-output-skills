#!/usr/bin/env node
/* Install the autonomous skills on a dev box, or any machine that only uses them, and keep them current. The Mac
 * that maintains the skills uses sync-skills.py instead, which also harvests the edits sessions make there.
 *
 *   node install-devbox.mjs [--schedule] [--every <hours>] [--repo <dir>] [--url <git url>] [--skills <dir>] [--force]
 *
 * It clones the public repo into ~/.copilot/autonomous-output-skills, or pulls it (fast-forward only), then copies
 * every skill (a top-level folder with a SKILL.md) into ~/.copilot/skills. A skill is replaced only when it differs,
 * and the replaced copy moves to ~/.copilot/skills-backup/devbox-<time>/ first, so an edit a session made there is
 * never lost. Other skills in ~/.copilot/skills are left alone. COPILOT_HOME moves ~/.copilot. Each run appends one
 * line to ~/.copilot/install-devbox.log. A session's skill list is read when it starts; a skill's text is read when
 * it loads, so an update reaches running sessions that load the skill afterwards.
 *
 *   --schedule   also rerun every --every hours (default 4): on Windows a scheduled task for this user, with no
 *                window and no admin rights; elsewhere it prints a crontab line to add
 *   --force      run even where sync-skills.py manages the skills (the maintainer's Mac)
 *
 * Exit codes: 0 installed or already current, 1 error, 2 installed from the checkout but the pull failed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const usage = code => {
	const lines = fs.readFileSync(SELF, 'utf8').split('\n');
	const head = lines.slice(1, lines.findIndex(l => l.trim() === '*/'));
	console.log(head.map(l => l.replace(/^\/\* ?/, '').replace(/^ \* ?/, '').replace(/^ \*$/, '')).join('\n').trim());
	process.exit(code);
};
const die = msg => { console.error(`install-devbox: ${msg}`); process.exit(1); };

const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === '-h' || a === '--help') { usage(0); }
	if (a === '--schedule' || a === '--force') { opt[a.slice(2)] = true; continue; }
	const m = /^--(repo|url|skills|every)(?:=(.*))?$/.exec(a);
	if (!m) { die(`unknown argument ${a}; run with --help`); }
	opt[m[1]] = m[2] ?? argv[++i];
	if (opt[m[1]] === undefined) { die(`${a} needs a value`); }
}

const COPILOT = process.env.COPILOT_HOME ? path.resolve(process.env.COPILOT_HOME) : path.join(os.homedir(), '.copilot');
const REPO = path.resolve(opt.repo || path.join(COPILOT, 'autonomous-output-skills'));
const URL = opt.url || 'https://github.com/eli-w-king/autonomous-output-skills.git';
const SKILLS = path.resolve(opt.skills || path.join(COPILOT, 'skills'));
const HOME = path.dirname(SKILLS);
const BACKUPS = path.join(HOME, 'skills-backup');
const STAGING = path.join(HOME, '.skills-staging');
const LOG = path.join(HOME, 'install-devbox.log');
const EVERY = Number(opt.every || 4);
if (!(EVERY >= 1 && EVERY <= 24)) { die('--every takes 1 to 24 hours'); }

if (!opt.skills && !opt.force && fs.existsSync(path.join(COPILOT, 'skill-miner', 'installed-manifest.json'))) {
	die('sync-skills.py manages the skills on this machine; run python3 tools/sync-skills.py install, or pass --force');
}

const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const git = (...args) => spawnSync('git', args, { env: gitEnv, encoding: 'utf8' });
const firstLine = r => {
	const lines = String(r.stderr || r.stdout || r.error || '').trim().split('\n');
	return lines.find(l => /^(fatal|error):/.test(l)) || lines[0];
};
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const retry = fn => {
	for (let attempt = 1; ; attempt++) {
		try { return fn(); } catch (e) {
			// Windows refuses to move a folder while another process has a file in it open.
			if (attempt >= 6 || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(e.code)) { throw e; }
			sleep(500 * attempt);
		}
	}
};
const log = line => {
	console.log(line);
	try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch { /* the log is a convenience */ }
};

// 1. The checkout
let pullFailed = '';
if (!fs.existsSync(path.join(REPO, '.git'))) {
	if (fs.existsSync(REPO) && fs.readdirSync(REPO).length) { die(`${REPO} exists and is not a git checkout`); }
	fs.mkdirSync(path.dirname(REPO), { recursive: true });
	const r = git('clone', '--quiet', URL, REPO);
	if (r.status !== 0) { die(`git clone ${URL} failed: ${firstLine(r)}`); }
} else {
	const r = git('-C', REPO, 'pull', '--ff-only', '--quiet');
	if (r.status !== 0) { pullFailed = firstLine(r) || 'git pull failed'; }
}
const head = git('-C', REPO, 'rev-parse', '--short', 'HEAD').stdout.trim() || 'unknown';

// 2. The skills
const SKIP = new Set(['.DS_Store', '__pycache__', '.git']);
const digest = dir => {
	if (!fs.existsSync(dir)) { return null; }
	const h = crypto.createHash('sha256');
	const walk = rel => {
		const entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).filter(e => !SKIP.has(e.name));
		for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) { walk(r); } else if (e.isFile()) { h.update(`${r}\0`); h.update(fs.readFileSync(path.join(dir, r))); h.update('\0'); }
		}
	};
	walk('');
	return h.digest('hex');
};
const skills = fs.readdirSync(REPO, { withFileTypes: true })
	.filter(d => d.isDirectory() && !d.name.startsWith('.') && fs.existsSync(path.join(REPO, d.name, 'SKILL.md')))
	.map(d => d.name).sort();
if (!skills.length) { die(`no skills in ${REPO}`); }

const stamp = new Date().toISOString().replace(/[-:.Z]/g, '').replace('T', '-');
const backup = path.join(BACKUPS, `devbox-${stamp}`);
const changed = [], failed = [];
let backedUp = false;
fs.mkdirSync(SKILLS, { recursive: true });
for (const s of skills) {
	const src = path.join(REPO, s), dst = path.join(SKILLS, s), tmp = path.join(STAGING, s);
	if (digest(src) === digest(dst)) { continue; }
	try {
		fs.rmSync(tmp, { recursive: true, force: true });
		fs.cpSync(src, tmp, { recursive: true, filter: f => !SKIP.has(path.basename(f)) });
		if (fs.existsSync(dst)) {
			fs.mkdirSync(backup, { recursive: true });
			retry(() => fs.renameSync(dst, path.join(backup, s)));
			backedUp = true;
		}
		try { retry(() => fs.renameSync(tmp, dst)); } catch (e) {
			if (fs.existsSync(path.join(backup, s)) && !fs.existsSync(dst)) { fs.renameSync(path.join(backup, s), dst); }
			throw e;
		}
		changed.push(s);
	} catch (e) {
		failed.push(`${s} (${e.code || e.message})`);
	}
}
fs.rmSync(STAGING, { recursive: true, force: true });

// Keep the newest ten of this tool's backups.
if (fs.existsSync(BACKUPS)) {
	const mine = fs.readdirSync(BACKUPS).filter(n => /^devbox-\d{8}-\d{9}$/.test(n)).sort();
	for (const old of mine.slice(0, Math.max(0, mine.length - 10))) { fs.rmSync(path.join(BACKUPS, old), { recursive: true, force: true }); }
}

log(`skills at ${head}: ${changed.length ? `updated ${changed.join(', ')}` : 'all current'}`
	+ `${backedUp ? `; previous copies in ${backup}` : ''}`
	+ `${failed.length ? `; FAILED ${failed.join(', ')}` : ''}`
	+ `${pullFailed ? `; pull failed (${pullFailed}), installed the checkout as it is` : ''}`);

// 3. The schedule
if (opt.schedule) {
	const node = fs.realpathSync(process.execPath);
	const script = fs.existsSync(path.join(REPO, 'tools', 'install-devbox.mjs')) ? path.join(REPO, 'tools', 'install-devbox.mjs') : SELF;
	if (process.platform === 'win32') {
		// conhost --headless runs the console app without opening a window on the user's desktop.
		const conhost = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe');
		const tr = `"${conhost}" --headless "${node}" "${script}"`;
		const r = spawnSync('schtasks', ['/Create', '/F', '/SC', 'HOURLY', '/MO', String(EVERY), '/TN', 'Autonomous skills update', '/TR', tr], { encoding: 'utf8' });
		if (r.status !== 0) { die(`schtasks failed: ${firstLine(r)}`); }
		log(`scheduled "Autonomous skills update" every ${EVERY} hours`);
	} else {
		console.log(`To rerun it every ${EVERY} hours, add this line with crontab -e:\n0 */${EVERY} * * * "${node}" "${script}" >/dev/null 2>&1`);
	}
}

process.exit(failed.length ? 1 : pullFailed ? 2 : 0);

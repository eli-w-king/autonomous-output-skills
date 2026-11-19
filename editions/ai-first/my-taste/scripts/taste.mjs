#!/usr/bin/env node
/* Helper for the AI-First edition of my-taste. It reads only this computer's agent sessions and writes only inside
 * this skill's folder.
 *
 *   node taste.mjs messages [--days 7 | --since <date>] [--max-chars 60000] [--per-message 1500]
 *       What the person typed to their agents, newest first. Left out: sub-agents and other agents (an agentId, or a
 *       source starting with "agent"), autopilot, system messages, text another session sent (create_session,
 *       send_message and the like), and automations: any session whose first message starts with "Weekly taste
 *       update" or has "[my-taste]". (The Agents window gives every turn a parentAgentTaskId, so that's no sign.)
 *   node taste.mjs backup                     copy SKILL.md to backups/SKILL-<time>.md here; prints the path
 *   node taste.mjs check                      the front matter and sections are intact, and no em or en dashes
 *   node taste.mjs restore                    put the newest backup back (the current file is backed up first)
 *   node taste.mjs report --text "<note>"     add a dated note to updates/<yyyy-mm-dd>.md here (or pipe it in)
 *
 * Sessions: <COPILOT_HOME or ~/.copilot>/session-state/<id>/events.jsonl. Exit codes: 0 ok, 1 failed, 2 usage error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(SKILL, 'SKILL.md');
const BACKUPS = path.join(SKILL, 'backups');
const expand = p => (p === '~' || /^~[\\/]/.test(p || '')) ? path.join(os.homedir(), p.slice(1)) : p;
const COPILOT = process.env.COPILOT_HOME ? path.resolve(expand(process.env.COPILOT_HOME)) : path.join(os.homedir(), '.copilot');
const SESSIONS = path.join(COPILOT, 'session-state');
const AUTOMATION = [/^\s*weekly taste update\b/i, /\[my-taste\]/i];
const RELAY = new Set(['send_message', 'send_remote_message', 'create_session', 'create_remote_session', 'task']);
const INJECTED = /<(skill-context|system_notification|system_reminder|system-reminder|reminder|attachments|current_datetime|mode_changed_notice|tools_changed_notice|autopilot_mode|todo_status|lsp_servers|context|environment_context)\b[^>]*>[\s\S]*?<\/\1>/gi;
const DASHES = /[\u2013\u2014]/;
const print = value => console.log(JSON.stringify(value, null, 1));
const pad = n => String(n).padStart(2, '0');
const day = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const stamp = d => `${day(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const clean = text => String(text || '').replace(INJECTED, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const same = text => clean(text).replace(/\s+/g, ' ').toLowerCase();

function options(argv) {
	const out = { text: [] };
	for (let i = 0; i < argv.length; i++) {
		const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
		if (!m) { throw new Error(`unexpected ${argv[i]}`); }
		const value = m[2] ?? argv[++i];
		if (value === undefined) { throw new Error(`--${m[1]} needs a value`); }
		if (m[1] === 'text') { out.text.push(value); } else { out[m[1]] = value; }
	}
	return out;
}

function lines(file) {
	try {
		return fs.readFileSync(file, 'utf8').split('\n');
	} catch {
		return [];
	}
}

// The project a session ran in, by its folder's name. A chat with no workspace runs in a folder named for its id
// (<COPILOT_HOME>/chats/<id>): that's just "chat", so no session id ends up in what gets shown or shared.
function project(dir) {
	const cwd = lines(path.join(dir, 'workspace.yaml')).map(l => /^cwd:\s*(.*)$/.exec(l)).find(Boolean);
	if (!cwd) { return ''; }
	const folder = cwd[1].trim().replace(/^['"]|['"]$/g, '');
	const name = path.basename(folder);
	const chat = path.basename(path.dirname(folder)) === 'chats' || /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name);
	return chat ? 'chat' : name;
}

function messages(opts) {
	const since = opts.since ? Date.parse(opts.since) : Date.now() - Number(opts.days || 7) * 86400000;
	if (Number.isNaN(since)) { throw new Error('--since needs a date like 2026-11-01'); }
	const maxChars = Number(opts['max-chars'] || 60000);
	const perMessage = Number(opts['per-message'] || 1500);
	let dirs = [];
	try {
		dirs = fs.readdirSync(SESSIONS, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(SESSIONS, d.name));
	} catch { /* no sessions yet */ }
	const relayed = new Set();
	const found = [];
	for (const dir of dirs) {
		const events = path.join(dir, 'events.jsonl');
		let mtime = 0;
		try { mtime = fs.statSync(events).mtimeMs; } catch { continue; }
		if (mtime < since - 86400000) { continue; }
		let first = true;
		let automation = false;
		const where = project(dir);
		for (const line of lines(events)) {
			const relay = line.includes('"tool.execution_start"');
			if (!relay && !line.includes('"user.message"')) { continue; }
			let e;
			try { e = JSON.parse(line); } catch { continue; }
			const data = e.data || {};
			if (e.type === 'tool.execution_start') {
				if (RELAY.has(data.toolName)) {
					let args = data.arguments;
					if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
					const sent = args && (args.message || args.prompt);
					if (typeof sent === 'string' && sent.trim()) { relayed.add(same(sent)); }
				}
				continue;
			}
			if (e.type !== 'user.message') { continue; }
			const text = clean(data.content);
			if (!text) { continue; }
			if (first) {
				automation = AUTOMATION.some(r => r.test(text));
				first = false;
			}
			const source = String(data.source || '');
			if (automation || AUTOMATION.some(r => r.test(text)) || source === 'autopilot' || source === 'system'
				|| source.startsWith('agent') || e.agentId) {
				continue;
			}
			const at = Date.parse(e.timestamp || '');
			if (Number.isNaN(at) || at < since) { continue; }
			found.push({ at, where, text });
		}
	}
	const seen = new Set();
	const kept = found.filter(m => !relayed.has(same(m.text)) && !seen.has(same(m.text)) && seen.add(same(m.text)))
		.sort((a, b) => b.at - a.at);
	const out = [];
	let used = 0;
	let shown = 0;
	for (const m of kept) {
		const body = m.text.length > perMessage ? `${m.text.slice(0, perMessage)} [trimmed]` : m.text;
		const d = new Date(m.at);
		const entry = `- ${day(d)} ${clock(d)}${m.where ? ` (${m.where})` : ''}: ${body.replace(/\n/g, '\n  ')}`;
		if (used + entry.length > maxChars) { break; }
		out.push(entry);
		used += entry.length;
		shown++;
	}
	console.log(`# What you typed to your agents, ${day(new Date(since))} to ${day(new Date())}`);
	console.log(`${shown} of ${kept.length} messages, newest first.\n`);
	if (out.length) { console.log(out.join('\n')); }
	return 0;
}

function backup() {
	if (!fs.existsSync(FILE)) { throw new Error(`no ${FILE}`); }
	fs.mkdirSync(BACKUPS, { recursive: true });
	let target = path.join(BACKUPS, `SKILL-${stamp(new Date())}.md`);
	for (let n = 2; fs.existsSync(target); n++) { target = path.join(BACKUPS, `SKILL-${stamp(new Date())}-${n}.md`); }
	fs.copyFileSync(FILE, target);
	if (fs.readFileSync(target, 'utf8') !== fs.readFileSync(FILE, 'utf8')) { throw new Error('the backup does not match'); }
	print({ ok: true, backup: target });
	return 0;
}

function check() {
	const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
	const problems = [];
	const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
	if (!front) {
		problems.push('the front matter at the top is missing or broken');
	} else {
		if (!/^name:\s*my-taste\s*$/m.test(front[1])) { problems.push('the front matter needs "name: my-taste"'); }
		const description = /^description:\s*(.+)$/m.exec(front[1]);
		if (!description) { problems.push('the front matter needs a description'); } else if (description[1].length > 1024) { problems.push('the description is over 1024 characters'); }
	}
	for (const heading of ['## Rules', '## Update my taste']) {
		if (!text.includes(`\n${heading}\n`)) { problems.push(`the "${heading.slice(3)}" section is missing`); }
	}
	text.split('\n').forEach((line, i) => { if (DASHES.test(line)) { problems.push(`line ${i + 1} has an em or en dash`); } });
	print({ ok: !problems.length, file: FILE, problems });
	return problems.length ? 1 : 0;
}

function restore() {
	const names = fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS).filter(n => /^SKILL-.*\.md$/.test(n)).sort() : [];
	const latest = names.filter(n => !n.includes('-replaced')).pop();
	if (!latest) { throw new Error('there is no backup to restore'); }
	const replaced = path.join(BACKUPS, `SKILL-${stamp(new Date())}-replaced.md`);
	fs.copyFileSync(FILE, replaced);
	fs.copyFileSync(path.join(BACKUPS, latest), FILE);
	print({ ok: true, restored: path.join(BACKUPS, latest), replacedCopy: replaced });
	return 0;
}

function report(opts) {
	let text = opts.text.join('\n').trim();
	if (!text && !process.stdin.isTTY) { text = fs.readFileSync(0, 'utf8').trim(); }
	if (!text) { throw new Error('report needs --text "<note>" (or the note on stdin)'); }
	const now = new Date();
	const file = path.join(SKILL, 'updates', `${day(now)}.md`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const head = fs.existsSync(file) ? '' : `# Taste update, ${day(now)}\n\n`;
	fs.appendFileSync(file, `${head}## ${clock(now)}\n\n${text}\n\n`);
	print({ ok: true, report: file });
	return 0;
}

const [command, ...rest] = process.argv.slice(2);
const commands = { messages, backup, check, restore, report };
if (!commands[command]) {
	const help = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
	console.log(help.slice(1, help.findIndex(l => l.trim() === '*/')).map(l => l.replace(/^\s?\*\s?/, '')).join('\n'));
	process.exitCode = 2;
} else {
	try {
		process.exitCode = commands[command](options(rest));
	} catch (error) {
		print({ ok: false, error: error.message });
		process.exitCode = /needs|unexpected/.test(error.message) ? 2 : 1;
	}
}

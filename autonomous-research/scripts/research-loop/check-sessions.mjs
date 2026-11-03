#!/usr/bin/env node
// Check agent sessions on this machine: model, effort and context at start, and any permission request that was
// never answered (a session waiting for an approval nobody can give). Reads ~/.copilot/session-state/*/events.jsonl.
//
//   node check-sessions.mjs --since 10            sessions created in the last 10 minutes
//   node check-sessions.mjs --match "<text>"   sessions whose first prompt contains the text
//   node check-sessions.mjs --id <session-id>
// Exit code 1 when any matched session has an unanswered permission request or is not on the expected settings
// (EXPECT_MODEL, default claude-opus-5.5; effort max; context long_context).
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = process.env.COPILOT_SESSION_STATE || join(homedir(), '.copilot', 'session-state');
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const sinceMin = Number(opt('since') ?? 0);
const match = opt('match');
const id = opt('id');
const EXPECT = { model: process.env.EXPECT_MODEL || 'claude-opus-5.5', effort: 'max', tier: 'long_context' };

let dirs = readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);
if (id) {
	dirs = dirs.filter(d => d === id);
}
const rows = [];
for (const d of dirs) {
	const f = join(ROOT, d, 'events.jsonl');
	if (!existsSync(f)) {
		continue;
	}
	const born = statSync(join(ROOT, d)).birthtimeMs;
	if (sinceMin && Date.now() - born > sinceMin * 60_000) {
		continue;
	}
	const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
	let start = null, model = null, prompt = '';
	const requested = new Map();
	const completed = new Set();
	for (const l of lines) {
		let e;
		try { e = JSON.parse(l); } catch { continue; }
		if (e.type === 'session.start') { start = e.data; }
		else if (e.type === 'session.model_change' && !model) { model = e.data; }
		else if (e.type === 'user.message' && !prompt) { prompt = String(e.data?.content ?? ''); }
		else if (e.type === 'permission.requested') { requested.set(e.data?.requestId ?? e.data?.id ?? e.id, { at: e.timestamp, kind: e.data?.permissionRequest?.kind ?? e.data?.kind, what: JSON.stringify(e.data?.permissionRequest ?? e.data).slice(0, 160) }); }
		else if (e.type === 'permission.completed') { completed.add(e.data?.requestId ?? e.data?.id); }
	}
	if (match && !prompt.includes(match)) {
		continue;
	}
	const pending = [...requested].filter(([k]) => !completed.has(k)).map(([, v]) => v);
	const m = start?.selectedModel ?? model?.newModel ?? '?';
	const effort = start?.reasoningEffort ?? model?.reasoningEffort ?? '?';
	const tier = start?.contextTier ?? model?.contextTier ?? '?';
	const ok = m === EXPECT.model && effort === EXPECT.effort && tier === EXPECT.tier && pending.length === 0;
	rows.push({ ok, session: d, model: m, effort, tier, permissionRequests: requested.size, unanswered: pending.length, firstUnanswered: pending[0], prompt: prompt.slice(0, 90).replace(/\s+/g, ' ') });
}
for (const r of rows) {
	console.log(`${r.ok ? 'OK  ' : 'BAD '} ${r.session} model=${r.model} effort=${r.effort} context=${r.tier} permissions=${r.permissionRequests} unanswered=${r.unanswered}${r.firstUnanswered ? ` first=${r.firstUnanswered.what}` : ''} | ${r.prompt}`);
}
if (!rows.length) {
	console.log('no matching sessions');
}
process.exit(rows.length && rows.every(r => r.ok) ? 0 : 1);

#!/usr/bin/env node
// Poll Outset for newly completed interviews and (optionally) wake an agent.
//
//   node watch-studies.mjs               # poll once, harvest, and report
//   node watch-studies.mjs --wake-agent  # also open a new agent window on new data
//   node watch-studies.mjs --dry-run     # poll + harvest, never wake an agent
//   node watch-studies.mjs --status      # show what is being watched, poll nothing
//   node watch-studies.mjs --reset       # forget seen interviews (re-harvest all)
//
// Design notes:
//   - The watcher is deliberately DUMB and durable. It does not analyze; it
//     detects, harvests to disk, and records state. Analysis is the agent's job.
//     A crashed or half-finished analysis must never lose the fact that an
//     interview arrived, so "seen" is committed only after the transcript is
//     safely on disk.
//   - State lives in its own SQLite file, not the session DB, because it must
//     outlive any single agent session.
//   - Real human interviews only. SYNTH (AI-simulated) interviews are excluded:
//     they are guide QA, not research data, and must never silently enter a
//     findings pipeline.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { outsetMcp, outsetRest, loadEnv } from './research-client.mjs';

const ROOT = join(homedir(), 'Desktop', 'Automated User Testing');
const STATE_DIR = join(homedir(), '.copilot', 'research-state');
const DB_PATH = join(STATE_DIR, 'watch.db');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const STATUS_ONLY = args.has('--status');
const WAKE_AGENT = args.has('--wake-agent');

mkdirSync(STATE_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
	CREATE TABLE IF NOT EXISTS seen_interview (
		interview_id TEXT PRIMARY KEY,
		study_id     TEXT NOT NULL,
		study_name   TEXT,
		completed_at TEXT,
		transcript_path TEXT,
		harvested_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS poll_log (
		polled_at TEXT NOT NULL,
		studies_checked INTEGER,
		new_interviews INTEGER,
		error TEXT
	);
`);

if (args.has('--reset')) {
	db.exec('DELETE FROM seen_interview');
	console.log('Cleared seen-interview state. Next poll re-harvests everything.');
	process.exit(0);
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

if (STATUS_ONLY) {
	const rows = db.prepare(`
		SELECT study_name, COUNT(*) n, MAX(completed_at) latest
		FROM seen_interview GROUP BY study_id ORDER BY latest DESC
	`).all();
	const last = db.prepare('SELECT * FROM poll_log ORDER BY polled_at DESC LIMIT 1').get();
	console.log(`State: ${DB_PATH}`);
	console.log(`Last poll: ${last ? `${last.polled_at} (${last.new_interviews} new)` : 'never'}`);
	if (!rows.length) {
		console.log('No interviews harvested yet.');
	}
	for (const r of rows) {
		console.log(`  ${String(r.n).padStart(3)}  ${r.study_name ?? '?'}  latest ${(r.latest ?? '').slice(0, 19)}`);
	}
	process.exit(0);
}

async function poll() {
	const env = loadEnv();
	const mcp = await outsetMcp(env);

	// Only studies that are actually collecting data are worth polling.
	const { body } = await outsetRest('/v1/studies/', env);
	const active = (body?.results ?? []).filter(s => s.active);
	if (!active.length) {
		console.log('No active studies. Nothing to watch.');
		return { checked: 0, fresh: [] };
	}

	const isSeen = db.prepare('SELECT 1 FROM seen_interview WHERE interview_id = ?');
	const markSeen = db.prepare(`
		INSERT OR REPLACE INTO seen_interview
		(interview_id, study_id, study_name, completed_at, transcript_path, harvested_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`);

	const fresh = [];

	for (const study of active) {
		let cursor = null;
		const pending = [];

		// Newest-first, so stop as soon as we hit something already harvested.
		page: do {
			const res = await mcp.callJson('list_interviews', {
				study_id: study.id,
				completed_only: true,
				interview_types: ['USER'],
				limit: 50,
				...(cursor ? { cursor } : {}),
			});
			for (const iv of res.interviews ?? []) {
				if (isSeen.get(iv.id)) {
					break page;
				}
				pending.push(iv);
			}
			cursor = res.next_cursor ?? null;
		} while (cursor);

		if (!pending.length) {
			continue;
		}

		const dir = join(ROOT, slug(study.name), 'transcripts');
		mkdirSync(dir, { recursive: true });

		for (const iv of pending.reverse()) {
			const path = join(dir, `${slug(iv.name)}-${iv.id.slice(0, 8)}.json`);
			try {
				const transcript = await mcp.callJson('get_interview_transcript', { interview_id: iv.id });
				writeFileSync(path, JSON.stringify(transcript, null, 2));
			} catch (err) {
				// Leave it unseen so the next poll retries rather than losing it.
				console.error(`  ! harvest failed for ${iv.name}: ${err.message}`);
				continue;
			}
			markSeen.run(iv.id, study.id, study.name, iv.completed_at ?? null, path, new Date().toISOString());
			fresh.push({ study: study.name, studyId: study.id, name: iv.name, path, lowQuality: iv.is_low_quality, fraudScore: iv.fraud_score });
		}
	}

	return { checked: active.length, fresh };
}

let result = { checked: 0, fresh: [] };
let error = null;
try {
	result = await poll();
} catch (err) {
	error = err.message;
	console.error(`Poll failed: ${error}`);
}

db.prepare('INSERT INTO poll_log (polled_at, studies_checked, new_interviews, error) VALUES (?,?,?,?)')
	.run(new Date().toISOString(), result.checked, result.fresh.length, error);

if (error) {
	process.exit(1);
}

console.log(`Checked ${result.checked} active study(ies). New completed interviews: ${result.fresh.length}`);
for (const f of result.fresh) {
	const flags = [f.lowQuality ? 'LOW-QUALITY' : null, f.fraudScore > 0.5 ? `FRAUD ${f.fraudScore}` : null]
		.filter(Boolean).join(' ');
	console.log(`  + ${f.study} / ${f.name} ${flags}`);
}

if (!result.fresh.length || DRY_RUN || !WAKE_AGENT) {
	process.exit(0);
}

// Wake an agent with enough context to resume synthesis unaided.
const byStudy = new Map();
for (const f of result.fresh) {
	byStudy.set(f.study, (byStudy.get(f.study) ?? 0) + 1);
}
const summary = [...byStudy].map(([s, n]) => `${n} new completed interview(s) in "${s}"`).join('; ');
const prompt = [
	`New Outset research results landed: ${summary}.`,
	`Transcripts are already harvested to ${ROOT}/<study-slug>/transcripts/.`,
	`Follow the autonomous-research-synthesis skill:`,
	`analyze into ranked findings, triangulate with telemetry, and prepare a DRAFT issue.`,
	`Do not post anything publicly without explicit approval.`,
].join(' ');

execFile('code-insiders', ['chat', '--mode', 'agent', '--new-window', prompt], err => {
	console.log(err ? `Could not wake agent: ${err.message}` : 'Agent session started.');
});

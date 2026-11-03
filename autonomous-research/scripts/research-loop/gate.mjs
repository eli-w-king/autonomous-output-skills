#!/usr/bin/env node
// The quick gate check, for mornings when an approval is expected. For every active study it records whether each arm
// of the current round is live, publishable, waiting for an admin's approval or not ready. Then it launches each arm
// that is live or publishable, through launch.mjs, in that order.
// It does not take the run lock: launch.mjs holds a lock per arm and re-reads the ledger right before the click, so it
// is safe next to a long run, and a long run never delays a launch.
//   node gate.mjs [--study <slug>] [--no-launch]
// Submit for review is invisible to Outset's API, so whoever knows records it; this calls nothing on Outset, launches
// nothing, and refreshes the morning folder:
//   node gate.mjs --review submitted|not-submitted [--study <slug>] [--arms A,B] [--at <ISO time>] [--by <who said so>]
//                 [--note <short note shown with the state>]
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStudies, loadStudy } from './lib/state.mjs';
import { outsetEveryday } from './lib/outset.mjs';
import { checkGates, recordReview } from './lib/gate.mjs';
import { recordStalls } from './lib/stalls.mjs';
import { CONFIG } from './lib/config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const only = opt('study');
const DONE = new Set(['done', 'stopped', 'handed-to-owner']);

function refreshMorning() {
	if (!CONFIG.morningDir) {
		return 'no morning folder configured';
	}
	const m = spawnSync(process.execPath, [join(HERE, 'morning.mjs')], { encoding: 'utf8', timeout: 10 * 60e3 });
	return m.status === 0 ? 'updated' : `failed: ${(m.stderr || m.error?.message || '').slice(0, 200)}`;
}

if (opt('review')) {
	const active = listStudies().filter(x => (!only || x === only) && !DONE.has(loadStudy(x).status));
	if (active.length !== 1) {
		console.error(`--review needs exactly one active study; pass --study (active: ${active.join(', ') || 'none'})`);
		process.exit(2);
	}
	try {
		const arms = await recordReview(active[0], opt('arms')?.split(',').map(x => x.trim()).filter(Boolean), { state: opt('review'), at: opt('at') ?? new Date().toISOString(), by: opt('by') ?? 'unknown', note: opt('note') });
		console.log(JSON.stringify({ at: new Date().toISOString(), study: active[0], review: opt('review'), arms, morning: refreshMorning() }, null, 1));
		process.exit(0);
	} catch (e) {
		console.error(e.message);
		process.exit(2);
	}
}

const everyday = await outsetEveryday();
const summary = { at: new Date().toISOString(), studies: [] };
for (const slug of listStudies().filter(x => !only || x === only)) {
	const study = loadStudy(slug);
	if (DONE.has(study.status)) {
		continue;
	}
	try {
		summary.studies.push({ slug, arms: await checkGates(slug, study, everyday, { launch: !argv.includes('--no-launch') }) });
	} catch (e) {
		summary.studies.push({ slug, error: e.message });
	}
}
// A launch, a gate that changed, or a stalled session shows in the morning folder right away.
try {
	summary.stalls = recordStalls().stalls.length;
} catch (e) {
	summary.stalls = `scan failed: ${e.message}`;
}
if (CONFIG.morningDir) {
	summary.morning = refreshMorning();
}
console.log(JSON.stringify(summary, null, 1));
process.exit(summary.studies.some(s => s.error) ? 1 : 0);

// Whether the loop has anything to do. The schedule only needs to run while something is being researched: a study
// that has not ended, or an ended study whose close-out still waits for an email confirmation. With nothing to do, a
// run exits in seconds (no browser, no platform API), and the run's agent asks, once, for the schedule to be turned off.
// Starting a new study turns it back on (references/research-loop.md).
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { STATE_DIR } from './env.mjs';
import { pending } from './confirm.mjs';

export const ENDED = new Set(['done', 'stopped', 'handed-to-owner']);
export const IDLE_FILE = join(STATE_DIR, 'idle.json');

/** studies: [{ slug, study, ledger }] -> { idle, active, confirming } */
export function activity(studies) {
	const active = studies.filter(x => !ENDED.has(x.study.status)).map(x => x.slug);
	const confirming = studies.filter(x => ENDED.has(x.study.status) && pending(x.ledger).length).map(x => x.slug);
	return { idle: !active.length && !confirming.length, active, confirming };
}

export function loadIdle() {
	try {
		return JSON.parse(readFileSync(IDLE_FILE, 'utf8'));
	} catch {
		return {};
	}
}

export function saveIdle(state) {
	mkdirSync(dirname(IDLE_FILE), { recursive: true });
	const tmp = `${IDLE_FILE}.tmp-${process.pid}`;
	writeFileSync(tmp, JSON.stringify(state, null, 1));
	renameSync(tmp, IDLE_FILE);
}

export const idleFileExists = () => existsSync(IDLE_FILE);

/** The one request to turn the schedule off, in plain words. */
export function disableRequest(schedule, ended) {
	const name = schedule?.name ?? 'the research loop schedule';
	return `Research loop: nothing is being researched now${ended.length ? ` (${ended.join(', ')} ended)` : ''}. Please disable the automation "${name}"${schedule?.id ? ` (${schedule.id})` : ''}. Starting a new study turns it back on.`;
}

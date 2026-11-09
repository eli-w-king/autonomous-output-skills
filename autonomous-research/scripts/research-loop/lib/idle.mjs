// Whether the loop has anything to do. The schedule only needs to run while something is being researched: a study
// that has not ended, an ended study whose close-out still waits for an email confirmation, or an ended study not yet
// contributed back to the research wiki. With nothing to do, a run exits in seconds (no browser, no platform API), and
// the run's agent asks, once, for the schedule to be turned off. Starting a new study turns it back on
// (references/research-loop.md).
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { STATE_DIR } from './env.mjs';
import { CONFIG } from './config.mjs';
import { pending } from './confirm.mjs';

export const ENDED = new Set(['done', 'stopped', 'handed-to-owner']);
export const IDLE_FILE = join(STATE_DIR, 'idle.json');

/** An ended study (done or handed to its owner) still to be contributed back to the research wiki: no pull request yet,
 * and not marked blocked (wiki-pr.mjs block). Only when contributing is configured. */
export const contributionOpen = (study, configured = !!CONFIG.priorResearch?.contribute) =>
	configured && ['done', 'handed-to-owner'].includes(study.status) && !study.wiki_pr?.url && study.wiki_pr?.state !== 'blocked';

/** studies: [{ slug, study, ledger }] -> { idle, active, confirming, contributing } */
export function activity(studies, { contribute = !!CONFIG.priorResearch?.contribute } = {}) {
	const active = studies.filter(x => !ENDED.has(x.study.status)).map(x => x.slug);
	const confirming = studies.filter(x => ENDED.has(x.study.status) && pending(x.ledger).length).map(x => x.slug);
	const contributing = studies.filter(x => contributionOpen(x.study, contribute)).map(x => x.slug);
	return { idle: !active.length && !confirming.length && !contributing.length, active, confirming, contributing };
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

// Study state (study.json) and the spend ledger (ledger.json), one folder per study. Every write takes the study's
// lock and replaces the file atomically, so the scheduled run, a launcher and a chat never interleave writes.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLock } from './lock.mjs';
import { STATE_DIR } from './env.mjs';
import { CONFIG } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOOP_ROOT = CONFIG.home;
export const STUDIES_DIR = resolve(process.env.RESEARCH_LOOP_STUDIES || join(LOOP_ROOT, 'studies'));

export const studyDir = slug => join(STUDIES_DIR, slug);
const lockFor = slug => join(STATE_DIR, 'locks', `study-${slug}.lock`);

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJsonAtomic(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(value, null, '\t')}\n`);
	renameSync(tmp, path);
}

export function loadStudy(slug) {
	return readJson(join(studyDir(slug), 'study.json'));
}

export function loadLedger(slug) {
	const p = join(studyDir(slug), 'ledger.json');
	return existsSync(p) ? readJson(p) : { study: slug, entries: [] };
}

/** Read-modify-write the study under its lock. fn receives the study and may return a value. */
export async function updateStudy(slug, fn) {
	return withLock(lockFor(slug), async () => {
		const study = loadStudy(slug);
		const out = await fn(study);
		study.updated_at = new Date().toISOString();
		writeJsonAtomic(join(studyDir(slug), 'study.json'), study);
		return out;
	}, { label: `study ${slug}` });
}

export async function appendLedger(slug, entry) {
	return withLock(lockFor(slug), async () => {
		const ledger = loadLedger(slug);
		const e = { at: new Date().toISOString(), ...entry };
		ledger.entries.push(e);
		writeJsonAtomic(join(studyDir(slug), 'ledger.json'), ledger);
		return e;
	}, { label: `ledger ${slug}` });
}

export function listStudies() {
	if (!existsSync(STUDIES_DIR)) {
		return [];
	}
	return readdirSync(STUDIES_DIR).filter(n => existsSync(join(STUDIES_DIR, n, 'study.json')));
}

export function findArm(study, round, arm) {
	const r = study.rounds.find(x => x.n === Number(round));
	if (!r) {
		throw new Error(`${study.slug} has no round ${round}`);
	}
	const a = r.arms.find(x => x.arm === arm);
	if (!a) {
		throw new Error(`${study.slug} round ${round} has no arm ${arm}`);
	}
	return { round: r, arm: a };
}

export function addHistory(study, event, extra = {}) {
	study.history ??= [];
	study.history.push({ at: new Date().toISOString(), event, ...extra });
}

// How an arm is named in reports, the issue and the morning summary: the design's own label when the study sets one
// (for example "study B (list view)", matching the study names people see), so design codes stay out of what people read.
export const armLabel = (study, arm) => study.designs?.[arm.design]?.label
	?? `${arm.arm}: ${arm.design}${study.designs?.[arm.design]?.name ? ` (${study.designs[arm.design].name})` : ''}`;
export const armSlug = (study, arm) => study.designs?.[arm.design]?.slug ?? `${arm.arm}-${arm.design}`;
export const capitalize = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
// The name a design's still is published under: the design's slug replaces its id prefix, so a capture named
// "<design id>-1-overview.png" is published as "<slug>-1-overview.png". Stills of today's product keep their names.
export const publishedStill = (study, arm, file) => {
	const slug = study.designs?.[arm.design]?.slug;
	return slug && file?.startsWith(`${arm.design}-`) ? `${slug}-${file.slice(arm.design.length + 1)}` : file;
};



// Private progress for this machine's setup: the person's choices, what the agent reported, the first check (so the
// page can say "already set up") and the last check. It lives in <copilot-home>/extension-data/<canvas-id>/, which
// every Copilot host on the machine shares, so several sessions can read and write it at once:
// - each write goes to a unique temp file in the same folder and is renamed over the target, so readers never see
//   half a file;
// - every read checks the format marker, the version and the shape, and a file that fails is reported and left
//   alone, never overwritten;
// - updates in this process run one at a time, each on a fresh read of the file.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SetupError } from './errors.mjs';
import { CANVAS_ID, REPORT_STATUSES } from './catalog.mjs';

export const FORMAT = 'autonomous-setup-checklist';
export const VERSION = 1;
export const FILE_NAME = 'setup-progress.json';

const META_FIELDS = ['title', 'subtitle', 'presenter', 'checkInChat', 'skillsDir'];
const CHECK_OK = [true, false, null];

export function copilotHome(env = process.env, homedir = os.homedir()) {
	const value = env.COPILOT_HOME;
	return typeof value === 'string' && value !== '' ? value : path.join(homedir, '.copilot');
}

export function dataDir(home) {
	return path.join(home, 'extension-data', CANVAS_ID);
}

export function tilde(file, home = os.homedir()) {
	const text = String(file);
	return text === home || text.startsWith(home + path.sep) ? '~' + text.slice(home.length) : text;
}

export function emptyRecord(now) {
	return { format: FORMAT, version: VERSION, createdAt: now, updatedAt: now, meta: {}, baseline: null, choices: {}, reports: {}, step: null, lastCheck: null, welcomedAt: null };
}

class ShapeError extends Error {}

function expect(condition, where) {
	if (!condition) {
		throw new ShapeError(where);
	}
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value, max = 4000) => typeof value === 'string' && value.length <= max;
const isStringOrNull = (value, max) => value === null || isString(value, max);
const isId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);

function checkMap(value, where, each) {
	expect(isObject(value), where);
	for (const [key, entry] of Object.entries(value)) {
		expect(isId(key), `${where} key`);
		each(entry, `${where}.${key}`);
	}
}

// Throws ShapeError naming the first part that doesn't fit. Unknown extra fields are allowed, so a newer plugin can
// add one without older copies calling the file corrupt.
export function checkShape(data) {
	expect(isObject(data), 'the top level');
	expect(isString(data.createdAt, 64) && isString(data.updatedAt, 64), 'the timestamps');
	expect(isObject(data.meta), 'meta');
	for (const field of META_FIELDS) {
		expect(data.meta[field] === undefined || isStringOrNull(data.meta[field], 2048), `meta.${field}`);
	}
	expect(data.baseline === null || (isObject(data.baseline) && isString(data.baseline.at, 64) && Array.isArray(data.baseline.ids) && data.baseline.ids.every(isId)), 'baseline');
	checkMap(data.choices, 'choices', (entry, where) => expect(typeof entry === 'boolean', where));
	checkMap(data.reports, 'reports', (entry, where) => {
		expect(isObject(entry) && REPORT_STATUSES.includes(entry.status), `${where}.status`);
		expect(isStringOrNull(entry.note, 2000), `${where}.note`);
		expect(Array.isArray(entry.commands) && entry.commands.every((c) => isString(c, 1000)), `${where}.commands`);
		expect(isString(entry.at, 64), `${where}.at`);
	});
	expect(data.step === null || (isObject(data.step) && isId(data.step.id) && isString(data.step.at, 64)), 'step');
	// When the person closed the welcome. Files from before the welcome don't have it.
	expect(data.welcomedAt === undefined || isStringOrNull(data.welcomedAt, 64), 'welcomedAt');
	if (data.lastCheck !== null) {
		const check = data.lastCheck;
		expect(isObject(check), 'lastCheck');
		expect(isStringOrNull(check.at, 64) && isString(check.receivedAt, 64), 'lastCheck times');
		expect(check.os === null || (isObject(check.os) && isStringOrNull(check.os.name, 200) && (check.os.arch === undefined || isStringOrNull(check.os.arch, 32))), 'lastCheck.os');
		checkMap(check.items, 'lastCheck.items', (entry, where) => {
			expect(isObject(entry) && CHECK_OK.includes(entry.ok), `${where}.ok`);
			expect(typeof entry.required === 'boolean' && isString(entry.detail, 2000), `${where}.detail`);
		});
		checkMap(check.steps, 'lastCheck.steps', (entry, where) => expect(isObject(entry) && isString(entry.status, 32), where));
	}
}

export function parseRecord(text, file) {
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		throw corrupt(file, 'it isn\'t valid JSON');
	}
	if (!isObject(data) || data.format !== FORMAT) {
		throw corrupt(file, 'it isn\'t a setup checklist file');
	}
	if (data.version !== VERSION) {
		throw new SetupError('storage_unsupported', `The saved setup progress in ${tilde(file)} is version ${JSON.stringify(data.version)}, and this plugin reads version ${VERSION}. Update the plugin, or move that file aside to start fresh. It was left as is.`);
	}
	try {
		checkShape(data);
	} catch (error) {
		if (error instanceof ShapeError) {
			throw corrupt(file, `${error.message} doesn't look right`);
		}
		throw error;
	}
	return data;
}

function corrupt(file, why) {
	return new SetupError('storage_corrupt', `The saved setup progress in ${tilde(file)} can't be read: ${why}. It was left as is. Move it aside or delete it, then open the canvas again to start fresh.`);
}

function ioError(file, verb, error) {
	return new SetupError('storage_failed', `Couldn't ${verb} the setup progress in ${tilde(file)} (${error.code || error.message}).`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function renameWithRetry(fs, from, to) {
	// On Windows a reader holding the target open makes rename fail for a moment.
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.rename(from, to);
			return;
		} catch (error) {
			if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
				throw error;
			}
			await sleep(20 * (attempt + 1));
		}
	}
}

export async function writeAtomic(file, text, fs = fsp) {
	const dir = path.dirname(file);
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
	try {
		await fs.writeFile(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
		await renameWithRetry(fs, temp, file);
	} catch (error) {
		await fs.rm(temp, { force: true }).catch(() => {});
		throw error;
	}
}

export class Store {
	constructor({ home, now = () => new Date().toISOString(), fs = fsp }) {
		this.dir = dataDir(home);
		this.file = path.join(this.dir, FILE_NAME);
		this.now = now;
		this.fs = fs;
		this.queue = Promise.resolve();
		this.lastWriteMtimeMs = null;
	}

	// The record, or null when nothing was saved yet.
	async read() {
		let text;
		try {
			text = await this.fs.readFile(this.file, 'utf8');
		} catch (error) {
			if (error.code === 'ENOENT') {
				return null;
			}
			throw ioError(this.file, 'read', error);
		}
		return parseRecord(text, this.file);
	}

	async mtimeMs() {
		try {
			return (await this.fs.stat(this.file)).mtimeMs;
		} catch {
			return null;
		}
	}

	// Runs mutate(record) on a fresh read and saves the result. mutate changes the record in place.
	update(mutate) {
		const run = async () => {
			const current = (await this.read()) || emptyRecord(this.now());
			const next = structuredClone(current);
			mutate(next);
			next.updatedAt = this.now();
			try {
				checkShape(next);
			} catch (error) {
				throw new SetupError('storage_failed', `The setup progress wasn't saved: ${error.message} was invalid.`);
			}
			try {
				await writeAtomic(this.file, JSON.stringify(next, null, 1) + '\n', this.fs);
			} catch (error) {
				throw ioError(this.file, 'save', error);
			}
			this.lastWriteMtimeMs = await this.mtimeMs();
			return next;
		};
		const result = this.queue.then(run, run);
		this.queue = result.catch(() => {});
		return result;
	}
}

// The checklist's shared state for this Copilot home: one model per process, used by every open canvas instance.
// It loads the saved record, runs the check one at a time, applies what the agent and the page change, and tells the
// instances when anything changed (including changes another session saved to the same file).
import { EventEmitter } from 'node:events';
import { SetupError } from './errors.mjs';
import { compactCheck } from './runner.mjs';
import { emptyRecord } from './store.mjs';
import { buildView, summarize, resolveItemId, isOptionalId, baselineIds, knownStepIds, deriveItem, itemDefs, osFromRecord, statusText } from './checklist.mjs';

const RECHECK_AFTER_MS = 15000;
const WATCH_EVERY_MS = 2000;

export class SetupModel extends EventEmitter {
	constructor({ store, runner, platform = process.platform, now = () => new Date().toISOString(), log = () => {} }) {
		super();
		this.store = store;
		this.runner = runner;
		this.platform = platform;
		this.now = now;
		this.log = log;
		this.record = null;
		this.checking = false;
		this.checkError = null;
		this.inflight = null;
		this.lastCheckDone = 0;
		this.watchers = 0;
		this.timer = null;
		this.seenMtime = null;
	}

	// Reads the record from disk. Throws SetupError when it's corrupt or can't be read.
	async load() {
		this.record = (await this.store.read()) || emptyRecord(this.now());
		this.seenMtime = await this.store.mtimeMs();
		this.emit('change');
		return this.record;
	}

	async save(mutate) {
		this.record = await this.store.update(mutate);
		this.seenMtime = this.store.lastWriteMtimeMs;
		this.emit('change');
		return this.record;
	}

	view(extra = {}) {
		return buildView(this.record || emptyRecord(this.now()), { platform: this.platform, checking: this.checking, checkError: this.checkError, ...extra });
	}

	summary() {
		const record = this.record || emptyRecord(this.now());
		return summarize(this.view(), record);
	}

	statusLine() {
		const view = this.view();
		if (view.check.checking && !view.check.at) {
			return 'Checking your setup';
		}
		if (view.allDone) {
			return 'All set';
		}
		return `${view.progress.done} of ${view.progress.total} done`;
	}

	async setMeta(fields) {
		const keys = Object.keys(fields);
		if (!keys.length) {
			return this.record;
		}
		const changedDir = 'skillsDir' in fields && (this.record?.meta?.skillsDir ?? null) !== fields.skillsDir;
		await this.save((record) => {
			for (const key of keys) {
				if (fields[key] === null) {
					delete record.meta[key];
				} else {
					record.meta[key] = fields[key];
				}
			}
		});
		if (changedDir) {
			this.lastCheckDone = 0;
		}
		return this.record;
	}

	// Runs the check unless one ran a moment ago (or is running). Never throws; the error shows on the page.
	refreshSoon() {
		if (this.inflight || Date.now() - this.lastCheckDone < RECHECK_AFTER_MS) {
			return this.inflight || Promise.resolve();
		}
		return this.refresh().catch(() => {});
	}

	// Runs the check (or joins the one that's running) and saves the result. Throws SetupError when it fails.
	refresh({ quick = false } = {}) {
		if (this.inflight) {
			return this.inflight;
		}
		this.checking = true;
		this.emit('change');
		const run = async () => {
			try {
				const skillsDir = this.record?.meta?.skillsDir || null;
				const { data } = await this.runner.run({ skillsDir, quick });
				const compact = compactCheck(data, this.now());
				await this.save((record) => {
					record.lastCheck = compact;
					if (!record.baseline) {
						record.baseline = { at: compact.receivedAt, ids: baselineIds(record, this.platform) };
					}
				});
				this.checkError = null;
				return this.record;
			} catch (error) {
				this.checkError = error instanceof SetupError ? error.message : `The setup check failed: ${error.message}`;
				this.log(this.checkError, 'warning');
				throw error instanceof SetupError ? error : new SetupError('check_failed', this.checkError);
			} finally {
				this.checking = false;
				this.lastCheckDone = Date.now();
				this.inflight = null;
				this.emit('change');
			}
		};
		this.inflight = run();
		return this.inflight;
	}

	async setItem({ id, status, note, commands }) {
		await this.ensureLoaded();
		const resolved = resolveItemId(id, this.record);
		if (!resolved) {
			throw new SetupError('unknown_item', `There's no item ${JSON.stringify(id)}. Use one of: ${this.knownItemIds().join(', ')}.`);
		}
		const optional = isOptionalId(resolved, this.record);
		await this.save((record) => {
			record.reports[resolved] = { status, note: note || null, commands: commands || [], at: this.now() };
			if (optional) {
				record.choices[resolved] = status !== 'skipped';
			}
		});
		return this.itemSummary(resolved);
	}

	async setStep({ id }) {
		await this.ensureLoaded();
		// Any item setItem accepts works here too, including one that stays hidden until it's reported (Homebrew).
		const item = id === 'none' ? null : resolveItemId(id, this.record);
		const resolved = id === 'none' ? 'none' : (item || id);
		if (!item && !knownStepIds(this.record).includes(resolved)) {
			throw new SetupError('unknown_step', `There's no item or group ${JSON.stringify(id)}. Use an item id from getState, a group (basics, workshop, connections, yours, optional), or none.`);
		}
		await this.save((record) => {
			record.step = resolved === 'none' ? null : { id: resolved, at: this.now() };
		});
		return { step: this.view().step };
	}

	// The welcome shows the first time the canvas opens on this computer, until the person closes it.
	welcomePending() {
		return !this.record?.welcomedAt;
	}

	async markWelcomed() {
		await this.ensureLoaded();
		if (!this.record.welcomedAt) {
			await this.save((record) => {
				record.welcomedAt = record.welcomedAt || this.now();
			});
		}
		return this.record;
	}

	async setChoice({ id, on }) {
		await this.ensureLoaded();
		if (!isOptionalId(id, this.record)) {
			throw new SetupError('invalid_input', `${id} isn't an optional item.`);
		}
		await this.save((record) => {
			record.choices[id] = on;
		});
		return this.itemSummary(id);
	}

	async ensureLoaded() {
		if (!this.record) {
			await this.load();
		}
	}

	knownItemIds() {
		return itemDefs(this.record).defs.map((def) => def.id);
	}

	itemSummary(id) {
		const def = itemDefs(this.record).defs.find((entry) => entry.id === id);
		const item = def ? deriveItem(def, { record: this.record, os: osFromRecord(this.record, this.platform), checking: this.checking, meta: this.record.meta }) : null;
		const view = this.view();
		return {
			ok: true,
			item: item ? { id: item.id, label: item.label, status: item.status, statusText: statusText(item), tryIt: item.tryIt ? item.tryIt.text : undefined } : { id },
			progress: view.progress,
		};
	}

	// Picks up changes other sessions save to the same file, while a page is listening.
	watch() {
		this.watchers++;
		if (!this.timer) {
			this.timer = setInterval(() => this.poll().catch(() => {}), WATCH_EVERY_MS);
			this.timer.unref?.();
		}
		return () => {
			this.watchers = Math.max(0, this.watchers - 1);
			if (!this.watchers && this.timer) {
				clearInterval(this.timer);
				this.timer = null;
			}
		};
	}

	async poll() {
		const mtime = await this.store.mtimeMs();
		if (mtime !== null && mtime !== this.seenMtime) {
			try {
				await this.load();
			} catch (error) {
				this.log(error.message, 'warning');
			}
		}
	}

	dispose() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.removeAllListeners();
	}
}

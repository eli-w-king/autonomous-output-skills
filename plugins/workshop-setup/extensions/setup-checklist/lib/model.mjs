// The checklist's shared state for this Copilot home: one model per process, used by every open canvas instance.
// It loads the saved record, runs the check one at a time, applies what the agent and the page change, and tells the
// instances when anything changed (including changes another session saved to the same file).
import { EventEmitter } from 'node:events';
import { SetupError } from './errors.mjs';
import { compactCheck } from './runner.mjs';
import { emptyRecord } from './store.mjs';
import { buildView, summarize, resolveItemId, isOptionalId, baselineIds, knownStepIds, deriveItem, itemDefs, osFromRecord, statusText } from './checklist.mjs';
import { AF_ITEM_BY_ID, FLOW_MODES, FLOW_STEPS, WORKSHOPS, applySelection, emptyFlow, flowOf, flowSummary, flowView, installList, usesAiFirst } from './ai-first.mjs';

const RECHECK_AFTER_MS = 15000;
const WATCH_EVERY_MS = 2000;

export class SetupModel extends EventEmitter {
	constructor({ store, runner, aiFirstRunner = null, platform = process.platform, now = () => new Date().toISOString(), log = () => {} }) {
		super();
		this.store = store;
		this.runner = runner;
		this.aiFirstRunner = aiFirstRunner;
		this.waiters = 0;
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
		const record = this.record || emptyRecord(this.now());
		const view = buildView(record, { platform: this.platform, checking: this.checking, checkError: this.checkError, ...extra });
		if (usesAiFirst(record)) {
			view.flow = flowView(record, { os: view.os });
		}
		return view;
	}

	summary() {
		const record = this.record || emptyRecord(this.now());
		const out = summarize(this.view(), record);
		if (record.aiFirst) {
			out.path = usesAiFirst(record) ? 'ai-first' : 'full';
			out.flow = flowSummary(record, osFromRecord(record, this.platform));
		}
		return out;
	}

	statusLine() {
		const view = this.view();
		if (view.flow && !view.flow.confirmed) {
			return view.flow.pick === 'microsoft' ? 'Waiting for a Microsoft sign-in' : 'Waiting for your choices';
		}
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
				const runner = usesAiFirst(this.record) && this.aiFirstRunner ? this.aiFirstRunner : this.runner;
				const { data } = await runner.run({ skillsDir, quick, folder: this.record?.aiFirst?.folder || null });
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

	// Which workshop path this open shows. "choose" and "ai-first" show the AI-First flow; anything else (no workshop in
	// the open input) is the full setup, exactly as before, even on a machine that once showed the flow.
	async setWorkshop({ workshop = null, workshopDir } = {}) {
		await this.ensureLoaded();
		const mode = FLOW_MODES.includes(workshop) ? workshop : null;
		const current = this.record.aiFirst || null;
		if (!mode && !current) {
			return this.record;
		}
		const before = usesAiFirst(this.record);
		await this.save((record) => {
			const flow = { ...emptyFlow(), ...(record.aiFirst || {}) };
			flow.mode = mode;
			if (workshopDir !== undefined) {
				flow.folder = workshopDir;
			}
			if (mode === 'ai-first' && !flow.pick) {
				flow.pick = 'ai-first';
				flow.step = 'ready';
			}
			record.aiFirst = flow;
		});
		if (before !== usesAiFirst(this.record)) {
			this.lastCheckDone = 0;
		}
		return this.record;
	}

	// What the page changes in the flow: the workshop it picks, the step it's on, the optional switches, Confirm, and
	// continuing to the Microsoft setup once its sign-in passed.
	async flowAction({ action, id = null, on = null, step = null }) {
		await this.ensureLoaded();
		if (!usesAiFirst(this.record)) {
			throw new SetupError('invalid_input', 'This checklist isn\'t showing the workshop picker.');
		}
		const flow = flowOf(this.record);
		if (flow.confirmedAt) {
			throw new SetupError('invalid_input', 'Your choices are confirmed, and the agent is setting them up.');
		}
		const next = { ...flow };
		if (action === 'pick') {
			if (!WORKSHOPS.some((workshop) => workshop.id === id)) {
				throw new SetupError('invalid_input', `Pick one of: ${WORKSHOPS.map((workshop) => workshop.id).join(', ')}.`);
			}
			next.pick = id;
			next.step = id === 'microsoft' ? 'gate' : 'ready';
		} else if (action === 'step') {
			const allowed = flow.pick === 'microsoft' ? ['pick', 'gate'] : flow.pick ? FLOW_STEPS : ['pick'];
			if (!allowed.includes(step)) {
				throw new SetupError('invalid_input', `That step isn't available now. Go to one of: ${allowed.join(', ')}.`);
			}
			next.step = step;
		} else if (action === 'select') {
			if (AF_ITEM_BY_ID.get(id)?.required !== false || typeof on !== 'boolean') {
				throw new SetupError('invalid_input', 'Only the optional items have a switch.');
			}
			next.selections = applySelection(flow.selections, id, on);
		} else if (action === 'confirm') {
			if (flow.pick !== 'ai-first' || flow.step !== 'after') {
				throw new SetupError('invalid_input', 'Confirm is on the last step.');
			}
			next.confirmedAt = this.now();
			// The list as the person confirmed it, so it doesn't change as tools land.
			next.plan = installList(this.record, osFromRecord(this.record, this.platform)).rows
				.filter((row) => row.state === 'locked' || row.state === 'on').map((row) => row.id);
		} else if (action === 'continue') {
			const gate = this.record.lastCheck?.items?.microsoft_signin;
			if (flow.pick !== 'microsoft' || gate?.ok !== true) {
				throw new SetupError('invalid_input', 'Sign in with your Microsoft account first.');
			}
			next.continuedAt = this.now();
		} else {
			throw new SetupError('invalid_input', 'Unknown step action.');
		}
		await this.save((record) => {
			record.aiFirst = { ...emptyFlow(), ...(record.aiFirst || {}), ...next };
		});
		if (action === 'confirm') {
			this.emit('confirmed', flowSummary(this.record, osFromRecord(this.record, this.platform)));
		}
		if (action === 'continue') {
			this.lastCheckDone = 0;
		}
		return this.flowResult(this.flowStatus());
	}

	flowStatus() {
		const flow = flowOf(this.record);
		if (flow.confirmedAt) {
			return 'confirmed';
		}
		if (flow.continuedAt) {
			return 'microsoft';
		}
		return flow.pick === 'microsoft' ? 'gate' : 'waiting';
	}

	flowResult(status) {
		return { status, flow: flowSummary(this.record, osFromRecord(this.record, this.platform)) };
	}

	// Resolves when the person clicks Confirm, continues to the Microsoft setup, or picks Microsoft (so the agent can
	// start its sign-in), or when timeoutMs passes. Returns { status, flow }.
	async waitForFlow({ timeoutMs = 120000 } = {}) {
		await this.ensureLoaded();
		const start = this.flowStatus();
		if (start === 'confirmed' || start === 'microsoft') {
			return this.flowResult(start);
		}
		return new Promise((resolve) => {
			let finished = false;
			const finish = () => {
				if (finished) {
					return;
				}
				finished = true;
				clearTimeout(timer);
				this.off('change', onChange);
				this.waiters = Math.max(0, this.waiters - 1);
				resolve(this.flowResult(this.flowStatus()));
			};
			const onChange = () => {
				const now = this.flowStatus();
				if (now === 'confirmed' || now === 'microsoft' || (now === 'gate' && start !== 'gate')) {
					finish();
				}
			};
			const timer = setTimeout(finish, timeoutMs);
			this.waiters++;
			this.on('change', onChange);
		});
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

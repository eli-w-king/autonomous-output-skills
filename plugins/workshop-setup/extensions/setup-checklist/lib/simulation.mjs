// A pretend first-time setup that hosts can watch before a workshop: a new Mac or Windows PC goes from the canvas's
// first check to "all set". It's driven the way the setup skill drives the real canvas (setStep, setItem, refresh),
// the check results read like check-setup.py's, and the page draws it with the same code as a real setup.
// Everything lives in memory: it never runs check-setup.py, never reads or writes the saved progress, and never
// installs anything.
import { EventEmitter } from 'node:events';
import { SetupError } from './errors.mjs';
import { SetupModel } from './model.mjs';
import { checkShape, emptyRecord } from './store.mjs';

export const SIMULATE_OS = ['mac', 'windows'];
export const SIMULATION_STATES = ['waiting', 'playing', 'paused', 'done', 'failed'];

const LABELS = { mac: 'A new Mac', windows: 'A new Windows PC' };
const AI_FIRST_FOLDER = '~/ai-first-workshop';
const OS_INFO = { mac: { name: 'macOS', version: '26.1', arch: 'arm64' }, windows: { name: 'Windows 11', version: '10.0.26100', arch: 'AMD64' } };
// What GitHub's device sign-in shows; the agent sends it to the canvas as the thing to copy.
const SIGN_IN_CODE = '7F3A-21C9';
const META_FIELDS = ['title', 'subtitle', 'presenter', 'checkInChat'];
const FULL_CHECK_MS = 2400;
const QUICK_CHECK_MS = 700;
const FEED = 'https://packagefeedproxy.microsoft.io/npm/';
const SKILLS = ['autonomous-computer-use', 'autonomous-demos', 'autonomous-prototypes', 'autonomous-research', 'autonomous-runs',
	'autonomous-setup', 'autonomous-variations', 'my-taste', 'my-voice'];
const SETTINGS = ['sessions.chat.experimental.workspaceOptOut', 'chat.agentHost.computerUse.enabled', 'chat.remoteSessions.tools.enabled',
	'chat.agent.sandbox.enabled', 'chat.canvases.enabled', 'dictation.model'];

export class Cancelled extends Error {}

// Timestamps that always move forward, so a check that ends after a report always reads as newer, even at test speed.
export function monotonicNow() {
	let last = 0;
	return () => {
		last = Math.max(Date.now(), last + 1);
		return new Date(last).toISOString();
	};
}

// Waits that hold while paused, and reject with Cancelled once the run is thrown away.
export class Clock {
	constructor({ speed = 1 } = {}) {
		this.speed = speed;
		this.paused = false;
		this.cancelled = false;
		this.waits = new Set();
	}

	sleep(ms) {
		if (this.cancelled) {
			return Promise.reject(new Cancelled());
		}
		return new Promise((resolve, reject) => {
			const wait = { left: Math.max(0, ms / this.speed), since: 0, timer: null, resolve, reject };
			this.waits.add(wait);
			if (!this.paused) {
				this.arm(wait);
			}
		});
	}

	arm(wait) {
		wait.since = Date.now();
		wait.timer = setTimeout(() => {
			this.waits.delete(wait);
			wait.resolve();
		}, wait.left);
	}

	pause() {
		if (this.paused || this.cancelled) {
			return;
		}
		this.paused = true;
		for (const wait of this.waits) {
			clearTimeout(wait.timer);
			wait.left = Math.max(0, wait.left - (Date.now() - wait.since));
		}
	}

	resume() {
		if (!this.paused || this.cancelled) {
			return;
		}
		this.paused = false;
		for (const wait of this.waits) {
			this.arm(wait);
		}
	}

	cancel() {
		this.cancelled = true;
		for (const wait of this.waits) {
			clearTimeout(wait.timer);
			wait.reject(new Cancelled());
		}
		this.waits.clear();
	}
}

// The same interface as Store, kept in memory.
export class MemoryStore {
	constructor({ now = () => new Date().toISOString() } = {}) {
		this.now = now;
		this.record = null;
		this.writes = 0;
		this.lastWriteMtimeMs = null;
	}

	async read() {
		return this.record ? structuredClone(this.record) : null;
	}

	async mtimeMs() {
		return this.record ? this.writes : null;
	}

	async update(mutate) {
		const next = structuredClone(this.record || emptyRecord(this.now()));
		mutate(next);
		next.updatedAt = this.now();
		try {
			checkShape(next);
		} catch (error) {
			throw new SetupError('storage_failed', `The simulation's progress wasn't kept: ${error.message} was invalid.`);
		}
		this.record = next;
		this.writes += 1;
		this.lastWriteMtimeMs = this.writes;
		return structuredClone(next);
	}
}

const ok = (detail, extra = {}) => ({ ok: true, required: true, detail, ...extra });
const missing = (detail) => ({ ok: false, required: true, detail });
const unknown = (detail) => ({ ok: null, required: true, detail });
const optional = (result, detail) => ({ ok: result, required: false, detail });

// What check-setup.py reports when the canvas first opens on a new machine. By then the person has signed in to
// VS Code Insiders, pasted the workshop settings and installed this plugin, and the setup prompt has cloned the
// skills (on a Mac, that git installed the Command Line Tools; on Windows, Python came first).
export function firstCheck(os) {
	const items = {
		vscode_insiders: ok('VS Code Insiders 1.147.0-insider'),
		copilot_signin: unknown('ask: signed in to GitHub with Copilot in VS Code Insiders?'),
		gh: missing('GitHub CLI is not installed'),
		node: missing('Node.js is not installed'),
		npm: missing('npm is not installed (it comes with Node.js)'),
		yarn: missing('Yarn is not installed'),
		ffmpeg: missing('ffmpeg is not installed'),
		ffprobe: missing('ffprobe is not installed'),
		settings: ok(`${SETTINGS.length} of ${SETTINGS.length} workshop settings are set`, { matching: SETTINGS, missing: [], different: [] }),
		practice: { ok: null, required: false, detail: 'later, at the workshop', later: true },
		skills: missing(`0 skills installed; not installed yet: ${SKILLS.join(', ')}; no private copy yet (origin is eli-w-king/autonomous-output-skills)`),
		weekly: unknown('set up in the Agents window\'s Automations; its proof run (--check-run) shows it works'),
		workiq: missing('no Work IQ plugin installed'),
		playwright: missing('no Playwright MCP server yet'),
		computer_use: ok('setting on; plugin not downloaded yet'),
		dictation: ok('cloud dictation (MAI)'),
		azure: optional(null, 'Azure CLI is not installed'),
		devbox: optional(false, 'no Dev Box project yet'),
		research: optional(null, 'no research.env'),
	};
	if (os === 'windows') {
		return {
			...items,
			package_manager: optional(true, 'winget v1.12.350'),
			git: missing('git 2.52.0.windows.1; commit identity missing: name, email'),
			powershell: missing('execution policy: Windows PowerShell Restricted'),
			python: missing('Python 3.13.11, no Pillow'),
			browser: ok('Edge 157.0.4341.46'),
		};
	}
	return {
		...items,
		command_line_tools: ok('Command Line Tools installed'),
		package_manager: optional(false, 'Homebrew is not installed'),
		git: missing('git 2.49.0; commit identity missing: name, email'),
		python: missing('Python 3.9.6, no Pillow'),
		browser: missing('no Chrome or Edge'),
	};
}

export class PretendMachine {
	constructor(os) {
		this.os = os;
		this.items = firstCheck(os);
	}

	set(id, entry) {
		this.items[id] = entry;
	}

	// check-setup.py's JSON, as the runner hands it to the model.
	snapshot(time) {
		return { time, os: { ...OS_INFO[this.os] }, items: structuredClone(this.items), steps: {} };
	}
}

const MB = 1000 * 1000;
const size = (download, disk) => ({ download: Math.round(download * MB), disk: Math.round(disk * MB) });
const zero = { download: 0, disk: 0 };

// What ai-first.mjs check reports when the canvas first opens on a new laptop for the AI-First path: the person pasted
// the workshop settings, and the setup prompt downloaded the skills into the workshop folder. Nothing else is here.
export function firstAiFirstCheck(os) {
	const mac = os === 'mac';
	const items = {
		git: { ok: false, required: true, needed: true, detail: 'not on this computer yet', size: mac ? size(41.6, 25) : size(39.8, 97) },
		node: { ok: false, required: true, needed: true, detail: 'not on this computer yet', size: mac ? size(30.6, 162) : size(41.2, 118) },
		gh: { ok: false, required: true, needed: true, installed: false, signed_in: false, detail: 'not on this computer yet', size: mac ? size(14.1, 40) : size(15.2, 42) },
		skills: { ok: false, required: true, needed: true, detail: '0 of 4 installed', size: size(0.07, 0.07) },
		skill_runs: { ok: false, required: false, needed: true, detail: 'not installed', size: size(0.02, 0.02) },
		skill_research: { ok: false, required: false, needed: true, detail: 'not installed', size: size(0.03, 0.03) },
		skill_taste: { ok: false, required: false, needed: true, detail: 'not installed', size: size(0.02, 0.02) },
		excalidraw: { ok: false, required: true, needed: true, detail: 'not created yet', size: size(40, 200) },
		resources: { ok: false, required: true, needed: true, detail: 'not copied yet', size: size(0.03, 0.03) },
		demo_tools: { ok: false, required: true, needed: true, detail: mac ? 'uses your Google Chrome' : 'uses your Microsoft Edge', browser: mac ? 'Google Chrome' : 'Microsoft Edge', size: mac ? size(24.2, 67) : size(34.8, 101) },
		computer_use: { ok: true, required: true, needed: false, detail: 'on; its helper downloads the first time you use it', size: mac ? size(5.3, 6) : size(2.5, 3) },
		dictation: { ok: true, required: true, needed: false, detail: 'cloud dictation is on (nothing to download)', size: zero },
		taste_weekly: { ok: null, required: false, needed: true, detail: 'set up after the skills, in the Agents window', size: zero },
		microsoft_signin: { ok: false, required: false, detail: 'not signed in with GitHub CLI yet', size: zero },
	};
	return items;
}

export class PretendAiFirstMachine {
	constructor(os) {
		this.os = os;
		this.items = firstAiFirstCheck(os);
	}

	set(id, changes) {
		this.items[id] = { ...this.items[id], ...changes };
	}

	snapshot(time) {
		return {
			time,
			path: 'ai-first',
			os: { ...OS_INFO[this.os] },
			folder_display: AI_FIRST_FOLDER,
			free_bytes: 38 * 1000 * MB,
			settings: { missing: [] },
			items: structuredClone(this.items),
			steps: {},
		};
	}
}

export class PretendRunner {
	constructor({ machine, clock, now }) {
		this.machine = machine;
		this.clock = clock;
		this.now = now;
	}

	async run({ quick = false } = {}) {
		await this.clock.sleep(quick ? QUICK_CHECK_MS : FULL_CHECK_MS);
		return { data: this.machine.snapshot(this.now()), script: 'simulation' };
	}
}

// The setup, beat by beat, in the order the setup skill works: the machine, the skills and the weekly update,
// Work IQ and Playwright (tested in a new session), Computer Use, dictation, then the optional items they turn on.
// Voice and taste aren't in v1, so they stay off the list. Each wait is how long a beat stays on screen at 1x.
export async function firstTimeSetup(s) {
	const mac = s.os === 'mac';
	const via = mac ? 'with Homebrew' : 'with winget';

	// The canvas runs the check as it opens. The plan goes out in the chat, and they reply go.
	await s.check({ quick: false });
	await s.wait(3000);

	// Machine. They're chatting with Copilot, so they're signed in.
	await s.on('copilot_signin', 900);
	s.set('copilot_signin', ok('signed in to GitHub with Copilot in VS Code Insiders'));
	await s.check();
	if (mac) {
		// The agent opens Homebrew's installer, and they type their Mac password in its window (the canvas's steps).
		await s.on('package_manager');
		await s.report('package_manager', 'working', 2000, 'Downloading the Homebrew installer');
		await s.report('package_manager', 'needs-you', 7600);
		s.set('package_manager', optional(true, 'Homebrew 7.0.13'));
		await s.report('package_manager', 'working', 1400, 'Finishing the Homebrew setup');
		await s.check();
	} else {
		await s.on('powershell');
		await s.report('powershell', 'working', 1600, 'Letting PowerShell run npm and yarn');
		s.set('powershell', ok('execution policy: Windows PowerShell RemoteSigned'));
		await s.check();
	}
	await s.on('gh');
	await s.report('gh', 'working', 1800, `Installing GitHub CLI ${via}`);
	s.set('gh', missing('GitHub CLI is not signed in'));
	await s.report('gh', 'working', 1400, 'Starting the GitHub sign-in in your browser');
	await s.report('gh', 'needs-you', 8000, null, [SIGN_IN_CODE]);
	s.set('gh', ok('signed in as mona-designer (active)'));
	await s.check();
	await s.on('git');
	await s.report('git', 'working', 1500, 'Setting the name and email on your commits');
	s.set('git', ok(mac ? 'git 2.49.0' : 'git 2.52.0.windows.1'));
	await s.check();
	await s.on('node');
	await s.report('node', 'working', 2200, `Installing Node.js ${via}`);
	s.set('node', ok('Node 22.22.1'));
	// Managed Macs already point npm at Microsoft's package feed; on Windows the agent asks, then sets it.
	s.set('npm', ok(mac ? `npm 11.21.1, registry ${FEED}; public npm is blocked here`
		: 'npm 11.21.1, registry https://registry.npmjs.org/; public npm is blocked here; not on the package feed yet'));
	await s.check();
	if (!mac) {
		await s.on('npm');
		await s.report('npm', 'working', 1500, 'Pointing npm at Microsoft\'s package feed');
		s.set('npm', ok(`npm 11.21.1, registry ${FEED}; public npm is blocked here`));
		await s.check();
	}
	await s.on('yarn');
	await s.report('yarn', 'working', 1500, 'Installing Yarn 1 from the package feed');
	s.set('yarn', ok('Yarn 1.22.22'));
	await s.check();
	await s.on('python');
	await s.report('python', 'working', 1600, 'Adding Pillow to Python');
	s.set('python', ok(mac ? 'Python 3.9.6 with Pillow 11.2.1' : 'Python 3.13.11 with Pillow 11.2.1'));
	await s.check();
	await s.on('ffmpeg');
	await s.report('ffmpeg', 'working', 2400, `Installing FFmpeg ${via}`);
	s.set('ffmpeg', ok('ffmpeg 9.0.2'));
	s.set('ffprobe', ok('ffprobe 9.0.2'));
	await s.check();
	if (mac) {
		await s.on('browser');
		await s.report('browser', 'working', 2000, 'Installing Chrome with Homebrew');
		s.set('browser', ok('Chrome 157.0.8103.78'));
		await s.check();
	}

	// Their own copy of the skills, then the weekly update and its proof run.
	await s.on('skills');
	await s.report('skills', 'working', 2400, 'Making your private copy of the skills on GitHub');
	await s.report('skills', 'working', 2000, 'Installing the skills and scheduling the daily sync');
	s.set('skills', ok(`${SKILLS.length} skills installed; private copy mona-designer/autonomous-output-skills`));
	await s.report('skills', 'installed', 1200);
	await s.on('weekly');
	await s.report('weekly', 'working', 2000, 'Scheduling the weekly skill update');
	await s.report('weekly', 'working', 2400, 'Running it once to make sure it works');
	s.set('weekly', ok('the proof run passed'));
	await s.report('weekly', 'tested', 800);

	// Work IQ and Playwright load in new sessions, so both go in now and get tested in the next session.
	await s.on('workiq');
	await s.report('workiq', 'working', 2200, 'Installing the Work IQ plugins');
	s.set('workiq', ok('plugins: workiq, workiq-productivity'));
	await s.check();
	await s.on('playwright');
	await s.report('playwright', 'working', 2000, 'Adding the Playwright MCP server');
	s.set('playwright', ok('Playwright MCP server set up (Copilot: playwright)'));
	await s.check();

	// In the new session, they send each Try it prompt.
	await s.on('none', 2600);
	for (const id of ['skills', 'workiq', 'playwright']) {
		await s.on(id, 2600);
		await s.report(id, 'tested', 700);
	}

	await s.on('computer_use');
	await s.report('computer_use', 'needs-you', 7600);
	s.set('computer_use', ok('setting on; plugin downloaded'));
	await s.report('computer_use', 'installed', 2800);
	await s.report('computer_use', 'tested', 700);

	await s.on('dictation', 2800);
	await s.report('dictation', 'tested', 700);

	// The optional items: they switch on Azure on the canvas and leave the rest for later.
	await s.on('optional', 2800);
	await s.choose('azure', true);
	await s.wait(1400);
	await s.on('azure');
	await s.report('azure', 'working', 2000, `Installing Azure CLI ${via}`);
	s.set('azure', optional(false, 'not signed in'));
	await s.report('azure', 'working', 1200, 'Opening the Microsoft sign-in page in your browser');
	await s.report('azure', 'needs-you', 6400);
	s.set('azure', optional(true, 'signed in, a subscription is selected'));
	await s.check();
	await s.wait(2600);
	await s.report('azure', 'tested', 700);

	await s.on('none', 0);
}

// The AI-First path, beat by beat: the person reads the steps and confirms (with My taste and its weekly update
// switched on), then the agent installs, the person signs in to GitHub, and they try Computer Use and dictation.
export async function aiFirstSetup(s) {
	const mac = s.os === 'mac';
	const done = { needed: false, size: zero };
	await s.check({ quick: false });
	await s.wait(3200);
	await s.flow('pick', { id: 'ai-first' });
	await s.wait(3000);
	await s.flow('step', { step: 'install' });
	await s.wait(2400);
	await s.flow('select', { id: 'skill_taste', on: true });
	await s.wait(900);
	await s.flow('select', { id: 'taste_weekly', on: true });
	await s.wait(2600);
	await s.flow('step', { step: 'uninstall' });
	await s.wait(3000);
	await s.flow('step', { step: 'after' });
	await s.wait(3000);
	await s.flow('confirm');
	await s.wait(1200);

	await s.on('git');
	await s.report('git', 'working', 2200, mac ? 'Adding a small portable Git to your workshop folder' : 'Adding MinGit, Git for Windows\' portable build');
	s.set('git', { ok: true, ...done, detail: 'Git 2.56.1, installed by the setup', by: 'setup' });
	await s.check();
	await s.on('node');
	await s.report('node', 'working', 2400, 'Adding Node.js 26 to your workshop folder');
	s.set('node', { ok: true, ...done, detail: 'Node.js 26.13.1, installed by the setup', by: 'setup' });
	await s.check();
	await s.on('gh');
	await s.report('gh', 'working', 1600, 'Adding the GitHub CLI');
	s.set('gh', { installed: true, detail: 'GitHub CLI 2.105.0, not signed in yet', needed: false, size: zero });
	await s.report('gh', 'working', 1200, 'Starting the GitHub sign-in in your browser');
	await s.report('gh', 'needs-you', 8000, null, [SIGN_IN_CODE]);
	s.set('gh', { ok: true, signed_in: true, login: 'mona-designer', detail: 'signed in as mona-designer' });
	await s.check();

	await s.on('skills');
	await s.report('skills', 'working', 1600, 'Copying the four workshop skills');
	s.set('skills', { ok: true, ...done, detail: '4 of 4 installed' });
	s.set('skill_taste', { ok: true, ...done, detail: 'installed' });
	await s.check();
	await s.on('excalidraw');
	await s.report('excalidraw', 'working', 2400, 'Making your copy: mona-designer/excalidraw-case-study');
	await s.report('excalidraw', 'working', 2000, 'Turning on GitHub Pages for it');
	await s.report('excalidraw', 'working', 3200, 'Installing its packages (about 40 MB)');
	s.set('excalidraw', { ok: true, ...done, repo: 'mona-designer/excalidraw-case-study', detail: `mona-designer/excalidraw-case-study in ${AI_FIRST_FOLDER}/excalidraw-case-study` });
	await s.check();
	await s.on('resources');
	await s.report('resources', 'working', 1200, 'Copying the prompts, cheat sheet and practice docs');
	s.set('resources', { ok: true, ...done, detail: `in ${AI_FIRST_FOLDER}/resources` });
	await s.check();
	await s.on('demo_tools');
	await s.report('demo_tools', 'working', 2600, mac ? 'Adding Playwright Core and a small ffmpeg; recording uses your Chrome' : 'Adding Playwright Core and a small ffmpeg; recording uses Edge');
	s.set('demo_tools', { ok: true, ...done, detail: `ready, recording with ${mac ? 'Google Chrome' : 'Microsoft Edge'}` });
	await s.check();

	await s.on('computer_use');
	if (mac) {
		await s.report('computer_use', 'needs-you', 7600);
	}
	await s.report('computer_use', 'installed', 3200);
	await s.report('computer_use', 'tested', 800);
	await s.on('dictation', 2800);
	await s.report('dictation', 'tested', 800);
	await s.on('taste_weekly');
	await s.report('taste_weekly', 'working', 2000, 'Creating the weekly automation, then running it once to check it');
	s.set('taste_weekly', { ok: true, ...done, detail: '"Weekly taste update" runs every Monday' });
	await s.check();
	await s.report('taste_weekly', 'tested', 800);
	await s.on('none', 0);
}

function pickMeta(meta) {
	const out = {};
	for (const field of META_FIELDS) {
		if (meta?.[field] !== undefined) {
			out[field] = meta[field];
		}
	}
	return out;
}

// One play-through. Replay throws it away and starts a new one.
class SimulationRun {
	constructor({ os, meta, speed, log, now, script, onChange, workshop = null }) {
		this.os = os;
		this.workshop = workshop;
		this.script = script;
		this.onChange = onChange;
		this.state = 'waiting';
		this.error = null;
		this.disposed = false;
		this.clock = new Clock({ speed });
		this.machine = workshop ? new PretendAiFirstMachine(os) : new PretendMachine(os);
		this.store = new MemoryStore({ now });
		const quietLog = (message, level) => {
			if (!this.disposed) {
				log(message, level);
			}
		};
		const runner = new PretendRunner({ machine: this.machine, clock: this.clock, now });
		this.model = new SetupModel({
			store: this.store,
			runner,
			aiFirstRunner: workshop ? runner : null,
			platform: os === 'windows' ? 'win32' : 'darwin',
			now,
			log: quietLog,
		});
		this.ready = (async () => {
			await this.model.load();
			await this.model.setMeta(meta);
			if (workshop) {
				await this.model.setWorkshop({ workshop, workshopDir: AI_FIRST_FOLDER });
			}
		})();
		this.finished = this.ready.catch(() => {});
	}

	director() {
		const { model, machine, clock } = this;
		const wait = (ms) => clock.sleep(ms);
		return {
			os: this.os,
			wait,
			set: (id, entry) => machine.set(id, entry),
			check: ({ quick = true } = {}) => model.refresh({ quick }),
			on: async (id, ms = 600) => {
				await model.setStep({ id });
				if (ms) {
					await wait(ms);
				}
			},
			report: async (id, status, ms = 0, note = null, commands = []) => {
				await model.setItem({ id, status, note, commands });
				if (ms) {
					await wait(ms);
				}
			},
			choose: (id, on) => model.setChoice({ id, on }),
			flow: (action, extra = {}) => model.flowAction({ action, ...extra }),
		};
	}

	setState(state, error = null) {
		this.state = state;
		this.error = error;
		this.onChange();
	}

	start() {
		if (this.state !== 'waiting' || this.disposed) {
			return false;
		}
		this.setState('playing');
		this.finished = (async () => {
			try {
				await this.ready;
				await this.script(this.director());
				if (!this.disposed) {
					this.setState('done');
				}
			} catch (error) {
				if (this.disposed || error instanceof Cancelled) {
					return;
				}
				this.setState('failed', String(error?.message || error).split('\n')[0]);
			}
		})();
		return true;
	}

	pause() {
		if (this.state === 'playing') {
			this.clock.pause();
			this.setState('paused');
		}
	}

	resume() {
		if (this.state === 'paused') {
			this.clock.resume();
			this.setState('playing');
		}
	}

	dispose() {
		this.disposed = true;
		this.clock.cancel();
		this.model.dispose();
	}
}

// The simulation behind one canvas instance. Its model is what the page draws and what the agent's actions read.
// It emits "change" when its state changes and "model" when a replay starts over with a new model.
export class Simulation extends EventEmitter {
	constructor({ os = 'mac', meta = {}, speed = 1, log = () => {}, now = monotonicNow(), workshop = null, script = null } = {}) {
		super();
		if (!SIMULATE_OS.includes(os)) {
			throw new SetupError('invalid_input', `simulate must be one of: ${SIMULATE_OS.join(', ')}.`);
		}
		this.os = os;
		this.workshop = workshop;
		script = script || (workshop ? aiFirstSetup : firstTimeSetup);
		this.meta = pickMeta(meta);
		this.speed = speed;
		this.log = log;
		this.now = now;
		this.script = script;
		this.run = this.newRun();
	}

	newRun() {
		return new SimulationRun({ os: this.os, meta: this.meta, speed: this.speed, log: this.log, now: this.now, script: this.script,
			workshop: this.workshop, onChange: () => this.emit('change') });
	}

	get model() {
		return this.run.model;
	}

	get state() {
		return this.run.state;
	}

	ready() {
		return this.run.ready;
	}

	// The current play-through's end (done, failed or thrown away). Mostly for tests.
	finished() {
		return this.run.finished;
	}

	info() {
		const label = this.workshop ? `${LABELS[this.os]}, AI-First setup` : LABELS[this.os];
		return { os: this.os, label, state: this.run.state, error: this.run.error, ...(this.workshop ? { workshop: this.workshop } : {}) };
	}

	async setMeta(meta) {
		const fields = pickMeta(meta);
		this.meta = { ...this.meta, ...fields };
		await this.run.ready;
		await this.run.model.setMeta(fields);
	}

	start() {
		return this.run.start();
	}

	pause() {
		this.run.pause();
	}

	resume() {
		this.run.resume();
	}

	async replay() {
		const old = this.run;
		this.run = this.newRun();
		await this.run.ready;
		this.emit('model', this.run.model);
		old.dispose();
		this.emit('change');
	}

	dispose() {
		this.run.dispose();
		this.removeAllListeners();
	}
}

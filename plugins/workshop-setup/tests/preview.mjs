// Runs the checklist server without a Copilot session, for a look in a browser. Nothing here touches the real setup.
//   node preview.mjs --home <scratch folder> [--title T] [--subtitle S] [--presenter P] [--chat C] [--port-file F]
//     shows a setup in progress, against a made-up check result.
//   node preview.mjs --simulate mac|windows [--speed N] [--title T] [--subtitle S] [--presenter P] [--port-file F]
//     plays a first-time setup from scratch, in memory, like the canvas's simulate input.
// It prints the page URL and keeps running until stopped.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { SetupModel } from '../extensions/setup-checklist/lib/model.mjs';
import { CanvasHub } from '../extensions/setup-checklist/lib/server.mjs';
import { Simulation } from '../extensions/setup-checklist/lib/simulation.mjs';
import { Store } from '../extensions/setup-checklist/lib/store.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};

async function writeUrl(url) {
	process.stdout.write(`${url}\n`);
	const portFile = opt('port-file');
	if (portFile) {
		await fsp.writeFile(path.resolve(portFile), url);
	}
}

async function simulate(os) {
	const fields = { title: opt('title'), subtitle: opt('subtitle'), presenter: opt('presenter'), checkInChat: opt('chat') };
	const meta = Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
	const simulation = new Simulation({ os, speed: Number(opt('speed', '1')) || 1, meta });
	await simulation.ready();
	const instance = await new CanvasHub({ model: simulation.model }).open('preview', { simulation });
	await writeUrl(instance.url);
}

async function inProgress() {
	const home = opt('home');
	if (!home) {
		process.stderr.write('Pass --home with a scratch folder.\n');
		process.exit(2);
	}

	const ok = (detail, extra = {}) => ({ ok: true, required: true, detail, ...extra });
	const missing = (detail) => ({ ok: false, required: true, detail });
	const fixture = {
		time: new Date().toISOString(),
		os: { name: 'macOS', version: '26.1' },
		items: {
			command_line_tools: ok('Command Line Tools installed'),
			package_manager: { ok: true, required: false, detail: 'Homebrew 4.6.2' },
			vscode_insiders: ok('VS Code Insiders 1.147.0-insider'),
			copilot_signin: ok('signed in to GitHub with Copilot in VS Code Insiders'),
			gh: ok('signed in as mona-designer (active)'),
			git: ok('git 2.49.0'),
			node: ok('Node 22.12.0'),
			npm: ok('npm 10.9.0, registry https://packagefeedproxy.microsoft.io/npm/'),
			yarn: ok('Yarn 1.22.22'),
			python: ok('Python 3.13.1 with Pillow 11.2.1'),
			ffmpeg: missing('ffmpeg is not installed'),
			ffprobe: missing('ffprobe is not installed'),
			browser: ok('Chrome 142.0.7444.60'),
			settings: { ok: false, required: true, detail: '5 of 6 workshop settings are set', matching: ['chat.canvases.enabled'], missing: [{ key: 'dictation.model' }], different: [] },
			practice: { ok: null, required: false, detail: 'later, at the workshop', later: true },
			skills: ok('17 skills installed; private copy mona-designer/autonomous-output-skills'),
			workiq: ok('plugins: workiq, workiq-productivity'),
			playwright: ok('Playwright MCP for Copilot CLI'),
			computer_use: ok('setting on; plugin downloaded'),
			azure: { ok: true, required: false, detail: 'signed in, a subscription is selected' },
			devbox: { ok: null, required: false, detail: 'remote agent hosts in settings: 0' },
			research: { ok: null, required: false, detail: 'no research.env' },
		},
		steps: { skills: { status: 'ok', at: new Date(Date.now() - 60000).toISOString() } },
	};

	const runner = { run: async () => ({ data: JSON.parse(JSON.stringify(fixture)), script: 'fixture' }) };
	const model = new SetupModel({ store: new Store({ home }), runner, platform: 'darwin' });
	const hub = new CanvasHub({ model });

	await fsp.mkdir(home, { recursive: true });
	await model.load();
	await model.setMeta({ title: opt('title'), subtitle: opt('subtitle'), presenter: opt('presenter'), checkInChat: opt('chat') });
	await model.refresh();
	await model.setItem({ id: 'computer_use', status: 'needs-you', note: 'In the Set Up Computer Use dialog, click Allow in Settings for Screen Recording.\nDo the same for Accessibility.\nSwitch on Copilot Computer Use in System Settings, then click Check Again.', commands: [] });
	await model.setItem({ id: 'voice', status: 'working', note: null, commands: [] });
	await model.setItem({ id: 'weekly', status: 'failed', note: 'configureAutomation: the Automations view isn\'t available in this window', commands: [] });
	await model.setStep({ id: 'computer_use' });
	const instance = await hub.open('preview');
	await writeUrl(instance.url);
}

if (opt('simulate')) {
	await simulate(opt('simulate'));
} else {
	await inProgress();
}

// What the checklist shows: the groups, each setup item's name, the test a person runs once it's installed, and
// plain steps for when it needs them. Item ids match check-setup.py's JSON. Ids the catalog doesn't know still show
// up (see checklist.mjs), so new checks appear before this file learns their names.
//
// Nothing here names an event, a person or a chat: those come from the canvas's open input, so the plugin stays
// generic.

export const CANVAS_ID = 'autonomous-setup-checklist';

// Statuses the page shows. "installed" means set up but not tested yet; "done" means tested (or set up, for items
// without a test).
export const STATUSES = ['checking', 'todo', 'working', 'needs-you', 'installed', 'done', 'skipped', 'failed'];

// Statuses the agent reports with setItem.
export const REPORT_STATUSES = ['todo', 'working', 'needs-you', 'installed', 'tested', 'skipped', 'failed'];

export const GROUPS = [
	{ id: 'basics', label: 'Basics', blurb: 'Tools the agent uses in every session.' },
	{ id: 'workshop', label: 'Workshop', blurb: 'Your settings, your own copy of the skills, and a browser the agent can drive.' },
	{ id: 'connections', label: 'Connections', blurb: 'How the agent reaches your work and your apps.' },
	{ id: 'yours', label: 'Yours', blurb: 'Your own voice and taste, built from your messages on this machine.' },
	{ id: 'optional', label: 'Optional', blurb: 'Only if you want them. You can add them later.' },
	{ id: 'more', label: 'More', blurb: '' },
];

const FEED = 'https://packagefeedproxy.microsoft.io/npm/';
const HOMEBREW_SCRIPT = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
const steps = (...lines) => lines.join('\n');

// The steps below show when the agent marks an item needs-you without steps of its own. The agent runs the commands,
// so these say what only the person can do: click through an installer, sign in, allow a permission. Anything they
// copy works as it is: a sign-in code for the browser, a line for the chat, or (Intel Macs only) Homebrew's command
// for Terminal.
const IN_CHAT = 'Check the chat. The agent says what it needs from you here.';

export const ITEMS = [
	// Basics
	{
		id: 'command_line_tools', group: 'basics', label: 'Command Line Tools',
		help: { mac: { text: steps('A macOS window asks to install the Command Line Tools. Click Install, then Agree.', 'It takes a few minutes. The agent takes it from there.') } },
	},
	{
		id: 'package_manager', group: 'basics', label: { mac: 'Homebrew', win: 'winget', other: 'Package manager' },
		// Only needed when something is missing, so it shows once it's there or once the agent asks for it.
		quietUntilReady: true,
		help: {
			// The agent opens Homebrew's installer package, which supports Apple silicon only. Intel Macs run its script.
			mac: ({ arch }) => (arch === 'x86_64'
				? {
					text: steps(
						'Open Terminal: press Command (⌘) and Space together, type Terminal and press Return.',
						'Click Copy below, click in the Terminal window, press ⌘ and V together, then press Return.',
						'When it asks for your Mac password, type it and press Return. Nothing shows while you type.',
						'When it says Press RETURN to continue, press Return. It takes a few minutes.',
						'When it says Installation successful, tell the agent in the chat.',
					),
					commands: [HOMEBREW_SCRIPT],
				}
				: {
					text: steps(
						'In the Homebrew installer window, click Continue until you see Install, then click Install.',
						'When macOS asks for your password, type it (or use Touch ID) and click Install Software.',
						'When it says the installation was successful, click Close. The agent takes it from there.',
						'Don\'t see the installer? Click Installer in the Dock.',
					),
				}),
			win: { text: steps('Open the Microsoft Store, search for App Installer, and click Get or Update.', 'When it\'s done, click Refresh at the top of this page.') },
		},
	},
	{
		id: 'vscode_insiders', group: 'basics', label: 'VS Code Insiders',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'copilot_signin', group: 'basics', label: 'GitHub Copilot sign-in', unknownDetail: 'The agent asks you about this in the chat.',
		// The check knows this from their answer; the page states the result.
		okDetail: 'signed in to GitHub with Copilot in VS Code Insiders',
		help: { all: { text: 'In VS Code Insiders, open the Accounts menu at the bottom left and sign in with GitHub. Then tell the agent you\'re signed in.' } },
	},
	{
		id: 'gh', group: 'basics', label: 'GitHub CLI',
		// The agent starts the sign-in and sends the one-time code as the command to copy.
		help: {
			all: {
				text: steps(
					'Your browser opens GitHub\'s device page. If it doesn\'t, go to github.com/login/device.',
					'If it asks you to sign in, use the GitHub account that has Copilot.',
					'Copy the one-time code below, paste it on that page and click Continue.',
					'Click Authorize. The agent takes it from there.',
				),
			},
		},
	},
	{
		id: 'git', group: 'basics', label: 'git',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'powershell', group: 'basics', label: 'PowerShell scripts',
		help: { win: { text: IN_CHAT } },
	},
	{
		id: 'node', group: 'basics', label: 'Node.js',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'npm', group: 'basics', label: 'npm on Microsoft\'s feed',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'yarn', group: 'basics', label: 'Yarn',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'python', group: 'basics', label: 'Python',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'ffmpeg', checks: ['ffmpeg', 'ffprobe'], group: 'basics', label: 'FFmpeg',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'browser', group: 'basics', label: 'Chrome or Edge',
		help: {
			win: { text: 'Microsoft Edge comes with Windows. If it\'s missing, reinstall it from microsoft.com/edge.' },
			all: { text: IN_CHAT },
		},
	},

	// Workshop
	{
		id: 'settings', group: 'workshop', label: 'VS Code settings',
		help: { all: { text: 'Open the Command Palette, run Preferences: Open User Settings (JSON), and paste the settings the agent shows you. Restart VS Code Insiders when it asks.' } },
	},
	{
		id: 'skills', group: 'workshop', label: 'Your skills',
		test: { prompt: 'List the skills you can use from my copy of the skills.' },
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'weekly', group: 'workshop', label: 'Weekly update', always: true,
		test: { prompt: 'Run my weekly skill update once now, then check the run.' },
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'playwright', group: 'workshop', label: 'Playwright',
		test: { prompt: 'Use Playwright to open https://code.visualstudio.com, take a screenshot and show it to me.' },
		help: { all: { text: IN_CHAT } },
	},

	// Connections
	{
		id: 'workiq', group: 'connections', label: 'Work IQ',
		test: {
			prompt: (ctx) => ctx.checkInChat
				? `Use Work IQ to post "Work IQ is set up" in the ${ctx.checkInChat} chat.`
				: 'Use Work IQ to tell me the subject of my next meeting.',
		},
		help: {
			all: {
				text: steps(
					'Start a new session and say "continue my setup" there. Work IQ loads in new sessions.',
					'If a window asks you to sign in or allow access, sign in with your work account and accept.',
					'If it asks for admin approval or a license, your organization sets that. Skip it for now and tell your host.',
				),
			},
		},
	},
	{
		id: 'computer_use', step: 'computer-use', group: 'connections', label: 'Computer Use',
		test: {
			prompt: {
				mac: 'Use Computer Use to write "Computer Use works" in a new note in Notes.',
				win: 'Use Computer Use to open Notepad and type "Computer Use works". Don\'t save the file.',
				other: 'Use Computer Use to open a text editor and type "Computer Use works". Don\'t save the file.',
			},
		},
		help: {
			mac: {
				text: steps(
					'Copy /computer on, send it in the chat, then click Turn On.',
					'In the Set Up Computer Use dialog, click Allow in Settings for Screen Recording, then for Accessibility.',
					'Switch on Copilot Computer Use in each list in System Settings, then click Check Again in the dialog.',
				),
				commands: ['/computer on'],
			},
			all: { text: 'Copy /computer on, send it in the chat, then click Turn On.', commands: ['/computer on'] },
		},
	},
	{
		id: 'dictation', group: 'connections', label: 'Dictation', always: true, fromSetting: 'dictation.model',
		test: { kind: 'do', prompt: 'Click the microphone in the chat box, say "Dictation works", then send it.' },
		help: { all: { text: 'Add the dictation setting the agent shows you to your User settings (JSON), then save.' } },
	},

	// Yours: personal voice and taste ship in a later version. Until the setup reports them, they stay off the
	// checklist and out of the count, so "all done" is reachable.
	{
		id: 'voice', group: 'yours', label: 'Your voice',
		test: { prompt: 'Draft a two sentence reply in my voice to "Can you look at my mock this week?"' },
		help: { all: { text: 'Say yes in the chat when the agent asks to read your recent messages. The skill keeps short rules, not your messages.' } },
	},
	{
		id: 'taste', group: 'yours', label: 'Your taste',
		test: { prompt: 'Show me three rules from my taste and where each one came from.' },
		help: { all: { text: 'Say yes in the chat when the agent asks to read the design feedback you gave and got. The skill keeps short rules, not your messages.' } },
	},

	// Optional
	{
		id: 'azure', group: 'optional', label: 'Azure', blurb: 'For sharing pages that need a sign-in, with a subscription you\'re allowed to use.',
		test: { prompt: 'Run az account show and tell me which subscription I\'m signed in to.' },
		help: {
			all: {
				text: steps(
					'Your browser opens a Microsoft sign-in page. Sign in with your work account.',
					'If the agent asks which subscription to use, answer in the chat with one you\'re allowed to use.',
				),
			},
		},
	},
	{
		id: 'devbox', group: 'optional', label: 'Dev box', blurb: 'Keeps agents working when your laptop is closed.',
		test: { prompt: 'Start a session on my dev box and have it say hello.' },
		help: { all: { text: 'Ask the agent for the dev box steps. Getting one can take a while, so start early.' } },
	},
	{
		id: 'research', group: 'optional', label: 'Research tools', blurb: 'For planning and running user studies.',
		help: {
			win: { text: steps('Your keys go in a file only you can read: %USERPROFILE%\\.copilot\\research.env. The agent opens it for you in VS Code Insiders.', 'Type each key after its = sign, then save and close the file. Keys never go in the chat.') },
			all: { text: steps('Your keys go in a file only you can read: ~/.copilot/research.env. The agent opens it for you in VS Code Insiders.', 'Type each key after its = sign, then save and close the file. Keys never go in the chat.') },
		},
	},

	// Later: listed in a quiet note, never counted.
	{ id: 'practice', later: true, label: 'Practice project' },
];

export const ITEM_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

// Check ids that another item shows (ffprobe is part of FFmpeg).
export const MERGED_CHECKS = new Map(ITEMS.flatMap((item) => (item.checks || []).filter((c) => c !== item.id).map((c) => [c, item.id])));

export const LATER_NOTE = 'Your practice project comes at the workshop, when you pick your own work or the example.';

export function osKey(name) {
	const text = String(name || '').toLowerCase();
	if (text.startsWith('mac') || text === 'darwin') {
		return 'mac';
	}
	if (text.startsWith('windows') || text === 'win32') {
		return 'win';
	}
	return 'other';
}

function pick(value, os) {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value[os] ?? value.other ?? value.all ?? null;
	}
	return value ?? null;
}

export function itemLabel(def, os) {
	return pick(def.label, os);
}

// The steps for an item on this OS. An entry can depend on the machine (env.arch, from the check).
export function itemHelp(def, os, env = {}) {
	const help = def.help || {};
	const entry = help[os] || help.all || null;
	return typeof entry === 'function' ? entry(env) : entry;
}

// The Try it text for an item, or null when it has no test.
export function itemTest(def, os, meta) {
	if (!def.test) {
		return null;
	}
	const raw = typeof def.test.prompt === 'function' ? def.test.prompt(meta || {}) : pick(def.test.prompt, os);
	return raw ? { kind: def.test.kind || 'prompt', text: raw } : null;
}

// "dev_box" becomes "Dev box", for ids the catalog doesn't know yet.
export function humanize(id) {
	const words = String(id).replace(/[_-]+/g, ' ').trim();
	return words ? words[0].toUpperCase() + words.slice(1) : String(id);
}

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
const SAY_YES = 'Say yes in the chat when the agent offers to install it, or run this yourself:';

export const ITEMS = [
	// Basics
	{
		id: 'command_line_tools', group: 'basics', label: 'Command Line Tools',
		help: { mac: { text: 'Run this in Terminal. macOS asks you to confirm, then installs them. It takes a few minutes.', commands: ['xcode-select --install'] } },
	},
	{
		id: 'package_manager', group: 'basics', label: { mac: 'Homebrew', win: 'winget', other: 'Package manager' },
		// Only needed when something is missing, so it shows once it's there or once the agent asks for it.
		quietUntilReady: true,
		help: {
			mac: { text: 'Paste this in Terminal. It asks for your Mac password, which only you type.', commands: ['/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'] },
			win: { text: 'Install or update App Installer from the Microsoft Store, then click Refresh.' },
		},
	},
	{
		id: 'vscode_insiders', group: 'basics', label: 'VS Code Insiders',
		help: {
			mac: { text: SAY_YES, commands: ['brew install --cask visual-studio-code@insiders'] },
			win: { text: SAY_YES, commands: ['winget install --id Microsoft.VisualStudioCode.Insiders -e'] },
		},
	},
	{
		id: 'copilot_signin', group: 'basics', label: 'GitHub Copilot sign-in', unknownDetail: 'The agent asks you about this in the chat.',
		help: { all: { text: 'In VS Code Insiders, open the Accounts menu at the bottom left and sign in with GitHub. Then tell the agent you\'re signed in.' } },
	},
	{
		id: 'gh', group: 'basics', label: 'GitHub CLI',
		help: { all: { text: 'In VS Code, open Terminal > New Terminal, run this, and finish signing in in your browser. Then say done in the chat.', commands: ['gh auth login --hostname github.com --web --git-protocol https'] } },
	},
	{
		id: 'git', group: 'basics', label: 'git',
		help: {
			mac: { text: 'Say yes in the chat when the agent offers to set up git, or run this yourself:', commands: ['xcode-select --install'] },
			win: { text: SAY_YES, commands: ['winget install --id Git.Git -e'] },
		},
	},
	{
		id: 'powershell', group: 'basics', label: 'PowerShell scripts',
		help: { win: { text: 'Run this in PowerShell, so npm and yarn work there too.', commands: ['Set-ExecutionPolicy -Scope CurrentUser RemoteSigned'] } },
	},
	{
		id: 'node', group: 'basics', label: 'Node.js',
		help: {
			mac: { text: SAY_YES, commands: ['brew install node'] },
			win: { text: SAY_YES, commands: ['winget install --id OpenJS.NodeJS.LTS -e'] },
		},
	},
	{
		id: 'npm', group: 'basics', label: 'npm on Microsoft\'s feed',
		help: {
			mac: { text: 'Say yes in the chat when the agent asks to use Microsoft\'s package feed, or run this yourself:', commands: [`npm config set registry ${FEED}`] },
			win: { text: 'Say yes in the chat when the agent asks to use Microsoft\'s package feed, or run this yourself:', commands: [`npm.cmd config set registry ${FEED}`] },
			all: { text: 'Say yes in the chat when the agent asks to use Microsoft\'s package feed, or run this yourself:', commands: [`npm config set registry ${FEED}`] },
		},
	},
	{
		id: 'yarn', group: 'basics', label: 'Yarn',
		help: {
			win: { text: SAY_YES, commands: ['npm.cmd install -g yarn'] },
			all: { text: SAY_YES, commands: ['npm install -g yarn'] },
		},
	},
	{
		id: 'python', group: 'basics', label: 'Python',
		help: {
			mac: { text: SAY_YES, commands: ['python3 -m pip install --user Pillow'] },
			win: { text: SAY_YES, commands: ['winget install --id Python.Python.3.13 -e'] },
		},
	},
	{
		id: 'ffmpeg', checks: ['ffmpeg', 'ffprobe'], group: 'basics', label: 'FFmpeg',
		help: {
			mac: { text: SAY_YES, commands: ['brew install ffmpeg'] },
			win: { text: SAY_YES, commands: ['winget install --id Gyan.FFmpeg -e'] },
		},
	},
	{
		id: 'browser', group: 'basics', label: 'Chrome or Edge',
		help: {
			mac: { text: SAY_YES, commands: ['brew install --cask google-chrome'] },
			win: { text: 'Microsoft Edge comes with Windows. If it\'s missing, reinstall it from microsoft.com/edge.' },
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
		help: { all: { text: 'Say yes in the chat when the agent shows the plan for your own copy of the skills.' } },
	},
	{
		id: 'weekly', group: 'workshop', label: 'Weekly update', always: true,
		test: { prompt: 'Run my weekly skill update once now, then check the run.' },
		help: { all: { text: 'Say yes in the chat when the agent offers to schedule the weekly update.' } },
	},
	{
		id: 'playwright', group: 'workshop', label: 'Playwright',
		test: { prompt: 'Use Playwright to open https://code.visualstudio.com, take a screenshot and show it to me.' },
		help: { all: { text: 'Say yes in the chat when the agent offers to set up Playwright.' } },
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
				text: 'In VS Code, open Terminal > New Terminal and run these, then start a new session. If Work IQ asks for admin approval or a license, your organization sets that: skip it for now and tell your host.',
				commands: ['copilot plugin marketplace add microsoft/work-iq', 'copilot plugin install workiq@work-iq', 'copilot plugin install workiq-productivity@work-iq'],
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
			mac: { text: 'In the Set Up Computer Use dialog, click Allow in Settings for Screen Recording and for Accessibility. Switch on Copilot Computer Use in System Settings, then click Check Again in the dialog.' },
			all: { text: 'Type /computer on in the chat, then click Turn On.' },
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
		help: { all: { text: 'Run this in your own terminal, finish in your browser, and pick a subscription you\'re allowed to use.', commands: ['az login'] } },
	},
	{
		id: 'devbox', group: 'optional', label: 'Dev box', blurb: 'Keeps agents working when your laptop is closed.',
		test: { prompt: 'Start a session on my dev box and have it say hello.' },
		help: { all: { text: 'Ask the agent for the dev box steps. Getting one can take a while, so start early.' } },
	},
	{
		id: 'research', group: 'optional', label: 'Research tools', blurb: 'For planning and running user studies.',
		help: { all: { text: 'Fill in your keys in ~/.copilot/research.env yourself. Keys never go in the chat.' } },
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

export function itemHelp(def, os) {
	const help = def.help || {};
	return help[os] || help.all || null;
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

#!/usr/bin/env node
// Launch a BUILT Code OSS checkout as an isolated, scripted demo instance that never touches the
// user's screen: fresh profile, demo settings preset, no real keychain, invisible window driven over
// CDP. Prints one JSON line with the pid and ports, then exits (the app keeps running detached).
//
// Use this for prototype and storyboard demos whose agent responses are scripted. For "the real
// product today" demos that need a real signed-in account, use the vscode repo `launch` skill
// instead and then run `hide-windows.mjs --inspect <its main inspector port>`.
//
// Usage:
//   node launch-demo-oss.mjs --repo <vscode-checkout> [--name demo] [--agents]
//     [--workspace <folder>] [--open <file>] [--theme "Dark 2026"] [--size 1440x900]
//     [--mode invisible|offscreen|visible] [--hovers] [--mock-llm http://127.0.0.1:47331]
//     [--settings extra-settings.json] [--storage extra-storage.json] [--agents-storage file.json]
//     [--cdp <port>] [--inspect <port>] [--run-root ~/.demo-runs] [--dry-run]
//   --name defaults to a unique demo-<id>; reuse a name only for a run dir this launcher created.
//
// Notes
// - The run dir path stays short on purpose: the IPC socket under it must stay below ~104 chars.
// - `--mock-llm` points the built-in Copilot extension at a local mock server (see
//   start-mock-llm.cjs) with a fake token, so no account, keychain, or network model is involved.
//   `--use-mock-keychain` is always passed: a real keychain prompt stalls the main thread.
// - `--agents` opens the Agents window with the new session composer layout and an isolated HOME,
//   so the sidebar never lists the machine's real agent sessions.
// - Settings precedence: preset < --settings file. Storage files are flat {key: value} JSON; values
//   that are not strings are JSON-encoded, matching how VS Code stores them.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchWindows } from './hide-windows.mjs';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const arg = (name, fallback) => {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const expandHome = p => p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
const readJson = file => file ? JSON.parse(fs.readFileSync(expandHome(file), 'utf8')) : {};

const ROOT = path.resolve(expandHome(arg('repo', process.env.VSCODE_REPO ?? process.cwd())));
const name = arg('name', `demo-${Date.now().toString(36)}`);
// The run dir is deleted and recreated, so the name must be a plain folder name under the run root.
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(name)) {
	throw new Error(`--name must be a short plain folder name (letters, digits, . _ -), got ${JSON.stringify(name)}`);
}
const agents = flag('agents');
const theme = arg('theme', 'Dark 2026');
const mode = arg('mode', flag('visible') ? 'visible' : 'invisible');
const [width, height] = String(arg('size', '1440x900')).split('x').map(Number);
const hovers = flag('hovers') || mode === 'visible';
const mockUrl = arg('mock-llm');
const workspace = arg('workspace') ? path.resolve(expandHome(arg('workspace'))) : undefined;
const openFile = arg('open') ? path.resolve(expandHome(arg('open'))) : undefined;
const runRoot = path.resolve(expandHome(arg('run-root', '~/.demo-runs')));
const dryRun = flag('dry-run');

if (!['invisible', 'offscreen', 'visible'].includes(mode)) {
	throw new Error(`unknown --mode ${mode}`);
}
if (!width || !height) {
	throw new Error('--size must look like 1440x900');
}

const electron = process.platform === 'darwin'
	? path.join(ROOT, '.build/electron/Code - OSS.app/Contents/MacOS/Code - OSS')
	: path.join(ROOT, '.build/electron/code-oss');
if (!dryRun && !fs.existsSync(electron)) {
	throw new Error(`no built Electron at ${electron}. Build the checkout first (npm install, npm run compile), or use the launch skill.`);
}

async function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}
const cdpPort = Number(arg('cdp', 0)) || await freePort();
const inspectPort = Number(arg('inspect', 0)) || await freePort();

const runDir = path.join(runRoot, name);
if (path.dirname(runDir) !== runRoot) {
	throw new Error(`run dir ${runDir} escapes ${runRoot}`);
}
const userDataDir = path.join(runDir, 'user-data');
const extensionsDir = path.join(runDir, 'extensions');
const logsDir = path.join(runDir, 'logs');
const stateHome = path.join(runDir, 'state');
const home = path.join(runDir, 'home');
if (runDir.length > 70) {
	console.error(`warning: run dir ${runDir} is long; keep it short so the IPC socket path fits`);
}

const settings = {
	// The look the user standardized on (Modern UI, compact, Dark 2026, clean chrome).
	'workbench.colorTheme': theme,
	'window.autoDetectColorScheme': false,
	'workbench.experimental.modernUI': true,
	'window.density.layout': 'compact',
	'sessions.developerJoy.enabled': false,
	'workbench.startupEditor': 'none',
	'workbench.tips.enabled': false,
	'editor.minimap.enabled': false,
	// Hover states without tooltip text: hovers only appear when deliberately requested.
	'workbench.hover.delay': hovers ? 500 : 600000,
	'workbench.hover.reducedDelay': hovers ? 200 : 600000,
	'editor.hover.delay': hovers ? 500 : 600000,
	// No squiggles, light bulbs, or occurrence highlights that read as errors on camera.
	'typescript.validate.enable': false,
	'javascript.validate.enable': false,
	'editor.lightbulb.enabled': 'off',
	'editor.occurrencesHighlight': 'off',
	// No update, telemetry, trust, or recommendation prompts.
	'telemetry.telemetryLevel': 'off',
	'update.mode': 'none',
	'extensions.ignoreRecommendations': true,
	'git.openRepositoryInParentFolders': 'never',
	'security.workspace.trust.enabled': false,
	'files.autoSave': 'off',
	// Quick-input folder dialogs can be driven over CDP; native OS dialogs cannot.
	'files.simpleDialog.enable': true,
	...(agents ? {
		'sessions.chat.unifiedWorkspacePicker.enabled': true,
		'sessions.chat.experimental.newSessionComposerLayout': true,
	} : {}),
	...(mockUrl ? {
		'github.copilot.advanced.debug.overrideProxyUrl': mockUrl,
		'github.copilot.advanced.debug.overrideCapiUrl': mockUrl,
		'chat.allowAnonymousAccess': true,
		'chat.titleBar.signIn.enabled': false,
		'chat.mcp.discovery.enabled': false,
		'chat.mcp.enabled': false,
		'github.copilot.chat.githubMcpServer.enabled': false,
		'github.copilot.chat.cli.mcp.enabled': false,
		'github.copilot.enable': { '*': false },
		'github.copilot.nextEditSuggestions.enabled': false,
		'editor.inlineSuggest.enabled': false,
		...(agents ? { 'chat.agentHost.allowSignedOutWhenUsable': true } : {}),
	} : {}),
	...readJson(arg('settings')),
};

// Silent keys for the driver, so nothing is ever run through the command palette on camera.
const keybindings = [
	{ key: 'f5', command: 'workbench.action.showHover' },
	{ key: 'f6', command: 'workbench.action.agentToggleSidePanel' },
	{ key: 'f7', command: 'notifications.clearAll' },
	{ key: 'f8', command: 'workbench.action.closeSidebar' },
	{ key: 'f9', command: 'workbench.action.chat.newChat' },
	{ key: 'f10', command: 'workbench.action.closePanel' },
];

const globalStorage = {
	// Keep the built-in Copilot extension enabled on a fresh profile.
	builtinChatExtensionEnablementMigration: 'true',
	'chat.cacheBreakHintDismissed': 'true',
	...(mockUrl ? { 'chat.tools.global.autoApprove.optIn': 'true' } : {}),
	...(workspace && agents ? { 'history.recentlyOpenedPathsList': { entries: [{ folderUri: pathToFileURL(workspace).href }] } } : {}),
	...readJson(arg('storage')),
};
const agentsStorage = {
	// The sidebar's Customizations section starts collapsed to its header.
	'agentSessions.customizationsShortcuts.collapsed': 'true',
	...readJson(arg('agents-storage')),
};

const env = {
	...process.env,
	TMPDIR: '/tmp',
	XDG_STATE_HOME: stateHome,
	// Agent-host sessions and CLI state would otherwise land in the user's real ~/.copilot.
	COPILOT_HOME: path.join(stateHome, '.copilot'),
	CODEX_HOME: path.join(stateHome, '.codex'),
	NODE_ENV: 'development',
	VSCODE_DEV: '1',
	VSCODE_CLI: '1',
	...(agents ? { HOME: home } : {}),
};
delete env.ELECTRON_RUN_AS_NODE;
if (mockUrl) {
	env.IS_SCENARIO_AUTOMATION = '1';
	env.GITHUB_PAT = 'demo-fake-pat';
	env.VSCODE_COPILOT_CHAT_TOKEN = Buffer.from(JSON.stringify({
		token: 'demo-fake-token',
		expires_at: Math.floor(Date.now() / 1000) + 12 * 3600,
		refresh_in: 6 * 3600,
		sku: 'copilot_for_individuals_subscriber',
		individual: true,
		copilot_plan: 'individual',
		organization_login_list: [],
		endpoints: { api: mockUrl, proxy: mockUrl },
	})).toString('base64');
}

const args = [
	`--remote-debugging-port=${cdpPort}`,
	`--inspect=${inspectPort}`,
	'--disable-renderer-backgrounding',
	'--disable-backgrounding-occluded-windows',
	'--disable-background-timer-throttling',
	// Never let this instance ask macOS for the real keychain.
	'--use-mock-keychain',
	ROOT,
	'--skip-release-notes',
	'--skip-welcome',
	'--disable-telemetry',
	'--disable-updates',
	'--disable-workspace-trust',
	`--user-data-dir=${userDataDir}`,
	`--extensions-dir=${extensionsDir}`,
	`--logsPath=${logsDir}`,
	'--disable-extension=vscode.vscode-api-tests',
	'--disable-extension=ms-vscode.vscode-selfhost-test-provider',
	// The smoke-test driver skips the sign-in welcome and uses scriptable dialogs.
	...(agents ? ['--agents', '--enable-smoke-test-driver'] : []),
	...(workspace ? [workspace] : []),
	...(openFile ? [openFile] : []),
];

const summary = { runDir, userDataDir, cdpPort, inspectPort, mode, agents, theme, size: `${width}x${height}`, mockLlm: mockUrl ?? null };
if (dryRun) {
	console.log(JSON.stringify({ dryRun: true, ...summary, electron, args, settings, keybindings, globalStorage, agentsStorage }, null, 1));
	process.exit(0);
}

function writeStorage(dbFile, entries) {
	fs.mkdirSync(path.dirname(dbFile), { recursive: true });
	const quote = value => `'${String(value).replaceAll('\'', '\'\'')}'`;
	const statements = ['CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);'];
	for (const [key, value] of Object.entries(entries)) {
		statements.push(`INSERT INTO ItemTable (key, value) VALUES (${quote(key)}, ${quote(typeof value === 'string' ? value : JSON.stringify(value))});`);
	}
	execFileSync('sqlite3', [dbFile, statements.join(' ')]);
}

// Only ever replace a run dir this launcher created, and never one whose instance is still running.
if (fs.existsSync(runDir)) {
	const receipt = path.join(runDir, 'launch.json');
	if (!fs.existsSync(receipt) && fs.readdirSync(runDir).length) {
		throw new Error(`${runDir} exists and was not created by this launcher; pick another --name`);
	}
	if (fs.existsSync(receipt)) {
		const { pid } = JSON.parse(fs.readFileSync(receipt, 'utf8'));
		let alive = false;
		try { process.kill(pid, 0); alive = true; } catch { }
		if (alive) {
			throw new Error(`${runDir} belongs to running pid ${pid}; stop it first or pick another --name`);
		}
	}
}
fs.rmSync(runDir, { recursive: true, force: true });
for (const dir of [path.join(userDataDir, 'User'), extensionsDir, logsDir, path.join(stateHome, '.copilot'), path.join(stateHome, '.codex'), home]) {
	fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify(settings, null, '\t'));
fs.writeFileSync(path.join(userDataDir, 'User', 'keybindings.json'), JSON.stringify(keybindings, null, '\t'));
writeStorage(path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb'), globalStorage);
if (agents) {
	writeStorage(path.join(userDataDir, 'User', 'profiles', 'builtin', 'agents', 'globalStorage', 'state.vscdb'), agentsStorage);
}

const logFile = path.join(runDir, 'electron.log');
const log = fs.openSync(logFile, 'a');
const child = spawn(electron, args, { env, cwd: ROOT, detached: true, stdio: ['ignore', log, log] });
child.unref();

fs.writeFileSync(path.join(runDir, 'launch.json'), JSON.stringify({ pid: child.pid, ...summary, starting: true }, null, 1));
const stop = reason => {
	try { process.kill(child.pid); } catch { }
	console.error(`stopped pid ${child.pid}: ${reason}`);
	process.exit(1);
};
let patch = null;
if (mode !== 'visible') {
	try {
		patch = await patchWindows({ inspectPort, mode, width, height, expectPid: child.pid });
	} catch (error) {
		stop(`window patch failed: ${error.message}`);
	}
}

// Wait until the renderer's CDP endpoint answers, so callers can connect right away.
const deadline = Date.now() + 90000;
let cdpReady = false;
while (Date.now() < deadline && !cdpReady) {
	try {
		const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) });
		cdpReady = response.ok;
	} catch { }
	if (!cdpReady) {
		await new Promise(resolve => setTimeout(resolve, 250));
	}
}
if (!cdpReady) {
	stop('CDP did not answer within 90 s');
}
fs.writeFileSync(path.join(runDir, 'launch.json'), JSON.stringify({ pid: child.pid, ...summary, cdpReady, patch, log: logFile }, null, 1));
console.log(JSON.stringify({ pid: child.pid, ...summary, cdpReady, patch, log: logFile }));
process.exit(0);

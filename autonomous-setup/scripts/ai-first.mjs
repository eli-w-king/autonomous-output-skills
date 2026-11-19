#!/usr/bin/env node
// The AI-First workshop setup: the light, public path of autonomous-setup (references/ai-first.md).
//
// It checks a personal Mac or Windows laptop, installs only what the person checked on the setup canvas, and records
// every change in <folder>/.setup/installed.json, so the uninstall can take back exactly what it added. Tools that are
// missing go into <folder>/tools as portable copies (no administrator password), and one PATH entry points at them.
// Tools the person already has are used as they are and never changed.
//
// It runs on Node 18 or newer, or on VS Code Insiders' own runtime before Node is installed:
//   macOS:   ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders" ai-first.mjs ...
//   Windows: $env:ELECTRON_RUN_AS_NODE='1'; & "$env:LOCALAPPDATA\Programs\Microsoft VS Code Insiders\Code - Insiders.exe" ai-first.mjs ...
//
//   ai-first.mjs check     [--folder DIR] [--json] [--repo-name]   what's here, each item's size, and the Microsoft
//                                                        sign-in gate; --repo-name adds the name their Excalidraw copy
//                                                        will get (excalidraw.next_repo), from GitHub
//   ai-first.mjs canvas    [--folder DIR] [--json]       copy the setup canvas into Copilot's extensions folder
//   ai-first.mjs install   ITEM [--folder DIR] [--json]  git, node, gh, github, skills, skill_runs, skill_research,
//                                                        skill_taste, excalidraw, resources, demo_tools. Each does its
//                                                        whole step; excalidraw installs its packages too (npm ci in
//                                                        the clone, with no install scripts)
//   ai-first.mjs env       [--folder DIR] [--format sh|ps|json]   the PATH line for this shell
//   ai-first.mjs automation [--folder DIR] [--json]      the configureAutomation input for the weekly taste update
//   ai-first.mjs record    KEY --value JSON [--folder DIR]   record what the agent did (taste_weekly, choices)
//   ai-first.mjs uninstall [--folder DIR] [--yes] [--json]  list what the setup added; --yes removes it. It leaves
//                                                        VS Code's settings to the person, last, by hand
//
// Environment: COPILOT_HOME (default ~/.copilot), AI_FIRST_WORKSHOP (the folder, default ~/ai-first-workshop), and
// for testing only, AI_FIRST_IGNORE_SYSTEM_TOOLS=1 to act as if Git, Node.js and the GitHub CLI weren't installed,
// and AI_FIRST_TEST=1 to allow install excalidraw --skip-npm.
// Exit codes: 0 ok, 1 failed (the reason is printed), 2 usage.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

export const FORMAT = 'ai-first-workshop-setup';
export const VERSION = 1;
export const MIN_NODE_MAJOR = 22;
export const TEMPLATE_REPO = 'eli-w-king/excalidraw-case-study';
export const REPO_NAME = 'excalidraw-case-study';
export const PUBLIC_SKILLS_REPO = 'eli-w-king/autonomous-output-skills';
export const UNINSTALL_URL = 'https://eli-w-king.github.io/ai-first-design-workshop/uninstall.html';
// Where the canvas's Horizon fonts come from: the workshop site, then its repo. Each file is checked against the
// SHA-256 in the canvas's web/horizon-fonts.json.
export const FONT_SOURCES = [
	'https://eli-w-king.github.io/ai-first-design-workshop/assets/horizon/fonts/',
	'https://raw.githubusercontent.com/eli-w-king/ai-first-design-workshop/main/vendor/horizon/fonts/',
];
export const REQUIRED_SKILLS = ['autonomous-variations', 'autonomous-prototypes', 'autonomous-demos', 'autonomous-computer-use'];
export const OPTIONAL_SKILLS = { skill_runs: 'autonomous-runs', skill_research: 'autonomous-research', skill_taste: 'my-taste' };
export const PATH_MARK = 'ai-first-workshop';
export const PLAYWRIGHT_CORE = '1.65.0';
export const TASTE_AUTOMATION_NAME = 'Weekly taste update';
export const TASTE_MODEL = 'agent-host-copilotcli:gpt-6.2-sol';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
const MB = 1000 * 1000;

// Pinned downloads. Each one is checked against a published checksum before it's unpacked.
export const PINS = {
	git: {
		// GitHub's portable Git build (the one GitHub Desktop ships). Its .sha256 file sits next to each archive.
		mac: {
			base: 'https://github.com/desktop/dugite-native/releases/download/v2.56.1/',
			arm64: 'dugite-native-v2.56.1-238326e-macOS-arm64.lzma',
			x64: 'dugite-native-v2.56.1-238326e-macOS-x64.lzma',
			version: '2.56.1',
		},
		// MinGit, Git for Windows' own minimal portable build. Checksums from its release notes.
		win: {
			base: 'https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/',
			x64: 'MinGit-2.56.1-64-bit.zip',
			arm64: 'MinGit-2.56.1-arm64.zip',
			sha256: {
				'MinGit-2.56.1-64-bit.zip': '4a92850b6e917da4fd010669b614b55dccf5b0ec333a534cc4be4700dfefdafd',
				'MinGit-2.56.1-arm64.zip': '96571e442e90523a90e5fd8661b4c4e43bc192910f3c6db938816e6955b4cc8c',
			},
			version: '2.56.1',
		},
	},
	// The current LTS line; SHASUMS256.txt names the newest patch and its checksum.
	node: { base: 'https://nodejs.org/dist/latest-v26.x/' },
	gh: { base: 'https://github.com/cli/cli/releases/download/v2.105.0/', version: '2.105.0', checksums: 'gh_2.105.0_checksums.txt' },
	ffmpeg: {
		base: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/',
		sha256: {
			'ffmpeg-darwin-arm64.gz': '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
			'ffmpeg-darwin-x64.gz': '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
			'ffmpeg-win32-x64.gz': '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
		},
	},
};

// Measured on Nov 18, 2026: [download MB, MB on disk] for each OS and chip. Items measured live (the skills and the
// resources) aren't here. The Excalidraw numbers come from the practice repo's own install check.
export const SIZES = {
	git: { 'mac-arm64': [41.6, 25], 'mac-x64': [46.3, 27], 'win-x64': [39.8, 97], 'win-arm64': [38.0, 93] },
	node: { 'mac-arm64': [30.6, 162], 'mac-x64': [32.7, 170], 'win-x64': [41.2, 118], 'win-arm64': [37.0, 110] },
	gh: { 'mac-arm64': [14.1, 40], 'mac-x64': [15.7, 44], 'win-x64': [15.2, 42], 'win-arm64': [13.7, 40] },
	excalidraw: { 'mac-arm64': [20.9, 125], 'mac-x64': [20.9, 125], 'win-x64': [22.1, 119], 'win-arm64': [22.1, 119] },
	demo_tools: { 'mac-arm64': [22.7, 64], 'mac-x64': [28.8, 97], 'win-x64': [33.1, 101], 'win-arm64': [33.1, 101] },
	browser: { 'mac-arm64': [105, 215], 'mac-x64': [112, 230], 'win-x64': [129, 280], 'win-arm64': [129, 280] },
	computer_use: { 'mac-arm64': [5.3, 6], 'mac-x64': [5.4, 6], 'win-x64': [2.5, 3], 'win-arm64': [2.4, 3] },
};

export const SETTINGS_KEYS = [
	'sessions.chat.experimental.workspaceOptOut',
	'chat.agentHost.computerUse.enabled',
	'chat.remoteSessions.tools.enabled',
	'chat.agent.sandbox.enabled',
	'chat.canvases.enabled',
	'dictation.model',
	'workbench.experimental.modernUI',
	'sessions.chat.experimental.newSessionComposerOptionsExpanded',
	'sessions.chat.experimental.environmentPicker',
	'sessions.chat.experimental.environmentPickerManageRemotes',
	'chat.agentHost.moveChats.enabled',
	'sessions.chat.compareAgents.enabled',
	'sessions.list.agentTools.enabled',
	'chat.customizations.marketplace.enabled',
	'chat.automations.enabled',
	'chat.artifactTools.enabled',
];

// ---------------------------------------------------------------- where things are

export class SetupError extends Error {
	constructor(message, code = 'failed') {
		super(message);
		this.code = code;
	}
}

export function osKey(platform = process.platform) {
	return platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
}

export function archKey(arch = process.arch) {
	return arch === 'arm64' ? 'arm64' : 'x64';
}

export function expandHome(value, home = os.homedir()) {
	if (!value) {
		return value;
	}
	if (value === '~') {
		return home;
	}
	if (value.startsWith('~/') || value.startsWith('~\\')) {
		return path.join(home, value.slice(2));
	}
	return value;
}

export function tilde(file, home = os.homedir()) {
	const text = String(file);
	return text === home || text.startsWith(home + path.sep) ? '~' + text.slice(home.length) : text;
}

// Everything a command needs to know about this machine. Tests pass their own.
export function makeContext({ folder, env = process.env, platform = process.platform, arch = process.arch, home = os.homedir(), repoRoot = REPO_ROOT } = {}) {
	const dir = path.resolve(expandHome(folder || env.AI_FIRST_WORKSHOP || path.join(home, 'ai-first-workshop'), home));
	const copilotHome = env.COPILOT_HOME ? path.resolve(expandHome(env.COPILOT_HOME, home)) : path.join(home, '.copilot');
	const key = osKey(platform);
	return {
		folder: dir,
		home,
		env,
		platform,
		os: key,
		arch: archKey(arch),
		target: `${key}-${archKey(arch)}`,
		copilotHome,
		repoRoot,
		tools: path.join(dir, 'tools'),
		setupDir: path.join(dir, '.setup'),
		manifestFile: path.join(dir, '.setup', 'installed.json'),
		summaryFile: path.join(dir, '.setup', 'installed.md'),
		skillsDir: path.join(copilotHome, 'skills'),
		backupsDir: path.join(copilotHome, 'skills-backup', 'ai-first-workshop'),
		cacheDir: path.join(dir, '.setup', 'cache'),
	};
}

// The portable tools' own folders, and the folders that go on PATH for them.
export function toolPaths(ctx) {
	const win = ctx.os === 'win';
	return {
		git: {
			dir: path.join(ctx.tools, 'git'),
			bin: win ? path.join(ctx.tools, 'git', 'cmd', 'git.exe') : path.join(ctx.tools, 'bin', 'git'),
			pathDir: win ? path.join(ctx.tools, 'git', 'cmd') : path.join(ctx.tools, 'bin'),
		},
		node: {
			dir: path.join(ctx.tools, 'node'),
			bin: win ? path.join(ctx.tools, 'node', 'node.exe') : path.join(ctx.tools, 'node', 'bin', 'node'),
			pathDir: win ? path.join(ctx.tools, 'node') : path.join(ctx.tools, 'node', 'bin'),
		},
		gh: {
			dir: path.join(ctx.tools, 'gh'),
			bin: path.join(ctx.tools, 'gh', 'bin', win ? 'gh.exe' : 'gh'),
			pathDir: path.join(ctx.tools, 'gh', 'bin'),
		},
		demo: { dir: path.join(ctx.tools, 'demo') },
	};
}

const exists = (file) => fs.existsSync(file);

async function isFile(file) {
	try {
		return (await fsp.stat(file)).isFile();
	} catch {
		return false;
	}
}

async function readJson(file, fallback = null) {
	try {
		return JSON.parse(await fsp.readFile(file, 'utf8'));
	} catch {
		return fallback;
	}
}

async function writeAtomic(file, text) {
	await fsp.mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
	await fsp.writeFile(temp, text, 'utf8');
	await fsp.rename(temp, file);
}

export async function folderBytes(dir) {
	let total = 0;
	let entries;
	try {
		entries = await fsp.readdir(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			total += await folderBytes(full);
		} else if (entry.isFile()) {
			total += (await fsp.stat(full)).size;
		}
	}
	return total;
}

// ---------------------------------------------------------------- running programs

// Runs a program without a shell. Resolves { code, stdout, stderr } (code null when it couldn't start).
export function run(command, args = [], { cwd, env, timeoutMs = 120000, input } = {}) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
		} catch (error) {
			resolve({ code: null, stdout: '', stderr: String(error.message || error) });
			return;
		}
		const out = [];
		const err = [];
		let done = false;
		const timer = setTimeout(() => {
			if (!done) {
				child.kill();
			}
		}, timeoutMs);
		child.stdout.on('data', (chunk) => out.push(chunk));
		child.stderr.on('data', (chunk) => err.push(chunk));
		child.on('error', (error) => {
			if (!done) {
				done = true;
				clearTimeout(timer);
				resolve({ code: null, stdout: '', stderr: String(error.message || error) });
			}
		});
		child.on('close', (code) => {
			if (!done) {
				done = true;
				clearTimeout(timer);
				resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
			}
		});
		if (input !== undefined) {
			child.stdin.end(input);
		} else {
			child.stdin.end();
		}
	});
}

const firstLine = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';

// The PATH this script's children get: the setup's tool folders first, so gh finds the setup's git.
export function childEnv(ctx, extra = {}) {
	const tools = toolPaths(ctx);
	const dirs = [tools.git.pathDir, tools.node.pathDir, tools.gh.pathDir].filter((dir) => exists(dir));
	const key = Object.keys(ctx.env).find((name) => name.toLowerCase() === 'path') || 'PATH';
	const env = { ...ctx.env };
	delete env.ELECTRON_RUN_AS_NODE;
	env[key] = [...dirs, ctx.env[key] || ''].filter(Boolean).join(path.delimiter);
	env.GH_PROMPT_DISABLED = '1';
	env.GIT_TERMINAL_PROMPT = '0';
	return { ...env, ...extra };
}

// The first program called name on PATH. On Windows it tries PATHEXT too.
export function which(name, ctx, { skip = [] } = {}) {
	const key = Object.keys(ctx.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
	const dirs = String(ctx.env[key] || '').split(path.delimiter).filter(Boolean);
	const exts = ctx.os === 'win' ? ['.exe', '.cmd', '.bat', ''] : [''];
	for (const dir of dirs) {
		if (skip.includes(dir)) {
			continue;
		}
		for (const ext of exts) {
			const file = path.join(dir, name + ext);
			try {
				if (fs.statSync(file).isFile()) {
					return file;
				}
			} catch {
				// Not here.
			}
		}
	}
	return null;
}

// ---------------------------------------------------------------- the record

export function emptyManifest(ctx, now = new Date().toISOString()) {
	return { format: FORMAT, version: VERSION, folder: ctx.folder, createdAt: now, updatedAt: now, os: { name: ctx.os, arch: ctx.arch }, choices: {}, items: {} };
}

export async function readManifest(ctx) {
	const data = await readJson(ctx.manifestFile, null);
	if (!data) {
		return emptyManifest(ctx);
	}
	if (data.format !== FORMAT) {
		throw new SetupError(`${tilde(ctx.manifestFile, ctx.home)} isn't a setup record; it was left as is.`);
	}
	data.items = data.items || {};
	data.choices = data.choices || {};
	return data;
}

// Saves the record and a plain summary next to it (the uninstall guide points people at the summary).
export async function writeManifest(ctx, manifest) {
	manifest.updatedAt = new Date().toISOString();
	await writeAtomic(ctx.manifestFile, JSON.stringify(manifest, null, 1) + '\n');
	await writeAtomic(ctx.summaryFile, summaryText(ctx, manifest));
	return manifest;
}

export async function record(ctx, key, value) {
	const manifest = await readManifest(ctx);
	if (key === 'choices') {
		manifest.choices = { ...manifest.choices, ...value };
	} else {
		manifest.items[key] = { ...(manifest.items[key] || {}), ...value, at: new Date().toISOString() };
	}
	return writeManifest(ctx, manifest);
}

export function summaryText(ctx, manifest) {
	const t = (file) => tilde(file, ctx.home);
	const items = manifest.items;
	const lines = ['# What the workshop setup added', '', `Folder: ${t(ctx.folder)}`, ''];
	lines.push('To take it all back out, see the uninstall guide:', UNINSTALL_URL, '', '## Tools', '');
	for (const id of ['git', 'node', 'gh']) {
		const entry = items[id];
		const name = { git: 'Git', node: 'Node.js', gh: 'GitHub CLI' }[id];
		if (!entry) {
			lines.push(`- ${name}: not set up yet.`);
		} else if (entry.by === 'setup') {
			lines.push(`- ${name}: installed by the setup in ${t(entry.dir)}. It goes away with the folder.`);
		} else {
			lines.push(`- ${name}: yours, already here (${t(entry.path || '')}). The setup didn't change it.`);
		}
	}
	if (items.path_block) {
		lines.push(`- PATH: a block marked "${PATH_MARK}" in ${t(items.path_block.file)}.`);
	}
	if (items.user_path) {
		lines.push(`- PATH: these entries in your user Path: ${(items.user_path.entries || []).join('; ')}.`);
	}
	if (items.github) {
		const g = items.github;
		if (g.credential_helper) {
			lines.push('- Git signs in through the GitHub CLI (`gh auth setup-git`).');
		}
		if (g.set_name || g.set_email) {
			lines.push(`- Git's name and email for commits: ${[g.set_name ? 'name' : null, g.set_email ? 'email' : null].filter(Boolean).join(' and ')} set by the setup.`);
		}
		if (g.created_gh_config) {
			lines.push(`- GitHub CLI sign-in: the setup created ${t(g.gh_config || '')}.`);
		}
	}
	lines.push('', '## Skills', '');
	const skills = Object.entries(items).filter(([id]) => id === 'skills' || id in OPTIONAL_SKILLS);
	if (!skills.length) {
		lines.push('- None yet.');
	}
	for (const [, entry] of skills) {
		for (const [name, info] of Object.entries(entry.installed || {})) {
			lines.push(`- ${name} in ${t(info.path)}${info.backup ? `; your earlier copy is saved in ${t(info.backup)}` : ''}.`);
		}
		for (const [name, why] of Object.entries(entry.kept || {})) {
			lines.push(`- ${name}: kept yours (${why}).`);
		}
	}
	lines.push('', '## Workshop', '');
	if (items.excalidraw?.repo) {
		lines.push(`- Your Excalidraw repo: https://github.com/${items.excalidraw.repo} (local copy in ${t(items.excalidraw.path)}).`);
	}
	if (items.resources) {
		lines.push(`- Workshop resources in ${t(items.resources.path)}.`);
	}
	if (items.demo_tools) {
		lines.push(`- Demo video tools in ${t(items.demo_tools.path)}.`);
	}
	if (items.canvas) {
		lines.push(`- The setup checklist in ${t(items.canvas.path)} (its progress in ${t(items.canvas.data)}).`);
	}
	if (items.taste_weekly?.automationId) {
		lines.push(`- The "${TASTE_AUTOMATION_NAME}" automation in the Agents window.`);
	}
	lines.push('');
	return lines.join('\n');
}

// ---------------------------------------------------------------- checks

const VERSION_RE = /(\d+)\.(\d+)(?:\.(\d+))?/;

export function parseVersion(text) {
	const m = VERSION_RE.exec(String(text || ''));
	return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] || 0), text: m[0] } : null;
}

async function macCommandLineTools(ctx) {
	if (ctx.os !== 'mac') {
		return false;
	}
	const result = await run('/usr/bin/xcode-select', ['-p'], { env: ctx.env, timeoutMs: 10000 });
	const dir = result.stdout.trim();
	return result.code === 0 && !!dir && exists(dir);
}

// A Git the person can use. On a Mac, /usr/bin/git only works once Apple's command line tools are installed (before
// that, running it opens an install dialog), so it's never run without them.
const ignoreSystem = (ctx) => ctx.env.AI_FIRST_IGNORE_SYSTEM_TOOLS === '1';

export async function findGit(ctx) {
	const tools = toolPaths(ctx);
	const candidates = [];
	if (await isFile(tools.git.bin)) {
		candidates.push({ file: tools.git.bin, by: 'setup' });
	}
	if (ignoreSystem(ctx)) {
		// Testing: only the setup's own copy counts.
	} else if (ctx.os === 'mac') {
		const clt = await macCommandLineTools(ctx);
		for (const file of ['/opt/homebrew/bin/git', '/usr/local/bin/git']) {
			if (await isFile(file)) {
				candidates.push({ file, by: 'yours' });
			}
		}
		const onPath = which('git', ctx, { skip: clt ? [tools.git.pathDir] : ['/usr/bin', tools.git.pathDir] });
		if (onPath) {
			candidates.push({ file: onPath, by: 'yours' });
		}
	} else {
		const onPath = which('git', ctx, { skip: [tools.git.pathDir] });
		if (onPath) {
			candidates.push({ file: onPath, by: 'yours' });
		}
		if (ctx.os === 'win' && ctx.env.ProgramFiles) {
			const file = path.join(ctx.env.ProgramFiles, 'Git', 'cmd', 'git.exe');
			if (await isFile(file)) {
				candidates.push({ file, by: 'yours' });
			}
		}
	}
	for (const candidate of candidates) {
		const result = await run(candidate.file, ['--version'], { env: childEnv(ctx), timeoutMs: 15000 });
		const version = result.code === 0 ? parseVersion(result.stdout) : null;
		if (version) {
			return { ...candidate, version: version.text };
		}
	}
	return null;
}

export async function findNode(ctx) {
	const tools = toolPaths(ctx);
	const candidates = [];
	if (await isFile(tools.node.bin)) {
		candidates.push({ file: tools.node.bin, by: 'setup' });
	}
	const onPath = ignoreSystem(ctx) ? null : which('node', ctx, { skip: [tools.node.pathDir] });
	if (onPath) {
		candidates.push({ file: onPath, by: 'yours' });
	}
	let tooOld = null;
	for (const candidate of candidates) {
		const env = childEnv(ctx);
		const result = await run(candidate.file, ['--version'], { env, timeoutMs: 15000 });
		const version = result.code === 0 ? parseVersion(result.stdout) : null;
		if (!version) {
			continue;
		}
		if (version.major >= MIN_NODE_MAJOR) {
			return { ...candidate, version: version.text, major: version.major };
		}
		tooOld = tooOld || { ...candidate, version: version.text, major: version.major };
	}
	return tooOld ? { ...tooOld, tooOld: true } : null;
}

export function ghConfigDir(ctx) {
	if (ctx.env.GH_CONFIG_DIR) {
		return ctx.env.GH_CONFIG_DIR;
	}
	if (ctx.os === 'win') {
		return path.join(ctx.env.APPDATA || path.join(ctx.home, 'AppData', 'Roaming'), 'GitHub CLI');
	}
	return path.join(ctx.env.XDG_CONFIG_HOME || path.join(ctx.home, '.config'), 'gh');
}

// The GitHub CLI's signed-in accounts for github.com, from its hosts.yml. Tokens are never read.
export function parseGhHosts(text) {
	const lines = String(text || '').split(/\r?\n/);
	let inHost = false;
	let inUsers = false;
	let usersIndent = -1;
	let active = null;
	const users = [];
	for (const raw of lines) {
		if (!raw.trim() || raw.trim().startsWith('#')) {
			continue;
		}
		const indent = raw.length - raw.trimStart().length;
		const line = raw.trim();
		if (indent === 0) {
			inHost = /^"?github\.com"?\s*:/.test(line);
			inUsers = false;
			continue;
		}
		if (!inHost) {
			continue;
		}
		if (inUsers && indent <= usersIndent) {
			inUsers = false;
		}
		if (inUsers) {
			if (indent === usersIndent + 4 || (indent > usersIndent && /^[^\s:]+:\s*$/.test(line))) {
				const name = line.replace(/:\s*$/, '').replace(/^"|"$/g, '');
				if (name && !users.includes(name) && /:\s*$/.test(line)) {
					users.push(name);
				}
			}
			continue;
		}
		const m = /^(user|users)\s*:\s*(.*)$/.exec(line);
		if (m && m[1] === 'users') {
			inUsers = true;
			usersIndent = indent;
		} else if (m && m[1] === 'user' && m[2]) {
			active = m[2].replace(/^"|"$/g, '').trim();
		}
	}
	if (active && !users.includes(active)) {
		users.unshift(active);
	}
	return { active, users };
}

// A Microsoft work account on GitHub is an Enterprise Managed User. Their usernames always end in an underscore and
// a short code; a personal GitHub username can't have an underscore at all.
export const isManagedLogin = (login) => typeof login === 'string' && /^[A-Za-z0-9-]+_[A-Za-z0-9]+$/.test(login);

export async function findGh(ctx) {
	const tools = toolPaths(ctx);
	let found = null;
	if (await isFile(tools.gh.bin)) {
		found = { file: tools.gh.bin, by: 'setup' };
	} else {
		const onPath = ignoreSystem(ctx) ? null : which('gh', ctx, { skip: [tools.gh.pathDir] });
		if (onPath) {
			found = { file: onPath, by: 'yours' };
		}
	}
	if (found) {
		const result = await run(found.file, ['--version'], { env: childEnv(ctx), timeoutMs: 15000 });
		const version = result.code === 0 ? parseVersion(result.stdout) : null;
		found = version ? { ...found, version: version.text } : null;
	}
	const hostsFile = path.join(ghConfigDir(ctx), 'hosts.yml');
	let hosts = { active: null, users: [] };
	try {
		hosts = parseGhHosts(await fsp.readFile(hostsFile, 'utf8'));
	} catch {
		// Not signed in on this machine yet.
	}
	return { cli: found, active: hosts.active, users: hosts.users, configDir: ghConfigDir(ctx) };
}

export function browserCandidates(ctx) {
	if (ctx.os === 'mac') {
		const apps = ['/Applications', path.join(ctx.home, 'Applications')];
		return [
			...apps.map((dir) => ({ channel: 'chrome', name: 'Google Chrome', file: path.join(dir, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome') })),
			...apps.map((dir) => ({ channel: 'msedge', name: 'Microsoft Edge', file: path.join(dir, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge') })),
		];
	}
	if (ctx.os === 'win') {
		const roots = [ctx.env.ProgramFiles, ctx.env['ProgramFiles(x86)'], ctx.env.LOCALAPPDATA].filter(Boolean);
		return [
			...roots.map((root) => ({ channel: 'chrome', name: 'Google Chrome', file: path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe') })),
			...roots.map((root) => ({ channel: 'msedge', name: 'Microsoft Edge', file: path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe') })),
		];
	}
	return [];
}

export async function findBrowser(ctx) {
	for (const candidate of browserCandidates(ctx)) {
		if (await isFile(candidate.file)) {
			return candidate;
		}
	}
	return null;
}

export function vscodeSettingsFile(ctx) {
	if (ctx.os === 'mac') {
		return path.join(ctx.home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'settings.json');
	}
	if (ctx.os === 'win') {
		return path.join(ctx.env.APPDATA || path.join(ctx.home, 'AppData', 'Roaming'), 'Code - Insiders', 'User', 'settings.json');
	}
	return path.join(ctx.env.XDG_CONFIG_HOME || path.join(ctx.home, '.config'), 'Code - Insiders', 'User', 'settings.json');
}

// JSON with comments and trailing commas, as VS Code writes it.
export function parseJsonc(text) {
	let out = '';
	let i = 0;
	let inString = false;
	const src = String(text || '');
	while (i < src.length) {
		const ch = src[i];
		const next = src[i + 1];
		if (inString) {
			out += ch;
			if (ch === '\\') {
				out += next ?? '';
				i += 2;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			i++;
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
			i++;
		} else if (ch === '/' && next === '/') {
			while (i < src.length && src[i] !== '\n') {
				i++;
			}
		} else if (ch === '/' && next === '*') {
			i += 2;
			while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
				i++;
			}
			i += 2;
		} else {
			out += ch;
			i++;
		}
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1') || '{}');
}

export async function readVscodeSettings(ctx) {
	try {
		return parseJsonc(await fsp.readFile(vscodeSettingsFile(ctx), 'utf8'));
	} catch {
		return null;
	}
}

export function editionDir(ctx, name) {
	return path.join(ctx.repoRoot, 'editions', 'ai-first', name);
}

async function sameSkill(a, b) {
	try {
		const [x, y] = await Promise.all([fsp.readFile(path.join(a, 'SKILL.md')), fsp.readFile(path.join(b, 'SKILL.md'))]);
		return x.equals(y);
	} catch {
		return false;
	}
}

// Skills the person's own full setup manages: a maintainer or attendee clone of the skills with the daily sync. The
// AI-First path never overwrites those.
export async function managedSkills(ctx) {
	const settings = path.join(ctx.copilotHome, 'skills-sync.json');
	if (exists(settings)) {
		return { managed: true, why: 'your own skills setup keeps these up to date (skills-sync.json)' };
	}
	const clone = path.join(ctx.copilotHome, 'autonomous-output-skills');
	if (exists(path.join(clone, '.git'))) {
		const git = await findGit(ctx);
		if (git) {
			const result = await run(git.file, ['-C', clone, 'remote', 'get-url', 'origin'], { env: childEnv(ctx), timeoutMs: 15000 });
			const url = result.stdout.trim().toLowerCase().replace(/\.git$/, '');
			if (result.code === 0 && url && !url.endsWith(PUBLIC_SKILLS_REPO.toLowerCase())) {
				return { managed: true, why: 'your own copy of the skills is in ~/.copilot/autonomous-output-skills' };
			}
		}
	}
	return { managed: false, why: null };
}

function sizeFor(id, ctx, live = null) {
	if (live !== null) {
		return { download: live, disk: live };
	}
	const table = SIZES[id];
	const entry = table?.[ctx.target] || table?.all || null;
	return entry ? { download: Math.round(entry[0] * MB), disk: Math.round(entry[1] * MB) } : { download: 0, disk: 0 };
}

async function freeBytes(dir) {
	try {
		let probe = dir;
		while (!exists(probe) && path.dirname(probe) !== probe) {
			probe = path.dirname(probe);
		}
		const stats = await fsp.statfs(probe);
		return stats.bavail * stats.bsize;
	} catch {
		return null;
	}
}

// What's here now, in the shape check-setup.py uses (items with ok, required, detail), plus each item's size and
// whether it's needed on this machine. Read only: it never installs, never changes a file, and needs no network.
// With repoName, it also asks GitHub which name install excalidraw would give their copy (excalidraw.next_repo).
export async function check(ctx, { repoName = false } = {}) {
	const manifest = await readManifest(ctx);
	const tools = toolPaths(ctx);
	const [git, node, gh, browser, settings, managed] = await Promise.all([
		findGit(ctx), findNode(ctx), findGh(ctx), findBrowser(ctx), readVscodeSettings(ctx), managedSkills(ctx),
	]);
	const items = {};
	const t = (file) => tilde(file, ctx.home);

	items.git = {
		ok: !!git,
		required: true,
		needed: !git,
		detail: git ? `Git ${git.version}${git.by === 'setup' ? ', installed by the setup' : ''}` : 'not on this computer yet',
		by: git?.by || null,
		path: git?.file || null,
		size: git ? { download: 0, disk: 0 } : sizeFor('git', ctx),
	};
	items.node = {
		ok: !!node && !node.tooOld,
		required: true,
		needed: !node || !!node.tooOld,
		detail: !node ? 'not on this computer yet' : node.tooOld ? `Node.js ${node.version} is older than ${MIN_NODE_MAJOR}` : `Node.js ${node.version}${node.by === 'setup' ? ', installed by the setup' : ''}`,
		by: node && !node.tooOld ? node.by : null,
		path: node?.file || null,
		size: node && !node.tooOld ? { download: 0, disk: 0 } : sizeFor('node', ctx),
	};
	const login = gh.active || gh.users[0] || null;
	items.gh = {
		ok: !!gh.cli && !!login,
		required: true,
		needed: !gh.cli,
		detail: !gh.cli ? 'not on this computer yet' : login ? `signed in as ${login}` : `GitHub CLI ${gh.cli.version}, not signed in yet`,
		installed: !!gh.cli,
		signed_in: !!login,
		login,
		by: gh.cli?.by || null,
		path: gh.cli?.file || null,
		size: gh.cli ? { download: 0, disk: 0 } : sizeFor('gh', ctx),
	};

	const skillState = async (names) => {
		const out = { installed: [], missing: [], kept: [], bytes: 0, available: [] };
		for (const name of names) {
			const source = editionDir(ctx, name);
			const target = path.join(ctx.skillsDir, name);
			if (exists(path.join(source, 'SKILL.md'))) {
				out.available.push(name);
				out.bytes += await folderBytes(source);
			}
			if (await sameSkill(source, target)) {
				out.installed.push(name);
			} else if (managed.managed && exists(path.join(target, 'SKILL.md'))) {
				out.kept.push(name);
			} else {
				out.missing.push(name);
			}
		}
		return out;
	};
	const required = await skillState(REQUIRED_SKILLS);
	items.skills = {
		ok: required.missing.length === 0 && required.available.length > 0,
		required: true,
		needed: required.missing.length > 0,
		detail: required.available.length === 0
			? 'the light skills aren\'t in this copy of the skills yet'
			: required.missing.length === 0
				? (required.kept.length ? `kept your own: ${required.kept.join(', ')}` : `${required.installed.length} of ${REQUIRED_SKILLS.length} installed`)
				: `${required.installed.length + required.kept.length} of ${REQUIRED_SKILLS.length} installed`,
		kept: required.kept,
		size: sizeFor('skills', ctx, required.bytes),
	};
	for (const [id, name] of Object.entries(OPTIONAL_SKILLS)) {
		const state = await skillState([name]);
		items[id] = {
			ok: state.missing.length === 0 && state.available.length > 0,
			required: false,
			needed: state.missing.length > 0,
			detail: state.available.length === 0 ? 'not in this copy of the skills yet' : state.kept.length ? 'kept your own' : state.installed.length ? 'installed' : 'not installed',
			size: sizeFor(id, ctx, state.bytes),
		};
	}

	const excalidraw = manifest.items.excalidraw || null;
	const repoDir = excalidraw?.path || path.join(ctx.folder, REPO_NAME);
	const cloned = exists(path.join(repoDir, '.git'));
	const packagesIn = exists(path.join(repoDir, 'node_modules'));
	items.excalidraw = {
		ok: cloned && packagesIn && !!excalidraw?.repo,
		required: true,
		needed: !(cloned && packagesIn),
		detail: !cloned ? 'not created yet' : !packagesIn ? `${excalidraw?.repo || t(repoDir)} is cloned; its packages aren't installed yet` : `${excalidraw?.repo || 'your copy'} in ${t(repoDir)}`,
		repo: excalidraw?.repo || null,
		path: repoDir,
		size: cloned && packagesIn ? { download: 0, disk: 0 } : sizeFor('excalidraw', ctx),
	};
	if (repoName && !excalidraw?.repo) {
		if (!gh.cli || !login) {
			Object.assign(items.excalidraw, { next_repo: null, next_repo_note: 'sign in to GitHub first' });
		} else {
			try {
				const next = await nextRepo(ctx, gh.cli.file, login);
				Object.assign(items.excalidraw, { next_repo: next, next_live: `https://${login}.github.io/${next.split('/')[1]}/` });
			} catch (error) {
				Object.assign(items.excalidraw, { next_repo: null, next_repo_note: String(error?.message || error) });
			}
		}
	}

	const resourcesSource = path.join(ctx.repoRoot, 'autonomous-setup', 'ai-first', 'resources');
	const resourcesBytes = await folderBytes(resourcesSource);
	const resourcesHere = exists(path.join(ctx.folder, 'resources', 'README.md'));
	items.resources = {
		ok: resourcesHere,
		required: true,
		needed: !resourcesHere,
		detail: resourcesHere ? `in ${t(path.join(ctx.folder, 'resources'))}` : 'not copied yet',
		size: sizeFor('resources', ctx, resourcesHere ? 0 : resourcesBytes),
	};

	const demoInfo = await readJson(path.join(tools.demo.dir, 'demo-tools.json'), null);
	const demoOk = !!demoInfo && exists(demoInfo.ffmpeg || '') && exists(demoInfo.playwrightCore || '');
	const demoSize = sizeFor('demo_tools', ctx);
	const shell = sizeFor('browser', ctx);
	items.demo_tools = {
		ok: demoOk,
		required: true,
		needed: !demoOk,
		detail: demoOk ? `ready, recording with ${demoInfo.browserName || 'the browser it installed'}` : browser ? `uses your ${browser.name}` : 'no Chrome or Edge here, so it adds a small browser for recording',
		browser: browser ? browser.name : null,
		size: demoOk ? { download: 0, disk: 0 } : browser ? demoSize : { download: demoSize.download + shell.download, disk: demoSize.disk + shell.disk },
		fallback: browser ? null : shell,
	};

	const cuSetting = settings?.['chat.agentHost.computerUse.enabled'] === true;
	const cuInstalled = exists(path.join(ctx.copilotHome, 'computer-use'));
	items.computer_use = {
		ok: cuSetting,
		required: true,
		needed: false,
		detail: !cuSetting ? 'the Computer Use setting isn\'t on yet' : cuInstalled ? 'on' : 'on; its helper downloads the first time you use it',
		size: cuInstalled ? { download: 0, disk: 0 } : sizeFor('computer_use', ctx),
	};
	const dictation = settings?.['dictation.model'] === 'mai';
	items.dictation = {
		ok: dictation,
		required: true,
		needed: false,
		detail: dictation ? 'cloud dictation is on (nothing to download)' : 'the dictation setting isn\'t on yet',
		size: { download: 0, disk: 0 },
	};
	const taste = manifest.items.taste_weekly || null;
	items.taste_weekly = {
		ok: taste?.automationId ? true : null,
		required: false,
		needed: !taste?.automationId,
		detail: taste?.automationId ? `"${TASTE_AUTOMATION_NAME}" runs every Monday` : 'set up after the skills, in the Agents window',
		size: { download: 0, disk: 0 },
	};

	const managedLogins = gh.users.filter(isManagedLogin);
	items.microsoft_signin = {
		ok: managedLogins.length > 0,
		required: false,
		gate: true,
		detail: managedLogins.length ? `signed in with a work account (${managedLogins[0]})` : gh.users.length ? 'signed in with a personal account only' : 'not signed in with GitHub CLI yet',
		size: { download: 0, disk: 0 },
	};

	const missingSettings = settings ? SETTINGS_KEYS.filter((key) => !(key in settings)) : SETTINGS_KEYS.slice();
	return {
		time: new Date().toISOString(),
		path: 'ai-first',
		os: { name: ctx.os === 'mac' ? 'macOS' : ctx.os === 'win' ? 'Windows' : 'Linux', key: ctx.os, arch: ctx.arch, version: os.release() },
		folder: ctx.folder,
		folder_display: t(ctx.folder),
		free_bytes: await freeBytes(ctx.folder),
		uninstall_url: UNINSTALL_URL,
		settings: { file: t(vscodeSettingsFile(ctx)), found: !!settings, missing: missingSettings },
		managed_skills: managed,
		runtime: { node: process.execPath, electron: !!process.versions.electron, version: process.version },
		items,
		steps: {},
	};
}

// ---------------------------------------------------------------- downloads

async function sha256File(file) {
	const hash = createHash('sha256');
	await pipeline(fs.createReadStream(file), hash);
	return hash.digest('hex');
}

// Downloads url to file, retrying twice, then checks the checksum when one is known.
export async function download(url, file, { sha256 = null, attempts = 3, fetchImpl = globalThis.fetch } = {}) {
	await fsp.mkdir(path.dirname(file), { recursive: true });
	let last = null;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const temp = `${file}.part`;
		try {
			const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60 * 1000) });
			if (!response.ok || !response.body) {
				throw new Error(`HTTP ${response.status}`);
			}
			await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));
			if (sha256) {
				const got = await sha256File(temp);
				if (got !== sha256.toLowerCase()) {
					await fsp.rm(temp, { force: true });
					throw new SetupError(`the download of ${path.basename(file)} didn't match its published checksum, so it wasn't used`);
				}
			}
			await fsp.rename(temp, file);
			return file;
		} catch (error) {
			last = error;
			await fsp.rm(temp, { force: true }).catch(() => {});
			if (error instanceof SetupError) {
				throw error;
			}
			if (attempt < attempts) {
				await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
			}
		}
	}
	throw new SetupError(`couldn't download ${url} (${last?.message || 'no answer'}). Check the Wi-Fi and try again.`);
}

async function fetchText(url, fetchImpl = globalThis.fetch) {
	const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
	if (!response.ok) {
		throw new SetupError(`couldn't read ${url} (HTTP ${response.status})`);
	}
	return response.text();
}

// "<sha256>  <file name>" lines, as in SHASUMS256.txt and gh's checksums file.
export function checksumFor(text, name) {
	for (const line of String(text || '').split(/\r?\n/)) {
		const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
		if (m && m[2].trim() === name) {
			return m[1].toLowerCase();
		}
	}
	return null;
}

function tarCommand(ctx) {
	if (ctx.os === 'win') {
		return path.join(ctx.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
	}
	return '/usr/bin/tar';
}

async function extract(ctx, archive, dest) {
	await fsp.mkdir(dest, { recursive: true });
	const result = await run(tarCommand(ctx), ['-xf', archive, '-C', dest], { env: ctx.env, timeoutMs: 10 * 60 * 1000 });
	if (result.code !== 0) {
		throw new SetupError(`couldn't unpack ${path.basename(archive)}: ${firstLine(result.stderr) || `exit ${result.code}`}`);
	}
}

// Unpacks into a fresh staging folder, then swaps it in, so a failed install never leaves half a tool.
async function installFolder(ctx, finalDir, fill) {
	const staging = `${finalDir}.new-${process.pid}`;
	await fsp.rm(staging, { recursive: true, force: true });
	await fsp.mkdir(staging, { recursive: true });
	try {
		await fill(staging);
		await fsp.rm(finalDir, { recursive: true, force: true });
		await fsp.rename(staging, finalDir);
	} catch (error) {
		await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
}

// Moves the only folder inside dir up one level (archives that wrap everything in node-v26.x.y-darwin-arm64/).
async function flatten(dir) {
	const entries = (await fsp.readdir(dir)).filter((name) => !name.startsWith('.'));
	if (entries.length !== 1) {
		return;
	}
	const inner = path.join(dir, entries[0]);
	if (!(await fsp.stat(inner)).isDirectory()) {
		return;
	}
	for (const name of await fsp.readdir(inner)) {
		await fsp.rename(path.join(inner, name), path.join(dir, name));
	}
	await fsp.rmdir(inner);
}

// ---------------------------------------------------------------- PATH

export function pathBlock(ctx, dirs) {
	const shown = dirs.map((dir) => (dir.startsWith(ctx.home + path.sep) ? `$HOME${dir.slice(ctx.home.length)}` : dir));
	return [
		`# >>> ${PATH_MARK} >>>`,
		'# Added by the AI-First Design Workshop setup, so new terminals and VS Code find its tools. Delete this block to undo it.',
		`export PATH="${shown.join(':')}:$PATH"`,
		`# <<< ${PATH_MARK} <<<`,
	].join('\n');
}

export function stripPathBlock(text) {
	const start = `# >>> ${PATH_MARK} >>>`;
	const end = `# <<< ${PATH_MARK} <<<`;
	const lines = String(text).split('\n');
	const out = [];
	let skipping = false;
	for (const line of lines) {
		if (line.trim() === start) {
			skipping = true;
			continue;
		}
		if (skipping && line.trim() === end) {
			skipping = false;
			continue;
		}
		if (!skipping) {
			out.push(line);
		}
	}
	return out.join('\n').replace(/\n{3,}$/, '\n\n');
}

export function profileFile(ctx) {
	const shell = String(ctx.env.SHELL || '');
	return path.join(ctx.home, shell.endsWith('/bash') ? '.bash_profile' : '.zprofile');
}

// The PowerShell that puts the setup's folders first on the user's Path, or takes them off. It keeps the other
// entries and their %VARIABLES% as they are, and tells Windows the environment changed.
export function windowsPathScript({ add = [], remove = [] }) {
	const list = (items) => `@(${items.map((item) => `'${String(item).replace(/'/g, "''")}'`).join(', ')})`;
	return [
		'$ErrorActionPreference = "Stop"',
		"$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')",
		"$old = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
		`$add = ${list(add)}`,
		`$remove = ${list(remove)}`,
		"$parts = @($old -split ';' | Where-Object { $_ -ne '' -and $add -notcontains $_ -and $remove -notcontains $_ })",
		"$new = (@($add) + $parts) -join ';'",
		"$k.SetValue('Path', $new, [Microsoft.Win32.RegistryValueKind]::ExpandString)",
		'$k.Close()',
		"[Environment]::SetEnvironmentVariable('AI_FIRST_WORKSHOP_REFRESH', '1', 'User')",
		"[Environment]::SetEnvironmentVariable('AI_FIRST_WORKSHOP_REFRESH', $null, 'User')",
	].join('\n');
}

async function powershell(ctx, script) {
	const exe = path.join(ctx.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
	const encoded = Buffer.from(script, 'utf16le').toString('base64');
	const result = await run(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { env: ctx.env, timeoutMs: 60000 });
	if (result.code !== 0) {
		throw new SetupError(`PowerShell couldn't update your Path: ${firstLine(result.stderr) || `exit ${result.code}`}`);
	}
}

// Points new terminals (and VS Code, after a restart) at the setup's tools. Only the folders of tools the setup
// installed go on PATH.
export async function ensurePath(ctx) {
	const manifest = await readManifest(ctx);
	const tools = toolPaths(ctx);
	const dirs = ['git', 'node', 'gh'].filter((id) => manifest.items[id]?.by === 'setup').map((id) => tools[id].pathDir);
	if (!dirs.length) {
		return { changed: false };
	}
	if (ctx.os === 'win') {
		await powershell(ctx, windowsPathScript({ add: dirs }));
		await record(ctx, 'user_path', { entries: dirs });
		return { changed: true, entries: dirs };
	}
	const file = profileFile(ctx);
	let text = '';
	try {
		text = await fsp.readFile(file, 'utf8');
	} catch {
		// A new profile file.
	}
	const existed = exists(file);
	const base = stripPathBlock(text).replace(/\s*$/, '');
	const next = (base ? base + '\n\n' : '') + pathBlock(ctx, dirs) + '\n';
	if (next !== text) {
		await writeAtomic(file, next);
	}
	const previous = manifest.items.path_block;
	await record(ctx, 'path_block', { file, created_file: previous ? !!previous.created_file : !existed, dirs });
	return { changed: next !== text, file };
}

export function envLine(ctx, format = 'sh') {
	const tools = toolPaths(ctx);
	const dirs = [tools.git.pathDir, tools.node.pathDir, tools.gh.pathDir].filter((dir) => exists(dir));
	if (format === 'ps') {
		return dirs.length ? `$env:Path = "${dirs.join(';')};" + $env:Path` : '';
	}
	return dirs.length ? `export PATH="${dirs.join(':')}:$PATH"` : '';
}

// ---------------------------------------------------------------- installs

async function installGit(ctx, { fetchImpl } = {}) {
	const found = await findGit(ctx);
	if (found) {
		await record(ctx, 'git', found.by === 'setup' ? { by: 'setup', dir: toolPaths(ctx).git.dir, version: found.version } : { by: 'yours', path: found.file, version: found.version });
		return { changed: false, detail: `Git ${found.version} is already here` };
	}
	const tools = toolPaths(ctx);
	if (ctx.os === 'mac') {
		const pin = PINS.git.mac;
		const name = pin[ctx.arch];
		const archive = path.join(ctx.cacheDir, name);
		const sum = (await fetchText(pin.base + name + '.sha256', fetchImpl)).trim().split(/\s+/)[0];
		await download(pin.base + name, archive, { sha256: sum, fetchImpl });
		await installFolder(ctx, tools.git.dir, async (staging) => {
			await extract(ctx, archive, staging);
			// GitHub Desktop's build carries its own sign-in helper and Git LFS, about 125 MB the workshop doesn't use:
			// git signs in through the GitHub CLI instead.
			const core = path.join(staging, 'libexec', 'git-core');
			for (const entry of await fsp.readdir(core)) {
				if (entry.startsWith('git-credential-manager') || entry === 'git-lfs' || !(entry.startsWith('git') || entry === 'NOTICE')) {
					await fsp.rm(path.join(core, entry), { recursive: true, force: true });
				}
			}
		});
		// The build expects its folders in the environment, so git is called through a small wrapper.
		const wrapper = [
			'#!/bin/sh',
			'# Git from the AI-First Design Workshop setup. Delete the ai-first-workshop folder to remove it.',
			`GIT_DIR_ROOT='${tools.git.dir.replace(/'/g, "'\\''")}'`,
			'GIT_EXEC_PATH="$GIT_DIR_ROOT/libexec/git-core"',
			'GIT_TEMPLATE_DIR="$GIT_DIR_ROOT/share/git-core/templates"',
			'export GIT_EXEC_PATH GIT_TEMPLATE_DIR',
			'exec "$GIT_DIR_ROOT/bin/git" "$@"',
			'',
		].join('\n');
		await fsp.mkdir(path.dirname(tools.git.bin), { recursive: true });
		await fsp.writeFile(tools.git.bin, wrapper, { mode: 0o755 });
		await fsp.rm(archive, { force: true });
	} else if (ctx.os === 'win') {
		const pin = PINS.git.win;
		const name = pin[ctx.arch];
		const archive = path.join(ctx.cacheDir, name);
		await download(pin.base + name, archive, { sha256: pin.sha256[name] || null, fetchImpl });
		await installFolder(ctx, tools.git.dir, async (staging) => {
			await extract(ctx, archive, staging);
		});
		await fsp.rm(archive, { force: true });
	} else {
		throw new SetupError('install Git with your package manager on Linux; the workshop setup covers macOS and Windows');
	}
	const after = await findGit(ctx);
	if (!after || after.by !== 'setup') {
		throw new SetupError('Git was unpacked but doesn\'t run. Ask your host; Apple\'s command line tools are the fallback on a Mac.');
	}
	await record(ctx, 'git', { by: 'setup', dir: tools.git.dir, version: after.version });
	await ensurePath(ctx);
	return { changed: true, detail: `Git ${after.version} in ${tilde(tools.git.dir, ctx.home)}` };
}

async function installNode(ctx, { fetchImpl } = {}) {
	const found = await findNode(ctx);
	if (found && !found.tooOld) {
		await record(ctx, 'node', found.by === 'setup' ? { by: 'setup', dir: toolPaths(ctx).node.dir, version: found.version } : { by: 'yours', path: found.file, version: found.version });
		return { changed: false, detail: `Node.js ${found.version} is already here` };
	}
	const tools = toolPaths(ctx);
	const sums = await fetchText(PINS.node.base + 'SHASUMS256.txt', fetchImpl);
	const suffix = ctx.os === 'mac' ? `darwin-${ctx.arch}.tar.xz` : ctx.os === 'win' ? `win-${ctx.arch}.zip` : `linux-${ctx.arch}.tar.xz`;
	const line = sums.split(/\r?\n/).find((entry) => entry.trim().endsWith(suffix) && /node-v\d+\.\d+\.\d+-/.test(entry));
	if (!line) {
		throw new SetupError(`couldn't find the Node.js download for ${suffix}`);
	}
	const name = line.trim().split(/\s+/).pop();
	const archive = path.join(ctx.cacheDir, name);
	await download(PINS.node.base + name, archive, { sha256: checksumFor(sums, name), fetchImpl });
	await installFolder(ctx, tools.node.dir, async (staging) => {
		await extract(ctx, archive, staging);
		await flatten(staging);
		// C headers for compiling native add-ons: the workshop builds none, and npm fetches them if one ever needs them.
		await fsp.rm(path.join(staging, 'include'), { recursive: true, force: true });
	});
	await fsp.rm(archive, { force: true });
	const after = await findNode(ctx);
	if (!after || after.by !== 'setup') {
		throw new SetupError('Node.js was unpacked but doesn\'t run');
	}
	await record(ctx, 'node', { by: 'setup', dir: tools.node.dir, version: after.version, replaced: found?.tooOld ? found.version : null });
	await ensurePath(ctx);
	return { changed: true, detail: `Node.js ${after.version} in ${tilde(tools.node.dir, ctx.home)}` };
}

async function installGh(ctx, { fetchImpl } = {}) {
	const found = await findGh(ctx);
	if (found.cli) {
		await record(ctx, 'gh', found.cli.by === 'setup' ? { by: 'setup', dir: toolPaths(ctx).gh.dir, version: found.cli.version } : { by: 'yours', path: found.cli.file, version: found.cli.version });
		return { changed: false, detail: `GitHub CLI ${found.cli.version} is already here` };
	}
	const tools = toolPaths(ctx);
	const pin = PINS.gh;
	const name = ctx.os === 'mac'
		? `gh_${pin.version}_macOS_${ctx.arch === 'arm64' ? 'arm64' : 'amd64'}.zip`
		: ctx.os === 'win' ? `gh_${pin.version}_windows_${ctx.arch === 'arm64' ? 'arm64' : 'amd64'}.zip` : null;
	if (!name) {
		throw new SetupError('install the GitHub CLI with your package manager on Linux');
	}
	const sums = await fetchText(pin.base + pin.checksums, fetchImpl);
	const archive = path.join(ctx.cacheDir, name);
	await download(pin.base + name, archive, { sha256: checksumFor(sums, name), fetchImpl });
	await installFolder(ctx, tools.gh.dir, async (staging) => {
		await extract(ctx, archive, staging);
		await flatten(staging);
	});
	await fsp.rm(archive, { force: true });
	const after = await findGh(ctx);
	if (!after.cli || after.cli.by !== 'setup') {
		throw new SetupError('the GitHub CLI was unpacked but doesn\'t run');
	}
	await record(ctx, 'gh', { by: 'setup', dir: tools.gh.dir, version: after.cli.version, had_config: exists(path.join(ghConfigDir(ctx), 'hosts.yml')) });
	await ensurePath(ctx);
	return { changed: true, detail: `GitHub CLI ${after.cli.version} in ${tilde(tools.gh.dir, ctx.home)}` };
}

async function ghJson(ctx, gh, args) {
	const result = await run(gh, args, { env: childEnv(ctx), timeoutMs: 60000 });
	if (result.code !== 0) {
		throw new SetupError(`gh ${args.slice(0, 2).join(' ')}: ${firstLine(result.stderr) || `exit ${result.code}`}`);
	}
	return JSON.parse(result.stdout || 'null');
}

// After the person signs in to the GitHub CLI: git uses that sign-in, and commits get their GitHub name and a private
// noreply email (only when git has none yet).
async function installGithub(ctx) {
	const gh = await findGh(ctx);
	const git = await findGit(ctx);
	if (!gh.cli || !git) {
		throw new SetupError('install Git and the GitHub CLI first');
	}
	const status = await run(gh.cli.file, ['auth', 'status', '--hostname', 'github.com'], { env: childEnv(ctx), timeoutMs: 60000 });
	if (status.code !== 0) {
		throw new SetupError('the GitHub CLI isn\'t signed in yet: run gh auth login --hostname github.com --web --git-protocol https first', 'needs_signin');
	}
	const user = await ghJson(ctx, gh.cli.file, ['api', 'user']);
	const previous = (await readManifest(ctx)).items.github || {};
	const changes = { login: user.login, managed: isManagedLogin(user.login) };
	const helper = await run(git.file, ['config', '--global', '--get-all', 'credential.https://github.com.helper'], { env: childEnv(ctx) });
	if (!/gh(\.exe)?['"]? auth git-credential/.test(helper.stdout)) {
		const setup = await run(gh.cli.file, ['auth', 'setup-git', '--hostname', 'github.com'], { env: childEnv(ctx), timeoutMs: 60000 });
		if (setup.code !== 0) {
			throw new SetupError(`gh auth setup-git: ${firstLine(setup.stderr) || `exit ${setup.code}`}`);
		}
		changes.credential_helper = true;
	} else {
		changes.credential_helper = !!previous.credential_helper;
	}
	const name = (await run(git.file, ['config', '--global', 'user.name'], { env: childEnv(ctx) })).stdout.trim();
	const email = (await run(git.file, ['config', '--global', 'user.email'], { env: childEnv(ctx) })).stdout.trim();
	changes.set_name = !!previous.set_name;
	changes.set_email = !!previous.set_email;
	if (!name) {
		const value = (user.name || user.login).trim();
		await run(git.file, ['config', '--global', 'user.name', value], { env: childEnv(ctx) });
		changes.set_name = value;
	}
	if (!email) {
		const value = `${user.id}+${user.login}@users.noreply.github.com`;
		await run(git.file, ['config', '--global', 'user.email', value], { env: childEnv(ctx) });
		changes.set_email = value;
	}
	const ghRecord = (await readManifest(ctx)).items.gh || {};
	changes.gh_config = ghConfigDir(ctx);
	changes.created_gh_config = previous.created_gh_config ?? (ghRecord.by === 'setup' && ghRecord.had_config === false);
	await record(ctx, 'github', changes);
	return { changed: true, detail: `git signs in as ${user.login}` };
}

async function copyDir(source, target) {
	await fsp.cp(source, target, { recursive: true, force: true, errorOnExist: false, filter: (src) => !path.basename(src).startsWith('.DS_Store') });
}

function stamp() {
	return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
}

// Copies light editions into the personal skills folder, saving any folder of the same name first.
async function installSkills(ctx, id, names) {
	const managed = await managedSkills(ctx);
	const installed = {};
	const kept = {};
	const manifest = await readManifest(ctx);
	const previous = manifest.items[id] || {};
	for (const name of names) {
		const source = editionDir(ctx, name);
		if (!exists(path.join(source, 'SKILL.md'))) {
			throw new SetupError(`the light ${name} skill isn't in ${tilde(path.join(ctx.repoRoot, 'editions', 'ai-first'), ctx.home)} yet. Pull the skills and try again.`);
		}
		const target = path.join(ctx.skillsDir, name);
		if (await sameSkill(source, target)) {
			installed[name] = previous.installed?.[name] || { path: target, backup: null };
			continue;
		}
		if (managed.managed && exists(path.join(target, 'SKILL.md'))) {
			kept[name] = managed.why;
			continue;
		}
		// My taste fills in from the person's own sessions after it's installed: never replace it with the empty one.
		if (name === OPTIONAL_SKILLS.skill_taste && previous.installed?.[name] && exists(path.join(target, 'SKILL.md'))) {
			installed[name] = previous.installed[name];
			continue;
		}
		let backup = previous.installed?.[name]?.backup || null;
		if (exists(target) && !previous.installed?.[name]) {
			backup = path.join(ctx.backupsDir, `${name}-${stamp()}`);
			await fsp.mkdir(ctx.backupsDir, { recursive: true });
			await fsp.rename(target, backup).catch(async () => {
				await copyDir(target, backup);
				await fsp.rm(target, { recursive: true, force: true });
			});
		}
		await installFolder(ctx, target, (staging) => copyDir(source, staging));
		installed[name] = { path: target, backup };
	}
	await record(ctx, id, { installed, kept });
	const parts = [];
	if (Object.keys(installed).length) {
		parts.push(`installed ${Object.keys(installed).join(', ')}`);
	}
	if (Object.keys(kept).length) {
		parts.push(`kept yours: ${Object.keys(kept).join(', ')}`);
	}
	return { changed: true, detail: parts.join('; ') };
}

async function installResources(ctx) {
	const source = path.join(ctx.repoRoot, 'autonomous-setup', 'ai-first', 'resources');
	if (!exists(source)) {
		throw new SetupError('the workshop resources aren\'t in this copy of the skills yet; pull the skills and try again');
	}
	const target = path.join(ctx.folder, 'resources');
	await fsp.mkdir(target, { recursive: true });
	await copyDir(source, target);
	await record(ctx, 'resources', { path: target });
	return { changed: true, detail: `in ${tilde(target, ctx.home)}` };
}

// npm through the Node the setup found, without a shell (so it works under any PowerShell execution policy).
async function npmCommand(ctx) {
	const node = await findNode(ctx);
	if (!node || node.tooOld) {
		throw new SetupError(`install Node.js ${MIN_NODE_MAJOR} or newer first`);
	}
	const real = await fsp.realpath(node.file);
	const dir = path.dirname(real);
	const candidates = [
		path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
		path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
		path.join(dir, '..', 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
	];
	for (const file of candidates) {
		if (await isFile(file)) {
			return { node: node.file, cli: file };
		}
	}
	throw new SetupError(`couldn't find npm next to ${tilde(node.file, ctx.home)}`);
}

async function npm(ctx, args, { cwd, timeoutMs = 15 * 60 * 1000, env = {} } = {}) {
	if (!(await isFile(path.join(cwd, 'package.json')))) {
		throw new SetupError(`there's no package.json in ${tilde(cwd, ctx.home)}, so npm didn't run`);
	}
	const { node, cli } = await npmCommand(ctx);
	// --prefix keeps npm in this folder; without it, npm looks upward for a project when it can't find one here.
	const result = await run(node, [cli, ...args, '--prefix', cwd], { cwd, env: childEnv(ctx, env), timeoutMs });
	if (result.code !== 0) {
		const lines = `${result.stderr}\n${result.stdout}`.split(/\r?\n/).map((line) => line.trim()).filter((line) => /err/i.test(line));
		throw new SetupError(`npm ${args[0]} failed in ${tilde(cwd, ctx.home)}: ${lines.slice(-2).join(' ') || `exit ${result.code}`}`);
	}
	return result;
}

// Whether GitHub has a repo by this name: exists, free (GitHub answered "not found"), or unknown (no answer).
async function repoState(ctx, gh, fullName) {
	const result = await run(gh, ['api', `repos/${fullName}`, '--jq', '.full_name'], { env: childEnv(ctx), timeoutMs: 60000 });
	if (result.code === 0) {
		return { state: 'exists' };
	}
	if (/HTTP 404|Not Found/.test(`${result.stderr}\n${result.stdout}`)) {
		return { state: 'free' };
	}
	return { state: 'unknown', detail: firstLine(result.stderr) || firstLine(result.stdout) || `exit ${result.code}` };
}

// The name install excalidraw gives their copy: excalidraw-case-study, or -2 to -20 when they already have those.
// check --repo-name reports the same name, so the question before it can name the repo.
export async function nextRepo(ctx, gh, owner, base = REPO_NAME) {
	for (let n = 1; n <= 20; n++) {
		const candidate = `${owner}/${n === 1 ? base : `${base}-${n}`}`;
		const answer = await repoState(ctx, gh, candidate);
		if (answer.state === 'free') {
			return candidate;
		}
		if (answer.state === 'unknown') {
			throw new SetupError(`couldn't ask GitHub whether ${candidate} is free (${answer.detail}). Check the Wi-Fi and try again.`);
		}
	}
	throw new SetupError(`every name from ${base} to ${base}-20 is taken in ${owner}'s account`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GitHub copies a template into a new repo a few seconds after creating it; until then the repo has no commits.
async function waitForFirstCommit(ctx, gh, fullName, { tries = 30, delayMs = 2000 } = {}) {
	for (let attempt = 1; attempt <= tries; attempt++) {
		const result = await run(gh, ['api', `repos/${fullName}/commits?per_page=1`, '--jq', '.[0].sha'], { env: childEnv(ctx), timeoutMs: 60000 });
		if (result.code === 0 && /^[0-9a-f]{40}$/.test(result.stdout.trim())) {
			return true;
		}
		await sleep(delayMs);
	}
	return false;
}

// A clone with the template's files in it: commits, and the package.json npm needs.
async function cloneLooksRight(ctx, git, dir) {
	if (!exists(path.join(dir, '.git'))) {
		return false;
	}
	const head = await run(git, ['-C', dir, 'rev-parse', '--verify', 'HEAD'], { env: childEnv(ctx), timeoutMs: 30000 });
	return head.code === 0 && (await isFile(path.join(dir, 'package.json')));
}

// The person's own copy of the Excalidraw case study: made from the template on GitHub, cloned into the workshop
// folder, with GitHub Pages set to deploy from Actions, and its packages installed.
async function installExcalidraw(ctx, { skipNpm = false, name: wanted = null, owner: forcedOwner = null } = {}) {
	const gh = await findGh(ctx);
	const git = await findGit(ctx);
	if (!gh.cli || !git) {
		throw new SetupError('install Git and the GitHub CLI and sign in first');
	}
	const user = await ghJson(ctx, gh.cli.file, ['api', 'user']);
	const owner = forcedOwner || user.login;
	const manifest = await readManifest(ctx);
	const previous = manifest.items.excalidraw || {};
	let fullName = previous.repo || null;
	let created = !!previous.created;
	if (!fullName) {
		fullName = await nextRepo(ctx, gh.cli.file, owner, wanted || REPO_NAME);
		const make = await run(gh.cli.file, ['repo', 'create', fullName, '--template', TEMPLATE_REPO, '--public',
			'--description', 'My copy of the Excalidraw case study from the AI-First Design Workshop'], { cwd: ctx.folder, env: childEnv(ctx), timeoutMs: 120000 });
		if (make.code !== 0) {
			throw new SetupError(`gh repo create: ${firstLine(make.stderr) || `exit ${make.code}`}`);
		}
		created = true;
		await record(ctx, 'excalidraw', { repo: fullName, created: true, template: TEMPLATE_REPO });
	}
	const dir = previous.path || path.join(ctx.folder, fullName.split('/')[1]);
	if (!(await waitForFirstCommit(ctx, gh.cli.file, fullName))) {
		throw new SetupError(`${fullName} still has no files from the template after a minute. Check it on GitHub, then run this again.`);
	}
	if (!(await cloneLooksRight(ctx, git.file, dir))) {
		let cloned = false;
		for (let attempt = 1; attempt <= 4 && !cloned; attempt++) {
			// An earlier clone that came back empty (made before the template was copied) is replaced.
			if (exists(dir) && !(await cloneLooksRight(ctx, git.file, dir))) {
				const status = await run(git.file, ['-C', dir, 'status', '--porcelain'], { env: childEnv(ctx), timeoutMs: 30000 });
				const head = await run(git.file, ['-C', dir, 'rev-parse', '--verify', 'HEAD'], { env: childEnv(ctx), timeoutMs: 30000 });
				if (head.code === 0 || status.stdout.trim()) {
					throw new SetupError(`${tilde(dir, ctx.home)} isn't a clean copy of ${fullName}. Move it aside, then run this again.`);
				}
				await fsp.rm(dir, { recursive: true, force: true });
			}
			const result = await run(gh.cli.file, ['repo', 'clone', fullName, dir], { cwd: ctx.folder, env: childEnv(ctx), timeoutMs: 10 * 60 * 1000 });
			cloned = result.code === 0 && (await cloneLooksRight(ctx, git.file, dir));
			if (!cloned) {
				if (attempt === 4) {
					throw new SetupError(`gh repo clone ${fullName}: ${firstLine(result.stderr) || 'the clone came back empty'}`);
				}
				await sleep(3000 * attempt);
			}
		}
	}
	await record(ctx, 'excalidraw', { repo: fullName, path: dir, created });
	let pages = previous.pages || false;
	if (!pages) {
		const post = await run(gh.cli.file, ['api', '-X', 'POST', `repos/${fullName}/pages`, '-f', 'build_type=workflow'], { env: childEnv(ctx), timeoutMs: 60000 });
		if (post.code === 0) {
			pages = true;
		} else {
			const put = await run(gh.cli.file, ['api', '-X', 'PUT', `repos/${fullName}/pages`, '-f', 'build_type=workflow'], { env: childEnv(ctx), timeoutMs: 60000 });
			pages = put.code === 0;
		}
		if (pages) {
			// The copy's first Pages run skipped while Pages was off, so start one now; a failure here only delays the
			// live link until their first push.
			await run(gh.cli.file, ['workflow', 'run', 'pages.yml', '-R', fullName], { env: childEnv(ctx), timeoutMs: 60000 });
		}
		await record(ctx, 'excalidraw', { pages });
	}
	if (!skipNpm) {
		// The packages come from the template's own lockfile, and no package's install script runs: the project needs
		// none (esbuild finds its binary without its own).
		await npm(ctx, ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(ctx.cacheDir, 'npm')], { cwd: dir });
		await record(ctx, 'excalidraw', { packages: true });
	}
	const [login, repo] = fullName.split('/');
	return {
		changed: true,
		detail: `${fullName} in ${tilde(dir, ctx.home)}${skipNpm ? '' : ', with its packages'}${pages ? '' : ' (turn on GitHub Pages later: Settings, Pages, Source: GitHub Actions)'}`,
		repo: fullName,
		live: `https://${login}.github.io/${repo}/`,
	};
}

// The demo video tools in tools/demo: Playwright Core driving the installed Chrome or Edge, and a small ffmpeg (with
// H.264) that encodes the browser's own screencast. Without Chrome or Edge, a small headless browser too.
// demo-tools.json lists the paths for the demos skill.
async function installDemoTools(ctx, { fetchImpl } = {}) {
	const dir = toolPaths(ctx).demo.dir;
	const browsers = path.join(dir, 'browsers');
	await fsp.mkdir(dir, { recursive: true });
	const pkg = path.join(dir, 'package.json');
	await writeAtomic(pkg, JSON.stringify({ name: 'ai-first-workshop-demo-tools', version: '0.0.0', private: true, dependencies: { 'playwright-core': PLAYWRIGHT_CORE } }, null, 2) + '\n');
	await npm(ctx, ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--save-exact', '--cache', path.join(ctx.cacheDir, 'npm')], { cwd: dir });
	const core = path.join(dir, 'node_modules', 'playwright-core');
	const platform = ctx.os === 'mac' ? `darwin-${ctx.arch}` : ctx.os === 'win' ? 'win32-x64' : `linux-${ctx.arch}`;
	const ffmpeg = path.join(dir, ctx.os === 'win' ? 'ffmpeg.exe' : 'ffmpeg');
	if (!(await isFile(ffmpeg))) {
		const name = `ffmpeg-${platform}.gz`;
		const archive = path.join(ctx.cacheDir, name);
		await download(PINS.ffmpeg.base + name, archive, { sha256: PINS.ffmpeg.sha256[name] || null, fetchImpl });
		await pipeline(fs.createReadStream(archive), zlib.createGunzip(), fs.createWriteStream(`${ffmpeg}.part`, { mode: 0o755 }));
		await fsp.rename(`${ffmpeg}.part`, ffmpeg);
		await fsp.rm(archive, { force: true });
		for (const extra of ['LICENSE', 'README']) {
			await download(PINS.ffmpeg.base + `${platform}.${extra}`, path.join(dir, `ffmpeg.${extra}`), { fetchImpl }).catch(() => {});
		}
	}
	const version = await run(ffmpeg, ['-version'], { env: childEnv(ctx), timeoutMs: 30000 });
	if (version.code !== 0) {
		throw new SetupError('the small ffmpeg didn\'t run');
	}
	const node = await npmCommand(ctx);
	const cli = path.join(core, 'cli.js');
	const pwEnv = childEnv(ctx, { PLAYWRIGHT_BROWSERS_PATH: browsers });
	const browser = await findBrowser(ctx);
	let executablePath = null;
	if (!browser) {
		const shell = await run(node.node, [cli, 'install', 'chromium-headless-shell'], { env: pwEnv, timeoutMs: 20 * 60 * 1000 });
		if (shell.code !== 0) {
			throw new SetupError(`the small recording browser didn't install: ${firstLine(shell.stderr) || `exit ${shell.code}`}`);
		}
		const probe = await run(node.node, ['-e', `const { chromium } = require(${JSON.stringify(core)}); process.stdout.write(chromium.executablePath())`], { env: pwEnv, timeoutMs: 60000 });
		executablePath = probe.stdout.trim() || null;
	}
	const info = {
		playwrightCore: core,
		ffmpeg,
		browsersPath: browsers,
		channel: browser ? browser.channel : null,
		browserName: browser ? browser.name : 'Chromium headless shell',
		executablePath: browser ? browser.file : executablePath,
		version: PLAYWRIGHT_CORE,
	};
	await writeAtomic(path.join(dir, 'demo-tools.json'), JSON.stringify(info, null, 2) + '\n');
	await record(ctx, 'demo_tools', { path: dir, browser: info.browserName, downloaded_browser: !browser });
	// The demos skill's own check opens the browser and reads ffmpeg's encoders: the real proof.
	const demos = [path.join(ctx.skillsDir, 'autonomous-demos', 'scripts', 'demo.mjs'), path.join(editionDir(ctx, 'autonomous-demos'), 'scripts', 'demo.mjs')].find((file) => exists(file));
	if (demos) {
		const result = await run(node.node, [demos, 'check'], { env: childEnv(ctx, { AI_FIRST_WORKSHOP: ctx.folder }), timeoutMs: 120000 });
		let report = null;
		try {
			report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
		} catch {
			report = null;
		}
		if (!report?.ok) {
			throw new SetupError(`the demo tools check didn't pass: ${report?.detail || report?.error || firstLine(result.stderr) || firstLine(result.stdout) || `exit ${result.code}`}`);
		}
	}
	return { changed: true, detail: `ready in ${tilde(dir, ctx.home)}, recording with ${info.browserName}` };
}

// ---------------------------------------------------------------- the canvas

export function canvasPaths(ctx) {
	return {
		source: path.join(ctx.repoRoot, 'plugins', 'workshop-setup', 'extensions', 'setup-checklist'),
		target: path.join(ctx.copilotHome, 'extensions', 'setup-checklist'),
		data: path.join(ctx.copilotHome, 'extension-data', 'autonomous-setup-checklist'),
	};
}

async function digest(dir) {
	if (!exists(path.join(dir, 'extension.mjs'))) {
		return null;
	}
	const hash = createHash('sha256');
	const walk = async (folder, rel = '') => {
		// The fonts are fetched into the copy afterwards (canvasFonts), so they aren't part of what changed.
		const entries = (await fsp.readdir(folder, { withFileTypes: true }))
			.filter((entry) => !entry.name.startsWith('.') && !/\.woff2$/i.test(entry.name))
			.sort((a, b) => (a.name < b.name ? -1 : 1));
		for (const entry of entries) {
			const full = path.join(folder, entry.name);
			const name = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				await walk(full, name);
			} else if (entry.isFile()) {
				hash.update(name + '\0');
				hash.update(await fsp.readFile(full));
				hash.update('\0');
			}
		}
	};
	await walk(dir);
	return hash.digest('hex');
}

function pluginInstalled(ctx) {
	if (exists(path.join(ctx.copilotHome, 'installed-plugins', 'autonomous-output-skills', 'workshop-setup'))) {
		return true;
	}
	try {
		const config = JSON.parse(fs.readFileSync(path.join(ctx.copilotHome, 'config.json'), 'utf8'));
		return (config.installedPlugins || []).some((entry) => String(entry?.name || '') === 'workshop-setup');
	} catch {
		return false;
	}
}

// The Horizon kit's fonts for the canvas copy. The skills repo publishes text only, so they come from FONT_SOURCES,
// checked against the canvas's web/horizon-fonts.json, and stay in the setup's cache for the next copy. Without them
// the canvas uses the system's faces, so a font that can't be fetched never fails the step.
export async function canvasFonts(ctx, target, { fetchImpl = globalThis.fetch, sources = FONT_SOURCES } = {}) {
	let fonts = [];
	try {
		fonts = JSON.parse(await fsp.readFile(path.join(target, 'web', 'horizon-fonts.json'), 'utf8')).fonts || [];
	} catch {
		return { fonts: 0, missing: 0 };
	}
	const dir = path.join(target, 'web', 'horizon', 'fonts');
	const cache = path.join(ctx.cacheDir, 'fonts');
	// They're small, so a slow network gives up quickly instead of holding up the welcome.
	const quick = (url, options) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(10000) });
	const matches = async (file, sha256) => exists(file) && (await sha256File(file)) === sha256;
	const fetched = await Promise.all(fonts.map(async (font) => {
		const name = String(font?.name || '');
		const sha256 = String(font?.sha256 || '').toLowerCase();
		if (!/^[A-Za-z0-9._-]+\.woff2$/.test(name) || !/^[a-f0-9]{64}$/.test(sha256)) {
			return false;
		}
		const file = path.join(dir, name);
		if (await matches(file, sha256)) {
			return true;
		}
		const cached = path.join(cache, name);
		for (const base of sources) {
			if (await matches(cached, sha256)) {
				break;
			}
			try {
				await download(base + name, cached, { sha256, attempts: 1, fetchImpl: quick });
			} catch {
				// the next source
			}
		}
		if (!(await matches(cached, sha256))) {
			return false;
		}
		await fsp.mkdir(dir, { recursive: true });
		await fsp.copyFile(cached, file);
		return true;
	}));
	return { fonts: fonts.length, missing: fetched.filter((ok) => !ok).length };
}

const fontNote = (fonts) => (fonts.missing ? `; ${fonts.missing} of its ${fonts.fonts} fonts couldn't be fetched, so it uses the system's for now` : '');

// The same job as canvas-extension.py install, without Python: copies the canvas where the running chat can load
// it, unless the workshop-setup plugin already brings it.
export async function installCanvas(ctx, { fetchImpl = globalThis.fetch } = {}) {
	const { source, target, data } = canvasPaths(ctx);
	const want = await digest(source);
	if (!want) {
		throw new SetupError(`no setup canvas at ${tilde(source, ctx.home)}`);
	}
	const have = await digest(target);
	if (pluginInstalled(ctx) && !have) {
		return { changed: false, reload_needed: false, skipped: 'plugin', detail: 'the workshop-setup plugin provides the canvas; nothing copied' };
	}
	const manifest = await readManifest(ctx);
	const already = manifest.items.canvas || {};
	if (have === want) {
		if (!already.path) {
			await record(ctx, 'canvas', { path: target, data, copied: false });
		}
		const fonts = await canvasFonts(ctx, target, { fetchImpl });
		return { changed: false, reload_needed: false, detail: `the canvas is in place and current${fontNote(fonts)}` };
	}
	await fsp.mkdir(path.dirname(target), { recursive: true });
	await installFolder(ctx, target, (staging) => fsp.cp(source, staging, { recursive: true, filter: (src) => (!path.basename(src).startsWith('.') || src === source) && !/\.woff2$/i.test(src) }));
	await record(ctx, 'canvas', { path: target, data, copied: already.copied ?? !have });
	const fonts = await canvasFonts(ctx, target, { fetchImpl });
	return { changed: true, reload_needed: true, detail: `copied the canvas to ${tilde(target, ctx.home)}${fontNote(fonts)}; call extensions_reload, then list_canvas_capabilities` };
}

// ---------------------------------------------------------------- the weekly taste update

export function automationInput(ctx) {
	return {
		name: TASTE_AUTOMATION_NAME,
		prompt: 'Weekly taste update. Use the my-taste skill\'s weekly update: read my agent sessions from the last 7 days on this '
			+ 'computer, update my taste skill (back it up first), and write a short report. Don\'t ask me anything; if something '
			+ 'blocks you, say so in the report.',
		schedule: { interval: 'weekly', scheduleDay: 1, scheduleHour: 10, scheduleMinute: 0 },
		target: { kind: 'workspace', folderUri: pathToFileURL(ctx.folder).href, providerId: 'local-agent-host', sessionTypeId: 'copilotcli', isolation: 'folder' },
		sessionTemplate: {
			modelId: TASTE_MODEL,
			modelConfiguration: { thinkingLevel: 'medium' },
			config: { mode: 'autopilot', autoApprove: 'autoApprove' },
		},
		enabled: true,
	};
}

// ---------------------------------------------------------------- uninstall

export async function uninstallPlan(ctx) {
	const manifest = await readManifest(ctx);
	const items = manifest.items;
	const t = (file) => tilde(file, ctx.home);
	const steps = [];
	for (const [id, entry] of Object.entries(items)) {
		if (id === 'skills' || id in OPTIONAL_SKILLS) {
			for (const [name, info] of Object.entries(entry.installed || {})) {
				const extra = name === OPTIONAL_SKILLS.skill_taste ? ' (the taste rules it learned go with it)' : '';
				steps.push({ id: `skill:${name}`, text: info.backup ? `Remove the ${name} skill${extra} and put your earlier copy back` : `Remove the ${name} skill${extra}`, path: info.path, backup: info.backup || null });
			}
		}
	}
	if (items.canvas?.copied) {
		steps.push({ id: 'canvas', text: 'Remove the setup checklist and its progress', path: items.canvas.path, data: items.canvas.data });
	}
	if (items.path_block) {
		steps.push({ id: 'path_block', text: `Remove the "${PATH_MARK}" block from ${t(items.path_block.file)}`, file: items.path_block.file, delete_file: !!items.path_block.created_file });
	}
	if (items.user_path) {
		steps.push({ id: 'user_path', text: 'Take the workshop tools off your user Path', entries: items.user_path.entries || [] });
	}
	if (items.github?.credential_helper) {
		steps.push({ id: 'credential_helper', text: 'Stop git signing in through the GitHub CLI' });
	}
	if (items.github?.set_name || items.github?.set_email) {
		steps.push({ id: 'git_identity', text: 'Remove the name and email the setup gave git', name: items.github.set_name || null, email: items.github.set_email || null });
	}
	if (items.github?.created_gh_config && items.gh?.by === 'setup') {
		steps.push({ id: 'gh_signout', text: 'Sign the GitHub CLI out and remove its settings', login: items.github.login || null, dir: items.github.gh_config });
	}
	if (items.taste_weekly?.automationId) {
		steps.push({ id: 'taste_weekly', text: `Delete the "${TASTE_AUTOMATION_NAME}" automation (the agent does this with deleteAutomation)`, automationId: items.taste_weekly.automationId, agent: true });
	}
	steps.push({ id: 'folder', text: `Delete ${t(ctx.folder)}: your local Excalidraw copy, the skills download, the resources and the tools the setup installed`, path: ctx.folder });
	// The workshop settings are the person's to remove, last, by hand. Removing them turns the terminal sandbox back on,
	// which would stop an agent's command partway through.
	const settings = vscodeSettingsFile(ctx);
	const keep = [`The 16 workshop settings stay in ${t(settings)} until you remove them, last: in VS Code Insiders, `
		+ 'Command Palette, Preferences: Open User Settings (JSON), delete the 16 lines you pasted at the workshop (from '
		+ `"${SETTINGS_KEYS[0]}" to "${SETTINGS_KEYS[SETTINGS_KEYS.length - 1]}"), save, and restart VS Code Insiders.`];
	if (items.excalidraw?.repo) {
		keep.push(`Your repo https://github.com/${items.excalidraw.repo} stays on GitHub. Delete it there if you want to.`);
	}
	keep.push('Cancel the free month of Copilot before it renews: github.com, Settings, Billing and licensing, Licensing.');
	return { folder: ctx.folder, steps, keep, settings: { file: settings, keys: SETTINGS_KEYS, by_hand: true }, guide: UNINSTALL_URL };
}

async function removeGitConfig(ctx, git, args) {
	if (git) {
		await run(git.file, ['config', '--global', ...args], { env: childEnv(ctx) });
	}
}

export async function uninstall(ctx, { yes = false } = {}) {
	const plan = await uninstallPlan(ctx);
	if (!yes) {
		return { ...plan, done: false };
	}
	const inside = (file) => file && (file === ctx.folder || file.startsWith(ctx.folder + path.sep));
	if (inside(process.execPath)) {
		throw new SetupError(`run the uninstall with VS Code's runtime or another Node.js, not the one in ${tilde(ctx.folder, ctx.home)}, which it removes`);
	}
	process.chdir(ctx.home);
	const git = await findGit(ctx);
	const gh = await findGh(ctx);
	const results = [];
	for (const step of plan.steps) {
		try {
			if (step.id.startsWith('skill:')) {
				await fsp.rm(step.path, { recursive: true, force: true });
				if (step.backup && exists(step.backup)) {
					await fsp.rename(step.backup, step.path);
				}
			} else if (step.id === 'canvas') {
				await fsp.rm(step.path, { recursive: true, force: true });
				await fsp.rm(step.data, { recursive: true, force: true });
			} else if (step.id === 'path_block') {
				const text = await fsp.readFile(step.file, 'utf8').catch(() => '');
				const next = stripPathBlock(text);
				if (step.delete_file && !next.trim()) {
					await fsp.rm(step.file, { force: true });
				} else if (next !== text) {
					await writeAtomic(step.file, next);
				}
			} else if (step.id === 'user_path') {
				await powershell(ctx, windowsPathScript({ remove: step.entries }));
			} else if (step.id === 'credential_helper') {
				await removeGitConfig(ctx, git, ['--remove-section', 'credential.https://github.com']);
				await removeGitConfig(ctx, git, ['--remove-section', 'credential.https://gist.github.com']);
			} else if (step.id === 'git_identity') {
				if (step.name) {
					await removeGitConfig(ctx, git, ['--unset', 'user.name']);
				}
				if (step.email) {
					await removeGitConfig(ctx, git, ['--unset', 'user.email']);
				}
			} else if (step.id === 'gh_signout') {
				if (gh.cli) {
					await run(gh.cli.file, ['auth', 'logout', '--hostname', 'github.com', ...(step.login ? ['--user', step.login] : [])], { env: childEnv(ctx), timeoutMs: 60000 });
				}
				await fsp.rm(step.dir, { recursive: true, force: true });
			} else if (step.id === 'taste_weekly') {
				results.push({ id: step.id, ok: null, detail: 'for the agent: deleteAutomation with this id', automationId: step.automationId });
				continue;
			} else if (step.id === 'folder') {
				await fsp.rm(step.path, { recursive: true, force: true, maxRetries: 3 });
			}
			results.push({ id: step.id, ok: true });
		} catch (error) {
			results.push({ id: step.id, ok: false, detail: String(error.message || error).split('\n')[0] });
		}
	}
	return { ...plan, done: true, results };
}

// ---------------------------------------------------------------- commands

export const INSTALLERS = {
	git: (ctx, opts) => installGit(ctx, opts),
	node: (ctx, opts) => installNode(ctx, opts),
	gh: (ctx, opts) => installGh(ctx, opts),
	github: (ctx) => installGithub(ctx),
	skills: (ctx) => installSkills(ctx, 'skills', REQUIRED_SKILLS),
	skill_runs: (ctx) => installSkills(ctx, 'skill_runs', [OPTIONAL_SKILLS.skill_runs]),
	skill_research: (ctx) => installSkills(ctx, 'skill_research', [OPTIONAL_SKILLS.skill_research]),
	skill_taste: (ctx) => installSkills(ctx, 'skill_taste', [OPTIONAL_SKILLS.skill_taste]),
	excalidraw: (ctx, opts) => installExcalidraw(ctx, opts),
	resources: (ctx) => installResources(ctx),
	demo_tools: (ctx, opts) => installDemoTools(ctx, opts),
};

function parseArgs(argv) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--ms-enable-electron-run-as-node') {
			continue;
		}
		if (arg.startsWith('--')) {
			const [name, inline] = arg.slice(2).split('=', 2);
			if (inline !== undefined) {
				out[name] = inline;
			} else if (['json', 'yes', 'skip-npm', 'repo-name', 'help'].includes(name)) {
				out[name] = true;
			} else {
				out[name] = argv[++i];
			}
		} else {
			out._.push(arg);
		}
	}
	return out;
}

function print(value, json) {
	if (json) {
		process.stdout.write(JSON.stringify(value, null, 1) + '\n');
	} else if (typeof value === 'string') {
		process.stdout.write(value + '\n');
	} else {
		process.stdout.write((value.detail || JSON.stringify(value, null, 1)) + '\n');
	}
}

function checkText(result) {
	const lines = [`AI-First setup in ${result.folder_display} on ${result.os.name} (${result.os.arch})`];
	for (const [id, item] of Object.entries(result.items)) {
		const mark = item.ok === true ? 'ok  ' : item.ok === false ? 'todo' : '..  ';
		lines.push(`${mark} ${id}: ${item.detail}`);
	}
	return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	const [command, item] = args._;
	if (!command || args.help) {
		process.stdout.write(`Usage: ai-first.mjs check|canvas|install ITEM|env|automation|record KEY --value JSON|uninstall [--folder DIR] [--json]\nItems: ${Object.keys(INSTALLERS).join(', ')}\n`);
		return command ? 0 : 2;
	}
	const ctx = makeContext({ folder: args.folder });
	try {
		if (command === 'check') {
			const result = await check(ctx, { repoName: !!args['repo-name'] });
			print(args.json ? result : checkText(result), !!args.json);
		} else if (command === 'canvas') {
			print({ ok: true, ...(await installCanvas(ctx)) }, !!args.json);
		} else if (command === 'install') {
			if (!INSTALLERS[item]) {
				process.stderr.write(`Unknown item ${JSON.stringify(item || '')}. Items: ${Object.keys(INSTALLERS).join(', ')}\n`);
				return 2;
			}
			if (args['skip-npm'] && ctx.env.AI_FIRST_TEST !== '1') {
				process.stderr.write('install excalidraw installs its packages itself, in the clone, so run it without --skip-npm '
					+ '(that flag is only for this script\'s tests, with AI_FIRST_TEST=1). It\'s safe to run again: it picks up where '
					+ 'it stopped.\n');
				return 2;
			}
			await fsp.mkdir(ctx.folder, { recursive: true });
			const result = await INSTALLERS[item](ctx, { skipNpm: !!args['skip-npm'], name: args.name || null, owner: args.owner || null });
			print({ ok: true, item, ...result }, !!args.json);
		} else if (command === 'env') {
			const format = args.format || (ctx.os === 'win' ? 'ps' : 'sh');
			print(format === 'json' ? { sh: envLine(ctx, 'sh'), ps: envLine(ctx, 'ps') } : envLine(ctx, format), format === 'json');
		} else if (command === 'automation') {
			print(automationInput(ctx), true);
		} else if (command === 'record') {
			if (!item || args.value === undefined) {
				process.stderr.write('record needs a KEY and --value JSON\n');
				return 2;
			}
			await record(ctx, item, JSON.parse(args.value));
			print({ ok: true, recorded: item }, !!args.json);
		} else if (command === 'uninstall') {
			const result = await uninstall(ctx, { yes: !!args.yes });
			if (args.json) {
				print(result, true);
			} else {
				print([...result.steps.map((step) => `- ${step.text}`), '', ...result.keep].join('\n'));
			}
			if (result.done && result.results.some((entry) => entry.ok === false)) {
				return 1;
			}
		} else {
			process.stderr.write(`Unknown command ${command}\n`);
			return 2;
		}
		return 0;
	} catch (error) {
		const message = String(error?.message || error).split('\n')[0];
		if (args.json) {
			print({ ok: false, item: item || null, code: error?.code || 'failed', detail: message }, true);
		} else {
			process.stderr.write(`Not done: ${message}\n`);
		}
		return 1;
	}
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
	main().then((code) => {
		process.exitCode = code;
	});
}

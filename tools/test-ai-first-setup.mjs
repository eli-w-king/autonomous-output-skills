// Tests for autonomous-setup/scripts/ai-first.mjs, the AI-First setup path. Everything runs in a scratch home with
// its own COPILOT_HOME; nothing is downloaded and nothing outside the scratch folder is touched.
//   node --test tools/test-ai-first-setup.mjs
// AI_FIRST_TEST_SCRATCH picks the scratch parent folder (default: the system temp folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as af from '../autonomous-setup/scripts/ai-first.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = process.env.AI_FIRST_TEST_SCRATCH || os.tmpdir();

async function scratchHome(name) {
	await fsp.mkdir(SCRATCH, { recursive: true });
	const home = await fsp.mkdtemp(path.join(SCRATCH, `ai-first-${name}-`));
	return home;
}

// The network, for the canvas fonts: nothing answers.
const offline = { fetchImpl: async () => new Response(null, { status: 404 }) };

function context(home, extra = {}) {
	return af.makeContext({
		home,
		env: { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh', COPILOT_HOME: path.join(home, '.copilot'), ...extra.env },
		platform: extra.platform || 'darwin',
		arch: extra.arch || 'arm64',
		repoRoot: REPO,
	});
}

test('sizes: every item has a size on every supported computer, and the worst case stays under 1 GB', () => {
	const targets = ['mac-arm64', 'mac-x64', 'win-x64', 'win-arm64'];
	for (const target of targets) {
		let disk = 0;
		for (const id of ['git', 'node', 'gh', 'demo_tools', 'browser', 'computer_use']) {
			const entry = af.SIZES[id][target];
			assert.ok(entry && entry[0] > 0 && entry[1] > 0, `${id} on ${target}`);
			disk += entry[1];
		}
		disk += af.SIZES.excalidraw[target][1];
		assert.ok(disk < 1000, `${target}: ${disk} MB`);
	}
});

test('the GitHub CLI hosts file gives the accounts, and only a work account on GitHub opens the Microsoft gate', () => {
	const hosts = [
		'github.com:',
		'    users:',
		'        mona-designer:',
		'        mona_contoso:',
		'    git_protocol: https',
		'    user: mona-designer',
		'enterprise.example.com:',
		'    user: someone_else',
	].join('\n');
	const parsed = af.parseGhHosts(hosts);
	assert.equal(parsed.active, 'mona-designer');
	assert.deepEqual(parsed.users, ['mona-designer', 'mona_contoso']);
	assert.equal(af.isManagedLogin('mona_contoso'), true);
	assert.equal(af.isManagedLogin('mona-designer'), false);
	assert.equal(af.isManagedLogin(''), false);
	assert.deepEqual(af.parseGhHosts('').users, []);
});

test('VS Code settings with comments and trailing commas parse', () => {
	const text = '{\n\t// mine\n\t"editor.fontSize": 14, /* keep */\n\t"dictation.model": "mai",\n\t"url": "http://x//y",\n}\n';
	assert.deepEqual(af.parseJsonc(text), { 'editor.fontSize': 14, 'dictation.model': 'mai', url: 'http://x//y' });
});

test('removing the workshop settings takes exactly the 16 lines and keeps the rest', () => {
	const pasted = af.SETTINGS_KEYS.map((key) => `\t"${key}": true,`).join('\n');
	const text = `{\n\t"editor.fontSize": 14,\n${pasted}\n}\n`;
	const out = af.removeSettingsText(text);
	assert.equal(out.removed, 16);
	assert.deepEqual(af.parseJsonc(out.text), { 'editor.fontSize': 14 });
	assert.match(out.text, /"editor\.fontSize": 14\n}/);
});

test('the PATH block goes in once, holds only the folders given, and comes back out exactly', () => {
	const ctx = context('/Users/you');
	const block = af.pathBlock(ctx, ['/Users/you/ai-first-workshop/tools/bin', '/Users/you/ai-first-workshop/tools/node/bin']);
	assert.match(block, /^# >>> ai-first-workshop >>>/);
	assert.match(block, /export PATH="\$HOME\/ai-first-workshop\/tools\/bin:\$HOME\/ai-first-workshop\/tools\/node\/bin:\$PATH"/);
	const profile = `export EDITOR=vim\n\n${block}\n`;
	assert.equal(af.stripPathBlock(profile).trim(), 'export EDITOR=vim');
	assert.equal(af.stripPathBlock('alias ll="ls -l"\n'), 'alias ll="ls -l"\n');
});

test('the Windows Path script adds and removes the given folders and keeps %VARIABLES%', () => {
	const script = af.windowsPathScript({ add: ["C:\\Users\\o'neil\\ai-first-workshop\\tools\\node"], remove: ['C:\\old'] });
	assert.match(script, /DoNotExpandEnvironmentNames/);
	assert.match(script, /ExpandString/);
	assert.match(script, /'C:\\Users\\o''neil\\ai-first-workshop\\tools\\node'/);
	assert.match(script, /\$remove = @\('C:\\old'\)/);
});

test('the weekly taste update: weekly, its model set, Autopilot with auto-approve, and the opening words the skill skips', () => {
	const ctx = context('/Users/you');
	const input = af.automationInput(ctx);
	assert.ok(input.prompt.startsWith('Weekly taste update'));
	assert.equal(input.schedule.interval, 'weekly');
	assert.equal(input.sessionTemplate.modelId, af.TASTE_MODEL);
	assert.deepEqual(input.sessionTemplate.config, { mode: 'autopilot', autoApprove: 'autoApprove' });
	assert.equal(input.target.kind, 'workspace');
	assert.equal(input.target.folderUri, 'file:///Users/you/ai-first-workshop');
});

test('check on a fresh scratch home: nothing of the workshop is there, every needed item has a size, and it reads only', async () => {
	const home = await scratchHome('check');
	const ctx = context(home);
	const result = await af.check(ctx);
	assert.equal(result.path, 'ai-first');
	assert.equal(result.items.skills.ok, false);
	assert.equal(result.items.excalidraw.ok, false);
	assert.equal(result.items.microsoft_signin.ok, false);
	for (const id of ['skills', 'excalidraw', 'resources', 'demo_tools']) {
		assert.ok(result.items[id].size.disk > 0, `${id} has a size`);
	}
	assert.ok(result.items.skills.size.disk < 1000 * 1000, 'the light skills are small');
	assert.equal(fs.existsSync(ctx.folder), false, 'check made no folder');
	assert.equal(fs.existsSync(ctx.manifestFile), false);
});

test('a work account in the GitHub CLI passes the Microsoft gate', async () => {
	const home = await scratchHome('gate');
	const ctx = context(home);
	await fsp.mkdir(path.join(home, '.config', 'gh'), { recursive: true });
	await fsp.writeFile(path.join(home, '.config', 'gh', 'hosts.yml'), 'github.com:\n    users:\n        mona_contoso:\n    user: mona_contoso\n');
	const result = await af.check(ctx);
	assert.equal(result.items.microsoft_signin.ok, true);
	assert.match(result.items.microsoft_signin.detail, /mona_contoso/);
});

test('skills: installs the four, saves a same-named folder first, records both, and does nothing the second time', async () => {
	const home = await scratchHome('skills');
	const ctx = context(home);
	const old = path.join(ctx.skillsDir, 'autonomous-demos');
	await fsp.mkdir(old, { recursive: true });
	await fsp.writeFile(path.join(old, 'SKILL.md'), '---\nname: autonomous-demos\n---\nmine\n');
	const first = await af.INSTALLERS.skills(ctx);
	assert.match(first.detail, /installed/);
	for (const name of af.REQUIRED_SKILLS) {
		assert.ok(fs.existsSync(path.join(ctx.skillsDir, name, 'SKILL.md')), name);
	}
	const manifest = await af.readManifest(ctx);
	const backup = manifest.items.skills.installed['autonomous-demos'].backup;
	assert.ok(backup && backup.startsWith(ctx.backupsDir));
	assert.equal(fs.readFileSync(path.join(backup, 'SKILL.md'), 'utf8').trim().endsWith('mine'), true);
	await af.INSTALLERS.skills(ctx);
	const again = await af.readManifest(ctx);
	assert.equal(again.items.skills.installed['autonomous-demos'].backup, backup, 'the backup is still the person\'s copy');
	assert.match(fs.readFileSync(ctx.summaryFile, 'utf8'), /autonomous-demos in ~\/\.copilot\/skills\/autonomous-demos; your earlier copy is saved/);
});

test('skills: a full skills setup on this machine is kept as it is', async () => {
	const home = await scratchHome('managed');
	const ctx = context(home);
	await fsp.mkdir(ctx.copilotHome, { recursive: true });
	await fsp.writeFile(path.join(ctx.copilotHome, 'skills-sync.json'), '{}\n');
	const mine = path.join(ctx.skillsDir, 'autonomous-variations');
	await fsp.mkdir(mine, { recursive: true });
	await fsp.writeFile(path.join(mine, 'SKILL.md'), 'the full skill\n');
	const result = await af.INSTALLERS.skills(ctx);
	assert.match(result.detail, /kept yours: autonomous-variations/);
	assert.equal(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8'), 'the full skill\n');
});

test('my taste keeps the rules it learned when the setup runs again', async () => {
	const home = await scratchHome('taste');
	const ctx = context(home);
	await af.INSTALLERS.skill_taste(ctx);
	const file = path.join(ctx.skillsDir, 'my-taste', 'SKILL.md');
	await fsp.appendFile(file, '\n- **Left align reading text.** (seen 2 times, last 2026-11-20)\n');
	await af.INSTALLERS.skill_taste(ctx);
	assert.match(fs.readFileSync(file, 'utf8'), /Left align reading text/);
});

test('resources and the canvas copy in, and both are recorded', async () => {
	const home = await scratchHome('copy');
	const ctx = context(home);
	await af.INSTALLERS.resources(ctx);
	for (const name of ['README.md', 'prompts.md', 'cheat-sheet.md', 'workshop-settings.jsonc']) {
		assert.ok(fs.existsSync(path.join(ctx.folder, 'resources', name)), name);
	}
	const canvas = await af.installCanvas(ctx, offline);
	assert.equal(canvas.changed, true);
	assert.equal(canvas.reload_needed, true);
	assert.ok(fs.existsSync(path.join(ctx.copilotHome, 'extensions', 'setup-checklist', 'extension.mjs')));
	assert.equal((await af.installCanvas(ctx, offline)).changed, false, 'a second copy changes nothing');
	const manifest = await af.readManifest(ctx);
	assert.equal(manifest.items.canvas.copied, true);
	assert.ok(manifest.items.resources.path.endsWith('resources'));
});

test('the canvas fonts come from the first source that has them, only when they match, then from the cache', async () => {
	const home = await scratchHome('fonts');
	const ctx = context(home);
	const target = path.join(home, 'canvas');
	const bytes = Buffer.from('a font');
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	await fsp.mkdir(path.join(target, 'web'), { recursive: true });
	await fsp.writeFile(path.join(target, 'web', 'horizon-fonts.json'), JSON.stringify({
		fonts: [{ name: 'Good.woff2', bytes: bytes.length, sha256 }, { name: 'Changed.woff2', bytes: 5, sha256: 'a'.repeat(64) }],
	}));
	const asked = [];
	const sources = ['https://first.example/', 'https://second.example/'];
	const fetchImpl = async (url) => {
		asked.push(url);
		if (url.startsWith(sources[0])) {
			return new Response(null, { status: 404 });
		}
		return new Response(url.endsWith('Good.woff2') ? bytes : Buffer.from('other'));
	};
	const fonts = path.join(target, 'web', 'horizon', 'fonts');
	assert.deepEqual(await af.canvasFonts(ctx, target, { fetchImpl, sources }), { fonts: 2, missing: 1 });
	assert.deepEqual(fs.readFileSync(path.join(fonts, 'Good.woff2')), bytes);
	assert.equal(fs.existsSync(path.join(fonts, 'Changed.woff2')), false, 'a file that doesn\'t match its checksum is never used');
	await fsp.rm(fonts, { recursive: true });
	asked.length = 0;
	assert.deepEqual(await af.canvasFonts(ctx, target, { fetchImpl, sources }), { fonts: 2, missing: 1 });
	assert.deepEqual(fs.readFileSync(path.join(fonts, 'Good.woff2')), bytes);
	assert.ok(!asked.some((url) => url.endsWith('Good.woff2')), 'the next copy uses the cache');
});

test('the copy\'s name skips the names they have, and no answer from GitHub is an error, not a free name', { skip: process.platform === 'win32' }, async () => {
	const home = await scratchHome('names');
	const ctx = context(home);
	// A stand-in for the GitHub CLI: mona has two copies already, and the offline account gets no answer.
	const gh = path.join(home, 'gh');
	await fsp.writeFile(gh, [
		'#!/bin/sh',
		'case "$2" in',
		'  repos/mona/excalidraw-case-study|repos/mona/excalidraw-case-study-2) echo "${2#repos/}"; exit 0 ;;',
		'  repos/offline/*) echo "error connecting to api.github.com" >&2; exit 1 ;;',
		'  *) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;',
		'esac',
		'',
	].join('\n'), { mode: 0o755 });
	assert.equal(await af.nextRepo(ctx, gh, 'mona'), 'mona/excalidraw-case-study-3');
	assert.equal(await af.nextRepo(ctx, gh, 'newcomer'), 'newcomer/excalidraw-case-study');
	await assert.rejects(af.nextRepo(ctx, gh, 'offline'), /couldn't ask GitHub/);
});

test('install excalidraw refuses --skip-npm outside the script\'s tests, before it touches anything', async () => {
	const home = await scratchHome('skipnpm');
	const folder = path.join(home, 'ai-first-workshop');
	const saved = process.env.AI_FIRST_TEST;
	delete process.env.AI_FIRST_TEST;
	const write = process.stderr.write;
	let said = '';
	process.stderr.write = (chunk) => {
		said += chunk;
		return true;
	};
	try {
		assert.equal(await af.main(['install', 'excalidraw', '--skip-npm', '--json', '--folder', folder]), 2);
	} finally {
		process.stderr.write = write;
		if (saved !== undefined) {
			process.env.AI_FIRST_TEST = saved;
		}
	}
	assert.match(said, /installs its packages itself/);
	assert.equal(fs.existsSync(folder), false);
});

test('the canvas isn\'t copied when the workshop-setup plugin already brings it', async () => {
	const home = await scratchHome('plugin');
	const ctx = context(home);
	await fsp.mkdir(path.join(ctx.copilotHome, 'installed-plugins', 'autonomous-output-skills', 'workshop-setup'), { recursive: true });
	const result = await af.installCanvas(ctx, offline);
	assert.equal(result.skipped, 'plugin');
	assert.equal(fs.existsSync(path.join(ctx.copilotHome, 'extensions', 'setup-checklist')), false);
});

test('uninstall lists before it removes, then puts everything back the way it was', async () => {
	const home = await scratchHome('uninstall');
	const ctx = context(home);
	// The person's own things, before the setup.
	const theirs = path.join(ctx.skillsDir, 'autonomous-prototypes');
	await fsp.mkdir(theirs, { recursive: true });
	await fsp.writeFile(path.join(theirs, 'SKILL.md'), 'their own\n');
	await fsp.writeFile(path.join(home, '.zprofile'), 'export EDITOR=vim\n');
	const settingsFile = af.vscodeSettingsFile(ctx);
	await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
	const pasted = af.SETTINGS_KEYS.map((key) => `\t"${key}": true,`).join('\n');
	await fsp.writeFile(settingsFile, `{\n\t"editor.fontSize": 14,\n${pasted}\n}\n`);
	// What the setup does.
	await fsp.mkdir(ctx.folder, { recursive: true });
	await af.installCanvas(ctx, offline);
	await af.INSTALLERS.skills(ctx);
	await af.INSTALLERS.resources(ctx);
	await af.record(ctx, 'git', { by: 'setup', dir: path.join(ctx.tools, 'git'), version: '2.56.1' });
	await fsp.mkdir(path.join(ctx.tools, 'bin'), { recursive: true });
	await af.ensurePath(ctx);
	assert.match(fs.readFileSync(path.join(home, '.zprofile'), 'utf8'), /ai-first-workshop\/tools\/bin/);
	await af.record(ctx, 'taste_weekly', { automationId: 'auto-123' });

	const plan = await af.uninstall(ctx);
	assert.equal(plan.done, false);
	assert.ok(fs.existsSync(ctx.folder), 'listing removes nothing');
	const ids = plan.steps.map((step) => step.id);
	assert.deepEqual(ids.slice(-1), ['folder'], 'the folder goes last');
	assert.ok(ids.includes('canvas') && ids.includes('path_block') && ids.includes('settings') && ids.includes('taste_weekly'));

	const cwd = process.cwd();
	const done = await af.uninstall(ctx, { yes: true });
	process.chdir(cwd);
	assert.equal(done.done, true);
	assert.deepEqual(done.results.filter((entry) => entry.ok === false), []);
	assert.equal(fs.existsSync(ctx.folder), false);
	assert.equal(fs.readFileSync(path.join(theirs, 'SKILL.md'), 'utf8'), 'their own\n', 'their skill is back');
	for (const name of af.REQUIRED_SKILLS.filter((name) => name !== 'autonomous-prototypes')) {
		assert.equal(fs.existsSync(path.join(ctx.skillsDir, name)), false, name);
	}
	assert.equal(fs.readFileSync(path.join(home, '.zprofile'), 'utf8').trim(), 'export EDITOR=vim');
	assert.equal(fs.existsSync(path.join(ctx.copilotHome, 'extensions', 'setup-checklist')), false);
	assert.deepEqual(af.parseJsonc(fs.readFileSync(settingsFile, 'utf8')), { 'editor.fontSize': 14 });
	assert.ok(fs.existsSync(`${settingsFile}.before-uninstall`));
	assert.equal(done.results.find((entry) => entry.id === 'taste_weekly').automationId, 'auto-123', 'the agent deletes the automation');
});

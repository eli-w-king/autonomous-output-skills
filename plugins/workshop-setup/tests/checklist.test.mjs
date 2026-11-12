// node --test plugins/workshop-setup/tests/checklist.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView, itemDefs } from '../extensions/setup-checklist/lib/checklist.mjs';

const record = (reports = {}) => ({
	reports,
	choices: {},
	meta: {},
	lastCheck: { at: '2026-11-11T00:00:00Z', os: { name: 'darwin' }, items: { git: { ok: true }, node: { ok: true } } },
});

test('voice and taste stay off the checklist and out of the count until the setup reports them', () => {
	const ids = itemDefs(record()).defs.map((def) => def.id);
	assert.ok(!ids.includes('voice'));
	assert.ok(!ids.includes('taste'));
	const view = buildView(record(), { platform: 'darwin' });
	const shown = view.groups.flatMap((group) => group.items).map((item) => item.id);
	assert.ok(!shown.includes('voice') && !shown.includes('taste'));
	assert.ok(!view.groups.some((group) => group.id === 'yours'));
});

test('voice and taste appear once the agent reports them', () => {
	const ids = itemDefs(record({ voice: { status: 'todo' }, taste: { status: 'todo' } })).defs.map((def) => def.id);
	assert.ok(ids.includes('voice') && ids.includes('taste'));
});

test('a re-check shows items it has no data for as they were, not as checking', () => {
	const weekly = (view) => view.groups.flatMap((group) => group.items).find((item) => item.id === 'weekly');
	assert.equal(weekly(buildView({ ...record(), lastCheck: null }, { platform: 'darwin', checking: true })).status, 'checking');
	assert.equal(weekly(buildView(record(), { platform: 'darwin', checking: true })).status, 'todo');
});

const AT = '2026-11-11T00:01:00Z';
const shownItem = (rec, id, platform = 'darwin') => buildView(rec, { platform }).groups.flatMap((group) => group.items).find((item) => item.id === id);
const withCheck = (items, os = { name: 'macOS', arch: 'arm64' }, reports = {}) => ({
	reports,
	choices: {},
	meta: {},
	lastCheck: { at: '2026-11-11T00:00:00Z', receivedAt: '2026-11-11T00:00:00Z', os, items, steps: {} },
});

test('a sign-in code the agent sends shows with the canvas\'s own steps', () => {
	const rec = withCheck({ gh: { ok: false, required: true, detail: 'GitHub CLI is not signed in' } }, undefined,
		{ gh: { status: 'needs-you', note: null, commands: ['7F3A-21C9'], at: AT } });
	const gh = shownItem(rec, 'gh');
	assert.equal(gh.status, 'needs-you');
	assert.deepEqual(gh.commands, ['7F3A-21C9']);
	assert.match(gh.note, /github\.com\/login\/device/);
	assert.doesNotMatch(gh.note, /Terminal/);
});

test('Homebrew\'s steps follow the Mac\'s chip: the installer window on Apple silicon, Terminal on Intel', () => {
	const reports = { package_manager: { status: 'needs-you', note: null, commands: [], at: AT } };
	const items = { package_manager: { ok: false, required: false, detail: 'Homebrew is not installed' } };
	const silicon = shownItem(withCheck(items, { name: 'macOS', arch: 'arm64' }, reports), 'package_manager');
	assert.deepEqual(silicon.commands, []);
	assert.match(silicon.note, /installer window/);
	const intel = shownItem(withCheck(items, { name: 'macOS', arch: 'x86_64' }, reports), 'package_manager');
	assert.equal(intel.commands.length, 1);
	assert.match(intel.note, /Open Terminal/);
});

test('the Copilot sign-in reads as a plain result', () => {
	const rec = withCheck({ copilot_signin: { ok: true, required: true, detail: 'signed in to GitHub with Copilot in VS Code Insiders (they said so)' } });
	assert.equal(shownItem(rec, 'copilot_signin').detail, 'signed in to GitHub with Copilot in VS Code Insiders');
});

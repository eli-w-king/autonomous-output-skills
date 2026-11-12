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

// node --test plugins/workshop-setup/tests/ai-first.test.mjs
// The AI-First path of the canvas: the picker, the Microsoft gate, the install list (locks, switches, sizes, total),
// Confirm, the wait the agent uses, the live list, and the first-time simulation on a Mac and a PC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SetupModel } from '../extensions/setup-checklist/lib/model.mjs';
import { CanvasHub, fontsPresent } from '../extensions/setup-checklist/lib/server.mjs';
import { MemoryStore, Simulation, firstAiFirstCheck, monotonicNow } from '../extensions/setup-checklist/lib/simulation.mjs';
import { applySelection, installList } from '../extensions/setup-checklist/lib/ai-first.mjs';
import { validateFlowBody, validateOpenInput, validateWaitInput } from '../extensions/setup-checklist/lib/validate.mjs';

const GB = 1000 * 1000 * 1000;

function fixture(os = 'mac', change = (items) => items) {
	const items = change(structuredClone(firstAiFirstCheck(os)));
	const data = { time: new Date().toISOString(), path: 'ai-first', os: { name: os === 'mac' ? 'macOS' : 'Windows', arch: 'arm64' }, folder_display: '~/ai-first-workshop', free_bytes: 50 * GB, items, steps: {} };
	return { run: async () => ({ data: structuredClone(data), script: 'fixture' }), data };
}

async function aiFirstModel({ os = 'mac', change, workshop = 'choose' } = {}) {
	const runner = fixture(os, change);
	const now = monotonicNow();
	const model = new SetupModel({ store: new MemoryStore({ now }), runner, aiFirstRunner: runner, platform: os === 'mac' ? 'darwin' : 'win32', now });
	await model.load();
	await model.setMeta({ title: 'Design systems workshop', subtitle: 'Team series', presenter: 'Your Name' });
	await model.setWorkshop({ workshop, workshopDir: '/Users/you/ai-first-workshop' });
	await model.refresh();
	return { model, runner };
}

const rowsOf = (model) => model.view().flow.install.rows;
const shownIds = (model) => model.view().groups.flatMap((group) => group.items).map((item) => item.id);

test('nothing is picked at first, and the open input keeps the internal setup the default', async () => {
	const { model } = await aiFirstModel();
	const view = model.view();
	assert.equal(view.path, 'ai-first');
	assert.equal(view.flow.pick, null);
	assert.equal(view.flow.step, 'pick');
	assert.deepEqual(view.flow.workshops.map((w) => w.id), ['ai-first', 'microsoft']);
	assert.deepEqual(validateOpenInput({ workshop: 'choose', workshopDir: '~/ai-first-workshop' }, { home: '/Users/you' }), { workshop: 'choose', workshopDir: '/Users/you/ai-first-workshop' });
	assert.throws(() => validateOpenInput({ workshop: 'internal' }));
	assert.deepEqual(validateOpenInput({}), {});
});

test('required items are locked on, the extras start off, and the total counts only what gets installed', async () => {
	const { model } = await aiFirstModel();
	await model.flowAction({ action: 'pick', id: 'ai-first' });
	const rows = rowsOf(model);
	const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
	for (const id of ['git', 'node', 'gh', 'skills', 'excalidraw', 'resources', 'demo_tools', 'computer_use', 'dictation']) {
		assert.equal(byId[id].state, 'locked', id);
		assert.ok(byId[id].reason, `${id} says why`);
	}
	for (const id of ['skill_runs', 'skill_research', 'skill_taste', 'taste_weekly']) {
		assert.equal(byId[id].state, 'off', id);
	}
	const total = model.view().flow.install.total;
	assert.equal(total.disk, rows.reduce((sum, row) => sum + row.disk, 0));
	assert.ok(total.disk > 400 * 1000 * 1000 && total.disk < GB, `a fresh Mac: ${total.text}`);
	await model.flowAction({ action: 'select', id: 'skill_research', on: true });
	assert.ok(model.view().flow.install.total.disk > total.disk, 'an extra adds its size');
});

test('a tool that is already there shows as present and adds nothing', async () => {
	const { model } = await aiFirstModel({
		change: (items) => ({ ...items, git: { ok: true, required: true, needed: false, detail: 'Git 2.49.0', size: { download: 0, disk: 0 } } }),
	});
	const git = rowsOf(model).find((row) => row.id === 'git');
	assert.equal(git.state, 'present');
	assert.equal(git.disk, 0);
	assert.match(git.note, /Already on this Mac/);
});

test('the worst case, a new Mac or PC without Chrome or Edge and every extra on, stays under 1 GB', async () => {
	for (const os of ['mac', 'windows']) {
		const { model } = await aiFirstModel({
			os,
			change: (items) => ({ ...items, demo_tools: { ...items.demo_tools, browser: null, fallback: { download: 129e6, disk: 280e6 }, size: { download: items.demo_tools.size.download + 129e6, disk: items.demo_tools.size.disk + 280e6 } } }),
		});
		await model.flowAction({ action: 'pick', id: 'ai-first' });
		for (const id of ['skill_runs', 'skill_research', 'taste_weekly']) {
			await model.flowAction({ action: 'select', id, on: true });
		}
		const install = model.view().flow.install;
		assert.ok(install.total.disk < GB, `${os}: ${install.total.text}`);
		assert.match(install.rows.find((row) => row.id === 'demo_tools').note, /No Chrome or Edge/);
	}
});

test('the weekly taste update brings My taste with it, and My taste off takes the update off', () => {
	assert.deepEqual(applySelection({}, 'taste_weekly', true), { taste_weekly: true, skill_taste: true });
	assert.deepEqual(applySelection({ taste_weekly: true, skill_taste: true }, 'skill_taste', false), { taste_weekly: false, skill_taste: false });
	assert.deepEqual(applySelection({}, 'skill_runs', true), { skill_runs: true });
});

test('the steps go in order, Confirm is only on the last one, and nothing changes after it', async () => {
	const { model } = await aiFirstModel();
	await assert.rejects(model.flowAction({ action: 'confirm' }), /last step/);
	await assert.rejects(model.flowAction({ action: 'step', step: 'install' }), /isn't available/);
	await model.flowAction({ action: 'pick', id: 'ai-first' });
	assert.equal(model.view().flow.step, 'ready');
	await model.flowAction({ action: 'select', id: 'taste_weekly', on: true });
	for (const step of ['install', 'uninstall', 'after']) {
		await model.flowAction({ action: 'step', step });
	}
	await assert.rejects(model.flowAction({ action: 'select', id: 'git', on: false }), /optional/);
	const result = await model.flowAction({ action: 'confirm' });
	assert.equal(result.status, 'confirmed');
	assert.deepEqual(result.flow.install, ['git', 'node', 'gh', 'skills', 'excalidraw', 'resources', 'demo_tools', 'computer_use', 'dictation', 'skill_taste', 'taste_weekly']);
	await assert.rejects(model.flowAction({ action: 'select', id: 'skill_runs', on: true }), /confirmed/);
	assert.deepEqual(shownIds(model), result.flow.install, 'the live list shows only what was chosen');
	assert.equal(model.summary().flow.confirmed, true);
});

test('the plan stays as confirmed while tools land', async () => {
	const { model, runner } = await aiFirstModel();
	await model.flowAction({ action: 'pick', id: 'ai-first' });
	for (const step of ['install', 'uninstall', 'after']) {
		await model.flowAction({ action: 'step', step });
	}
	await model.flowAction({ action: 'confirm' });
	runner.data.items.git = { ok: true, required: true, needed: false, detail: 'Git 2.56.1, installed by the setup', by: 'setup', size: { download: 0, disk: 0 } };
	await model.refresh();
	assert.ok(model.summary().flow.install.includes('git'));
	assert.equal(model.view().groups.flatMap((g) => g.items).find((item) => item.id === 'git').status, 'done');
	assert.equal(model.view().flow.restart, true, 'a tool the setup added asks for a restart at the end');
});

test('the Microsoft workshop needs a work account on GitHub before it continues to the internal setup', async () => {
	const { model, runner } = await aiFirstModel();
	await model.flowAction({ action: 'pick', id: 'microsoft' });
	assert.equal(model.view().flow.step, 'gate');
	assert.equal(model.view().flow.gate.ok, false);
	await assert.rejects(model.flowAction({ action: 'continue' }), /Microsoft account/);
	await assert.rejects(model.flowAction({ action: 'confirm' }), /last step/);
	runner.data.items.microsoft_signin = { ok: true, required: false, detail: 'signed in with a work account (mona_contoso)', size: { download: 0, disk: 0 } };
	await model.refresh();
	assert.equal(model.view().flow.gate.ok, true);
	const result = await model.flowAction({ action: 'continue' });
	assert.equal(result.status, 'microsoft');
	assert.equal(model.view().path, 'internal', 'the usual checklist from here');
	assert.equal(model.view().flow, undefined);
});

test('the agent\'s wait: picking Microsoft, Confirm, and the timeout', async () => {
	const { model } = await aiFirstModel();
	const quick = await model.waitForFlow({ timeoutMs: 30 });
	assert.equal(quick.status, 'waiting');
	const gate = model.waitForFlow({ timeoutMs: 5000 });
	await model.flowAction({ action: 'pick', id: 'microsoft' });
	assert.equal((await gate).status, 'gate');
	await model.flowAction({ action: 'step', step: 'pick' });
	await model.flowAction({ action: 'pick', id: 'ai-first' });
	const confirmed = model.waitForFlow({ timeoutMs: 5000 });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(model.waiters, 1);
	for (const step of ['install', 'uninstall', 'after']) {
		await model.flowAction({ action: 'step', step });
	}
	let heard = null;
	model.on('confirmed', (flow) => {
		heard = flow;
	});
	await model.flowAction({ action: 'confirm' });
	const result = await confirmed;
	assert.equal(result.status, 'confirmed');
	assert.equal(model.waiters, 0);
	assert.ok(heard?.install.includes('excalidraw'), 'Confirm tells the extension, which nudges the chat when nobody waits');
	assert.equal((await model.waitForFlow({ timeoutMs: 5000 })).status, 'confirmed', 'it answers at once after Confirm');
	assert.deepEqual(validateWaitInput({ timeoutSeconds: 30 }), { timeoutMs: 30000 });
	assert.throws(() => validateWaitInput({ timeoutSeconds: 1 }));
});

test('an open without workshop is the internal setup, even after the AI-First path ran here', async () => {
	const { model } = await aiFirstModel();
	await model.flowAction({ action: 'pick', id: 'ai-first' });
	await model.setWorkshop({ workshop: null });
	assert.equal(model.view().path, 'internal');
	await assert.rejects(model.flowAction({ action: 'step', step: 'install' }), /picker/);
	await model.setWorkshop({ workshop: 'choose' });
	assert.equal(model.view().flow.pick, 'ai-first', 'the AI-First choices are kept for its next open');
});

test('the page posts flow steps to the server, and bad ones get a clear 400', async () => {
	const { model } = await aiFirstModel();
	const hub = new CanvasHub({ model });
	const instance = await hub.open('test');
	const post = (body) => fetch(new URL('/api/flow', instance.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const ok = await post({ action: 'pick', id: 'ai-first' });
	assert.equal(ok.status, 200);
	assert.equal((await ok.json()).flow.pick, 'ai-first');
	const bad = await post({ action: 'select', id: 'git', on: false });
	assert.equal(bad.status, 400);
	const wrong = await post({ action: 'explode' });
	assert.equal(wrong.status, 400);
	for (const asset of ['/welcome.css', '/welcome.js', '/flow.css', '/flow.js', '/horizon/horizon.js']) {
		assert.equal((await fetch(new URL(asset, instance.url))).status, 200, asset);
	}
	// The kit's CSS asks for its fonts only when they're next to it, and nothing else in the folder is served as one.
	const css = await fetch(new URL('/horizon/horizon.css', instance.url));
	assert.match(css.headers.get('content-security-policy'), /font-src 'self'/);
	assert.equal((await css.text()).includes('@font-face'), await fontsPresent());
	for (const asset of ['/horizon/fonts/Unknown.woff2', '/horizon/fonts/..%2F..%2Flib%2Fserver.mjs', '/horizon/fonts/x.mjs']) {
		assert.equal((await fetch(new URL(asset, instance.url))).status, 404, asset);
	}
	const state = await (await fetch(new URL('/api/state', instance.url))).json();
	assert.equal(state.path, 'ai-first');
	assert.equal(state.flow.step, 'ready');
	await hub.closeAll();
	assert.throws(() => validateFlowBody({ action: 'pick', id: 'Not An Id' }));
});

test('the install list says what it is checking before the first check', () => {
	const list = installList({ aiFirst: { mode: 'choose', pick: 'ai-first', step: 'install', selections: {} }, lastCheck: null }, 'mac');
	assert.equal(list.checked, false);
	assert.ok(list.rows.every((row) => row.sizeText === 'Checking' || row.state === 'present'));
});

for (const os of ['mac', 'windows']) {
	test(`a first-time AI-First setup on a new ${os === 'mac' ? 'Mac' : 'PC'} goes from the picker to all done`, async () => {
		const sim = new Simulation({ os, speed: 200, workshop: 'choose', meta: { title: 'Design systems workshop', presenter: 'Your Name' } });
		await sim.ready();
		const codes = new Set();
		const steps = new Set();
		sim.model.on('change', () => {
			const view = sim.model.view();
			if (view.flow) {
				steps.add(view.flow.step);
			}
			const gh = view.groups.flatMap((group) => group.items).find((item) => item.id === 'gh');
			if (gh?.status === 'needs-you') {
				gh.commands.forEach((command) => codes.add(command));
			}
		});
		assert.equal(sim.info().workshop, 'choose');
		assert.match(sim.info().label, /AI-First/);
		sim.start();
		await sim.finished();
		assert.equal(sim.state, 'done', sim.info().error || '');
		const summary = sim.model.summary();
		assert.equal(summary.allDone, true);
		assert.equal(summary.flow.confirmed, true);
		assert.deepEqual([...steps].filter((step) => step !== 'pick'), ['ready', 'install', 'uninstall', 'after']);
		assert.deepEqual([...codes], ['7F3A-21C9']);
		const ids = shownIds(sim.model);
		assert.ok(ids.includes('skill_taste') && ids.includes('taste_weekly'));
		assert.ok(!ids.includes('skill_runs') && !ids.includes('skill_research'), 'extras they left off stay off the list');
		sim.dispose();
	});
}

// node --test plugins/workshop-setup/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SetupModel } from '../extensions/setup-checklist/lib/model.mjs';
import { CanvasHub } from '../extensions/setup-checklist/lib/server.mjs';
import { MemoryStore, Simulation, monotonicNow } from '../extensions/setup-checklist/lib/simulation.mjs';
import { validateOpenInput } from '../extensions/setup-checklist/lib/validate.mjs';

const FAST = 2000;
const shownIds = (model) => model.view().groups.flatMap((group) => group.items).map((item) => item.id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition, ms = 5000) {
	const end = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > end) {
			throw new Error('timed out');
		}
		await sleep(5);
	}
}

for (const os of ['mac', 'windows']) {
	test(`a new ${os} goes from the first check to all done, without voice or taste`, async () => {
		const sim = new Simulation({ os, speed: FAST, meta: { presenter: 'Your Name + Their Name' } });
		await sim.ready();
		const firstChecks = [];
		const codes = new Set();
		sim.model.on('change', () => {
			const view = sim.model.view();
			if (view.check.at && !firstChecks.length) {
				firstChecks.push(view.progress);
			}
			const gh = view.groups.flatMap((group) => group.items).find((item) => item.id === 'gh');
			if (gh?.status === 'needs-you') {
				gh.commands.forEach((command) => codes.add(command));
			}
		});
		assert.equal(sim.start(), true);
		await sim.finished();
		assert.equal(sim.state, 'done');
		assert.ok(firstChecks[0].done < firstChecks[0].total / 2, 'the first check finds most of it missing');
		assert.deepEqual([...codes], ['7F3A-21C9'], 'the GitHub sign-in shows the code to copy, not a command');
		const summary = sim.model.summary();
		assert.equal(summary.allDone, true);
		assert.equal(summary.progress.done, summary.progress.total);
		assert.equal(summary.checkError, null);
		assert.equal(summary.step, null);
		assert.equal(summary.choices.azure, true);
		assert.equal(summary.meta.presenter, 'Your Name + Their Name');
		const ids = shownIds(sim.model);
		assert.ok(!ids.includes('voice') && !ids.includes('taste'));
		assert.equal(ids.includes('powershell'), os === 'windows');
		sim.dispose();
	});
}

test('pause holds the simulation where it is, and play carries on', async () => {
	const sim = new Simulation({ os: 'mac', speed: 20 });
	await sim.ready();
	sim.start();
	await until(() => sim.model.view().step?.id === 'gh');
	sim.pause();
	assert.equal(sim.state, 'paused');
	const held = JSON.stringify(sim.model.summary());
	await sleep(400);
	assert.equal(JSON.stringify(sim.model.summary()), held);
	sim.resume();
	assert.equal(sim.state, 'playing');
	await until(() => sim.model.view().step?.id !== 'gh');
	sim.dispose();
});

test('replay throws the run away and starts over from scratch', async () => {
	const sim = new Simulation({ os: 'windows', speed: FAST });
	await sim.ready();
	sim.start();
	await sim.finished();
	const old = sim.model;
	let swapped = null;
	sim.on('model', (next) => {
		swapped = next;
	});
	await sim.replay();
	assert.notEqual(sim.model, old);
	assert.equal(swapped, sim.model);
	assert.equal(sim.state, 'waiting');
	assert.equal(sim.model.view().check.at, null);
	assert.equal(sim.model.summary().progress.done, 0);
	sim.dispose();
});

test('setStep accepts an item that stays hidden until it is reported, like Homebrew', async () => {
	const model = new SetupModel({ store: new MemoryStore(), runner: null, platform: 'darwin', now: monotonicNow() });
	await model.load();
	await model.setStep({ id: 'package_manager' });
	assert.equal(model.record.step.id, 'package_manager');
	await assert.rejects(model.setStep({ id: 'not_an_item' }), /no item or group/);
});

test('the simulation stays off unless simulate is set', async () => {
	assert.equal('simulate' in validateOpenInput({ title: 'T' }), false);
	assert.equal(validateOpenInput({ simulate: 'windows' }).simulate, 'windows');
	assert.throws(() => validateOpenInput({ simulate: 'linux' }), /simulate must be one of/);

	const real = new SetupModel({ store: new MemoryStore(), runner: null, platform: 'darwin' });
	await real.load();
	const hub = new CanvasHub({ model: real });
	const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	try {
		const plain = await hub.open('plain');
		assert.equal(hub.modelFor('plain'), real);
		assert.equal((await post(`${plain.url}api/sim`, { action: 'start' })).status, 404);
		assert.equal('simulation' in (await (await fetch(`${plain.url}api/state`)).json()), false);

		const sim = new Simulation({ os: 'mac', speed: 1 });
		await sim.ready();
		const shown = await hub.open('sim', { simulation: sim });
		assert.equal(hub.modelFor('sim'), sim.model);
		assert.notEqual(hub.modelFor('sim'), real);
		const state = await (await fetch(`${shown.url}api/state`)).json();
		assert.deepEqual(state.simulation, { os: 'mac', label: 'A new Mac', state: 'waiting', error: null });
		assert.equal((await post(`${shown.url}api/sim`, { action: 'rewind' })).status, 400);
		const replayed = await (await post(`${shown.url}api/sim`, { action: 'replay' })).json();
		assert.equal(replayed.simulation.state, 'waiting');
		assert.equal(hub.modelFor('sim'), sim.model);
		assert.equal(real.record.reports && Object.keys(real.record.reports).length, 0);
	} finally {
		await hub.closeAll();
	}
});

test('the welcome shows until the person closes it once, and a simulation shows it again on replay', async () => {
	const real = new SetupModel({ store: new MemoryStore(), runner: null, platform: 'darwin', now: monotonicNow() });
	await real.load();
	const hub = new CanvasHub({ model: real });
	const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const state = async (url) => (await fetch(`${url}api/state`)).json();
	try {
		const page = await hub.open('real');
		assert.equal((await state(page.url)).welcome.show, true);
		assert.equal((await post(`${page.url}api/welcome`, { extra: true })).status, 400);
		assert.equal((await post(`${page.url}api/welcome`, {})).status, 200);
		assert.equal((await state(page.url)).welcome.show, false);
		const closedAt = real.record.welcomedAt;
		assert.match(closedAt, /^\d{4}-\d{2}-\d{2}T/);

		const sim = new Simulation({ os: 'windows', speed: 1 });
		await sim.ready();
		const shown = await hub.open('sim', { simulation: sim });
		await post(`${shown.url}api/welcome`, {});
		assert.equal((await state(shown.url)).welcome.show, false);
		await post(`${shown.url}api/sim`, { action: 'replay' });
		assert.equal((await state(shown.url)).welcome.show, true);
		assert.equal(real.record.welcomedAt, closedAt, 'the simulation never touches the real progress');
	} finally {
		await hub.closeAll();
	}
});

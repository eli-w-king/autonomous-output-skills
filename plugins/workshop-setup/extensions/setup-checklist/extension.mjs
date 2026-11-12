// The workshop setup checklist as a Copilot canvas. This file only wires the canvas to the modules in lib/.
import { createCanvas, CanvasError, joinSession } from '@github/copilot-sdk/extension';
import { CANVAS_ID } from './lib/catalog.mjs';
import { SetupError } from './lib/errors.mjs';
import { CheckRunner } from './lib/runner.mjs';
import { SetupModel } from './lib/model.mjs';
import { CanvasHub } from './lib/server.mjs';
import { Simulation } from './lib/simulation.mjs';
import { Store, copilotHome } from './lib/store.mjs';
import {
	OPEN_INPUT_SCHEMA, REFRESH_SCHEMA, SET_ITEM_SCHEMA, SET_STEP_SCHEMA,
	validateOpenInput, validateRefreshInput, validateSetItemInput, validateSetStepInput,
} from './lib/validate.mjs';

let session = null;
const log = (message, level = 'info') => {
	session?.log(message, { level, ephemeral: true }).catch(() => {});
};

const home = copilotHome();
const model = new SetupModel({ store: new Store({ home }), runner: new CheckRunner({ copilotHome: home }), log });
const hub = new CanvasHub({ model, log });

function toCanvasError(error) {
	if (error instanceof CanvasError) {
		return error;
	}
	if (error instanceof SetupError) {
		return new CanvasError(error.code, error.message);
	}
	return new CanvasError('internal_error', `The setup canvas hit an unexpected error: ${String(error?.message || error).split('\n')[0]}`);
}

const guard = (fn) => async (ctx) => {
	try {
		return await fn(ctx);
	} catch (error) {
		throw toCanvasError(error);
	}
};

// The event's text saved by a real open, so a simulation looks like the real thing. Read only.
async function savedMeta() {
	try {
		await model.ensureLoaded();
		return model.record?.meta || {};
	} catch {
		return {};
	}
}

// A simulation for this instance: the one it already plays (same OS), or a new one from the start.
async function openSimulation(instanceId, os, fields) {
	const given = { ...fields };
	delete given.skillsDir;
	const current = hub.get(instanceId)?.simulation;
	if (current && current.os === os) {
		await current.setMeta(given);
		return hub.open(instanceId, { simulation: current });
	}
	const simulation = new Simulation({ os, meta: { ...(await savedMeta()), ...given }, log });
	await simulation.ready();
	return hub.open(instanceId, { simulation });
}

const canvas = createCanvas({
	id: CANVAS_ID,
	displayName: 'Workshop setup',
	description: 'A live checklist of this machine\'s workshop setup that shows what is ready, what is tested and what needs the person.',
	inputSchema: OPEN_INPUT_SCHEMA,
	actions: [
		{
			name: 'getState',
			description: 'Read every item\'s status, the person\'s choices for optional items, progress and the last check time.',
			handler: guard(async (ctx) => {
				const target = hub.modelFor(ctx.instanceId);
				await target.ensureLoaded();
				return target.summary();
			}),
		},
		{
			name: 'refresh',
			description: 'Run check-setup.py again, wait for it, and return the updated state. Use it after installs and sign-ins.',
			inputSchema: REFRESH_SCHEMA,
			handler: guard(async (ctx) => {
				const { quick } = validateRefreshInput(ctx.input);
				const target = hub.modelFor(ctx.instanceId);
				await target.ensureLoaded();
				await target.refresh({ quick });
				return target.summary();
			}),
		},
		{
			name: 'setItem',
			description: 'Report one item\'s status: working, needs-you (with steps and commands), installed (shows its Try it test), tested, skipped, failed (with the exact error) or todo.',
			inputSchema: SET_ITEM_SCHEMA,
			handler: guard(async (ctx) => hub.modelFor(ctx.instanceId).setItem(validateSetItemInput(ctx.input))),
		},
		{
			name: 'setStep',
			description: 'Show which item or group the agent is on now, or none.',
			inputSchema: SET_STEP_SCHEMA,
			handler: guard(async (ctx) => hub.modelFor(ctx.instanceId).setStep(validateSetStepInput(ctx.input))),
		},
	],
	open: guard(async (ctx) => {
		const { simulate, ...fields } = validateOpenInput(ctx.input);
		if (simulate) {
			const instance = await openSimulation(ctx.instanceId, simulate, fields);
			return { url: instance.url, title: 'Workshop setup', status: `Simulation: ${instance.simulation.info().label}` };
		}
		await model.load();
		await model.setMeta(fields);
		const instance = await hub.open(ctx.instanceId);
		model.refreshSoon();
		return { url: instance.url, title: 'Workshop setup', status: model.statusLine() };
	}),
	onClose: async (ctx) => {
		await hub.close(ctx.instanceId);
	},
});

session = await joinSession({ canvases: [canvas] });

// Every input that reaches the canvas, from the agent's actions or from the page, goes through here first.
import os from 'node:os';
import path from 'node:path';
import { SetupError } from './errors.mjs';
import { REPORT_STATUSES } from './catalog.mjs';

const ID_PATTERN = '^[a-z0-9][a-z0-9_-]{0,63}$';
const ID_RE = new RegExp(ID_PATTERN);
const SIMULATE_OS = ['mac', 'windows'];
const SIM_ACTIONS = ['start', 'pause', 'play', 'replay'];
const WORKSHOP_MODES = ['choose', 'ai-first'];
const FLOW_ACTIONS = ['pick', 'step', 'select', 'confirm', 'continue'];
export const WAIT_LIMITS = { min: 5, max: 300, default: 120 };
// Control characters, except tab and newline where a note allows them.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const CONTROL_OR_NEWLINE_RE = /[\u0000-\u001f\u007f]/;

export const LIMITS = { title: 80, subtitle: 80, presenter: 60, checkInChat: 120, skillsDir: 1024, workshopDir: 1024, note: 600, noteLines: 8, command: 400, commands: 6 };

export const OPEN_INPUT_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string', maxLength: LIMITS.title, description: 'The event\'s name, shown in the intro and above the checklist. An empty string clears it.' },
		subtitle: { type: 'string', maxLength: LIMITS.subtitle, description: 'A short line that goes with the title, like a series name.' },
		presenter: { type: 'string', maxLength: LIMITS.presenter, description: 'The host\'s name. The intro resolves into it.' },
		checkInChat: { type: 'string', maxLength: LIMITS.checkInChat, description: 'The meeting chat where the Work IQ test posts a check-in. Without it, the test reads the next meeting instead.' },
		skillsDir: { type: 'string', maxLength: LIMITS.skillsDir, description: 'Absolute path (or ~/...) of a folder that has autonomous-setup/scripts/check-setup.py. Default: autonomous-output-skills, then skills, in the Copilot home.' },
		workshop: { type: 'string', enum: WORKSHOP_MODES, description: 'The AI-First path (autonomous-setup references/ai-first.md): choose shows the workshop picker first, ai-first skips it. Leave it out for the full setup, which then works exactly as before.' },
		workshopDir: { type: 'string', maxLength: LIMITS.workshopDir, description: 'The workshop folder from the setup prompt, absolute or ~/..., like ~/ai-first-workshop. Only with workshop.' },
		simulate: { type: 'string', enum: SIMULATE_OS, description: 'Only for hosts previewing the workshop, never for a real setup: plays a made-up first-time setup on a new Mac or Windows PC, from the first check to all set, with its own instanceId. It runs in memory, so nothing on this machine is checked, saved or changed.' },
	},
	additionalProperties: false,
};

export const REFRESH_SCHEMA = {
	type: 'object',
	properties: {
		quick: { type: 'boolean', description: 'Skip the slow checks (Azure sign-in, the skills sync status, repo visibility).' },
	},
	additionalProperties: false,
};

export const SET_ITEM_SCHEMA = {
	type: 'object',
	properties: {
		id: { type: 'string', pattern: ID_PATTERN, description: 'Item id from getState, like workiq, playwright or computer_use.' },
		status: {
			type: 'string',
			enum: REPORT_STATUSES,
			description: 'todo: not started. working: you are on it. needs-you: the person has to act (give the steps in note). installed: set up, so the canvas shows its Try it test. tested: the person\'s Try it test worked. skipped: the person chose to skip it. failed: it broke (put the exact error line in note).',
		},
		note: { type: 'string', maxLength: LIMITS.note, description: 'Plain words for the person. For needs-you, the steps, one per line: what to click, type or allow, and where (they don\'t use a terminal). Leave it out to show the canvas\'s own steps for the item. For failed, the exact error line. For working, what is happening now.' },
		commands: { type: 'array', maxItems: LIMITS.commands, items: { type: 'string', maxLength: LIMITS.command }, description: 'Text the person copies, one per entry, exactly as they paste it: a one-time sign-in code (shown large, like the GitHub CLI device code), a line for the chat (like /computer on), or a command that works as is in Terminal (zsh) on a Mac or PowerShell on Windows: one line, ~ on a Mac but $HOME on Windows, quotes around paths with spaces, no placeholders.' },
	},
	required: ['id', 'status'],
	additionalProperties: false,
};

export const SET_STEP_SCHEMA = {
	type: 'object',
	properties: {
		id: { type: 'string', pattern: ID_PATTERN, description: 'The item or group the agent is on now (an id from getState, or basics, workshop, connections, yours, optional). Use none to clear it.' },
	},
	required: ['id'],
	additionalProperties: false,
};

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function invalid(message) {
	return new SetupError('invalid_input', message);
}

function objectInput(input, allowed, what) {
	if (input === undefined || input === null) {
		return {};
	}
	if (!isPlainObject(input)) {
		throw invalid(`${what} takes an object, like {}.`);
	}
	const extra = Object.keys(input).filter((key) => !allowed.includes(key));
	if (extra.length) {
		throw invalid(`${what} doesn't take ${extra.map((k) => JSON.stringify(k)).join(', ')}. It takes: ${allowed.join(', ') || 'nothing'}.`);
	}
	return input;
}

function text(value, field, max, { multiline = false } = {}) {
	if (typeof value !== 'string') {
		throw invalid(`${field} must be a string.`);
	}
	const trimmed = value.trim();
	if (trimmed.length > max) {
		throw invalid(`${field} is longer than ${max} characters.`);
	}
	if ((multiline ? CONTROL_RE : CONTROL_OR_NEWLINE_RE).test(trimmed)) {
		throw invalid(`${field} has control characters.`);
	}
	return trimmed;
}

export function validateId(value, field = 'id') {
	if (typeof value !== 'string' || !ID_RE.test(value)) {
		throw invalid(`${field} must be a lowercase id like workiq or computer_use.`);
	}
	return value;
}

export function expandHome(value, home = os.homedir()) {
	if (value === '~') {
		return home;
	}
	if (value.startsWith('~/') || value.startsWith('~\\')) {
		return path.join(home, value.slice(2));
	}
	return value;
}

// Returns only the fields that were given; an empty string means "clear it" (null).
export function validateOpenInput(input, { home = os.homedir() } = {}) {
	const source = objectInput(input, Object.keys(OPEN_INPUT_SCHEMA.properties), 'The open input');
	const out = {};
	for (const field of ['title', 'subtitle', 'presenter', 'checkInChat']) {
		if (source[field] !== undefined) {
			const value = text(source[field], field, LIMITS[field]);
			out[field] = value || null;
		}
	}
	if (source.skillsDir !== undefined) {
		const value = text(source.skillsDir, 'skillsDir', LIMITS.skillsDir);
		if (!value) {
			out.skillsDir = null;
		} else {
			const expanded = expandHome(value, home);
			if (!path.isAbsolute(expanded)) {
				throw invalid('skillsDir must be an absolute path or start with ~/.');
			}
			out.skillsDir = path.normalize(expanded);
		}
	}
	if (source.workshop !== undefined) {
		if (!WORKSHOP_MODES.includes(source.workshop)) {
			throw invalid(`workshop must be one of: ${WORKSHOP_MODES.join(', ')}.`);
		}
		out.workshop = source.workshop;
	}
	if (source.workshopDir !== undefined) {
		const value = text(source.workshopDir, 'workshopDir', LIMITS.workshopDir);
		if (!value) {
			out.workshopDir = null;
		} else {
			const expanded = expandHome(value, home);
			if (!path.isAbsolute(expanded)) {
				throw invalid('workshopDir must be an absolute path or start with ~/.');
			}
			out.workshopDir = path.normalize(expanded);
		}
	}
	if (source.simulate !== undefined) {
		if (!SIMULATE_OS.includes(source.simulate)) {
			throw invalid(`simulate must be one of: ${SIMULATE_OS.join(', ')}.`);
		}
		out.simulate = source.simulate;
	}
	return out;
}

export function validateRefreshInput(input) {
	const source = objectInput(input, ['quick'], 'refresh');
	if (source.quick !== undefined && typeof source.quick !== 'boolean') {
		throw invalid('quick must be true or false.');
	}
	return { quick: source.quick === true };
}

export function validateSetItemInput(input) {
	const source = objectInput(input, ['id', 'status', 'note', 'commands'], 'setItem');
	const id = validateId(source.id);
	if (!REPORT_STATUSES.includes(source.status)) {
		throw invalid(`status must be one of: ${REPORT_STATUSES.join(', ')}.`);
	}
	const out = { id, status: source.status, note: null, commands: [] };
	if (source.note !== undefined && source.note !== null) {
		const note = text(source.note, 'note', LIMITS.note, { multiline: true }).replace(/\t/g, ' ');
		const lines = note.split('\n').map((line) => line.trim()).filter(Boolean);
		if (lines.length > LIMITS.noteLines) {
			throw invalid(`note has more than ${LIMITS.noteLines} lines.`);
		}
		out.note = lines.join('\n') || null;
	}
	if (source.commands !== undefined && source.commands !== null) {
		if (!Array.isArray(source.commands)) {
			throw invalid('commands must be a list of strings.');
		}
		if (source.commands.length > LIMITS.commands) {
			throw invalid(`commands has more than ${LIMITS.commands} entries.`);
		}
		out.commands = source.commands.map((command, i) => text(command, `commands[${i}]`, LIMITS.command)).filter(Boolean);
	}
	return out;
}

export function validateSetStepInput(input) {
	const source = objectInput(input, ['id'], 'setStep');
	return { id: validateId(source.id) };
}

// Bodies the page posts.
export function validateChoiceBody(body) {
	const source = objectInput(body, ['id', 'on'], 'The choice');
	const id = validateId(source.id);
	if (typeof source.on !== 'boolean') {
		throw invalid('on must be true or false.');
	}
	return { id, on: source.on };
}

export function validateEmptyBody(body, what) {
	objectInput(body, [], what);
	return {};
}

export const WAIT_SCHEMA = {
	type: 'object',
	properties: {
		timeoutSeconds: { type: 'integer', minimum: WAIT_LIMITS.min, maximum: WAIT_LIMITS.max, description: `How long to wait, in seconds (default ${WAIT_LIMITS.default}). Call it again while the result says waiting or gate.` },
	},
	additionalProperties: false,
};

export function validateWaitInput(input) {
	const source = objectInput(input, ['timeoutSeconds'], 'waitForConfirm');
	if (source.timeoutSeconds === undefined) {
		return { timeoutMs: WAIT_LIMITS.default * 1000 };
	}
	const value = source.timeoutSeconds;
	if (!Number.isInteger(value) || value < WAIT_LIMITS.min || value > WAIT_LIMITS.max) {
		throw invalid(`timeoutSeconds must be a whole number from ${WAIT_LIMITS.min} to ${WAIT_LIMITS.max}.`);
	}
	return { timeoutMs: value * 1000 };
}

// The page's flow controls: { action, id?, on?, step? }.
export function validateFlowBody(body) {
	const source = objectInput(body, ['action', 'id', 'on', 'step'], 'The step');
	if (!FLOW_ACTIONS.includes(source.action)) {
		throw invalid(`action must be one of: ${FLOW_ACTIONS.join(', ')}.`);
	}
	const out = { action: source.action, id: null, on: null, step: null };
	if (source.id !== undefined) {
		out.id = validateId(source.id);
	}
	if (source.on !== undefined) {
		if (typeof source.on !== 'boolean') {
			throw invalid('on must be true or false.');
		}
		out.on = source.on;
	}
	if (source.step !== undefined) {
		out.step = validateId(source.step, 'step');
	}
	return out;
}

export function validateSimBody(body) {
	const source = objectInput(body, ['action'], 'The simulation control');
	if (!SIM_ACTIONS.includes(source.action)) {
		throw invalid(`action must be one of: ${SIM_ACTIONS.join(', ')}.`);
	}
	return { action: source.action };
}

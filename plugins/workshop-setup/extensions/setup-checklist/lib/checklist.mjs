// Turns the saved record (the last check, the steps the agent recorded with check-setup.py mark, what the agent
// reported with setItem, and the person's choices) into one status per item, the progress, and the summary the agent
// reads back. Pure functions, so they're easy to test.
import { GROUPS, ITEMS, ITEM_BY_ID, MERGED_CHECKS, LATER_NOTE, osKey, itemLabel, itemHelp, itemTest, humanize } from './catalog.mjs';

const GROUP_BY_ID = new Map(GROUPS.map((group) => [group.id, group]));
const time = (value) => {
	const ms = Date.parse(value || '');
	return Number.isNaN(ms) ? -Infinity : ms;
};

// Steps recorded with check-setup.py mark, read as if the agent had reported them.
function stepSignal(step) {
	if (!step) {
		return null;
	}
	const map = { ok: 'tested', skipped: 'skipped', blocked: 'needs-you', failed: 'failed' };
	if (map[step.status]) {
		return { status: map[step.status], note: step.note || null, commands: [], at: step.at, from: 'step' };
	}
	if (step.status === 'pending' && step.note) {
		return { status: 'todo', note: step.note, commands: [], at: step.at, from: 'step' };
	}
	return null;
}

function newest(a, b) {
	if (!a) {
		return b;
	}
	if (!b) {
		return a;
	}
	return time(b.at) > time(a.at) ? b : a;
}

function settingState(checkItems, key) {
	const keys = checkItems.settings?.keys;
	if (!keys) {
		return null;
	}
	if (keys.matching.includes(key)) {
		return true;
	}
	if (keys.missing.includes(key) || keys.different.includes(key)) {
		return false;
	}
	return null;
}

export function osFromRecord(record, platform = process.platform) {
	return osKey(record.lastCheck?.os?.name || platform);
}

// The items to show, in catalog order, then ids only the check or the agent knows about.
export function itemDefs(record) {
	const checkItems = record.lastCheck?.items || {};
	const defs = [];
	const later = [];
	const known = new Set();
	for (const def of ITEMS) {
		known.add(def.id);
		(def.checks || []).forEach((id) => known.add(id));
		const fromCheck = (def.checks || [def.id]).some((id) => checkItems[id]) || (def.fromSetting && settingState(checkItems, def.fromSetting) !== null);
		const fromAgent = !!record.reports[def.id];
		if (def.later || (fromCheck && checkItems[def.id]?.later)) {
			if (fromCheck) {
				later.push(def);
			}
			continue;
		}
		if (def.quietUntilReady && !fromAgent && checkItems[def.id]?.ok !== true) {
			continue;
		}
		if (fromCheck || fromAgent || def.always) {
			defs.push(def);
		}
	}
	for (const [id, item] of Object.entries(checkItems)) {
		if (known.has(id) || MERGED_CHECKS.has(id)) {
			continue;
		}
		const def = { id, label: item.title || humanize(id), group: item.required === false ? 'optional' : 'more', unknown: true };
		(item.later ? later : defs).push(def);
		known.add(id);
	}
	for (const id of Object.keys(record.reports)) {
		if (!known.has(id)) {
			defs.push({ id, label: humanize(id), group: 'more', unknown: true });
		}
	}
	return { defs, later };
}

export function deriveItem(def, { record, os, checking = false, meta = {} }) {
	const check = record.lastCheck;
	const checkItems = check?.items || {};
	const found = (def.checks || [def.id]).map((id) => checkItems[id]).filter(Boolean);
	let checkOk = null;
	let detail = '';
	if (found.length) {
		checkOk = found.some((c) => c.ok === false) ? false : found.every((c) => c.ok === true) ? true : null;
		const failing = found.find((c) => c.ok === false);
		detail = (failing || found[0]).detail || '';
		if (checkOk === null && def.unknownDetail) {
			detail = def.unknownDetail;
		}
		if (checkOk === true && def.okDetail) {
			detail = def.okDetail;
		}
	} else if (def.fromSetting) {
		checkOk = settingState(checkItems, def.fromSetting);
		detail = checkOk === true ? 'The setting is on.' : checkOk === false ? 'The setting isn\'t on yet.' : '';
	}
	const hasCheckData = found.length > 0 || checkOk !== null;
	// The check skips some items on this machine (a dev box skips dictation, the weekly update, Azure and creating a
	// dev box), so they're skipped here even when the agent doesn't report them.
	const skippedByCheck = found.length > 0 && found.every((c) => c.skip === true);
	const optional = def.group === 'optional';
	const test = itemTest(def, os, meta);
	const stepId = def.step || def.id.replace(/_/g, '-');
	const step = check?.steps?.[stepId] || check?.steps?.[def.id] || null;
	const report = record.reports[def.id] ? { ...record.reports[def.id], from: 'agent' } : null;
	const signal = newest(report, stepSignal(step));
	const checkAfterSignal = signal ? time(check?.receivedAt) > time(signal.at) : true;
	const installed = checkOk === true;

	const choice = record.choices[def.id];
	const chosen = optional ? (choice === true || (choice === undefined && !!signal && signal.status !== 'skipped') || installed) : true;

	let status;
	let note = null;
	let commands = [];
	const settled = (isTested) => (test && !isTested ? 'installed' : 'done');
	if (skippedByCheck) {
		status = 'skipped';
	} else if (optional && !chosen && !installed) {
		status = 'skipped';
	} else if (!signal) {
		// Only the first check can still tell about an item it has no data for; later re-checks leave it as is.
		status = installed ? settled(false) : (!hasCheckData && checking && !check ? 'checking' : 'todo');
	} else if (signal.status === 'tested' || signal.status === 'installed') {
		// The agent says it's set up. A newer check that finds it missing wins.
		const disproved = hasCheckData && checkOk === false && checkAfterSignal;
		status = disproved ? 'todo' : settled(signal.status === 'tested');
	} else if (['working', 'needs-you', 'todo'].includes(signal.status) && installed && checkAfterSignal) {
		// A newer check found it installed, so the step it was waiting on is done.
		status = settled(false);
	} else {
		status = signal.status;
		note = signal.note || null;
		commands = signal.commands || [];
	}

	if (status === 'needs-you' && !note) {
		// Without the agent's own steps, the catalog's show, with whatever the agent sent to copy (a sign-in code).
		const help = itemHelp(def, os, { arch: check?.os?.arch || null });
		if (help) {
			note = help.text || null;
			if (!commands.length) {
				commands = help.commands || [];
			}
		}
	}
	if (status === 'todo' && signal?.status === 'todo' && signal.note) {
		detail = signal.note;
		note = null;
	}
	const how = record.baseline?.ids.includes(def.id) ? 'already' : 'new';
	return {
		id: def.id,
		group: GROUP_BY_ID.has(def.group) ? def.group : 'more',
		label: itemLabel(def, os) || humanize(def.id),
		status,
		how: status === 'done' || status === 'installed' ? how : null,
		tested: status === 'done' && !!test,
		detail,
		note,
		commands,
		tryIt: status === 'installed' ? test : null,
		optional,
		chosen,
		choice: choice === undefined ? null : choice,
		blurb: def.blurb || null,
		skippedByCheck,
		counted: status !== 'skipped' && (!optional || chosen),
	};
}

const STATUS_TEXT = {
	checking: 'Checking',
	todo: 'To do',
	working: 'Working on it',
	'needs-you': 'Needs you',
	installed: 'Installed',
	failed: 'Failed',
};

export function statusText(item) {
	if (item.status === 'done') {
		return item.tested ? 'Tested' : item.how === 'already' ? 'Already set up' : 'Set up just now';
	}
	if (item.status === 'skipped') {
		return item.optional && item.choice !== true && !item.skippedByCheck ? 'Not now' : 'Skipped';
	}
	if (item.status === 'installed' && item.how === 'already') {
		return 'Already installed';
	}
	return STATUS_TEXT[item.status] || item.status;
}

function stepLabel(record, items) {
	const id = record.step?.id;
	if (!id || id === 'none') {
		return null;
	}
	const item = items.find((entry) => entry.id === id);
	if (item) {
		return { id, label: item.label, kind: 'item' };
	}
	const group = GROUP_BY_ID.get(id);
	return group ? { id, label: group.label, kind: 'group' } : null;
}

// Everything the page renders.
export function buildView(record, { platform = process.platform, checking = false, checkError = null, intro = null } = {}) {
	const os = osFromRecord(record, platform);
	const meta = record.meta || {};
	const { defs, later } = itemDefs(record);
	const items = defs.map((def) => {
		const item = deriveItem(def, { record, os, checking, meta });
		return { ...item, statusText: statusText(item) };
	});
	const step = stepLabel(record, items);
	for (const item of items) {
		item.current = step?.kind === 'item' && step.id === item.id;
	}
	const counted = items.filter((item) => item.counted);
	const done = counted.filter((item) => item.status === 'done').length;
	const groups = GROUPS.map((group) => {
		const groupItems = items.filter((item) => item.group === group.id);
		return {
			id: group.id,
			label: group.label,
			blurb: group.blurb,
			current: step?.kind === 'group' && step.id === group.id,
			done: groupItems.filter((item) => item.counted && item.status === 'done').length,
			total: groupItems.filter((item) => item.counted).length,
			items: groupItems,
		};
	}).filter((group) => group.items.length);
	return {
		os,
		meta: { title: meta.title || null, subtitle: meta.subtitle || null, presenter: meta.presenter || null },
		check: {
			checking,
			error: checkError,
			at: record.lastCheck?.at || record.lastCheck?.receivedAt || null,
		},
		progress: { done, total: counted.length },
		allDone: counted.length > 0 && done === counted.length && !checking,
		step,
		groups,
		later: later.length ? { note: LATER_NOTE, items: later.map((def) => itemLabel(def, os) || humanize(def.id)) } : null,
		intro,
	};
}

// What the agent reads back from getState and refresh.
export function summarize(view, record) {
	const items = view.groups.flatMap((group) => group.items).map((item) => {
		const out = { id: item.id, group: item.group, label: item.label, status: item.status };
		if (item.how) {
			out.how = item.how === 'already' ? 'already set up' : 'set up now';
		}
		if (item.status === 'installed' && item.tryIt) {
			out.tryIt = item.tryIt.text;
		}
		if (item.note && ['needs-you', 'failed'].includes(item.status)) {
			out.note = item.note;
		}
		if (item.detail) {
			out.detail = item.detail;
		}
		return out;
	});
	const choices = {};
	for (const group of view.groups) {
		for (const item of group.items) {
			if (item.optional) {
				choices[item.id] = item.choice;
			}
		}
	}
	return {
		checkedAt: view.check.at,
		checking: view.check.checking,
		checkError: view.check.error,
		progress: view.progress,
		allDone: view.allDone,
		step: view.step?.id || null,
		choices,
		items,
		later: view.later ? view.later.items : [],
		meta: { ...(record.meta || {}) },
	};
}

// Ids setItem accepts: anything shown, anything the last check reported, and catalog ids (step ids with dashes map
// to item ids, so computer-use works too).
export function resolveItemId(id, record) {
	const checkItems = record.lastCheck?.items || {};
	const candidates = [id, id.replace(/-/g, '_')];
	for (const candidate of candidates) {
		const merged = MERGED_CHECKS.get(candidate);
		if (merged) {
			return merged;
		}
		if (ITEM_BY_ID.has(candidate) && !ITEM_BY_ID.get(candidate).later) {
			return candidate;
		}
		if (checkItems[candidate] && !checkItems[candidate].later) {
			return candidate;
		}
		if (record.reports[candidate]) {
			return candidate;
		}
	}
	return null;
}

export function isOptionalId(id, record) {
	const def = ITEM_BY_ID.get(id);
	if (def) {
		return def.group === 'optional';
	}
	return record.lastCheck?.items?.[id]?.required === false;
}

// The ids that count as already set up the first time the check runs.
export function baselineIds(record, platform = process.platform) {
	const view = buildView({ ...record, baseline: null }, { platform });
	return view.groups.flatMap((group) => group.items).filter((item) => item.status === 'done' || item.status === 'installed').map((item) => item.id);
}

export function knownStepIds(record) {
	return [...GROUPS.map((group) => group.id), ...itemDefs(record).defs.map((def) => def.id), 'none'];
}

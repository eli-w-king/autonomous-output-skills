// The AI-First path of the setup canvas: the workshop picker, the steps before Confirm, and the catalog its live
// checklist uses after Confirm. The canvas's full setup (catalog.mjs) is unchanged; a record uses this one when the
// canvas was opened with workshop "choose" or "ai-first" (see catalogFor in checklist.mjs).
//
// Nothing here names an event or a person: the title, subtitle and host come from the canvas's open input. The two
// workshop names on the picker are the product's own.

export const WORKSHOPS = [
	{ id: 'ai-first', label: 'AI-First Design', tag: 'External', blurb: 'For designers on their own laptops and personal GitHub accounts.' },
	{ id: 'microsoft', label: 'Overnight Delegation at Scale', tag: 'Microsoft', blurb: 'For Microsoft employees. Needs a Microsoft sign-in.' },
];

// The steps before Confirm, in order. "gate" only follows a Microsoft pick.
export const FLOW_STEPS = ['pick', 'ready', 'install', 'uninstall', 'after'];
export const FLOW_ALL_STEPS = [...FLOW_STEPS, 'gate'];
export const FLOW_MODES = ['choose', 'ai-first'];

export const UNINSTALL_URL = 'https://eli-w-king.github.io/ai-first-design-workshop/uninstall.html';

export const AF_GROUPS = [
	{ id: 'tools', label: 'Tools', blurb: 'Only what this computer was missing.' },
	{ id: 'workshop', label: 'Workshop', blurb: 'Your skills, your copy of Excalidraw and the workshop resources.' },
	{ id: 'try', label: 'Try it', blurb: 'Two quick tests in the chat.' },
	{ id: 'optional', label: 'Extras you chose', blurb: '' },
];

const IN_CHAT = 'Check the chat. The agent says what it needs from you there.';
const steps = (...lines) => lines.join('\n');

// required: true (always), 'missing' (only when this computer doesn't have it) or false (a switch).
export const AF_ITEMS = [
	{
		id: 'git', group: 'tools', label: 'Git', required: 'missing',
		reason: 'Saves versions of your work, makes a branch for each variation, and sends your changes to GitHub.',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'node', group: 'tools', label: 'Node.js', required: 'missing',
		reason: 'Runs Excalidraw on your computer.',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'gh', group: 'tools', label: 'GitHub CLI and sign-in', required: true,
		reason: 'Makes your copy of Excalidraw on GitHub and opens pull requests. You sign in once in your browser.',
		help: {
			all: {
				text: steps(
					'Your browser opens GitHub\'s device page. If it doesn\'t, go to github.com/login/device.',
					'Sign in with your own GitHub account, the one with Copilot.',
					'Copy the one-time code below, paste it on that page and click Continue.',
					'Click Authorize. The agent takes it from there.',
				),
			},
		},
	},
	{
		id: 'skills', group: 'workshop', label: 'The workshop skills', required: true,
		reason: 'Variations, prototypes, demo videos and Computer Use, ready in every chat.',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'excalidraw', group: 'workshop', label: 'Your Excalidraw case study', required: true,
		reason: 'Your own copy on GitHub, cloned here and ready to run. It\'s what we build on together.',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'resources', group: 'workshop', label: 'Workshop resources', required: true,
		reason: 'The prompts, a cheat sheet and the practice docs, in one folder.',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'demo_tools', group: 'workshop', label: 'Demo video tools', required: true,
		reason: 'Records short demo videos with the browser you already have.',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'computer_use', step: 'computer-use', group: 'try', label: 'Computer Use', required: true,
		reason: 'Lets an agent use apps like Notes, with your okay for each app.',
		test: {
			prompt: {
				mac: 'Use Computer Use to write a short joke in a new note in Notes.',
				win: 'Write a short joke in a new note in Notepad.',
				other: 'Use Computer Use to open a text editor and write a short joke. Don\'t save it.',
			},
		},
		help: {
			mac: {
				text: steps(
					'Copy /computer on, send it in the chat, then click Turn On.',
					'In the Set Up Computer Use dialog, click Allow in Settings for Screen Recording, then for Accessibility.',
					'Switch on Copilot Computer Use in each list in System Settings, then click Check Again in the dialog.',
				),
				commands: ['/computer on'],
			},
			all: { text: 'Copy /computer on, send it in the chat, then click Turn On.', commands: ['/computer on'] },
		},
	},
	{
		id: 'dictation', group: 'try', label: 'Dictation', required: true,
		reason: 'Talk to the agent instead of typing. It\'s already on from your settings.',
		test: { kind: 'do', prompt: 'Click the microphone in the chat box, say "Dictation works", then send it.' },
		help: { all: { text: 'The first time, allow the microphone when your computer asks.' } },
	},
	{
		id: 'skill_runs', group: 'optional', label: 'Long and overnight runs', required: false,
		reason: 'A skill for long runs on your laptop: a status file, keeping it awake, and a morning report.',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'skill_research', group: 'optional', label: 'Research', required: false,
		reason: 'A skill that plans user studies and pulls together what people said.',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'skill_taste', group: 'optional', label: 'My taste', required: false,
		reason: 'A skill that learns your design taste from your own sessions and notes.',
		help: { all: { text: IN_CHAT } },
	},
	{
		id: 'taste_weekly', group: 'optional', label: 'Weekly taste update', required: false, needs: 'skill_taste',
		reason: 'An automation that updates My taste every Monday from that week\'s sessions. It uses a few credits each run.',
		test: { prompt: 'Run my weekly taste update once now, then show me what changed.' },
		help: { all: { text: IN_CHAT } },
	},
];

export const AF_ITEM_BY_ID = new Map(AF_ITEMS.map((item) => [item.id, item]));
export const AF_OPTIONAL_IDS = AF_ITEMS.filter((item) => item.required === false).map((item) => item.id);

export const AF_CATALOG = {
	kind: 'ai-first',
	GROUPS: AF_GROUPS,
	ITEMS: AF_ITEMS,
	ITEM_BY_ID: AF_ITEM_BY_ID,
	MERGED_CHECKS: new Map(),
	LATER_NOTE: '',
};

export function emptyFlow() {
	return { mode: null, folder: null, pick: null, step: 'pick', selections: {}, confirmedAt: null, continuedAt: null, plan: null };
}

// The flow for a record, filled in. Records from before the AI-First path have none.
export function flowOf(record) {
	return { ...emptyFlow(), ...(record?.aiFirst || {}), selections: { ...(record?.aiFirst?.selections || {}) } };
}

// A record shows the AI-First flow when the last open asked for it and the person hasn't moved on to the Microsoft
// setup (continuedAt is set once they pass its sign-in and continue).
export function usesAiFirst(record) {
	const flow = record?.aiFirst;
	return !!flow && FLOW_MODES.includes(flow.mode) && !flow.continuedAt;
}

// Turning one optional item on or off, with the one dependency: the weekly update needs My taste.
export function applySelection(selections, id, on) {
	const next = { ...selections, [id]: on };
	for (const item of AF_ITEMS) {
		if (item.needs && next[item.id] && !next[item.needs]) {
			if (id === item.id) {
				next[item.needs] = true;
			} else {
				next[item.id] = false;
			}
		}
	}
	return next;
}

// Whether an item will be installed: required ones, optional ones switched on, and the "only if missing" ones when
// the check says they're missing (or hasn't run yet).
export function itemChosen(def, flow, checkItems = {}) {
	if (def.required === false) {
		return flow.selections[def.id] === true;
	}
	if (def.required === 'missing') {
		return checkItems[def.id]?.needed !== false;
	}
	return true;
}

const MBYTE = 1000 * 1000;

export function formatSize(bytes) {
	if (!bytes) {
		return 'No download';
	}
	if (bytes < MBYTE) {
		return 'Under 1 MB';
	}
	if (bytes >= 1000 * MBYTE) {
		return `${(bytes / (1000 * MBYTE)).toFixed(1)} GB`;
	}
	return `${Math.round(bytes / MBYTE)} MB`;
}

const osName = (os) => (os === 'mac' ? 'Mac' : os === 'win' ? 'PC' : 'computer');

// The "What we'll install" list: every item with its lock or switch, its size here and the total.
export function installList(record, os) {
	const flow = flowOf(record);
	const checkItems = record?.lastCheck?.items || {};
	const checked = !!record?.lastCheck;
	const rows = AF_ITEMS.map((def) => {
		const check = checkItems[def.id] || null;
		const size = check?.size || null;
		const present = def.required === 'missing' && check?.needed === false;
		const chosen = itemChosen(def, flow, checkItems);
		const counts = chosen && !present;
		let state;
		if (def.required === false) {
			state = chosen ? 'on' : 'off';
		} else if (present) {
			state = 'present';
		} else {
			state = 'locked';
		}
		let note = null;
		if (present) {
			note = `Already on this ${osName(os)}: ${check.detail}`;
		} else if (def.id === 'gh' && check?.installed) {
			note = check.signed_in ? `Already here, ${check.detail}.` : 'Already here. You\'ll sign in.';
		} else if (def.id === 'demo_tools' && check?.fallback) {
			note = `No Chrome or Edge here, so this adds a small browser for recording (${formatSize(check.fallback.disk)} of it).`;
		} else if (def.id === 'computer_use') {
			note = 'Its helper downloads the first time you use it.';
		}
		return {
			id: def.id,
			group: def.group,
			label: def.label,
			reason: def.reason,
			required: def.required,
			state,
			locked: state === 'locked',
			needs: def.needs || null,
			note,
			disk: counts && size ? size.disk : 0,
			download: counts && size ? size.download : 0,
			sizeText: present ? 'Already here' : !checked ? 'Checking' : formatSize(size?.disk || 0),
		};
	});
	const total = rows.reduce((sum, row) => ({ disk: sum.disk + row.disk, download: sum.download + row.download }), { disk: 0, download: 0 });
	const free = record?.lastCheck?.freeBytes ?? null;
	return {
		rows,
		total: { ...total, text: formatSize(total.disk), downloadText: formatSize(total.download) },
		checked,
		os,
		where: osName(os),
		folder: record?.lastCheck?.folder || flow.folder || null,
		free,
		fits: free === null ? null : free > total.disk * 1.2,
	};
}

export function afterConfirmLines(os) {
	return [
		'The agent installs what you checked.',
		'It opens your browser so you can sign in to GitHub.',
		...(os === 'mac' ? ['It asks you for two permissions for Computer Use: Accessibility and Screen Recording.'] : []),
		'It creates your copy of Excalidraw on GitHub.',
		'It tells you when it\'s done, here and in the chat.',
	];
}

export const UNINSTALL_LINES = [
	'Everything goes in one folder, plus the workshop skills and this checklist in your .copilot folder.',
	'The setup keeps a list of what it adds, so you can take it all back out.',
	'To undo it, paste one prompt into a chat, or follow the guide. Tools you already had stay as they are.',
];

// The part of the page and of getState that's about the flow.
export function flowView(record, { os = 'other', gate = null } = {}) {
	const flow = flowOf(record);
	const checkItems = record?.lastCheck?.items || {};
	const signin = checkItems.microsoft_signin || null;
	return {
		mode: flow.mode,
		pick: flow.pick,
		step: flow.step,
		steps: FLOW_STEPS,
		confirmed: !!flow.confirmedAt,
		confirmedAt: flow.confirmedAt,
		selections: flow.selections,
		workshops: WORKSHOPS,
		gate: gate || { ok: signin?.ok === true, detail: signin?.detail || 'Checking for a Microsoft sign-in', checked: !!signin },
		install: installList(record, os),
		uninstall: { lines: UNINSTALL_LINES, url: UNINSTALL_URL },
		after: afterConfirmLines(os),
		// New tools only reach new chats after VS Code restarts (it reads PATH when it starts).
		restart: ['git', 'node', 'gh'].some((id) => checkItems[id]?.by === 'setup'),
	};
}

// What the agent reads back about the flow, in plain values.
export function flowSummary(record, os) {
	const view = flowView(record, { os });
	const flow = flowOf(record);
	const chosen = flow.plan || view.install.rows.filter((row) => row.state === 'locked' || row.state === 'on').map((row) => row.id);
	return {
		mode: view.mode,
		pick: view.pick,
		step: view.step,
		confirmed: view.confirmed,
		selections: view.selections,
		install: chosen,
		alreadyHere: view.install.rows.filter((row) => row.state === 'present').map((row) => row.id),
		total: { disk: view.install.total.disk, download: view.install.total.download, text: view.install.total.text },
		gate: view.gate,
		folder: view.install.folder,
	};
}

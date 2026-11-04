// Loop configuration. One JSON file per installation, never published when it names people or private repos:
//   RESEARCH_LOOP_CONFIG, else the first loop.config.json found walking up from the current directory, else from
//   this script's folder. Environment variables override single values. Every value has a neutral default, so the
//   scripts carry no personal or team names.
//
// {
//   "home": "<loop home: studies/, runs/, progress.md>",
//   "repo": "<owner>/<private repo for reports, state and steering issues>",
//   "github_user": "<gh account that can write that repo>",
//   "steering_users": ["<accounts whose issue comments are instructions>"],
//   "private_clone": "<local clone of that repo>",
//   "ui": { "profile": "<dedicated browser profile>", "cdp_port": 9461 },
//   "playwright_core": "<path to a playwright-core install>",
//   "main_chat": "<agent-host-session link the morning retrospective is sent to>",
//   "morning_dir": "<folder a morning reader picks up: morning-summary.md plus stills and short videos>",
//   "run_log": "<file whose end is the run log; default <home>/progress.md>",
//   "mail": { "domains": ["outset.ai", "userinterviews.com"], "start": "<ISO time the mail check starts from>",
//             "log": "<local mail log; default <home>/mail/mail-log.json>" },
//   "prior_research": { "label": "<how reports name it>", "base_url": "<link prefix for its pages>",
//                       "clone": "<local clone, read only>" },
//   "gate_dm": { "channel": "<chat channel of the owner's own DM, for the one message per round at the publish gate>",
//                "next_run": "<when the next scheduled run starts, as the DM says it; for example 'within 2 hours'>" },
//   "schedule": { "name": "<the automation that runs the loop>", "id": "<its id, for the request to turn it off>" },
//   "timezone": "America/Los_Angeles"
// }
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

function findUp(start) {
	let dir = resolve(start);
	for (;;) {
		const p = join(dir, 'loop.config.json');
		if (existsSync(p)) {
			return p;
		}
		const up = dirname(dir);
		if (up === dir) {
			return null;
		}
		dir = up;
	}
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = process.env.RESEARCH_LOOP_CONFIG || findUp(process.cwd()) || findUp(HERE);
const raw = CONFIG_PATH ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '')) : {};
const expand = p => (typeof p === 'string' && p.startsWith('~') ? join(homedir(), p.slice(1)) : p);
const home = resolve(expand(process.env.RESEARCH_LOOP_ROOT || raw.home || (CONFIG_PATH ? dirname(CONFIG_PATH) : process.cwd())));

export const CONFIG = {
	home,
	repo: process.env.RESEARCH_LOOP_REPO || raw.repo || null,
	githubUser: process.env.GITHUB_LOOP_USER || raw.github_user || null,
	steeringUsers: (process.env.RESEARCH_LOOP_STEERING_USERS ? process.env.RESEARCH_LOOP_STEERING_USERS.split(',') : raw.steering_users ?? []).map(s => s.trim().toLowerCase()).filter(Boolean),
	privateClone: expand(process.env.RESEARCH_LOOP_PRIVATE_CLONE || raw.private_clone || null),
	uiProfile: expand(process.env.UI_PROFILE_DIR || raw.ui?.profile || join(homedir(), '.copilot', 'browser-profiles', 'userinterviews')),
	uiCdpPort: Number(process.env.UI_CDP_PORT || raw.ui?.cdp_port || 9461),
	playwrightCore: expand(process.env.PLAYWRIGHT_CORE_PATH || raw.playwright_core || null),
	mainChat: raw.main_chat || null,
	morningDir: expand(process.env.RESEARCH_LOOP_MORNING_DIR || raw.morning_dir || null),
	runLog: expand(process.env.RESEARCH_LOOP_RUN_LOG || raw.run_log || join(home, 'progress.md')),
	mailLog: expand(process.env.RESEARCH_LOOP_MAIL_LOG || raw.mail?.log || join(home, 'mail', 'mail-log.json')),
	mailDomains: (raw.mail?.domains ?? ['outset.ai', 'userinterviews.com']).map(d => d.toLowerCase()),
	mailStart: Number.isFinite(Date.parse(raw.mail?.start)) ? raw.mail.start : null,
	// The research a study's findings are compared with (a team's research wiki or repository): how it is named in
	// reports, where its pages link, and a local clone to read. Read only; the loop never edits it.
	priorResearch: {
		label: raw.prior_research?.label || 'prior research',
		baseUrl: raw.prior_research?.base_url || null,
		clone: expand(raw.prior_research?.clone || null),
	},
	// The one DM per round when a round's study stops at an admin's approval to publish (lib/gatedm.mjs). No channel
	// means no DM; the gate still shows in the morning summary, the report and the issue.
	gateDm: {
		channel: raw.gate_dm?.channel || null,
		nextRun: raw.gate_dm?.next_run || null,
	},
	// The scheduled automation that runs the loop: the run asks once for it to be turned off when nothing is being
	// researched, and starting a new study turns it back on.
	schedule: raw.schedule?.name || raw.schedule?.id ? { name: raw.schedule.name ?? null, id: raw.schedule.id ?? null } : null,
	timezone: raw.timezone || 'America/Los_Angeles',
};

export function requireConfig(...keys) {
	const missing = keys.filter(k => !CONFIG[k] || (Array.isArray(CONFIG[k]) && !CONFIG[k].length));
	if (missing.length) {
		throw new Error(`loop.config.json is missing ${missing.join(', ')} (config: ${CONFIG_PATH ?? 'none found'})`);
	}
}

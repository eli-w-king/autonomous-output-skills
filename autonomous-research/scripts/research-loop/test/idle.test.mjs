// node --test loop/scripts/test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Everything in a scratch folder: the config, the studies and the state folder, so a test never touches a real loop.
// Set before the modules read their configuration.
const scratch = mkdtempSync(join(tmpdir(), 'rl-idle-'));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }));
const studies = join(scratch, 'studies');
const state = join(scratch, 'state');
mkdirSync(studies, { recursive: true });
writeFileSync(join(scratch, 'loop.config.json'), JSON.stringify({
	main_chat: 'chat://owner',
	schedule: { name: 'Research loop (every 2 hours)', id: 'automation-1' },
	prior_research: { label: 'past research', clone: join(scratch, 'wiki'), contribute: { upstream: 'org/wiki', account: 'acct', clone: join(scratch, 'contrib') } },
}));
const env = { ...process.env, RESEARCH_LOOP_CONFIG: join(scratch, 'loop.config.json'), RESEARCH_LOOP_STUDIES: studies, RESEARCH_STATE_DIR: state };
process.env.RESEARCH_LOOP_CONFIG = env.RESEARCH_LOOP_CONFIG;
process.env.RESEARCH_STATE_DIR = state;
const { activity, contributionOpen } = await import('../lib/idle.mjs');

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'idle.mjs');
const cli = (...args) => {
	const r = spawnSync(process.execPath, [CLI, ...args], { env, cwd: scratch, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	return JSON.parse(r.stdout);
};
const PR = { wiki_pr: { url: 'https://example.invalid/pull/1', number: 1, state: 'open' } };
const setStudy = (slug, status, extra = {}, entries = []) => {
	mkdirSync(join(studies, slug), { recursive: true });
	writeFileSync(join(studies, slug, 'study.json'), JSON.stringify({ slug, status, rounds: [], ...extra }));
	writeFileSync(join(studies, slug, 'ledger.json'), JSON.stringify({ entries }));
};
const old = new Date(Date.now() - 3 * 3600_000).toISOString();
const payout = { type: 'payment', at: old, round: 1, arm: 'A', ui_project: 'p1' };

test('a study that has not ended keeps the loop busy; an ended one with an open confirmation too', () => {
	const s = (slug, status, entries = [], extra = PR) => ({ slug, study: { status, ...extra }, ledger: { entries } });
	assert.deepEqual(activity([s('a', 'recruiting'), s('b', 'done')]), { idle: false, active: ['a'], confirming: [], contributing: [] });
	assert.deepEqual(activity([s('b', 'done', [payout])]), { idle: false, active: [], confirming: ['b'], contributing: [] });
	assert.deepEqual(activity([s('b', 'handed-to-owner'), s('c', 'stopped')]), { idle: true, active: [], confirming: [], contributing: [] });
	assert.deepEqual(activity([]), { idle: true, active: [], confirming: [], contributing: [] });
});

test('an ended study stays busy until it is contributed back to the research wiki, or that is blocked', () => {
	const s = (slug, status, extra = {}) => ({ slug, study: { status, ...extra }, ledger: { entries: [] } });
	assert.deepEqual(activity([s('d', 'done')]), { idle: false, active: [], confirming: [], contributing: ['d'] });
	assert.deepEqual(activity([s('h', 'handed-to-owner', { wiki_pr: { state: 'drafting', branch: 'b' } })]).contributing, ['h']);
	assert.equal(activity([s('d', 'done', PR)]).idle, true);
	assert.equal(activity([s('d', 'done', { wiki_pr: { state: 'blocked' } })]).idle, true);
	// A study stopped by its owner is not contributed, and nothing is when contributing is not configured.
	assert.equal(activity([s('x', 'stopped')]).idle, true);
	assert.equal(activity([s('d', 'done')], { contribute: false }).idle, true);
	assert.equal(contributionOpen({ status: 'recruiting' }), false);
});

test('the request to turn the schedule off is due once per quiet period, and asked again after the next study', () => {
	setStudy('s1', 'recruiting');
	assert.equal(cli('check').request_due, false);

	setStudy('s1', 'done');
	assert.deepEqual(cli('check').contributing, ['s1']);
	assert.equal(cli('check').request_due, false);

	setStudy('s1', 'done', PR);
	const first = cli('check');
	assert.equal(first.idle, true);
	assert.equal(first.request_due, true);
	assert.equal(first.main_chat, 'chat://owner');
	assert.match(first.message, /\(s1 ended\)\. Please disable the automation "Research loop \(every 2 hours\)" \(automation-1\)\. Starting a new study turns it back on\./);
	assert.deepEqual(cli('requested'), { recorded: true });
	assert.equal(cli('check').request_due, false);

	setStudy('s2', 'recruiting');
	assert.equal(cli('check').idle, false);
	setStudy('s2', 'done', PR);
	assert.equal(cli('check').request_due, true);
});

// node --test loop/scripts/test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, unlinkSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { checkContribution, collectChanges, parseNameStatusZ, frontmatter, scanText, branchFor } from '../lib/wikipr.mjs';

const RAW = [
	'---',
	'title: "Scheduled runs: what people need"',
	'source:',
	'author:',
	'created: 2026-11-06',
	'confidentiality: internal',
	'---',
	'## Introduction',
	'Five participants per round; P-0002 said "I would check it every morning." (https://outset.ai/project/1/interview/2/read)',
].join('\n');
const SOURCE = [
	'---',
	'title: "Scheduled Runs Study (2026)"',
	'type: source',
	'source_date: "2026-11"',
	'created: "2026-11-06"',
	'updated: "2026-11-06"',
	'confidentiality: internal',
	'tags:',
	'  - scheduled-runs',
	'sources: 1',
	'---',
	'# Scheduled Runs Study (2026)',
].join('\n');
const good = () => ({
	changes: [
		{ status: 'A', path: 'raw/reports/Scheduled Runs Study.md' },
		{ status: 'A', path: 'wiki/sources/Scheduled Runs Study (2026).md' },
		{ status: 'M', path: 'wiki/concepts/Run Status.md' },
		{ status: 'M', path: 'wiki/Wiki Index.md' },
		{ status: 'M', path: 'wiki/Wiki Log.md' },
	],
	files: {
		'raw/reports/Scheduled Runs Study.md': RAW,
		'wiki/sources/Scheduled Runs Study (2026).md': SOURCE,
	},
	diffs: {
		'wiki/concepts/Run Status.md': {
			removed: ['updated: "2026-11-02"', 'sources: 7', '- [[Earlier Study (2026)]]'],
			added: ['updated: "2026-11-06"', 'sources: 8', '- [[Earlier Study (2026)]], [[Scheduled Runs Study (2026)]]', '- Scheduled runs need a state on the list, not only in the transcript.'],
		},
		'wiki/Wiki Index.md': { removed: [], added: ['- **2026-11 | internal** [[Scheduled Runs Study (2026)]], 3 rounds of AI-moderated interviews'] },
		'wiki/Wiki Log.md': { removed: [], added: ['## [2026-11-06] ingest | Scheduled Runs Study (2026)'] },
	},
	denyTerms: ['Jane', 'Doe'],
});

test('a contribution that follows the ingest workflow passes', () => {
	assert.deepEqual(checkContribution(good()), []);
	assert.equal(branchFor('scheduled-runs'), 'research-loop/scheduled-runs');
});

test('deleting, renaming, or changing an existing raw file or a file outside the wiki is refused', () => {
	const g = good();
	g.changes.push(
		{ status: 'D', path: 'wiki/concepts/Old Page.md' },
		{ status: 'R', from: 'wiki/sources/A.md', path: 'wiki/sources/B.md' },
		{ status: 'M', path: 'raw/reports/Someone Else.md' },
		{ status: 'M', path: 'AGENTS.md' },
		{ status: 'A', path: 'notes.md' },
		{ status: 'A', path: 'wiki/sources/sub/deeper.md' },
	);
	const p = checkContribution(g).join('\n');
	assert.match(p, /deletes wiki\/concepts\/Old Page\.md/);
	assert.match(p, /renames wiki\/sources\/A\.md to wiki\/sources\/B\.md/);
	assert.match(p, /changes an existing raw file: raw\/reports\/Someone Else\.md/);
	assert.match(p, /changes AGENTS\.md, which an ingest does not touch/);
	assert.match(p, /adds notes\.md, outside/);
	assert.match(p, /adds wiki\/sources\/sub\/deeper\.md, outside/);
});

test('exactly one raw report and one source page', () => {
	const two = good();
	two.changes.push({ status: 'A', path: 'raw/reports/Second.md' });
	two.files['raw/reports/Second.md'] = RAW;
	assert.match(checkContribution(two).join('\n'), /adds 2 files under raw\/reports\/ \(exactly one expected\)/);
	const none = good();
	none.changes = none.changes.filter(c => !c.path.startsWith('wiki/sources/'));
	assert.match(checkContribution(none).join('\n'), /adds 0 files under wiki\/sources\//);
});

test('a changed page may only gain text: a removed line must come back inside an added one', () => {
	const g = good();
	g.diffs['wiki/concepts/Run Status.md'].removed.push('- Participants restarted sessions that were progressing.');
	assert.match(checkContribution(g).join('\n'), /removes text from wiki\/concepts\/Run Status\.md: "- Participants restarted sessions/);
});

test('no emails, tracking ids, phone numbers, names or dashes in what the contribution adds', () => {
	const g = good();
	const at = (user, domain) => [user, domain].join('@');
	g.files['raw/reports/Scheduled Runs Study.md'] += [
		'',
		`Contact ${at('someone', 'example.com')} for the data.`,
		'Participant pp_abc123def4 finished first.',
		'Call 425-555-0100 if the link fails.',
		'Jane said it was clear.',
		'It worked \u2014 mostly.',
	].join('\n');
	const p = checkContribution(g).join('\n');
	assert.match(p, /an email address in raw\/reports\/Scheduled Runs Study\.md:10/);
	assert.match(p, /a recruiting tracking id in raw\/reports\/Scheduled Runs Study\.md:11/);
	assert.match(p, /a phone number in raw\/reports\/Scheduled Runs Study\.md:12/);
	assert.match(p, /a name that must not appear \("Jane"\)/);
	assert.match(p, /an em or en dash in raw\/reports\/Scheduled Runs Study\.md:14/);
	// Participant ids, interview links and dates are fine; a dash the wiki already had, on a line we extend, is too.
	assert.deepEqual(scanText([{ at: 'x', text: 'P-0002, https://outset.ai/project/1/interview/2/read, 2026-11-03' }]), []);
	assert.deepEqual(scanText([{ at: 'x', text: 'Agents \u2014 existing title, now with a new source', own: false }]), []);
});

test('a line the contribution extends is checked only for the text it adds', () => {
	const g = good();
	g.diffs['wiki/concepts/Run Status.md'] = {
		removed: ['- Smith, Jane \u2014 earlier paper on agent status'],
		added: ['- Smith, Jane \u2014 earlier paper on agent status; [[Scheduled Runs Study (2026)]] adds scheduled runs'],
	};
	assert.deepEqual(checkContribution(g), []);
	g.diffs['wiki/concepts/Run Status.md'].added = ['- Smith, Jane \u2014 earlier paper on agent status; Jane \u2014 again'];
	const p = checkContribution(g).join('\n');
	assert.match(p, /a name that must not appear \("Jane"\) in wiki\/concepts\/Run Status\.md/);
	assert.match(p, /an em or en dash in wiki\/concepts\/Run Status\.md/);
});

test('the new files carry the frontmatter the wiki uses, with no author named', () => {
	const g = good();
	g.files['raw/reports/Scheduled Runs Study.md'] = RAW.replace('author:', 'author: "Jane"').replace('confidentiality: internal', 'confidentiality: public');
	g.files['wiki/sources/Scheduled Runs Study (2026).md'] = SOURCE.replace('type: source', 'type: synthesis').replace('sources: 1', 'sources: 2');
	const p = checkContribution({ ...g, denyTerms: [] }).join('\n');
	assert.match(p, /names an author; leave author empty/);
	assert.match(p, /raw\/reports\/Scheduled Runs Study\.md must say confidentiality: internal/);
	assert.match(p, /must say type: source/);
	assert.match(p, /must say sources: 1/);
	assert.equal(frontmatter(SOURCE).source_date, '2026-11');
});

test('collectChanges reads staged changes, with spaces in names, from a real git repository', () => {
	const dir = mkdtempSync(join(tmpdir(), 'rl-wikipr-'));
	after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
	const git = (...a) => {
		const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', `user.email=${['t', 'example.invalid'].join('@')}`, ...a], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout;
	};
	git('init', '-q', '-b', 'main');
	git('config', 'core.autocrlf', 'false');
	mkdirSync(join(dir, 'raw', 'reports'), { recursive: true });
	mkdirSync(join(dir, 'wiki', 'concepts'), { recursive: true });
	mkdirSync(join(dir, 'wiki', 'sources'), { recursive: true });
	writeFileSync(join(dir, 'raw', 'reports', 'Earlier Study.md'), '# Earlier\n');
	writeFileSync(join(dir, 'wiki', 'concepts', 'Run Status.md'), '---\nupdated: "2026-11-02"\nsources: 7\n---\n## Sources\n- [[Earlier Study (2026)]]\n');
	writeFileSync(join(dir, 'wiki', 'Wiki Log.md'), '# Log\n');
	git('add', '-A');
	git('commit', '-q', '-m', 'base');
	const base = git('rev-parse', 'HEAD').trim();

	writeFileSync(join(dir, 'raw', 'reports', 'Scheduled Runs Study.md'), RAW);
	writeFileSync(join(dir, 'wiki', 'sources', 'Scheduled Runs Study (2026).md'), SOURCE);
	writeFileSync(join(dir, 'wiki', 'concepts', 'Run Status.md'), '---\nupdated: "2026-11-06"\nsources: 8\n---\n## Sources\n- [[Earlier Study (2026)]], [[Scheduled Runs Study (2026)]]\n');
	appendFileSync(join(dir, 'wiki', 'Wiki Log.md'), '## [2026-11-06] ingest | Scheduled Runs Study (2026)\n');
	git('add', '-A');
	const okSet = collectChanges(dir, base);
	assert.deepEqual(okSet.changes.map(c => `${c.status} ${c.path}`).sort(), [
		'A raw/reports/Scheduled Runs Study.md',
		'A wiki/sources/Scheduled Runs Study (2026).md',
		'M wiki/Wiki Log.md',
		'M wiki/concepts/Run Status.md',
	]);
	assert.deepEqual(checkContribution(okSet), []);

	// Then the same branch deletes a page and moves someone else's raw report: both are caught (an unchanged file that
	// moves is a rename; a page edited and moved shows as a delete, which is caught too).
	unlinkSync(join(dir, 'wiki', 'concepts', 'Run Status.md'));
	renameSync(join(dir, 'raw', 'reports', 'Earlier Study.md'), join(dir, 'raw', 'reports', 'Earlier Study (moved).md'));
	git('add', '-A');
	const p = checkContribution(collectChanges(dir, base)).join('\n');
	assert.match(p, /deletes wiki\/concepts\/Run Status\.md/);
	assert.match(p, /renames raw\/reports\/Earlier Study\.md to raw\/reports\/Earlier Study \(moved\)\.md/);
});

test('git -z name-status parsing keeps renames and plain changes apart', () => {
	assert.deepEqual(parseNameStatusZ('M\0wiki/a b.md\0R095\0wiki/x.md\0wiki/y.md\0A\0raw/reports/n.md\0'), [
		{ status: 'M', path: 'wiki/a b.md' },
		{ status: 'R', from: 'wiki/x.md', path: 'wiki/y.md' },
		{ status: 'A', path: 'raw/reports/n.md' },
	]);
});

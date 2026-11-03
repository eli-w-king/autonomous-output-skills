// node --test loop/scripts/test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// A scratch private repo: a bare remote, the clone the loop publishes from, and a stand-in validator that fails while
// tools/fail.flag exists. Set before the module reads its configuration.
const scratch = mkdtempSync(join(tmpdir(), 'rl-publish-'));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }));
const sh = (args, cwd) => {
	const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
	}
	return r.stdout;
};
const python = ['python', 'python3', 'py'].find(p => spawnSync(p, ['--version']).status === 0);
const email = ['loop-test', 'example.invalid'].join('@');
const seed = join(scratch, 'seed');
const remote = join(scratch, 'remote.git');
const clone = join(scratch, 'clone');
mkdirSync(join(seed, 'tools'), { recursive: true });
sh(['init', '-q', seed]);
sh(['checkout', '-q', '-b', 'main'], seed);
writeFileSync(join(seed, 'tools', 'validate-skills.py'), [
	'import os, sys',
	"if os.path.exists(os.path.join('tools', 'fail.flag')):",
	"    print('private term (line 1 of private/private-terms.txt)')",
	'    sys.exit(1)',
	"print('0 error(s), 0 warning(s)')",
	'',
].join('\n'));
sh(['add', '-A'], seed);
sh(['-c', 'user.name=Loop test', '-c', `user.email=${email}`, 'commit', '-q', '-m', 'seed'], seed);
sh(['clone', '-q', '--bare', seed, remote]);
sh(['clone', '-q', remote, clone]);
sh(['config', 'user.name', 'Loop test'], clone);
sh(['config', 'user.email', email], clone);

const study = join(scratch, 'studies', 's1');
mkdirSync(study, { recursive: true });
writeFileSync(join(study, 'study.json'), JSON.stringify({ slug: 's1' }));
writeFileSync(join(study, 'report.md'), '# Report v1\n');
writeFileSync(join(study, 'notes.local.md'), 'stays local\n');
mkdirSync(join(study, 'rounds', 'r1'), { recursive: true });
writeFileSync(join(study, 'rounds', 'r1', 'design-notes.md'), '# Design notes\n');
writeFileSync(join(study, 'rounds', 'r1', 'gate-help.local.md'), 'stays local too\n');

process.env.RESEARCH_LOOP_PRIVATE_CLONE = clone;
const { publishStudy, PRIVATE_CLONE } = await import('../lib/github.mjs');
// Never let this test touch a real clone.
assert.equal(resolve(PRIVATE_CLONE), resolve(clone));

const bare = args => sh(['--git-dir', remote, ...args]);
const remoteFiles = () => bare(['ls-tree', '-r', '--name-only', 'main']).split('\n').filter(Boolean);
const remoteCommits = () => bare(['log', '--oneline', 'main']).trim().split('\n').length;
const dirtyStudies = () => sh(['status', '--porcelain', '--', 'private'], clone).trim();
const skip = !python && 'no Python to run the stand-in validator';

test('a failing validator pushes nothing and leaves the clone clean, so the next pull works', { skip }, () => {
	writeFileSync(join(clone, 'tools', 'fail.flag'), '');
	try {
		assert.throws(() => publishStudy('s1', study, { message: 'test publish' }), /validate-skills\.py failed; nothing pushed: .*private term/);
		assert.equal(dirtyStudies(), '');
		assert.equal(remoteCommits(), 1);
	} finally {
		rmSync(join(clone, 'tools', 'fail.flag'), { force: true });
	}
});

test('leftovers from a failed or dead run are dropped, and only the study\'s shareable files are pushed', { skip }, () => {
	const dir = join(clone, 'private', 'studies', 's1');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'stray-staged.md'), 'left behind\n');
	sh(['add', '--', 'private/studies/s1/stray-staged.md'], clone);
	writeFileSync(join(dir, 'stray-untracked.md'), 'left behind\n');
	assert.equal(publishStudy('s1', study, { message: 'test publish' }).pushed, true);
	const files = remoteFiles();
	assert.ok(files.includes('private/studies/s1/study.json'));
	assert.ok(files.includes('private/studies/s1/report.md'));
	assert.ok(files.includes('private/studies/s1/rounds/r1/design-notes.md'));
	assert.ok(!files.some(f => /stray|\.local\./.test(f)));
	assert.equal(dirtyStudies(), '');
});

test('a published file changed in the clone is restored, then the study folder wins; no change pushes nothing', { skip }, () => {
	writeFileSync(join(clone, 'private', 'studies', 's1', 'report.md'), 'edited in the clone\n');
	writeFileSync(join(study, 'report.md'), '# Report v2\n');
	assert.equal(publishStudy('s1', study, { message: 'test publish 2' }).pushed, true);
	assert.equal(bare(['show', 'main:private/studies/s1/report.md']).replace(/\r\n/g, '\n'), '# Report v2\n');
	assert.deepEqual(publishStudy('s1', study, {}), { pushed: false, reason: 'no changes' });
	assert.equal(dirtyStudies(), '');
});

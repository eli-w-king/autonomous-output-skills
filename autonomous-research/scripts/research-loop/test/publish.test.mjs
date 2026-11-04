// node --test loop/scripts/test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// A scratch private repo: a bare remote, the clone the loop publishes from, and a stand-in validator that fails while
// a flag file exists in tools/: fail.flag (an error tied to no file), fail-elsewhere.flag (an error in a file the
// publish does not touch) or fail-own.flag (an error in the study being published).
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
	"flag = lambda name: os.path.exists(os.path.join('tools', name))",
	"if flag('fail.flag'):",
	"    print('private term (line 1 of private/private-terms.txt)')",
	'    sys.exit(1)',
	"if flag('fail-elsewhere.flag'):",
	"    print('error: other-skill/SKILL.md:52: private term (line 9 of private/private-terms.txt)')",
	"    print('2 skills, 9 text files checked: 1 error(s), 0 warning(s)')",
	'    sys.exit(1)',
	"if flag('fail-own.flag'):",
	"    print('error: other-skill/SKILL.md:52: private term (line 9 of private/private-terms.txt)')",
	"    print('error: private/studies/s1/report.md:1: secret-like string')",
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
const { publishStudy, validatorErrors, PRIVATE_CLONE } = await import('../lib/github.mjs');
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

test('validator errors only in files the publish does not touch are reported, and the study still publishes', { skip }, () => {
	writeFileSync(join(clone, 'tools', 'fail-elsewhere.flag'), '');
	try {
		writeFileSync(join(study, 'report.md'), '# Report v3\n');
		const r = publishStudy('s1', study, { message: 'test publish 3' });
		assert.equal(r.pushed, true);
		assert.equal(r.validator_errors_elsewhere, 1);
		assert.equal(bare(['show', 'main:private/studies/s1/report.md']).replace(/\r\n/g, '\n'), '# Report v3\n');
		assert.equal(dirtyStudies(), '');
	} finally {
		rmSync(join(clone, 'tools', 'fail-elsewhere.flag'), { force: true });
	}
});

test('a validator error in the study being published blocks the push, even next to errors elsewhere', { skip }, () => {
	writeFileSync(join(clone, 'tools', 'fail-own.flag'), '');
	try {
		const before = remoteCommits();
		writeFileSync(join(study, 'report.md'), '# Report v4\n');
		assert.throws(() => publishStudy('s1', study, { message: 'test publish 4' }), /validate-skills\.py failed; nothing pushed/);
		assert.equal(remoteCommits(), before);
		assert.equal(dirtyStudies(), '');
	} finally {
		rmSync(join(clone, 'tools', 'fail-own.flag'), { force: true });
	}
});

test('only plain repository paths count as a file an error is tied to', () => {
	const parsed = validatorErrors([
		'error: other-skill/SKILL.md:12: private term (line 9 of private/private-terms.txt)',
		'error: private/studies/s1/report.md: secret-like string',
		'error: C:\\Users\\someone\\x.mjs: [Errno 2] No such file or directory',
		'error: something went wrong: details',
		'error: validator: crashed',
		'8 skills, 206 text files checked: 2 error(s), 0 warning(s)',
	].join('\n'));
	assert.deepEqual(parsed.map(e => e.path), ['other-skill/SKILL.md', 'private/studies/s1/report.md', null, null, null]);
});

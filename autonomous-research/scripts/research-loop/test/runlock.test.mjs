// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Everything in a scratch state folder and run log, set before the modules read their environment.
const scratch = mkdtempSync(join(tmpdir(), 'rl-runlock-'));
process.env.RESEARCH_STATE_DIR = scratch;
process.env.RESEARCH_LOOP_RUN_LOG = join(scratch, 'progress.md');
process.env.RUN_LOCK_STALE_MIN = String(0.6 / 60); // 600 ms
writeFileSync(process.env.RESEARCH_LOOP_RUN_LOG, 'RUN LOG\n');
const { acquireRunLock, heartbeatRunLock, releaseRunLock, runLockStatus } = await import('../lib/runlock.mjs');
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'runlock.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('one holder at a time; a second run is told another run is active', async () => {
	const a = await acquireRunLock({ label: 'first' });
	assert.equal(a.acquired, true);
	const b = await acquireRunLock({ label: 'second' });
	assert.equal(b.acquired, false);
	assert.equal(b.holder.label, 'first');
	assert.equal(runLockStatus().active, true);
	assert.equal((await heartbeatRunLock('wrong-token')).ok, false);
	assert.equal((await releaseRunLock(a.token)).ok, true);
	assert.equal(runLockStatus().active, false);
});

test('heartbeats keep a lock alive past the stale limit; silence lets the next run steal it', async () => {
	const a = await acquireRunLock({ label: 'long run' });
	for (let i = 0; i < 4; i++) {
		await sleep(250);
		assert.equal((await heartbeatRunLock(a.token, `step ${i}`)).ok, true);
	}
	assert.equal((await acquireRunLock({ label: 'too early' })).acquired, false, 'held by heartbeats for about 1 s, longer than the 600 ms limit');
	await sleep(800);
	const b = await acquireRunLock({ label: 'next run' });
	assert.equal(b.acquired, true);
	assert.equal(b.stole_from.label, 'long run');
	const lost = await heartbeatRunLock(a.token, 'late');
	assert.equal(lost.ok, false, 'the quiet run learns it lost the lock');
	assert.match(lost.reason, /another run/);
	assert.equal((await releaseRunLock(a.token)).ok, false, 'and cannot release the new holder');
	assert.equal((await releaseRunLock(b.token)).ok, true);
});

function cli(args) {
	return new Promise(resolve => {
		const p = spawn(process.execPath, [CLI, ...args], { env: process.env });
		let out = '';
		p.stdout.on('data', d => { out += d; });
		p.on('exit', code => resolve({ code, out }));
	});
}

test('twelve runs starting at once: exactly one gets the lock, the others skip and say so in the run log', async () => {
	process.env.RUN_LOCK_STALE_MIN = '20';
	const results = await Promise.all(Array.from({ length: 12 }, (_, i) => cli(['acquire', '--label', `racer ${i}`])));
	const winners = results.filter(r => r.code === 0);
	assert.equal(winners.length, 1, results.map(r => r.code).join(','));
	assert.equal(results.filter(r => r.code === 3).length, 11);
	const log = readFileSync(process.env.RESEARCH_LOOP_RUN_LOG, 'utf8');
	assert.equal((log.match(/skipped: another run active/g) ?? []).length, 11);
	const { token } = JSON.parse(winners[0].out);
	const exec = await cli(['exec', '--token', token, '--phase', 'test', '--', 'node -e "process.exit(7)"']);
	assert.equal(exec.code, 7, 'exec returns the command exit code');
	assert.equal((await cli(['release', '--token', token])).code, 0);
	assert.equal(runLockStatus().active, false);
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));

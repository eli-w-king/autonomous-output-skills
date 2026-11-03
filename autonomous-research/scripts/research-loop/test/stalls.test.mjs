// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const scratch = mkdtempSync(join(tmpdir(), 'rl-stalls-'));
process.env.RESEARCH_STATE_DIR = join(scratch, 'state');
const { scanStalls } = await import('../lib/stalls.mjs');

const ago = min => new Date(Date.now() - min * 60_000).toISOString();
function session(name, events) {
	mkdirSync(join(scratch, 'sessions', name), { recursive: true });
	writeFileSync(join(scratch, 'sessions', name, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
}
const prompt = text => ({ type: 'user.message', timestamp: ago(60), data: { content: text } });
const ask = (id, min, intention) => ({ type: 'permission.requested', timestamp: ago(min), data: { requestId: id, permissionRequest: { kind: 'shell', intention, fullCommandText: 'secret-looking command' } } });
const done = id => ({ type: 'permission.completed', timestamp: ago(1), data: { requestId: id, result: { kind: 'approved' } } });

session('stalled-1', [prompt('Follow procedure.md exactly'), ask('r1', 25, 'Run the deterministic pass')]);
session('answered-2', [prompt('Another run'), ask('r2', 40, 'Read a file'), done('r2')]);
session('recent-3', [prompt('Just asked'), ask('r3', 3, 'Build')]);

test('only requests unanswered for 10 minutes or more are stalls, shown by intention, never by command', () => {
	const r = scanStalls({ root: join(scratch, 'sessions') });
	assert.equal(r.scanned, 3);
	assert.equal(r.stalls.length, 1);
	const [s] = r.stalls;
	assert.equal(s.session, 'stalled-1');
	assert.equal(s.what, 'Run the deterministic pass');
	assert.equal(s.prompt, 'Follow procedure.md exactly');
	assert.ok(s.minutes >= 24 && s.minutes <= 26);
	assert.ok(!JSON.stringify(r).includes('secret-looking command'));
});

test('a lower threshold catches the recent request too', () => {
	assert.equal(scanStalls({ root: join(scratch, 'sessions'), olderThanMin: 2 }).stalls.length, 2);
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));

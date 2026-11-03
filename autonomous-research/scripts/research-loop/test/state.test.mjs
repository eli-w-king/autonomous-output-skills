// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A scratch studies folder, set before the module reads its environment.
process.env.RESEARCH_LOOP_STUDIES = mkdtempSync(join(tmpdir(), 'rl-state-'));
const { armLabel, armSlug, publishedStill } = await import('../lib/state.mjs');

const study = {
	designs: {
		d1: { label: 'study A (first direction)', slug: 'A-first' },
		d2: { name: 'Board' },
	},
};
const a = { arm: 'A', design: 'd1' };
const b = { arm: 'B', design: 'd2' };

test('a design with a slug publishes its stills under the slug instead of its id', () => {
	assert.equal(publishedStill(study, a, 'd1-1-overview.png'), 'A-first-1-overview.png');
	assert.equal(publishedStill(study, a, 'd1-4-act.png'), 'A-first-4-act.png');
});

test("stills of today's product and files without the id prefix keep their names", () => {
	assert.equal(publishedStill(study, a, 'before-1-overview.png'), 'before-1-overview.png');
	assert.equal(publishedStill(study, a, 'd10-1-overview.png'), 'd10-1-overview.png');
	assert.equal(publishedStill(study, a, undefined), undefined);
});

test('a design without a slug keeps its file names and falls back to arm and id for its label and slug', () => {
	assert.equal(publishedStill(study, b, 'd2-1-overview.png'), 'd2-1-overview.png');
	assert.equal(armLabel(study, b), 'B: d2 (Board)');
	assert.equal(armSlug(study, b), 'B-d2');
	assert.equal(armLabel(study, a), 'study A (first direction)');
	assert.equal(armSlug(study, a), 'A-first');
});

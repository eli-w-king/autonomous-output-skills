#!/usr/bin/env node
// Check what a participant would get, without starting an interview (see lib/preflight.mjs):
//   node preflight.mjs --study <slug> --round <n> --arm <X>
// Exit 0 when the participant link shows the welcome page and every question serves its exact image; 1 otherwise.
// launch.mjs runs the same check after publishing and before recruiting starts, and does not launch when it fails.
import { preflightArm } from './lib/preflight.mjs';
import { outsetEveryday } from './lib/outset.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const slug = opt('study'), round = Number(opt('round')), arm = opt('arm');
if (!slug || !round || !arm) {
	console.error('usage: preflight.mjs --study <slug> --round <n> --arm <X>');
	process.exit(2);
}
const r = await preflightArm(slug, round, arm, await outsetEveryday());
console.log(JSON.stringify({ ok: r.ok, problems: r.problems, page: r.page, images: { questions_checked: r.images.questions_checked, files: r.images.files.length, ok: r.images.ok }, created_interviews: r.created_interviews }, null, 1));
process.exit(r.ok ? 0 : 1);

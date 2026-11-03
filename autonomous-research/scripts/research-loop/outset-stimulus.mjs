#!/usr/bin/env node
// Attach a round's stills to one arm's Outset study, per the guide's stimulus keys, and verify.
//   node outset-stimulus.mjs --study <dir> --round <n> --arm <A> --dir <stimulus folder with manifest.json> [--neutral-names]
// Keys: before-N -> before-N-*.png; after-N -> <design>-N-*.png. A still used by several questions is uploaded once
// and copied to the others. Re-running skips questions whose attached still has the same SHA-256 and upload name.
// --neutral-names uploads design stills as design-N-*.png, so no internal design code reaches a participant (a file
// name can surface in the participant's browser); the bytes, and so the checksums, stay the same.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { outsetEveryday } from './lib/outset.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const studyDir = opt('study'), round = Number(opt('round')), armName = opt('arm'), dir = opt('dir');
const spec = JSON.parse(readFileSync(join(studyDir, `guide-r${round}.json`), 'utf8').replace(/^\uFEFF/, ''));
const statePath = join(studyDir, 'rounds', `r${round}`, `arm-${armName}`, 'outset.json');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const design = state.design;
const files = readdirSync(dir).filter(f => /\.png$|\.jpe?g$/i.test(f) && !/contact-sheet/i.test(f));
const resolveKey = key => {
	const [part, n] = key.split('-');
	const prefix = part === 'before' ? `before-${n}-` : `${design}-${n}-`;
	const hit = files.filter(f => f.startsWith(prefix));
	if (hit.length !== 1) {
		throw new Error(`stimulus key ${key} for ${design} matches ${hit.length} files`);
	}
	return join(dir, hit[0]);
};
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const NEUTRAL = argv.includes('--neutral-names');
const uploadName = file => NEUTRAL ? basename(file).replace(new RegExp(`^${design.replace(/[^\w-]/g, '')}-`), 'design-') : basename(file);

const o = await outsetEveryday();
const sid = state.study_id;
state.stimuli ??= {};
const firstQuestionFor = {};
for (const sec of spec.sections) {
	for (const q of sec.questions) {
		if (!q.stimulus) {
			continue;
		}
		const qid = state.questions[q.key];
		const file = resolveKey(q.stimulus);
		const hash = sha(file);
		const name = uploadName(file);
		const prev = state.stimuli[q.key];
		if (prev?.sha256 === hash && (prev.uploaded_as ?? prev.file) === name) {
			firstQuestionFor[hash] ??= qid;
			continue;
		}
		if (firstQuestionFor[hash]) {
			await o.call('update_question_stimulus', { survey_id: sid, question_id: qid, source_question_id: firstQuestionFor[hash] });
		} else {
			const req = JSON.parse(await o.call('request_file_upload', { survey_id: sid, question_id: qid, filename: name }));
			const url = req.upload_url ?? req.url;
			if (!url || !req.upload_key) {
				throw new Error(`request_file_upload gave no upload url or key: ${JSON.stringify(req).slice(0, 300)}`);
			}
			const res = await fetch(url, { method: req.method ?? 'PUT', headers: req.headers ?? req.upload_headers ?? { 'content-type': 'image/png' }, body: readFileSync(file) });
			if (!res.ok) {
				throw new Error(`upload of ${basename(file)} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
			}
			await o.call('update_question_stimulus', { survey_id: sid, question_id: qid, upload_key: req.upload_key });
			firstQuestionFor[hash] = qid;
		}
		state.stimuli[q.key] = { key: q.stimulus, file: basename(file), uploaded_as: name, sha256: hash, attached_at: new Date().toISOString() };
		writeFileSync(statePath, JSON.stringify(state, null, '\t'));
		console.log(`${q.key}: ${basename(file)} attached as ${name}`);
	}
}

// Verify from Outset's side: list_stimuli reports which question each file is bound to (used_by). Every stimulus
// question must be bound to a file uploaded from the expected still (Outset appends a suffix to the name).
const bank = JSON.parse(await o.call('list_stimuli', { survey_id: sid }));
const boundTo = new Map();
for (const s of bank.stimuli ?? []) {
	for (const u of s.used_by ?? []) {
		if (u.type === 'question') {
			boundTo.set(u.id, s.filename);
		}
	}
}
const missing = [];
for (const sec of spec.sections) {
	for (const q of sec.questions.filter(x => x.stimulus)) {
		const want = uploadName(resolveKey(q.stimulus)).replace(/\.[^.]+$/, '');
		const got = boundTo.get(state.questions[q.key]) ?? '';
		if (!got.startsWith(want)) {
			missing.push(`${q.key} (bound to ${got || 'nothing'}, want ${want})`);
		}
	}
}state.stimulus_verified = { at: new Date().toISOString(), missing };
writeFileSync(statePath, JSON.stringify(state, null, '\t'));
console.log(missing.length ? `MISSING on Outset: ${missing.join(', ')}` : 'every stimulus question has its still on Outset');
process.exit(missing.length ? 1 : 0);


#!/usr/bin/env node
// Issue helpers for the run's agent.
//   node issue.mjs reply --study <slug> --instruction <commentId> --body-file <file>   reply and mark the instruction done
//   node issue.mjs note --study <slug> --body-file <file>                               post a note (never an instruction)
import { readFileSync } from 'node:fs';
import { loadStudy, updateStudy, addHistory } from './lib/state.mjs';
import { comment } from './lib/github.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const opt = n => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const slug = opt('study');
const body = readFileSync(opt('body-file'), 'utf8').replace(/[\u2013\u2014]/g, '-');
const study = loadStudy(slug);
const num = study.github?.issue?.number;
if (!num) {
	throw new Error(`${slug} has no issue yet`);
}
if (cmd === 'reply') {
	const id = Number(opt('instruction'));
	const c = comment(num, body);
	await updateStudy(slug, s => {
		const ins = (s.instructions ?? []).find(i => Number(i.id) === id);
		if (ins) {
			ins.status = 'done';
			ins.replied_at = new Date().toISOString();
			ins.reply_url = c?.html_url;
		}
		addHistory(s, `replied to instruction ${id}`);
	});
	console.log(c?.html_url ?? 'replied');
} else if (cmd === 'note') {
	const c = comment(num, body);
	console.log(c?.html_url ?? 'posted');
} else {
	console.error('usage: issue.mjs reply|note ...');
	process.exit(2);
}

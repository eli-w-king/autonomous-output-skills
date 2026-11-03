#!/usr/bin/env node
// Turn a round's harvested transcripts into what synthesis needs, in guide order, verbatim:
//   node transcripts.mjs --study <slug> --round <n> --arm <A>
// Writes rounds/r<n>/arm-<A>/transcripts.md (local only; it holds participants' words and is never published) and
// rounds/r<n>/arm-<A>/scores.template.json (one row per participant for the per-participant scoring the success
// criteria define). Real participants only: the harvest already skipped synthetic, fraud and low-quality interviews.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { studyDir } from './lib/state.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const slug = opt('study'), round = Number(opt('round')), arm = opt('arm');
const base = join(studyDir(slug), 'rounds', `r${round}`, `arm-${arm}`);
const outset = JSON.parse(readFileSync(join(base, 'outset.json'), 'utf8'));
const guide = JSON.parse(readFileSync(join(studyDir(slug), `guide-r${round}.json`), 'utf8').replace(/^\uFEFF/, ''));
const keyOf = new Map(Object.entries(outset.questions).map(([k, id]) => [id, k]));
const order = guide.sections.flatMap(s => s.questions.map(q => q.key));
const textOf = Object.fromEntries(guide.sections.flatMap(s => s.questions.map(q => [q.key, q.text])));
const tdir = join(base, 'transcripts');
const files = existsSync(tdir) ? readdirSync(tdir).filter(f => f.endsWith('.json')) : [];

export function byQuestion(messages, keyOfId) {
	const groups = new Map();
	for (const m of [...messages].sort((a, b) => a.order - b.order)) {
		const k = keyOfId.get(m.question_id) ?? (m.question_id ? `other:${m.question_id.slice(0, 8)}` : 'no question');
		if (!groups.has(k)) {
			groups.set(k, []);
		}
		groups.get(k).push(m);
	}
	return groups;
}

const out = [`# ${slug} round ${round} arm ${arm}: transcripts by question (local only, never publish)`, ''];
const rows = [];
for (const f of files.sort()) {
	const { interview: iv, transcript: t } = JSON.parse(readFileSync(join(tdir, f), 'utf8'));
	if (iv.type && iv.type !== 'USER') {
		continue;
	}
	const label = iv.participant_label ?? iv.name;
	out.push(`## ${label} (${iv.id})`, '', `Link: ${iv.url}  `, `Completed: ${iv.completed_at} · quality ${iv.quality_status ?? '?'} · fraud ${iv.fraud_score ?? '?'} · iid ${iv.metadata?.iid ?? 'none'}`, '');
	const groups = byQuestion(t.messages ?? [], keyOf);
	const keys = [...order.filter(k => groups.has(k)), ...[...groups.keys()].filter(k => !order.includes(k))];
	for (const k of keys) {
		out.push(`### ${k}${textOf[k] ? `: ${textOf[k]}` : ''}`, '');
		for (const m of groups.get(k)) {
			const who = m.role === 'PARTICIPANT' ? `**${label}**` : 'Interviewer';
			const content = String(m.content ?? '').trim();
			if (content) {
				out.push(`- ${who} (msg ${m.order}): ${content}`);
			}
		}
		out.push('');
	}
	rows.push({ label, interview_id: iv.id, url: iv.url, iid: iv.metadata?.iid ?? null, before_task: null, before_hint: null, main_task: null, main_hint: null, create: null, create_hint: null, act: null, act_hint: null, blocking: null, evidence: {} });
}
writeFileSync(join(base, 'transcripts.md'), out.join('\n'));
writeFileSync(join(base, 'scores.template.json'), JSON.stringify({ scale: 'success-without-help | success-with-help | failure; hint: none | H1 | H2', participants: rows }, null, 1));
console.log(`${files.length} transcripts -> ${join(base, 'transcripts.md')} and scores.template.json (${rows.length} participants)`);

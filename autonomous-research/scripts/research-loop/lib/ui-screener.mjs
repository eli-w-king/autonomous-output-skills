// Apply a study's screener spec to the screener a User Interviews project inherited from its template.
// The spec is data in the study folder (ui-screener.json), so nothing study specific lives in this script:
// {
//   "title": "<screener title>",
//   "keep": ["<question id>", ...],                 one per page, in this order; every other question is removed
//   "question_text": { "<question id>": "<text>" },
//   "answer_text": { "<answer id>": "<text>" },
//   "add_answers": [{ "question": "<id>", "text": "<text>", "qualify": "may|must|reject", "before": "<answer id>" }]
// }
// User Interviews' qualify values are may (shown as Accept or May Select), must and reject; "accept" makes launch fail.
import { randomUUID } from 'node:crypto';

export function applyScreenerSpec(inherited, spec) {
	const sj = structuredClone(inherited);
	for (const q of spec.keep) {
		if (!sj.questions[q]) {
			throw new Error(`inherited screener has no question ${q}; audit it by hand`);
		}
	}
	if (spec.title) {
		sj.title = spec.title;
	}
	for (const [id, text] of Object.entries(spec.question_text ?? {})) {
		if (!sj.questions[id]) {
			throw new Error(`no question ${id} to edit`);
		}
		sj.questions[id].text = text;
	}
	for (const [id, text] of Object.entries(spec.answer_text ?? {})) {
		if (!sj.answers[id]) {
			throw new Error(`no answer ${id} to edit`);
		}
		sj.answers[id].text = text;
	}
	for (const add of spec.add_answers ?? []) {
		const q = sj.questions[add.question];
		if (q.answerIds.some(a => sj.answers[a]?.text === add.text)) {
			continue;
		}
		const uuid = randomUUID();
		sj.answers[uuid] = { text: add.text, uuid, errors: {}, qualifyLogic: add.qualify, responseClass: 'answer', referenceIdentifier: randomUUID() };
		const at = add.before ? q.answerIds.indexOf(add.before) : -1;
		q.answerIds.splice(at >= 0 ? at : q.answerIds.length, 0, uuid);
	}
	const keepAnswers = new Set(spec.keep.flatMap(q => sj.questions[q].answerIds));
	for (const q of Object.keys(sj.questions)) {
		if (!spec.keep.includes(q)) {
			delete sj.questions[q];
		}
	}
	for (const a of Object.keys(sj.answers)) {
		if (!keepAnswers.has(a)) {
			delete sj.answers[a];
		}
	}
	const pages = {};
	const pageIds = [];
	for (const [i, q] of spec.keep.entries()) {
		// Reuse the inherited page id only once; two kept questions that shared a page get a new page each.
		const existing = Object.values(sj.sections).find(s => s.questionIds.includes(q) && !pages[s.uuid]);
		const uuid = existing?.uuid ?? randomUUID();
		pages[uuid] = { uuid, title: `Page ${i + 1}`, errors: {}, questionIds: [q], skipLogicIds: [] };
		pageIds.push(uuid);
	}
	sj.sections = pages;
	sj.sectionIds = pageIds;
	sj.skipLogics = {};
	sj.skipLogicConditions = {};
	return sj;
}

/** True when the project's screener already matches the spec (same questions in order, same texts). */
export function screenerMatches(sj, spec) {
	const order = sj.sectionIds.flatMap(s => sj.sections[s].questionIds);
	if (JSON.stringify(order) !== JSON.stringify(spec.keep) || (spec.title && sj.title !== spec.title)) {
		return false;
	}
	for (const [id, text] of Object.entries(spec.question_text ?? {})) {
		if (sj.questions[id]?.text !== text) {
			return false;
		}
	}
	for (const [id, text] of Object.entries(spec.answer_text ?? {})) {
		if (sj.answers[id]?.text !== text) {
			return false;
		}
	}
	return (spec.add_answers ?? []).every(add => (sj.questions[add.question]?.answerIds ?? []).some(a => sj.answers[a]?.text === add.text));
}

/** Problems that make User Interviews refuse to launch, or that break the screener's logic. */
export function screenerProblems(sj) {
	const problems = [];
	const allowed = new Set(['may', 'must', 'reject']);
	for (const [qid, q] of Object.entries(sj.questions)) {
		if (!q.text?.trim()) {
			problems.push(`question ${qid} has no text`);
		}
		if (/[\u2013\u2014]/.test(q.text)) {
			problems.push(`question ${qid} has an em or en dash`);
		}
		for (const a of q.answerIds ?? []) {
			const ans = sj.answers[a];
			if (!ans) {
				problems.push(`question ${qid} lists missing answer ${a}`);
				continue;
			}
			if (ans.responseClass === 'answer' && !String(ans.text ?? '').trim()) {
				problems.push(`empty answer in ${qid}`);
			}
			if (!allowed.has(ans.qualifyLogic)) {
				problems.push(`answer ${a} has qualifyLogic ${ans.qualifyLogic}`);
			}
		}
		const logics = (q.answerIds ?? []).map(a => sj.answers[a]?.qualifyLogic);
		if (logics.length && logics.every(l => l === 'reject')) {
			problems.push(`question ${qid} rejects every answer`);
		}
	}
	for (const s of Object.values(sj.sections)) {
		for (const q of s.questionIds) {
			if (!sj.questions[q]) {
				problems.push(`page ${s.title} lists missing question ${q}`);
			}
		}
	}
	return problems;
}

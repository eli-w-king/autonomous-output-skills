// node --test loop/scripts/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyScreenerSpec, screenerMatches, screenerProblems } from '../lib/ui-screener.mjs';

const ans = (uuid, text, qualifyLogic = 'may') => ({ uuid, text, qualifyLogic, responseClass: 'answer', errors: {} });
function inherited() {
	return {
		title: 'Old title',
		questions: {
			q1: { text: 'Do any of these apply?', answerIds: ['a1', 'a2'] },
			q2: { text: 'Which editors?', answerIds: ['b1', 'b2', 'b3'] },
			q3: { text: 'Old question to drop', answerIds: ['c1'] },
			q4: { text: 'Old consent wording', answerIds: ['d1', 'd2'] },
		},
		answers: {
			a1: ans('a1', 'I work for the vendor', 'reject'), a2: ans('a2', 'None of these', 'must'),
			b1: ans('b1', 'Editor One', 'must'), b2: ans('b2', 'Other'), b3: ans('b3', 'No editor', 'reject'),
			c1: ans('c1', 'Whatever'),
			d1: ans('d1', 'Yes'), d2: ans('d2', 'No', 'reject'),
		},
		sections: { s1: { uuid: 's1', title: 'Page 1', questionIds: ['q1', 'q2'] }, s2: { uuid: 's2', title: 'Page 2', questionIds: ['q3', 'q4'] } },
		sectionIds: ['s1', 's2'],
		skipLogics: { x: {} },
		skipLogicConditions: { y: {} },
	};
}
const spec = {
	title: 'New title',
	keep: ['q2', 'q1', 'q4'],
	question_text: { q4: 'Can you talk out loud for 30 minutes, recorded?' },
	answer_text: { a1: 'I work for the vendor or its parent' },
	add_answers: [{ question: 'q2', text: 'Fakecode', qualify: 'reject', before: 'b2' }],
};

test('applying a spec keeps, orders, rewrites and adds, one question per page', () => {
	const before = inherited();
	const sj = applyScreenerSpec(before, spec);
	assert.equal(before.title, 'Old title', 'input is not mutated');
	assert.equal(sj.title, 'New title');
	assert.deepEqual(sj.sectionIds.map(s => sj.sections[s].questionIds), [['q2'], ['q1'], ['q4']]);
	assert.equal(sj.questions.q3, undefined);
	assert.equal(sj.answers.c1, undefined);
	assert.equal(sj.questions.q4.text, spec.question_text.q4);
	assert.equal(sj.answers.a1.text, spec.answer_text.a1);
	const texts = sj.questions.q2.answerIds.map(a => sj.answers[a].text);
	assert.deepEqual(texts, ['Editor One', 'Fakecode', 'Other', 'No editor']);
	assert.deepEqual(sj.skipLogics, {});
	assert.equal(screenerMatches(sj, spec), true);
	assert.deepEqual(screenerProblems(sj), []);
});

test('applying twice adds nothing twice', () => {
	const once = applyScreenerSpec(inherited(), spec);
	const twice = applyScreenerSpec(once, spec);
	assert.equal(twice.questions.q2.answerIds.length, once.questions.q2.answerIds.length);
});

test('an inherited screener without a kept question is refused', () => {
	assert.throws(() => applyScreenerSpec(inherited(), { ...spec, keep: ['q2', 'q9'] }), /no question q9/);
});

test('an unchanged inherited screener does not match the spec', () => {
	assert.equal(screenerMatches(inherited(), spec), false);
});

test('problems: invalid qualify logic, a question that rejects everyone, dashes, empty answers', () => {
	const sj = applyScreenerSpec(inherited(), spec);
	sj.answers.d1.qualifyLogic = 'accept';
	sj.answers.a2.qualifyLogic = 'reject';
	sj.questions.q4.text = 'Thirty minutes \u2014 recorded?';
	sj.answers.b2.text = ' ';
	const p = screenerProblems(sj).join('\n');
	assert.match(p, /qualifyLogic accept/);
	assert.match(p, /q1 rejects every answer/);
	assert.match(p, /em or en dash/);
	assert.match(p, /empty answer in q2/);
});

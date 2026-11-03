#!/usr/bin/env node
// Build (or bring up to date) one Outset study from a guide spec. Idempotent: ids are kept in the arm's outset.json,
// so a rerun creates only what is missing and edits text and probing that drifted from the spec.
//
//   node outset-build.mjs --study <study dir> --round 1 --arm A --design <design key> --project <outset project id> [--name "..."]
//
// The everyday Outset connection is used; it cannot publish or launch. Prints the study URL and validation result.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { outsetEveryday, studyUrl, startUrl } from './lib/outset.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const studyDir = opt('study');
const round = Number(opt('round', '1'));
const arm = opt('arm');
const design = opt('design');
const projectId = opt('project');
if (!studyDir || !arm || !design || !projectId) {
	console.error('usage: outset-build.mjs --study <dir> --round <n> --arm <A|B|...> --design <kind> --project <outset project id> [--name <study name>]');
	process.exit(2);
}
const spec = JSON.parse(readFileSync(join(studyDir, `guide-r${round}.json`), 'utf8'));
const armDir = join(studyDir, 'rounds', `r${round}`, `arm-${arm}`);
mkdirSync(armDir, { recursive: true });
const statePath = join(armDir, 'outset.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { sections: {}, questions: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, '\t'));
const name = opt('name', state.study_name || `${spec.title_prefix ?? 'Study'} r${round} ${arm} ${design}`);

const desc = spec.design_descriptions?.[design];
if (!desc) {
	throw new Error(`guide-r${round}.json has no design_descriptions.${design}`);
}
const fill = s => String(s).replaceAll('{{DESIGN_DESCRIPTION}}', desc);
for (const s of [spec.welcome_message, spec.end_message, spec.context, ...(spec.goals ?? []), ...spec.sections.flatMap(x => x.questions.flatMap(q => [q.text, q.probing_instructions ?? '']))]) {
	if (/[\u2013\u2014]/.test(fill(s))) {
		throw new Error(`em or en dash in study text: ${fill(s).slice(0, 80)}`);
	}
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function idFrom(text, keys) {
	try {
		const j = JSON.parse(text);
		for (const k of keys) {
			const v = k.split('.').reduce((o, p) => o?.[p], j);
			if (typeof v === 'string' && UUID.test(v)) {
				return v;
			}
		}
	} catch { /* fall through */ }
	const m = UUID.exec(text);
	if (!m) {
		throw new Error(`no id in response: ${text.slice(0, 300)}`);
	}
	return m[0];
}

const o = await outsetEveryday();

if (!state.study_id) {
	const r = await o.call('create_study', {
		study_name: name,
		project_id: projectId,
		interview_method: spec.settings.interview_method,
		context: fill(spec.context),
		goals: spec.goals.map(fill),
		language_code: spec.settings.language_code ?? 'en',
		welcome_message: fill(spec.welcome_message),
		end_message: fill(spec.end_message),
	});
	state.study_id = idFrom(r, ['id', 'study_id', 'study.id', 'survey_id']);
	state.study_name = name;
	state.project_id = projectId;
	state.design = design;
	state.arm = arm;
	state.round = round;
	state.created_at = new Date().toISOString();
	save();
	console.log(`created study ${state.study_id}`);
}
const sid = state.study_id;

// Settings, every run (cheap, and it repairs drift).
const s = spec.settings;
const meta = {
	survey_id: sid,
	survey_name: name,
	context: fill(spec.context),
	goals: spec.goals.map(fill),
	welcome_message: fill(spec.welcome_message),
	end_message: fill(spec.end_message),
	allow_fallback_to_chat: s.allow_fallback_to_chat,
	desktop_only: s.desktop_only,
	interviewer_persona: s.interviewer_persona,
	interviewer_voice_engine: s.interviewer_voice_engine,
	pass_metadata_to_llm: s.pass_metadata_to_llm,
	auto_close_enabled: s.auto_close_enabled,
	max_interviews: s.max_interviews,
	completion_url: s.completion_url,
};
console.log('metadata:', (await o.call('update_survey_metadata', meta)).slice(0, 200).replace(/\s+/g, ' '));
// Participants arrive through the User Interviews project's tracked link, so Outset recruits nothing itself.
if (s.recruitment_method) {
	const rm = await o.call('set_recruitment_method', { study_id: sid, method: s.recruitment_method });
	console.log('recruitment method:', rm.slice(0, 160).replace(/\s+/g, ' '));
}

for (const [si, sec] of spec.sections.entries()) {
	const secKey = sec.key ?? sec.name;
	let secId = state.sections[secKey];
	if (!secId) {
		const r = await o.call('create_section', { survey_id: sid, section_name: sec.name, position: si });
		secId = idFrom(r, ['id', 'section_id', 'section.id']);
		state.sections[secKey] = secId;
		save();
		console.log(`section ${sec.name}: ${secId}`);
	} else if (state.section_names?.[secKey] !== sec.name) {
		await o.call('edit_section', { survey_id: sid, section_id: secId, section_name: sec.name });
		console.log(`section ${secKey}: renamed to ${sec.name}`);
	}
	state.section_names = { ...(state.section_names ?? {}), [secKey]: sec.name };
	save();
	for (const [qi, q] of sec.questions.entries()) {
		const fields = {
			text: fill(q.text),
			deep_probing: q.deep_probing,
			...(q.probing_instructions ? { probing_instructions: fill(q.probing_instructions) } : {}),
			...(q.type === 'RATING' ? { rating_scale: q.rating_scale, ...(q.rating_labels ? { rating_labels: q.rating_labels } : {}) } : {}),
		};
		const existing = state.questions[q.key];
		if (!existing) {
			const r = await o.call('create_question', { survey_id: sid, section_id: secId, question_type: q.type, position: qi, ...fields });
			state.questions[q.key] = idFrom(r, ['id', 'question_id', 'question.id']);
			save();
			console.log(`question ${q.key}: ${state.questions[q.key]}`);
		} else {
			const r = await o.call('edit_question', { survey_id: sid, question_id: existing, ...fields });
			if (!/No changes needed/i.test(r)) {
				console.log(`question ${q.key}: edited`);
			}
		}
	}
}

// Questions this study has that the spec no longer lists: preview, then delete, so the guide matches the spec.
const specKeys = new Set(spec.sections.flatMap(x => x.questions.map(q => q.key)));
for (const [key, qid] of Object.entries(state.questions)) {
	if (specKeys.has(key)) {
		continue;
	}
	const preview = await o.call('delete_question_preview', { survey_id: sid, question_id: qid }).catch(e => e.message);
	if (/skip|display/i.test(preview) && /[1-9]\d*\s+(rule|condition)/i.test(preview)) {
		console.log(`WARNING: deleting ${key} breaks logic: ${preview.slice(0, 200)}`);
	}
	await o.call('delete_question', { survey_id: sid, question_id: qid });
	delete state.questions[key];
	save();
	console.log(`question ${key}: deleted (not in the spec)`);
}

// Empty default sections (a new study can come with one) would fail validation; report them.
for (const sec of spec.sections) {
	const ids = sec.questions.map(q => state.questions[q.key]).filter(Boolean);
	await o.call('reorder_questions', { survey_id: sid, question_ids: ids, target_section_id: state.sections[sec.key ?? sec.name] }).catch(e => console.log(`reorder ${sec.name}: ${e.message.slice(0, 200)}`));
}
const st = JSON.parse(await o.call('get_survey_state', { survey_id: sid }));
const known = new Set(Object.values(state.sections));
const extra = (st.sections ?? []).filter(x => !known.has(x.id));
for (const x of extra) {
	const qs = (st.questions_by_section?.[x.id] ?? x.questions ?? []).length;
	if (qs === 0) {
		await o.call('delete_section', { survey_id: sid, section_id: x.id }).then(() => console.log(`deleted empty default section ${x.title ?? x.name ?? x.id}`)).catch(e => console.log(`could not delete section ${x.id}: ${e.message}`));
	} else {
		console.log(`WARNING: section not in the spec: ${x.title ?? x.name} (${qs} questions)`);
	}
}

const time = await o.call('get_time_estimate', { study_id: sid }).catch(() => o.call('get_time_estimate', { survey_id: sid })).catch(e => e.message);
state.time_estimate = time;
state.study_url = studyUrl(projectId, sid);
state.start_url = startUrl(sid);
save();
console.log(`time: ${time.slice(0, 300).replace(/\s+/g, ' ')}`);
const v = await o.call('validate_study', { study_id: sid });
state.last_validation = { at: new Date().toISOString(), result: v.slice(0, 4000) };
save();
console.log(`validate: ${v.slice(0, 1500)}`);
console.log(`study: ${state.study_url}\nstart: ${state.start_url}`);
process.exit(0);

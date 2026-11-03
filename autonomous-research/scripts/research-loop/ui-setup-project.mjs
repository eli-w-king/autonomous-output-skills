#!/usr/bin/env node
// Configure a User Interviews project for one arm of a study through the app's own API, then verify every setting by
// reading it back. Study-specific values come from the study folder: ui-copy.json (participant-facing copy, device,
// length, response limit) and ui-screener.json (the screener spec applied to the inherited screener).
//   node ui-setup-project.mjs --study <slug> --project <projectId> --outset <outsetStudyId>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uiFetch } from './lib/ui-browser.mjs';
import { ensureUiBrowser } from './lib/ui-chrome.mjs';
import { applyScreenerSpec, screenerMatches, screenerProblems } from './lib/ui-screener.mjs';
import { studyDir } from './lib/state.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const slug = opt('study'), pid = opt('project'), studyId = opt('outset');
if (!slug || !pid || !studyId) {
	console.error('usage: ui-setup-project.mjs --study <slug> --project <projectId> --outset <outsetStudyId>');
	process.exit(2);
}
const readJson = f => JSON.parse(readFileSync(join(studyDir(slug), f), 'utf8').replace(/^\uFEFF/, ''));
const copy = readJson('ui-copy.json');
const spec = readJson('ui-screener.json');
const hours = Number(copy.responseLimitHours ?? 6);
const { page } = await ensureUiBrowser();
const link = `https://outset.ai/start/${studyId}?iid=TRACKINGID`;
const must = (r, what) => { if (r.status >= 300) { throw new Error(`${what}: HTTP ${r.status} ${(r.text || JSON.stringify(r.json)).slice(0, 300)}`); } };

const proj = await uiFetch(page, `/api/projects/${pid}`);
must(proj, 'read project');
const accountId = proj.json?.data?.relationships?.owner?.data?.id;
must(await uiFetch(page, `/api/projects/${pid}`, { method: 'PATCH', body: { data: { attributes: {
	task: { accountId, projectId: String(pid), provider: 'custom_link_with_redirect', url: link, connectedAt: null, externalId: null, repositoryUrl: null, title: null, taskType: null },
} } } }), 'task');
must(await uiFetch(page, `/api/projects/${pid}`, { method: 'PATCH', body: { data: { attributes: {
	deviceRequirements: copy.deviceRequirements,
	confirmationNotesHtml: copy.confirmationNotesHtml,
	studyLength: copy.studyLength,
	publicTitle: copy.publicTitle,
	publicDescription: copy.publicDescription,
	additionalRecruitmentRequirementsHtml: copy.additionalRecruitmentRequirementsHtml,
} } } }), 'settings');
must(await uiFetch(page, `/api/projects/${pid}/task-setting`, { method: 'PATCH', body: { data: { attributes: { completionInterval: hours * 3600, timeLimitEnabled: true } } } }), 'time limit');

const cur = await uiFetch(page, `/api/projects/${pid}?include=survey_draft`);
let sj = (cur.json?.included ?? []).find(x => x.type === 'surveyDraft')?.attributes?.surveyJson;
if (typeof sj === 'string') { sj = JSON.parse(sj); }
if (!screenerMatches(sj, spec)) {
	const next = applyScreenerSpec(sj, spec);
	const p = screenerProblems(next);
	if (p.length) { throw new Error(`screener problems: ${p.join('; ')}`); }
	must(await uiFetch(page, `/api/projects/${pid}`, { method: 'PATCH', body: { data: { attributes: { surveyDraft: { surveyJson: next } } } } }), 'screener');
}

// Verify by reading everything back.
const g = await uiFetch(page, `/api/projects/${pid}?include=survey_draft`);
const a = g.json.data.attributes;
let sj2 = (g.json.included ?? []).find(x => x.type === 'surveyDraft')?.attributes?.surveyJson;
if (typeof sj2 === 'string') { sj2 = JSON.parse(sj2); }
const inc = await uiFetch(page, `/api/projects/${pid}?include=task,task_setting`);
const taskRec = (inc.json?.included ?? []).find(x => x.type === 'projectTask')?.attributes;
const tsRec = (inc.json?.included ?? []).find(x => x.type === 'taskSetting')?.attributes;
const cost = await uiFetch(page, `/api/projects/${pid}/expected-cost-details`);
const checks = {
	task: taskRec?.provider === 'custom_link_with_redirect' && (taskRec?.url === link || taskRec?.repositoryUrl === link),
	device: JSON.stringify(a.deviceRequirements?.ids ?? []) === JSON.stringify(copy.deviceRequirements),
	participants: a.numParticipants === 5,
	autoApproval: a.requireApproval === false,
	copy: a.publicTitle === copy.publicTitle,
	screener: screenerMatches(sj2, spec) && screenerProblems(sj2).length === 0,
	timeLimit: tsRec?.timeLimitEnabled === true && tsRec?.completionInterval === hours * 3600,
};
console.log(JSON.stringify({ pid, status: a.currentStatus, checks, incentive: a.compensationAmount, task: { provider: taskRec?.provider, url: taskRec?.url }, taskSetting: tsRec, cost: cost.json?.data?.attributes ?? cost.json }, null, 1));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);

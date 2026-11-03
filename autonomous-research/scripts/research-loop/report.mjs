#!/usr/bin/env node
// Write a study's one-screen report (report.md) from its state, ledger and round analyses.
//   node report.mjs --study <slug> [--out <file>] [--images <dir relative to the report>]
// The report leads with what the owner must know first, then the current designs, what participants did and said,
// the finish line, spend and what happens next. Quotes come only from analysis files written by the synthesis step,
// which takes them verbatim from real (USER) transcripts with their interview links.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadStudy, loadLedger, studyDir, armLabel, capitalize, publishedStill } from './lib/state.mjs';
import { committedSpend } from './lib/budget.mjs';
import { CONFIG } from './lib/config.mjs';
import { compareTitle, compareLines } from './lib/compare.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const slug = opt('study');
const study = loadStudy(slug);
const ledger = loadLedger(slug);
const dir = studyDir(slug);
const images = opt('images') ?? 'stills';
const out = opt('out') ?? join(dir, 'report.md');
const pt = iso => iso ? new Date(iso).toLocaleString('en-US', { timeZone: CONFIG.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet';
const money = n => { const v = Number(n ?? 0); return `$${v.toLocaleString('en-US', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const readJson = p => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;

const lines = [];
const L = s => lines.push(s ?? '');

L(`# ${study.title}`);
L();
for (const r of study.reminders ?? []) {
	L(`> **Reminder:** ${r}`);
}
if (study.reminders?.length) {
	L();
}
const current = study.rounds[study.rounds.length - 1];
L(`**Status:** ${study.status_line ?? study.status}. **Updated:** ${pt(new Date().toISOString())} (${CONFIG.timezone}). **Round:** ${current.n} of at most ${study.budget?.max_rounds ?? 3}.`);
L();
if (study.needs_you?.length) {
	L('**Needs you**');
	for (const n of study.needs_you) {
		L(`- ${n}`);
	}
	L();
}

// The designs in the current round.
L(`## The designs in round ${current.n}`);
L();
const arms = current.arms;
L(`| ${arms.map(a => capitalize(armLabel(study, a))).join(' | ')} |`);
L(`| ${arms.map(() => '---').join(' | ')} |`);
const still = (a, key) => { const f = a.stimulus?.files?.[key]?.file; return f && publishedStill(study, a, f); };
L(`| ${arms.map(a => still(a, 'main-task') ? `![${armLabel(study, a)} overview](${images}/${still(a, 'main-task')})` : '(no stills yet)').join(' | ')} |`);
L(`| ${arms.map(a => [['after-detail', 'one item opened'], ['create-sentence', 'creating one'], ['act-command', 'acting on a result']].filter(([k]) => still(a, k)).map(([k, label]) => `[${label}](${images}/${still(a, k)})`).join(', ')).join(' | ')} |`);
L(`| ${arms.map(a => `[Outset guide](${a.outset.study_url}) · [results](${a.outset.results_url}) · [User Interviews](${a.ui.url})`).join(' | ')} |`);
L();
const before = arms[0]?.stimulus?.files;
if (before?.['before-first-look']) {
	L(`Today's page, shown first in every interview: [overview](${images}/${before['before-first-look'].file}), [history](${images}/${before['before-detail']?.file ?? ''}).`);
	L();
}

// What participants did and said.
L('## What participants did and said');
L();
let anyData = false;
for (const a of arms) {
	const an = readJson(join(dir, 'rounds', `r${current.n}`, `arm-${a.arm}`, 'analysis.json'));
	const counts = a.counts ?? {};
	L(`**${capitalize(armLabel(study, a))}.** ${a.launched_at ? `Launched ${pt(a.launched_at)}.` : 'Not launched.'} Completed real interviews: ${counts.completed ?? 0} of 5${counts.in_progress ? `, ${counts.in_progress} in progress` : ''}${counts.excluded ? `, ${counts.excluded} excluded for quality` : ''}.`);
	if (an) {
		anyData = true;
		if (an.summary) {
			L(an.summary);
		}
		if (an.participants?.length) {
			L();
			L('| Participant | Main task | Hint | Blocking problem |');
			L('| --- | --- | --- | --- |');
			for (const p of an.participants) {
				L(`| [${p.label}](${p.url}) | ${p.main_task} | ${p.hint ?? 'none'} | ${p.blocking ?? 'none'} |`);
			}
		}
		for (const f of (an.findings ?? []).slice(0, 3)) {
			L();
			L(`- **${f.claim}** (${f.count}; confidence ${f.confidence})`);
			for (const q of (f.quotes ?? []).slice(0, 2)) {
				L(`  > "${q.text}" ([${q.label}](${q.url}))`);
			}
		}
	}
	L();
}
if (!anyData) {
	L('No interviews yet. Quotes appear here only from completed, real (not simulated) interviews, verbatim, with links.');
	L();
}

// How the findings compare with the prior research the study is set against.
L(`## ${compareTitle()}`);
L();
{
	const cmp = compareLines(arms.map(a => ({ label: capitalize(armLabel(study, a)), analysis: readJson(join(dir, 'rounds', `r${current.n}`, `arm-${a.arm}`, 'analysis.json')) })));
	if (cmp.length) {
		cmp.forEach(l => L(l));
	} else {
		L(`Not yet. Round ${current.n}'s synthesis sets each finding against ${CONFIG.priorResearch.label}: confirms, contradicts, extends or new, with links to the pages.`);
	}
}
L();

// Finish line.
L('## Against the finish line');
L();
const fl = study.criteria?.finish_line ?? {};
L(`Done when, in one round of ${fl.participants_per_round ?? 5}: at least ${fl.main_task_success_without_help_min ?? 4} complete the main task without help, nobody hits a blocking problem, and the design follows the taste rules. Full criteria: [success-criteria.md](success-criteria.md).`);
L();
for (const a of arms) {
	const an = readJson(join(dir, 'rounds', `r${current.n}`, `arm-${a.arm}`, 'analysis.json'));
	const f = an?.finish_line;
	L(`- ${capitalize(armLabel(study, a))}: ${f ? `${f.main_task_without_help} of ${f.n} without help, ${f.blocking} blocking, taste ${f.taste}; ${f.met ? '**met**' : 'not met'}` : 'not scored yet'}`);
}
L();

// Spend.
L('## Spend');
L();
const committed = committedSpend(ledger);
const launches = ledger.entries.filter(e => e.type === 'launch');
L(`Committed ${money(committed)} of the ${money(study.budget?.program_cap_usd ?? 1000)} ceiling (caps: ${money(study.budget?.per_round_per_arm_usd ?? 250)} per round per arm, ${study.budget?.max_rounds ?? 3} rounds).`);
for (const e of launches) {
	L(`- ${pt(e.at)}: round ${e.round} arm ${e.arm}, ${e.count} participants, ${money(e.cost_usd)} (up to ${money(e.cost_usd_with_allowance)} with tax allowance)`);
}
if (!launches.length) {
	// The latest real (not simulated) budget check per arm is the quote.
	const quotes = arms.map(a => {
		const c = [...ledger.entries].reverse().find(e => /check/.test(e.type) && Number(e.round) === current.n && e.arm === a.arm && !e.simulated && e.cost?.known)?.cost;
		if (!c) {
			return `${armLabel(study, a)} not quoted yet`;
		}
		const p = c.parts ?? {};
		return `${armLabel(study, a)} ${money(c.base_usd)} (${c.count} x ${money((p.ui_incentives ?? 0) / (c.count || 1))} incentive, ${money((p.ui_processing ?? 0) + (p.ui_recruit ?? 0))} fees, ${money(p.outset_recruitment)} survey-side recruitment; up to ${money(c.with_allowance_usd)} with the tax allowance)`;
	});
	L(`- Nothing launched. Latest quotes: ${quotes.join('; ')}.`);
}
L();

// Next.
L('## What happens next');
L();
L(study.next_action ?? '');
L();
L(`State: [study.json](study.json) · ledger: [ledger.json](ledger.json) · guide: [guide-r${current.n}.json](guide-r${current.n}.json)`);
L();
const text = lines.join('\n').replace(/[\u2013\u2014]/g, '-');
writeFileSync(out, text);
console.log(`wrote ${out} (${text.length} chars)`);


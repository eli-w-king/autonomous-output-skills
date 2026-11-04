// Email confirmations of close-outs and payouts (lib/confirm.mjs), checked on a run after the event.
//   node confirm.mjs due [--study <slug>]                 what to look for now: JSON per study, with the searches to run
//   node confirm.mjs check --file <fetch result> [--study <slug>]
//        records found or not for every due confirmation in the ledger, and adds a "Needs you" note when one is still
//        missing after two checks. Run it only when the mailbox search succeeded; a failed search is not a check.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listStudies, loadStudy, loadLedger, appendLedger, updateStudy, studyDir } from './lib/state.mjs';
import { due, checkDue, messagesOf, label } from './lib/confirm.mjs';

const [cmd, ...args] = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const SEARCHES = [
	'/me/messages?$search="from:outset.ai"&$select=id,receivedDateTime,from,subject&$top=50',
	'/me/messages?$search="from:userinterviews.com"&$select=id,receivedDateTime,from,subject&$top=50',
];

/** The names each platform puts in its subjects: the Outset study's name, and the project id for User Interviews. */
function namesFor(slug, study, groups) {
	const names = {};
	for (const g of groups) {
		if (g.platform === 'outset') {
			const p = join(studyDir(slug), 'rounds', `r${g.round}`, `arm-${g.arm}`, 'outset.json');
			const o = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
			names[g.key] = o.study_name ?? o.name ?? study.rounds?.find(r => Number(r.n) === Number(g.round))?.arms?.find(a => a.arm === g.arm)?.outset?.study_name ?? '';
		}
	}
	return names;
}

const studies = listStudies().filter(s => !opt('study') || s === opt('study'));
if (cmd === 'due') {
	const out = [];
	for (const slug of studies) {
		const ledger = loadLedger(slug);
		const groups = due(ledger);
		if (groups.length) {
			const names = namesFor(slug, loadStudy(slug), groups);
			out.push({ study: slug, due: groups.map(g => ({ key: g.key, what: label(g, names), since: g.since, checks: g.checks })), searches: SEARCHES });
		}
	}
	console.log(JSON.stringify(out, null, 1));
} else if (cmd === 'check') {
	const file = opt('file');
	if (!file || !existsSync(file)) {
		console.error('check needs --file <saved Work IQ fetch result>');
		process.exit(2);
	}
	const messages = messagesOf(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
	const summary = [];
	for (const slug of studies) {
		const ledger = loadLedger(slug);
		const groups = due(ledger);
		if (!groups.length) {
			continue;
		}
		const names = namesFor(slug, loadStudy(slug), groups);
		const { entries, notes } = checkDue(ledger, messages, { names });
		for (const e of entries) {
			await appendLedger(slug, e);
		}
		if (notes.length) {
			await updateStudy(slug, s => {
				s.needs_you = [...(s.needs_you ?? []), ...notes.filter(n => !(s.needs_you ?? []).includes(n))];
			});
		}
		summary.push({ study: slug, messages: messages.length, checked: entries.map(e => ({ key: e.key, found: e.found, check: e.check })), notes: notes.length });
	}
	console.log(JSON.stringify(summary, null, 1));
} else {
	console.error('usage: confirm.mjs due|check (see the header)');
	process.exit(2);
}

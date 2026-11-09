// Confirmations of close-outs and payouts (lib/confirm.mjs), checked on runs after the event.
//   node confirm.mjs due [--study <slug>]
//        what to look for now, per study: `due` (email checks, with the searches to run) and `platform` (no email came
//        after two checks, so the platform itself is checked next)
//   node confirm.mjs check --file <fetch result> [--study <slug>]
//        records found or not for every due email confirmation in the ledger. Run it only when the mailbox search
//        succeeded; a failed search is not a check. A confirmation still without email after two checks goes on to
//        `platform` (listed as `platform_next`); no note is added for a missing email.
//   node confirm.mjs platform [--study <slug>] [--dry-run]
//        for every confirmation whose email never came: reads the platform, read only, with the calls run.mjs and
//        close.mjs make (User Interviews: the project's status and paid count, in the loop's Chrome; Outset: the
//        study's `active`), and records "confirmed on the platform" in the ledger when it matches, or a "Needs you"
//        note when it does not. A failed read (signed out, an HTTP error) records nothing, so the next run tries again.
//        A matching close also brings the arm's close-out up to date (for example "close requested" to "closed").
//        --dry-run reads and prints, and writes nothing.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listStudies, loadStudy, loadLedger, appendLedger, updateStudy, studyDir, addHistory } from './lib/state.mjs';
import { due, checkDue, messagesOf, label, platformDue, platformReads, checkOnPlatform } from './lib/confirm.mjs';
import { UI_STATUS } from './lib/close.mjs';

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
		const onPlatform = platformDue(ledger);
		if (groups.length || onPlatform.length) {
			const names = namesFor(slug, loadStudy(slug), [...groups, ...onPlatform]);
			out.push({
				study: slug,
				due: groups.map(g => ({ key: g.key, what: label(g, names), since: g.since, checks: g.checks })),
				...(groups.length ? { searches: SEARCHES } : {}),
				platform: onPlatform.map(g => ({ key: g.key, what: label(g, names) })),
			});
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
		const { entries, platform_next: platformNext } = checkDue(ledger, messages, { names });
		for (const e of entries) {
			await appendLedger(slug, e);
		}
		summary.push({
			study: slug, messages: messages.length, checked: entries.map(e => ({ key: e.key, found: e.found, check: e.check })),
			platform_next: platformNext, ...(platformNext.length ? { next: 'run confirm.mjs platform now: no email came after the last check' } : {}),
		});
	}
	console.log(JSON.stringify(summary, null, 1));
} else if (cmd === 'platform') {
	const dryRun = args.includes('--dry-run');
	const plan = studies.map(slug => ({ slug, groups: platformDue(loadLedger(slug)) })).filter(x => x.groups.length);
	const needed = platformReads(plan.flatMap(x => x.groups));
	const reads = {};
	const ui = needed.filter(r => r.platform === 'user-interviews');
	if (ui.length) {
		const { uiProjectRead } = await import('./lib/platform-read.mjs');
		const { ensureUiBrowser, uiSignedIn } = await import('./lib/ui-chrome.mjs');
		const { page } = await ensureUiBrowser({ log: m => console.error(m) });
		const signedIn = await uiSignedIn(page);
		for (const r of ui) {
			try {
				reads[`user-interviews:${r.ref}`] = signedIn ? await uiProjectRead(page, r.ref) : { error: 'User Interviews is signed out in the loop\'s Chrome' };
			} catch (e) {
				reads[`user-interviews:${r.ref}`] = { error: e.message };
			}
		}
	}
	const outset = needed.filter(r => r.platform === 'outset');
	if (outset.length) {
		const { outsetStudyRead } = await import('./lib/platform-read.mjs');
		for (const r of outset) {
			try {
				reads[`outset:${r.ref}`] = await outsetStudyRead(r.ref);
			} catch (e) {
				reads[`outset:${r.ref}`] = { error: e.message };
			}
		}
	}
	const summary = [];
	for (const { slug } of plan) {
		const ledger = loadLedger(slug);
		const names = namesFor(slug, loadStudy(slug), platformDue(ledger));
		const { entries, notes, skipped } = checkOnPlatform(ledger, reads, { names });
		if (!dryRun) {
			for (const e of entries) {
				await appendLedger(slug, e);
			}
			if (entries.length) {
				await updateStudy(slug, s => {
					s.needs_you = [...(s.needs_you ?? []), ...notes.filter(n => !(s.needs_you ?? []).includes(n))];
					// A close the platform confirms brings the arm's close-out up to what the platform shows now.
					for (const e of entries.filter(x => x.ok && x.kind === 'close')) {
						const arm = s.rounds?.find(r => Number(r.n) === Number(e.round))?.arms?.find(a => a.arm === e.arm);
						if (!arm?.close) {
							continue;
						}
						if (e.platform === 'user-interviews') {
							const complete = e.observed.status_id !== UI_STATUS.PENDING_CLOSE_REQUEST;
							arm.close.ui = { ...arm.close.ui, ...(complete ? { state: 'closed' } : {}), status: e.observed.status ?? arm.close.ui?.status, confirmed_on_platform_at: e.checked_at };
						} else {
							arm.close.outset = { ...arm.close.outset, confirmed_on_platform_at: e.checked_at };
						}
					}
					const ok = entries.filter(e => e.ok).length;
					addHistory(s, `confirmations checked on the platform (no email came): ${ok} of ${entries.length} match the ledger${notes.length ? `; ${notes.length} do not (Needs you)` : ''}`);
				});
			}
		}
		summary.push({
			study: slug, dry_run: dryRun,
			checked: entries.map(e => ({ key: e.key, ok: e.ok, observed: e.observed, expected: e.expected, ...(e.mismatch ? { mismatch: e.mismatch } : {}) })),
			notes, skipped,
		});
	}
	console.log(JSON.stringify(summary, null, 1));
	// The loop's Chrome stays open for the next run; only this process's connection to it ends.
	process.exit(0);
} else {
	console.error('usage: confirm.mjs due|check|platform (see the header)');
	process.exit(2);
}

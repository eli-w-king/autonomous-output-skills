// The last step of every study: contribute it back to the team's research wiki with ONE pull request
// (lib/wikipr.mjs; prior_research.contribute in loop.config.json names the wiki, the account and the clone).
//   node wiki-pr.mjs plan --study <slug>
//        read only: the account, its permission on the wiki, the fork, the contribution clone, the branch, what is left
//   node wiki-pr.mjs prepare --study <slug>
//        only once the study has ended: forks the wiki to the account if there is no fork yet, makes the contribution
//        clone (a local clone of the reading clone, pointed at the wiki and the fork) and the study's branch from the
//        wiki's main. Then write the files the wiki's AGENTS.md ingest workflow asks for in that clone.
//   node wiki-pr.mjs check --study <slug>
//        stages the branch's changes and checks them: only what an ingest adds or updates, nothing deleted or renamed,
//        no existing raw file changed, a changed page only gains text, no emails, tracking ids, phone numbers or names,
//        plain file names, the two new files' frontmatter; then the wiki's own site build. Records the result.
//   node wiki-pr.mjs open --study <slug> --title "<title>" --body-file <file>
//        once per study, after a passing check of exactly what is staged: commits, pushes the branch to the fork (never
//        to the wiki itself), opens the pull request, reads it back, records it (study.json wiki_pr, the ledger), and
//        posts one note with the link on the study's issue
//   node wiki-pr.mjs block --study <slug> --reason "<why>"
//        when the contribution cannot be made (for example the account lost its access): records why, adds a "Needs
//        you" note, and lets the loop go idle; prepare clears it on a later try
// Exit codes: 0 done, 3 refused (the study has not ended, its pull request exists, or no passing check), 4 the check
// failed, 5 opened but the read-back did not confirm it, 1 error.
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { CONFIG } from './lib/config.mjs';
import { loadStudy, updateStudy, appendLedger, addHistory } from './lib/state.mjs';
import { comment } from './lib/github.mjs';
import { branchFor, checkContribution, collectChanges, scanText, gitIn, accountToken, ghAs, forkOf } from './lib/wikipr.mjs';

const ENDED = new Set(['done', 'handed-to-owner']);
const [cmd, ...args] = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const slug = opt('study');
const out = (o, code = 0) => { console.log(JSON.stringify(o, null, 1)); process.exit(code); };
const refuse = reason => out({ refused: true, reason }, 3);

if (!slug || !['plan', 'prepare', 'check', 'open', 'block'].includes(cmd)) {
	console.error('usage: wiki-pr.mjs plan|prepare|check|open|block --study <slug> (see the header)');
	process.exit(2);
}
const c = CONFIG.priorResearch.contribute;
if (!c?.upstream || !c.account || !c.clone) {
	console.error('loop.config.json has no prior_research.contribute { upstream, account, clone }');
	process.exit(1);
}
const reading = CONFIG.priorResearch.clone;
const name = c.upstream.split('/')[1];
const forkName = `${c.account}/${name}`;
const branch = branchFor(slug);
const study = loadStudy(slug);
const pr = study.wiki_pr ?? {};
const now = () => new Date().toISOString();

if (cmd === 'plan') {
	let account = null;
	let upstream = null;
	let fork = null;
	try {
		const token = accountToken(c.account);
		account = ghAs(token, ['api', 'user', '--jq', '.login']).stdout.trim();
		upstream = JSON.parse(ghAs(token, ['api', `repos/${c.upstream}`, '--jq', '{allow_forking, permissions: {push: .permissions.push, pull: .permissions.pull}, default_branch}']).stdout);
		fork = forkOf(token, c.account, c.upstream);
	} catch (e) {
		upstream = { error: e.message };
	}
	const cloneReady = existsSync(join(c.clone, '.git'));
	out({
		study: slug, status: study.status, ended: ENDED.has(study.status),
		account, upstream, fork, clone: { path: c.clone, exists: cloneReady }, branch, wiki_pr: study.wiki_pr ?? null,
		next: pr.url ? 'Its pull request is open; nothing to do.'
			: !ENDED.has(study.status) ? 'Wait for the study to end (done or handed-to-owner), then prepare.'
				: !pr.branch ? 'prepare' : !pr.check?.ok ? 'Write the ingest in the clone, then check.' : 'open',
	});
}

if (!ENDED.has(study.status)) {
	refuse(`the study has not ended (status ${study.status}); a study is contributed once, when it is done or handed to its owner`);
}
if (pr.url) {
	refuse(`its pull request already exists: ${pr.url}`);
}

if (cmd === 'block') {
	const reason = opt('reason');
	if (!reason) {
		console.error('block needs --reason "<why>"');
		process.exit(2);
	}
	const note = `The research wiki contribution for this study is blocked: ${reason}. Nothing was pushed to the wiki. To try again once it is fixed: node wiki-pr.mjs prepare --study ${slug} in the loop home, then procedure step 5b.`;
	await updateStudy(slug, s => {
		s.wiki_pr = { ...(s.wiki_pr ?? {}), state: 'blocked', blocked_at: now(), blocked_reason: reason };
		s.needs_you = [...(s.needs_you ?? []).filter(n => !/research wiki contribution/.test(n)), note];
		addHistory(s, `research wiki contribution blocked: ${reason}`);
	});
	await appendLedger(slug, { type: 'wiki-pr-blocked', at: now(), study: slug, reason });
	out({ blocked: true, reason });
}

if (cmd === 'prepare') {
	const token = accountToken(c.account);
	let fork = forkOf(token, c.account, c.upstream);
	let forked = false;
	if (!fork) {
		ghAs(token, ['repo', 'fork', c.upstream, '--clone=false', '--default-branch-only']);
		forked = true;
		for (let i = 0; i < 30 && !fork; i++) {
			spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 2000)']);
			fork = forkOf(token, c.account, c.upstream);
		}
		if (!fork) {
			throw new Error(`asked GitHub to fork ${c.upstream} to ${c.account}, but the fork did not appear within a minute`);
		}
	}
	if (!existsSync(join(c.clone, '.git'))) {
		const r = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', reading, c.clone], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
		if (r.status !== 0) {
			throw new Error(`git clone of the reading clone failed: ${r.stderr.trim().slice(0, 300)}`);
		}
		gitIn(c.clone, ['remote', 'set-url', 'origin', `https://github.com/${c.upstream}.git`]);
		gitIn(c.clone, ['remote', 'add', 'fork', `https://github.com/${forkName}.git`]);
		// Sign in the way the reading clone does (its repository-level credential helper), copied, never changed there.
		const helpers = gitIn(reading, ['config', '--local', '--get-all', 'credential.https://github.com.helper'], { allowFail: true }).stdout.split('\n').filter((h, i, a) => i < a.length - 1 || h);
		for (const h of helpers) {
			gitIn(c.clone, ['config', '--local', '--add', 'credential.https://github.com.helper', h]);
		}
	}
	gitIn(c.clone, ['fetch', '--quiet', 'origin', c.base]);
	const exists = gitIn(c.clone, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }).status === 0;
	gitIn(c.clone, exists ? ['switch', '--quiet', branch] : ['switch', '--quiet', '-c', branch, `origin/${c.base}`]);
	const base = gitIn(c.clone, ['merge-base', 'HEAD', `origin/${c.base}`]).stdout.trim();
	await updateStudy(slug, s => {
		s.wiki_pr = { ...(s.wiki_pr ?? {}), state: 'drafting', upstream: c.upstream, fork, clone: c.clone, branch, base, prepared_at: now() };
		s.needs_you = (s.needs_you ?? []).filter(n => !/research wiki contribution/.test(n));
		addHistory(s, `research wiki contribution prepared on ${branch}${forked ? ` (forked ${c.upstream} to ${fork})` : ''}`);
	});
	out({
		prepared: true, forked, fork, clone: c.clone, branch, base,
		next: 'In the clone, follow the wiki\'s AGENTS.md ingest workflow: add the final readout as one raw/reports/<title>.md (frontmatter title, created, confidentiality: internal, author left empty), its wiki/sources/<title> (<year>).md page, update the related concept pages, wiki/Wiki Index.md and wiki/Wiki Log.md in the format the latest entries use. Never delete or rename anything, never change an existing raw file. Then run check.',
	});
}

if (!pr.branch || !existsSync(join(c.clone, '.git'))) {
	refuse('run prepare first');
}
const current = gitIn(c.clone, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
if (current !== branch) {
	refuse(`the contribution clone is on ${current}, not ${branch}`);
}

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const runIn = (dir, bin, a) => spawnSync(bin, a, { cwd: dir, encoding: 'utf8', shell: true, timeout: 900_000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
const tail = r => `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').slice(-3).join(' | ');
// Paths go through a shell (npx on Windows), so they are quoted.
const quote = p => `"${p.replace(/"/g, '')}"`;

/** The wiki's own tooling, installed once in the contribution clone (`npm ci`, as its deploy workflow does). */
function ensureDeps(dir) {
	if (existsSync(join(dir, 'node_modules'))) {
		return { ok: true };
	}
	const ci = runIn(dir, NPM, ['ci', '--no-audit', '--no-fund', '--loglevel=error']);
	return ci.status === 0 ? { ok: true } : { ok: false, failed: 'npm ci', out: tail(ci) };
}

/**
 * The files this contribution adds are formatted with the wiki's own formatter (Prettier, half of its `npm run
 * check`), so they pass it. Existing pages are never reformatted: the wiki's main does not pass Prettier as a whole.
 */
function formatAdded(dir, added) {
	if (!added.length) {
		return { changed: [] };
	}
	const deps = ensureDeps(dir);
	if (!deps.ok) {
		return { changed: [], error: deps };
	}
	const w = runIn(dir, NPX, ['prettier', '--write', ...added.map(quote)]);
	if (w.status !== 0) {
		return { changed: [], error: { failed: 'prettier --write', out: tail(w) } };
	}
	return { changed: gitIn(dir, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--', ...added]).stdout.split('\n').filter(Boolean) };
}

/**
 * The wiki's own checks before a pull request: `tsc --noEmit` (the other half of its `npm run check`) and the site build
 * its deploy workflow runs (`npx quartz build -d wiki`); both must pass, and so must Prettier on the files this
 * contribution adds.
 */
function wikiChecks(dir, addedFiles) {
	const t0 = Date.now();
	const deps = ensureDeps(dir);
	if (!deps.ok) {
		return deps;
	}
	const tsc = runIn(dir, NPX, ['tsc', '--noEmit']);
	if (tsc.status !== 0) {
		return { ok: false, failed: 'tsc --noEmit', out: tail(tsc) };
	}
	const outDir = mkdtempSync(join(tmpdir(), 'wiki-build-'));
	try {
		const b = runIn(dir, NPX, ['quartz', 'build', '-d', 'wiki', '-o', quote(outDir)]);
		if (b.status !== 0) {
			return { ok: false, failed: 'quartz build -d wiki', out: tail(b) };
		}
	} finally {
		rmSync(outDir, { recursive: true, force: true, maxRetries: 3 });
	}
	if (addedFiles.length) {
		const pretty = runIn(dir, NPX, ['prettier', '--check', ...addedFiles.map(quote)]);
		if (pretty.status !== 0) {
			return { ok: false, failed: 'prettier --check (the added files)', out: tail(pretty) };
		}
	}
	return { ok: true, ran: ['tsc --noEmit', 'quartz build -d wiki', ...(addedFiles.length ? ['prettier --check (the added files)'] : [])], seconds: Math.round((Date.now() - t0) / 1000) };
}

if (cmd === 'check') {
	// Only the folders an ingest touches are staged, so tooling changes elsewhere (the build rewrites tracked files such
	// as tsconfig.tsbuildinfo) never reach the pull request. Anything else changed in the clone is listed, not included.
	gitIn(c.clone, ['add', '-A', '--', 'raw', 'wiki']);
	let collected = collectChanges(c.clone, pr.base);
	const added = collected.changes.filter(x => x.status === 'A' && x.path.endsWith('.md')).map(x => x.path);
	const formatted = formatAdded(c.clone, added);
	if (formatted.changed.length) {
		gitIn(c.clone, ['add', '--', ...formatted.changed]);
		collected = collectChanges(c.clone, pr.base);
	}
	const notIncluded = gitIn(c.clone, ['status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude)raw', ':(exclude)wiki']).stdout.split('\n').filter(Boolean);
	const problems = checkContribution({ ...collected, denyTerms: c.denyTerms });
	if (formatted.error) {
		problems.push(`formatting the added files failed: ${formatted.error.failed}: ${formatted.error.out}`);
	}
	const checks = problems.length ? null : wikiChecks(c.clone, added);
	const tree = gitIn(c.clone, ['write-tree']).stdout.trim();
	const ok = !problems.length && !!checks?.ok;
	await updateStudy(slug, s => {
		s.wiki_pr = { ...(s.wiki_pr ?? {}), check: { at: now(), ok, problems, checks, formatted: formatted.changed, tree, files: collected.changes.map(x => `${x.status} ${x.path}`) } };
	});
	out({ ok, problems, checks, formatted: formatted.changed, changes: collected.changes.map(x => `${x.status} ${x.path}`), not_included: notIncluded }, ok ? 0 : 4);
}
if (cmd === 'open') {
	const title = opt('title');
	const bodyFile = opt('body-file');
	if (!title || !bodyFile || !existsSync(bodyFile)) {
		console.error('open needs --title "<title>" and --body-file <file>');
		process.exit(2);
	}
	// Exactly what passed the check, nothing staged since.
	const tree = gitIn(c.clone, ['write-tree']).stdout.trim();
	if (!pr.check?.ok || pr.check.tree !== tree) {
		refuse(pr.check?.ok ? 'the staged files changed after the last check; run check again' : 'no passing check; run check');
	}
	const body = readFileSync(bodyFile, 'utf8');
	const textProblems = scanText([{ at: 'the title', text: title }, ...body.split('\n').map((l, i) => ({ at: `${basename(bodyFile)}:${i + 1}`, text: l }))], { denyTerms: c.denyTerms });
	if (textProblems.length) {
		out({ ok: false, problems: textProblems }, 4);
	}
	const token = accountToken(c.account);
	// One pull request per study, ever: look for one from this branch first (open, closed or merged).
	const existing = JSON.parse(ghAs(token, ['pr', 'list', '--repo', c.upstream, '--head', branch, '--state', 'all', '--json', 'url,number,state,headRepositoryOwner']).stdout)
		.filter(p => String(p.headRepositoryOwner?.login).toLowerCase() === c.account.toLowerCase());
	if (existing.length) {
		await updateStudy(slug, s => {
			s.wiki_pr = { ...(s.wiki_pr ?? {}), state: existing[0].state.toLowerCase(), url: existing[0].url, number: existing[0].number };
		});
		refuse(`a pull request from ${branch} already exists: ${existing[0].url}`);
	}
	const login = ghAs(token, ['api', 'user', '--jq', '.login']).stdout.trim();
	const id = ghAs(token, ['api', 'user', '--jq', '.id']).stdout.trim();
	if (gitIn(c.clone, ['diff', '--cached', '--quiet'], { allowFail: true }).status !== 0) {
		gitIn(c.clone, ['-c', `user.name=${login}`, '-c', `user.email=${id}+${login}@users.noreply.github.com`, 'commit', '--quiet',
			'-m', title, '-m', 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>']);
	}
	const commit = gitIn(c.clone, ['rev-parse', 'HEAD']).stdout.trim();
	// To the fork only. The wiki itself is never pushed to.
	const forkUrl = `https://github.com/${pr.fork ?? forkName}.git`;
	if (forkUrl.toLowerCase() === `https://github.com/${c.upstream}.git`.toLowerCase()) {
		refuse('the fork is the wiki itself; never push there');
	}
	gitIn(c.clone, ['push', '--quiet', forkUrl, `HEAD:refs/heads/${branch}`]);
	await appendLedger(slug, { type: 'wiki-pr-push', at: now(), study: slug, branch, commit, fork: pr.fork ?? forkName });
	const created = ghAs(token, ['pr', 'create', '--repo', c.upstream, '--base', c.base, '--head', `${c.account}:${branch}`, '--title', title, '--body-file', bodyFile]);
	const url = created.stdout.trim().split('\n').filter(Boolean).pop();
	const v = JSON.parse(ghAs(token, ['pr', 'view', url, '--repo', c.upstream, '--json', 'number,url,state,baseRefName,headRefName,title']).stdout);
	const ok = v.state === 'OPEN' && v.baseRefName === c.base && v.headRefName === branch;
	await appendLedger(slug, { type: ok ? 'wiki-pr' : 'wiki-pr-unverified', at: now(), study: slug, url: v.url, number: v.number, state: v.state, commit });
	await updateStudy(slug, s => {
		s.wiki_pr = { ...(s.wiki_pr ?? {}), state: v.state.toLowerCase(), url: v.url, number: v.number, title: v.title, commit, opened_at: now() };
		addHistory(s, `research wiki pull request opened: ${v.url}`);
	});
	// One note with the link on the study's issue (the report and the issue body show it too). The pull request itself
	// notifies the wiki's owner; nothing else is sent.
	let issueNote = null;
	const num = loadStudy(slug).github?.issue?.number;
	if (num) {
		try {
			comment(num, `Contributed this study back to the team's research wiki: ${v.url} (one pull request with the final readout, its source page, and updates to the related pages).`);
			issueNote = 'posted';
			await updateStudy(slug, s => {
				s.wiki_pr.issue_note_at = now();
			});
		} catch (e) {
			issueNote = `failed: ${e.message.slice(0, 200)}`;
		}
	}
	out({ ok, url: v.url, number: v.number, state: v.state, base: v.baseRefName, head: v.headRefName, commit, issue_note: issueNote }, ok ? 0 : 5);
}

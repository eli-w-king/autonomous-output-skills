// GitHub for the loop: the per-study issue in the private repo, steering comments, and publishing state.
// gh runs as the account that owns the private repo (GITHUB_LOOP_USER), with its token passed in the environment of
// each call only; the token is never printed or written. The loop's own comments carry LOOP_MARKER so they are never
// mistaken for instructions, even though they are posted as one of the allowed accounts.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, requireConfig } from './config.mjs';

export const LOOP_REPO = CONFIG.repo;
export const LOOP_USER = CONFIG.githubUser;
export const ALLOWED_AUTHORS = CONFIG.steeringUsers;
export const LOOP_MARKER = '<!-- research-loop -->';
export const PRIVATE_CLONE = CONFIG.privateClone;

let cachedToken = null;
function token() {
	if (process.env.RESEARCH_LOOP_GH_TOKEN) {
		return process.env.RESEARCH_LOOP_GH_TOKEN;
	}
	requireConfig('repo', 'githubUser');
	cachedToken ??= execFileSync('gh', ['auth', 'token', '--hostname', 'github.com', '--user', LOOP_USER], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '' } }).trim();
	return cachedToken;
}

export function gh(args, { input } = {}) {
	const env = { ...process.env, GH_TOKEN: token(), GH_PROMPT_DISABLED: '1' };
	const r = spawnSync('gh', args, { encoding: 'utf8', env, input, maxBuffer: 32 * 1024 * 1024 });
	if (r.status !== 0) {
		throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
	}
	return r.stdout;
}

export function ghJson(args, opts) {
	const out = gh(args, opts);
	return out.trim() ? JSON.parse(out) : null;
}

export function createIssue(title, body, labels = []) {
	const url = gh(['issue', 'create', '--repo', LOOP_REPO, '--title', title, '--body-file', '-', ...labels.flatMap(l => ['--label', l])], { input: `${body}\n\n${LOOP_MARKER}` }).trim();
	return { url, number: Number(url.split('/').pop()) };
}

export function updateIssueBody(number, body) {
	gh(['issue', 'edit', String(number), '--repo', LOOP_REPO, '--body-file', '-'], { input: `${body}\n\n${LOOP_MARKER}` });
}

export function updateIssueTitle(number, title) {
	gh(['issue', 'edit', String(number), '--repo', LOOP_REPO, '--title', title]);
}

/** Comments after `since` (ISO), oldest first, with author and whether they count as instructions. */
export function issueComments(number, since) {
	const q = since ? `?since=${encodeURIComponent(since)}&per_page=100` : '?per_page=100';
	const list = ghJson(['api', `repos/${LOOP_REPO}/issues/${number}/comments${q}`]) ?? [];
	return list.map(c => ({
		id: c.id,
		author: c.user?.login ?? '',
		at: c.created_at,
		updated: c.updated_at,
		body: c.body ?? '',
		url: c.html_url,
		fromLoop: (c.body ?? '').includes(LOOP_MARKER),
		allowed: ALLOWED_AUTHORS.includes((c.user?.login ?? '').toLowerCase()),
	})).filter(c => !since || c.at > since || c.updated > since);
}

export function comment(number, body) {
	return ghJson(['api', '-X', 'POST', `repos/${LOOP_REPO}/issues/${number}/comments`, '-F', 'body=@-'], { input: `${body}\n\n${LOOP_MARKER}` });
}

function git(args, cwd = PRIVATE_CLONE) {
	const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GH_TOKEN: '' } });
	if (r.status !== 0) {
		throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).slice(0, 400)}`);
	}
	return r.stdout;
}

/**
 * Drop any local change under one path of the clone: staged, modified or untracked. Only the loop writes a study's
 * folder there, copying it from its local study folder on every run, so leftovers from a publish that failed (or a run
 * that died between copying and committing) are safe to drop, and must be: they would make every later pull refuse.
 */
function discardLocal(rel) {
	if (!git(['status', '--porcelain', '--', rel]).trim()) {
		return false;
	}
	git(['reset', '--quiet', '--', rel]);
	if (git(['ls-files', '--', rel]).trim()) {
		git(['checkout', '--quiet', '--', rel]);
	}
	git(['clean', '-fdq', '--', rel]);
	return true;
}

/** Run the repository's validator with the first Python found (python, then python3, then py). */
function runValidator() {
	for (const py of ['python', 'python3', 'py']) {
		const r = spawnSync(py, ['tools/validate-skills.py'], { cwd: PRIVATE_CLONE, encoding: 'utf8' });
		if (r.error?.code !== 'ENOENT') {
			return r;
		}
	}
	return { status: 1, stdout: '', stderr: 'no Python found to run tools/validate-skills.py (tried python, python3 and py)' };
}

/**
 * Bring the clone up to its upstream branch. Not `git pull --rebase`: pull reads FETCH_HEAD, and two fetches at once in
 * the same clone (another tool, or a person's fetch next to a scheduled run) can leave the same line in it twice, so
 * pull refuses with "Cannot rebase onto multiple branches". Fetching without writing FETCH_HEAD and rebasing onto the
 * upstream ref avoids that, and leaves FETCH_HEAD alone for anyone else.
 */
function syncWithUpstream() {
	git(['fetch', '--quiet', '--no-write-fetch-head', 'origin']);
	try {
		git(['rebase', '--quiet', '@{upstream}']);
	} catch (e) {
		spawnSync('git', ['-C', PRIVATE_CLONE, 'rebase', '--abort'], { encoding: 'utf8' });
		throw e;
	}
}

/**
 * Copy a study's shareable files into private/studies/<slug>/ of the private repo and push. Transcripts stay local
 * (Outset is their system of record); stills are copied because the report shows them.
 */
export function publishStudy(slug, studyDirPath, { message } = {}) {
	if (!existsSync(join(PRIVATE_CLONE, '.git'))) {
		throw new Error(`no clone of the private repo at ${PRIVATE_CLONE}`);
	}
	const rel = `private/studies/${slug}`;
	discardLocal(rel);
	syncWithUpstream();
	const dest = join(PRIVATE_CLONE, 'private', 'studies', slug);
	mkdirSync(dest, { recursive: true });
	const keep = /^(study\.json|ledger\.json|report\.md|retrospective\.md|success-criteria\.md|guide-r\d+(\.v\d+)?\.json|guide-review-r\d+\.md)$/;
	for (const f of readdirSync(studyDirPath)) {
		if (keep.test(f)) {
			cpSync(join(studyDirPath, f), join(dest, f));
		}
	}
	const rounds = join(studyDirPath, 'rounds');
	if (existsSync(rounds)) {
		for (const r of readdirSync(rounds)) {
			const rd = join(rounds, r);
			for (const f of readdirSync(rd)) {
				const p = join(rd, f);
				// *.local.* files stay on this machine (notes that name people, tracking ids), wherever they are.
				if (statSync(p).isFile() && /\.(json|md)$/.test(f) && !/\.local\./.test(f)) {
					mkdirSync(join(dest, 'rounds', r), { recursive: true });
					cpSync(p, join(dest, 'rounds', r, f));
				} else if (statSync(p).isDirectory() && /^arm-/.test(f)) {
					for (const g of readdirSync(p)) {
						if (/^(analysis\.(json|md)|outset\.json|scores\.json)$/.test(g)) {
							mkdirSync(join(dest, 'rounds', r, f), { recursive: true });
							cpSync(join(p, g), join(dest, 'rounds', r, f, g));
						}
					}
				}
			}
		}
	}
	// Replace the published stills wholesale, so stills the report stopped naming are removed from the repository too.
	const stills = join(studyDirPath, 'stills');
	if (existsSync(stills)) {
		rmSync(join(dest, 'stills'), { recursive: true, force: true });
		cpSync(stills, join(dest, 'stills'), { recursive: true });
	}
	git(['add', '--', rel]);
	const staged = spawnSync('git', ['-C', PRIVATE_CLONE, 'diff', '--cached', '--quiet'], { encoding: 'utf8' }).status !== 0;
	if (!staged) {
		return { pushed: false, reason: 'no changes' };
	}
	// The repository's own validator, when it has one, gates every push (secrets, file names, private terms and dashes
	// in published paths). It checks the whole tree, so it can fail on text that is not the loop's; either way nothing
	// is pushed, the clone is left clean, and the next run tries again.
	const validator = join(PRIVATE_CLONE, 'tools', 'validate-skills.py');
	const v = existsSync(validator) ? runValidator() : { status: 0 };
	if (v.status !== 0) {
		discardLocal(rel);
		throw new Error(`validate-skills.py failed; nothing pushed: ${`${v.stdout ?? ''}${v.stderr ?? ''}`.trim().split('\n').slice(-6).join(' | ')}`);
	}
	git(['commit', '--quiet', '-m', message ?? `Research loop: ${slug} state`, '-m', 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>']);
	for (let i = 0; i < 3; i++) {
		try {
			syncWithUpstream();
			git(['push', '--quiet', 'origin', 'HEAD:main']);
			return { pushed: true, commit: git(['rev-parse', '--short', 'HEAD']).trim() };
		} catch (e) {
			if (i === 2) {
				throw e;
			}
		}
	}
	return { pushed: false };
}



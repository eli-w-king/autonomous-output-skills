// Contributing a finished study back to the team's research wiki: ONE pull request per study, from the owner's fork,
// prepared in a separate contribution clone so the clone the loop reads stays exactly as `git pull` leaves it. What it
// may touch follows the wiki's own ingest workflow (its AGENTS.md): one raw report and one source page added; concept,
// entity and synthesis pages, the index, the log and the overview updated. Nothing is deleted or renamed, no existing
// raw file changes, a changed page only gains text, and the added text carries no emails, tracking ids, phone numbers or
// names. checkContribution is pure (changes and text in, problems out), so it is tested without a network.
import { spawnSync } from 'node:child_process';

export const branchFor = slug => `research-loop/${slug}`;

const ADD_ONE = ['raw/reports/', 'wiki/sources/'];
const MAY_ADD = ['wiki/concepts/', 'wiki/entities/'];
const MAY_CHANGE = [
	/^wiki\/(concepts|entities|syntheses)\/[^/]+\.md$/,
	/^wiki\/(Wiki Index|Wiki Log|index|log|Research Overview|overview)\.md$/,
];
// Frontmatter fields an update rewrites by design.
const FRONTMATTER_CHURN = /^(updated|sources):\s/;

export const PATTERNS = Object.freeze({
	email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
	tracking: /\bpp_[a-z0-9]{6,}\b/i,
	phone: /(?<![\w/.-])(?:\+?\d{1,2}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\w/.-])/,
	dash: /[\u2013\u2014]/,
});

const inDir = (path, dir) => path.startsWith(dir) && !path.slice(dir.length).includes('/');
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A minimal frontmatter reader: top-level "key: value" lines only (lists are ignored), quotes stripped. */
export function frontmatter(text) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
	if (!m) {
		return null;
	}
	const out = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
		if (kv) {
			out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
		}
	}
	return out;
}

/** Emails, tracking ids, phone numbers, the given names, and (in text written for the contribution) em or en dashes. */
export function scanText(lines, { denyTerms = [], dashes = true } = {}) {
	const deny = denyTerms.filter(t => String(t).trim()).map(t => new RegExp(`(?<![\\w])${escape(String(t).trim())}(?![\\w])`, 'i'));
	const problems = [];
	for (const { at, text, own = true } of lines) {
		if (PATTERNS.email.test(text)) {
			problems.push(`an email address in ${at}`);
		}
		if (PATTERNS.tracking.test(text)) {
			problems.push(`a recruiting tracking id in ${at}`);
		}
		if (PATTERNS.phone.test(text)) {
			problems.push(`a phone number in ${at}`);
		}
		for (const r of deny) {
			if (r.test(text)) {
				problems.push(`a name that must not appear ("${text.match(r)[0]}") in ${at}`);
			}
		}
		if (dashes && own && PATTERNS.dash.test(text)) {
			problems.push(`an em or en dash in ${at}`);
		}
	}
	return problems;
}

/**
 * Problems with a study's contribution, or [] when it may be opened.
 *   changes: [{ status: 'A'|'M'|'D'|'R'|'C'|..., path, from? }] from git's name-status with renames detected
 *   diffs:   { [path]: { added: [line], removed: [line] } } for every changed (M) file
 *   files:   { [path]: text } for every added (A) file
 *   denyTerms: words the added text must never contain (people's names)
 */
export function checkContribution({ changes, diffs = {}, files = {}, denyTerms = [] }) {
	const problems = [];
	const added = Object.fromEntries(ADD_ONE.map(d => [d, []]));
	for (const c of changes) {
		const p = c.path;
		if (!/^[\x20-\x7E]+$/.test(p)) {
			problems.push(`a file name that is not plain ASCII: ${p}`);
		}
		if (c.status === 'D') {
			problems.push(`deletes ${p}`);
		} else if (c.status === 'R' || c.status === 'C') {
			problems.push(`${c.status === 'R' ? 'renames' : 'copies'} ${c.from ?? '(unknown)'} to ${p}`);
		} else if (c.status === 'A') {
			const one = ADD_ONE.find(d => inDir(p, d));
			if (one && p.endsWith('.md')) {
				added[one].push(p);
			} else if (!(MAY_ADD.some(d => inDir(p, d)) && p.endsWith('.md'))) {
				problems.push(`adds ${p}, outside what an ingest adds (one raw report, one source page, new concept or entity pages)`);
			}
		} else if (c.status === 'M') {
			if (p.startsWith('raw/')) {
				problems.push(`changes an existing raw file: ${p}`);
			} else if (!MAY_CHANGE.some(r => r.test(p))) {
				problems.push(`changes ${p}, which an ingest does not touch`);
			}
		} else {
			problems.push(`an unexpected change (${c.status}) to ${p}`);
		}
	}
	for (const [dir, list] of Object.entries(added)) {
		if (list.length !== 1) {
			problems.push(`adds ${list.length} files under ${dir} (exactly one expected)`);
		}
	}
	// Nothing deleted inside a page either: every removed line must come back inside an added line of the same file (its
	// text extended, not taken away), apart from the frontmatter fields an update rewrites.
	for (const [p, d] of Object.entries(diffs)) {
		for (const line of d.removed) {
			const t = line.trim();
			if (t && !FRONTMATTER_CHURN.test(t) && !d.added.some(a => a.includes(t))) {
				problems.push(`removes text from ${p}: "${t.slice(0, 80)}"`);
			}
		}
	}
	// The text this contribution adds. A line that extends an existing one is checked only for what it adds, so names,
	// numbers and punctuation already in the wiki (a paper's author, the wiki's own dashes) never count against it.
	const lines = [];
	for (const [p, text] of Object.entries(files)) {
		String(text).split('\n').forEach((l, i) => lines.push({ at: `${p}:${i + 1}`, text: l }));
	}
	for (const [p, d] of Object.entries(diffs)) {
		for (const l of d.added) {
			const kept = d.removed.map(r => r.trim()).filter(Boolean).sort((a, b) => b.length - a.length).find(r => l.includes(r));
			lines.push({ at: p, text: kept ? l.replace(kept, ' ') : l });
		}
	}
	problems.push(...scanText(lines, { denyTerms }));
	// The two new files' frontmatter, as the wiki's own pages have it.
	const raw = added['raw/reports/'][0];
	if (raw && files[raw] != null) {
		const fm = frontmatter(files[raw]);
		if (!fm) {
			problems.push(`${raw} has no frontmatter`);
		} else {
			if (!fm.title) {
				problems.push(`${raw} has no title`);
			}
			if (fm.confidentiality !== 'internal') {
				problems.push(`${raw} must say confidentiality: internal`);
			}
			if (fm.author) {
				problems.push(`${raw} names an author; leave author empty`);
			}
		}
	}
	const src = added['wiki/sources/'][0];
	if (src && files[src] != null) {
		const fm = frontmatter(files[src]);
		if (!fm) {
			problems.push(`${src} has no frontmatter`);
		} else {
			if (fm.type !== 'source') {
				problems.push(`${src} must say type: source`);
			}
			if (fm.confidentiality !== 'internal') {
				problems.push(`${src} must say confidentiality: internal`);
			}
			if (String(fm.sources) !== '1') {
				problems.push(`${src} must say sources: 1`);
			}
			for (const k of ['title', 'created', 'updated']) {
				if (!fm[k]) {
					problems.push(`${src} has no ${k}`);
				}
			}
		}
	}
	return [...new Set(problems)];
}

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

export function gitIn(dir, args, { allowFail = false } = {}) {
	const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: GIT_ENV, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
	if (r.status !== 0 && !allowFail) {
		throw new Error(`git ${args.slice(0, 3).join(' ')}: ${`${r.stderr ?? ''}${r.stdout ?? ''}`.trim().slice(0, 400)}`);
	}
	return r;
}

/** Git's -z name-status output as [{ status, path, from? }]. */
export function parseNameStatusZ(out) {
	const t = String(out).split('\0');
	const changes = [];
	for (let i = 0; i < t.length && t[i];) {
		const status = t[i][0];
		if (status === 'R' || status === 'C') {
			changes.push({ status, from: t[i + 1], path: t[i + 2] });
			i += 3;
		} else {
			changes.push({ status, path: t[i + 1] });
			i += 2;
		}
	}
	return changes;
}

/** Everything staged in a contribution clone against a base commit, in the shape checkContribution takes. */
export function collectChanges(dir, base) {
	const changes = parseNameStatusZ(gitIn(dir, ['-c', 'core.quotepath=off', 'diff', '--cached', '--name-status', '-M', '-z', base]).stdout);
	const diffs = {};
	const files = {};
	for (const c of changes) {
		if (c.status === 'M') {
			const d = gitIn(dir, ['diff', '--cached', '-U0', '--no-color', base, '--', c.path]).stdout.split('\n');
			diffs[c.path] = {
				added: d.filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)),
				removed: d.filter(l => l.startsWith('-') && !l.startsWith('---')).map(l => l.slice(1)),
			};
		} else if (c.status === 'A') {
			files[c.path] = gitIn(dir, ['show', `:${c.path}`]).stdout;
		}
	}
	return { changes, diffs, files };
}

/** The account's GitHub CLI token, for one call's environment only; never printed or stored. */
export function accountToken(account) {
	const r = spawnSync('gh', ['auth', 'token', '--hostname', 'github.com', '--user', account], { encoding: 'utf8' });
	const t = r.status === 0 ? r.stdout.trim() : '';
	if (!t) {
		throw new Error(`the GitHub CLI has no sign-in for ${account} (gh auth login --hostname github.com)`);
	}
	return t;
}

export function ghAs(token, args, { allowFail = false } = {}) {
	const r = spawnSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' }, timeout: 120_000 });
	if (r.status !== 0 && !allowFail) {
		throw new Error(`gh ${args.slice(0, 3).join(' ')}: ${`${r.stderr ?? ''}${r.stdout ?? ''}`.trim().slice(0, 400)}`);
	}
	return r;
}

/** The account's fork of the upstream repository ("owner/name"), or null. */
export function forkOf(token, account, upstream) {
	const name = upstream.split('/')[1];
	const r = ghAs(token, ['api', `repos/${account}/${name}`, '--jq', '{full_name, fork, parent: .parent.full_name}'], { allowFail: true });
	if (r.status !== 0) {
		return null;
	}
	const j = JSON.parse(r.stdout);
	return j.fork && String(j.parent).toLowerCase() === upstream.toLowerCase() ? j.full_name : null;
}

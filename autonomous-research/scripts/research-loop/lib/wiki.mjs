// Keeping the prior research current. At the start of every new study and before each redesign, the run pulls the
// research wiki's clone (read only; exactly `git -C <clone> pull`, nothing added to its configuration) and lists the
// wiki pages that changed since the study last refreshed its prior findings, so the run reads only what is new and
// updates the topic's prior findings from it.
import { spawnSync } from 'node:child_process';

const git = (clone, args) => spawnSync('git', ['-C', clone, ...args], {
	encoding: 'utf8',
	timeout: 180_000,
	// Unattended: never wait on a prompt. The clone's own credential helper does the signing in.
	env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
});

export function pullWiki(clone) {
	const r = git(clone, ['pull']);
	return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-3).join(' | ') };
}

export function headOf(clone) {
	const r = git(clone, ['rev-parse', 'HEAD']);
	return r.status === 0 ? r.stdout.trim() : null;
}

/** The last commit at or before a time, to start from when a study has never refreshed. */
export function commitAt(clone, iso) {
	const r = git(clone, ['rev-list', '-1', `--before=${iso}`, 'HEAD']);
	return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** Wiki pages added, changed or removed between two commits: [{ status: 'A'|'M'|'D'|'R', path }]. */
export function changedPages(clone, from, to = 'HEAD', dir = 'wiki/') {
	if (!from) {
		return [];
	}
	const r = git(clone, ['diff', '--name-status', `${from}..${to}`, '--', dir]);
	if (r.status !== 0) {
		throw new Error(`git diff failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
	}
	return parseNameStatus(r.stdout);
}

export function parseNameStatus(text) {
	return String(text).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
		const parts = l.split('\t');
		return { status: parts[0][0], path: parts.at(-1) };
	});
}

/** A page's link: the configured base URL plus the path, with spaces and other characters encoded. */
export const pageLink = (baseUrl, path) => (baseUrl ? `${baseUrl}${path.split('/').map(encodeURIComponent).join('/')}` : path);

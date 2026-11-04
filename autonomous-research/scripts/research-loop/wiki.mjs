// Refresh the prior research (lib/wiki.mjs) at the start of every new study and before each redesign.
//   node wiki.mjs refresh --study <slug> [--since <ISO time>]
//        pulls the wiki's clone and prints the pages changed since the study's last refresh (or since <time>, or since
//        the study was created), with links. Read each one and update the topic's prior findings.
//   node wiki.mjs mark --study <slug> [--publish <file in the loop home's private/research-loop/>]
//        records the refresh (the wiki commit and the time) in study.json; with --publish, also pushes the updated
//        prior findings file to the private repository's private/research-loop/.
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { loadStudy, updateStudy, addHistory } from './lib/state.mjs';
import { CONFIG } from './lib/config.mjs';
import { pullWiki, headOf, commitAt, changedPages, pageLink } from './lib/wiki.mjs';
import { publishPrivateFile } from './lib/github.mjs';

const [cmd, ...args] = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const slug = opt('study');
const clone = CONFIG.priorResearch.clone;
if (!slug || !['refresh', 'mark'].includes(cmd)) {
	console.error('usage: wiki.mjs refresh|mark --study <slug> (see the header)');
	process.exit(2);
}
if (!clone || !existsSync(join(clone, '.git'))) {
	console.error(`no clone of the prior research at ${clone ?? '(prior_research.clone is not set in loop.config.json)'}`);
	process.exit(1);
}
const study = loadStudy(slug);

if (cmd === 'refresh') {
	const pull = pullWiki(clone);
	const head = headOf(clone);
	const since = opt('since') ?? study.prior_research_refresh?.at ?? study.created_at;
	const from = study.prior_research_refresh?.commit ?? (since ? commitAt(clone, since) : null);
	const pages = from ? changedPages(clone, from, head) : [];
	console.log(JSON.stringify({
		pulled: pull.ok, pull_output: pull.out, head, from, since,
		last_refresh: study.prior_research_refresh ?? null,
		changed: pages.map(p => ({ ...p, link: pageLink(CONFIG.priorResearch.baseUrl, p.path) })),
		next: pages.length ? 'Read each changed page, update the topic\'s prior findings, then run wiki.mjs mark.' : 'Nothing changed in the wiki since the last refresh. Run wiki.mjs mark.',
	}, null, 1));
	process.exit(pull.ok ? 0 : 1);
} else {
	const head = headOf(clone);
	let published = null;
	const file = opt('publish');
	if (file) {
		const local = join(CONFIG.home, 'private', 'research-loop', basename(file));
		published = publishPrivateFile(local, `private/research-loop/${basename(file)}`, { message: `Research loop: refresh ${basename(file)} from the research wiki at ${head?.slice(0, 7)}` });
	}
	await updateStudy(slug, s => {
		s.prior_research_refresh = { commit: head, at: new Date().toISOString(), ...(file ? { file: basename(file) } : {}) };
		addHistory(s, `prior research refreshed from the wiki at ${head?.slice(0, 7)}${file ? `; ${basename(file)} updated` : ''}`);
	});
	console.log(JSON.stringify({ recorded: true, commit: head, published }, null, 1));
}

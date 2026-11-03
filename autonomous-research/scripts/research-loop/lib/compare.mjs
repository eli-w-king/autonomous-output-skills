// The "how this compares" section: each finding of a round's analysis set against the prior research the study is
// compared with (loop.config.json prior_research), as confirms, contradicts, extends or new, with links to the pages.
// Shared by the report and the morning summary. Analyses carry, per finding,
// compare: { relation, pages: [<path in the prior research repository>], note }, plus an arm-level compare_summary.
import { CONFIG } from './config.mjs';

export const compareTitle = () => `How this compares to ${CONFIG.priorResearch.label}`;

export const priorLink = path => (CONFIG.priorResearch.baseUrl
	? `${CONFIG.priorResearch.baseUrl}${String(path).split('/').map(encodeURIComponent).join('/')}`
	: null);

const pageName = path => String(path).split('/').pop().replace(/\.md$/i, '');

/** analyses: [{ label, analysis }]; returns markdown lines (empty when nothing is synthesized yet). */
export function compareLines(analyses, { maxPages = 3 } = {}) {
	const lines = [];
	for (const { label, analysis } of analyses) {
		const compared = (analysis?.findings ?? []).filter(f => f.compare?.relation);
		if (!analysis?.compare_summary && !compared.length) {
			continue;
		}
		lines.push(`- ${label}${analysis.compare_summary ? `: ${analysis.compare_summary}` : ''}`);
		for (const f of compared) {
			const c = f.compare;
			const pages = (c.pages ?? []).slice(0, maxPages).map(p => {
				const url = priorLink(p);
				return url ? `[${pageName(p)}](${url})` : pageName(p);
			});
			lines.push(`  - ${f.claim}: **${c.relation}**${c.note ? `. ${c.note}` : ''}${pages.length ? ` (${pages.join(', ')})` : ''}`);
		}
	}
	return lines;
}

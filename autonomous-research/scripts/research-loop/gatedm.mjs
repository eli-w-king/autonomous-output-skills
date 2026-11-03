#!/usr/bin/env node
// The one DM per round when a round's Outset study stops at an admin's approval to publish (lib/gatedm.mjs). The agent
// sends it with its chat tool; this script says when one is due, prints the exact text, and records the claim and the
// send in study.json, so a round never gets two.
//   node gatedm.mjs due [--study <slug>]     JSON per active study: status due, check, sent or none (text and channel when due or check)
//   node gatedm.mjs text --study <slug> [--round <n>]
//   node gatedm.mjs claim --study <slug> --round <n> [--by <run label>]    exit 0: send it now; exit 3: claimed or sent already
//   node gatedm.mjs sent --study <slug> --round <n> [--permalink <link>] [--ts "<message ts>"] [--at <ISO time>] [--by <who>]
//   node gatedm.mjs release --study <slug> --round <n> --reason <why>       only after the channel shows no such message
import { listStudies, loadStudy, loadLedger } from './lib/state.mjs';
import { CONFIG } from './lib/config.mjs';
import { gateDmStatus, gateDmText, claimGateDm, recordGateDmSent, releaseGateDm } from './lib/gatedm.mjs';

const [cmd, ...args] = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const need = n => {
	const v = opt(n);
	if (v === undefined) {
		console.error(`--${n} is required`);
		process.exit(2);
	}
	return v;
};
const DONE = new Set(['done', 'stopped', 'handed-to-owner']);
const print = x => console.log(JSON.stringify(x, null, 1));

try {
	if (cmd === 'due') {
		const out = [];
		for (const slug of listStudies().filter(x => !opt('study') || x === opt('study'))) {
			const s = loadStudy(slug);
			if (DONE.has(s.status)) {
				continue;
			}
			const ledger = loadLedger(slug);
			const st = gateDmStatus(s, ledger);
			const act = st.status === 'due' || st.status === 'check';
			out.push({
				study: slug,
				...st,
				...(act ? { channel: CONFIG.gateDm.channel, text: gateDmText(s, ledger, st.round) } : {}),
				...(act && !CONFIG.gateDm.channel ? { error: 'no gate_dm.channel in loop.config.json: do not send; the gate still shows in the summary, report and issue' } : {}),
			});
		}
		print(out);
	} else if (cmd === 'text') {
		const slug = need('study');
		const s = loadStudy(slug);
		console.log(gateDmText(s, loadLedger(slug), opt('round') ?? s.rounds?.at(-1)?.n));
	} else if (cmd === 'claim') {
		const r = await claimGateDm(need('study'), need('round'), { by: opt('by') ?? 'unknown' });
		print(r);
		process.exit(r.claimed ? 0 : 3);
	} else if (cmd === 'sent') {
		// A chat link carries the message's exact timestamp (Slack: .../p<10 digits><6 digits>); prefer it, because a shell
		// may turn an unquoted --ts into a number and drop digits (PowerShell does).
		const permalink = opt('permalink') ?? null;
		const m = /\/p(\d{10})(\d{6})(?:\D|$)/.exec(permalink ?? '');
		const ts = m ? `${m[1]}.${m[2]}` : (opt('ts') ?? null);
		const r = await recordGateDmSent(need('study'), need('round'), { ts, permalink, at: opt('at') ?? new Date().toISOString(), by: opt('by') ?? 'unknown' });
		print(r);
		process.exit(r.recorded ? 0 : 3);
	} else if (cmd === 'release') {
		const r = await releaseGateDm(need('study'), need('round'), { reason: need('reason') });
		print(r);
		process.exit(r.released ? 0 : 3);
	} else {
		console.error('usage: gatedm.mjs due|text|claim|sent|release (see the header)');
		process.exit(2);
	}
} catch (e) {
	console.error(e.message);
	process.exit(1);
}

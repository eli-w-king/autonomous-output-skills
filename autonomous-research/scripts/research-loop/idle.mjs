// Is there anything to research? (lib/idle.mjs) Reads local files only: no browser, no platform API.
//   node idle.mjs check       {"idle", "active", "confirming", "request_due", "message", "main_chat"}; when the loop is busy
//                             again it forgets an earlier request, so the next quiet period asks again
//   node idle.mjs requested   record that the request to turn the schedule off was sent (it is sent once)
import { listStudies, loadStudy, loadLedger } from './lib/state.mjs';
import { CONFIG } from './lib/config.mjs';
import { activity, loadIdle, saveIdle, idleFileExists, disableRequest, ENDED } from './lib/idle.mjs';

const cmd = process.argv[2];
const studies = listStudies().map(slug => ({ slug, study: loadStudy(slug), ledger: loadLedger(slug) }));
const act = activity(studies);
const state = loadIdle();
if (cmd === 'check') {
	if (!act.idle && idleFileExists() && (state.idle_since || state.disable_requested_at)) {
		saveIdle({ busy_since: new Date().toISOString() });
	} else if (act.idle && !state.idle_since) {
		saveIdle({ ...state, idle_since: new Date().toISOString() });
	}
	const ended = studies.filter(x => ENDED.has(x.study.status)).map(x => x.slug);
	const due = act.idle && !state.disable_requested_at;
	console.log(JSON.stringify({ ...act, request_due: due, ...(due ? { message: disableRequest(CONFIG.schedule, ended), main_chat: CONFIG.mainChat } : {}) }, null, 1));
} else if (cmd === 'requested') {
	saveIdle({ ...loadIdle(), disable_requested_at: new Date().toISOString() });
	console.log(JSON.stringify({ recorded: true }));
} else {
	console.error('usage: idle.mjs check|requested');
	process.exit(2);
}

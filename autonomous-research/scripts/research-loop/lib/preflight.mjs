// The participant-side check that stands in for a test interview, run right before a study's recruiting launches:
//   1. the participant link opens the study's welcome page in a fresh headless browser (not "Study closed", not an
//      error page), and
//   2. every question that shows an image serves exactly the file uploaded for it (downloaded and compared by
//      sha256), as an image the browser can load.
// It never clicks anything, so no interview starts. In case loading the page alone creates an interview record, the
// study's interview ids before and after are compared, and any new one is returned so the caller can exclude it.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadPlaywright } from './ui-browser.mjs';
import { chromePath } from './ui-chrome.mjs';
import { loadStudy, studyDir, findArm } from './state.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function pngSize(buf) {
	if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
		return null;
	}
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function interviewIds(everyday, studyId) {
	for (const args of [{ study_id: studyId, limit: 100 }, { study_id: studyId, interview_types: ['USER'], limit: 100 }]) {
		try {
			const r = JSON.parse(await everyday.call('list_interviews', args));
			const list = r.interviews ?? r.results ?? (Array.isArray(r) ? r : []);
			return new Set(list.map(i => i.id));
		} catch { /* try the narrower call */ }
	}
	return null;
}

/** Load the participant link headless and read what a participant would see first. Never clicks. */
export async function checkWelcomePage(startUrl, { welcomeText, shotPath, timeoutMs = 60_000 } = {}) {
	const { chromium } = loadPlaywright();
	const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
	try {
		// A plain desktop user agent: a "HeadlessChrome" one can get a different page than participants get.
		const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
		const ctx = await browser.newContext({ userAgent, viewport: { width: 1440, height: 900 } });
		const page = await ctx.newPage();
		const res = await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
		const read = () => page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
		let text = '';
		for (const until = Date.now() + 30_000; Date.now() < until;) {
			await page.waitForTimeout(1500);
			text = await read();
			if (/study closed|no longer accepting|something went wrong|an error occurred/i.test(text) || text.trim().length > 80) {
				break;
			}
		}
		await page.waitForTimeout(2500);
		text = (await read()) || text;
		const buttons = (await page.getByRole('button').allInnerTexts().catch(() => [])).map(b => b.trim()).filter(Boolean);
		if (shotPath) {
			mkdirSync(dirname(shotPath), { recursive: true });
			await page.screenshot({ path: shotPath }).catch(() => { });
		}
		const closed = /study closed|no longer accepting responses/i.test(text);
		const error = /something went wrong|an error occurred/i.test(text);
		const unsupported = /(browser|device) (is )?not supported|unsupported browser/i.test(text);
		const snippet = norm(welcomeText).split(/(?<=[.!?]) /)[0].slice(0, 60);
		const welcome = snippet.length > 10 && norm(text).includes(snippet);
		const startButton = buttons.some(b => /start|begin|continue|get started|next|agree|let'?s go/i.test(b));
		return {
			ok: !closed && !error && !unsupported && (welcome || startButton),
			http: res?.status() ?? null, url: page.url(), closed, error, unsupported, welcome, startButton,
			buttons: buttons.slice(0, 6), excerpt: text.replace(/\s+/g, ' ').slice(0, 240),
		};
	} finally {
		await browser.close();
	}
}

/**
 * Every question with an expected image serves that exact file. questions: { <question key>: <question id> };
 * expected: { <question key>: { file, sha256 } } (the arm's outset.json stimuli).
 */
export async function checkStimuli(everyday, studyId, { questions, expected }) {
	const bank = JSON.parse(await everyday.call('list_stimuli', { survey_id: studyId }));
	const usedBy = s => (typeof s.used_by === 'string' ? JSON.parse(s.used_by) : s.used_by ?? []);
	const wanted = new Set(Object.keys(expected).map(k => questions[k]).filter(Boolean));
	const bound = (bank.stimuli ?? []).filter(s => usedBy(s).some(u => wanted.has(u.id)));
	const files = [];
	const problems = [];
	for (const s of bound) {
		try {
			const res = await fetch(s.file_url, { signal: AbortSignal.timeout(60_000) });
			const buf = Buffer.from(await res.arrayBuffer());
			const type = res.headers.get('content-type') ?? '';
			const size = pngSize(buf);
			const ok = res.status === 200 && /^image\//.test(type) && buf.length > 10_000 && (!/png/.test(type) || Boolean(size));
			files.push({ filename: s.filename, status: res.status, type, bytes: buf.length, ...size, sha256: createHash('sha256').update(buf).digest('hex'), ok, question_ids: usedBy(s).map(u => u.id), questions: usedBy(s).map(u => u.label) });
			if (!ok) {
				problems.push(`image ${s.filename} did not load (HTTP ${res.status}, ${type || 'no type'}, ${buf.length} bytes)`);
			}
		} catch (e) {
			problems.push(`image ${s.filename} could not be fetched (${e.message})`);
		}
	}
	for (const [key, exp] of Object.entries(expected)) {
		const qid = questions[key];
		if (!files.some(f => f.ok && f.question_ids.includes(qid) && f.sha256 === exp.sha256)) {
			problems.push(`question ${key} does not serve ${exp.file}`);
		}
	}
	return { ok: problems.length === 0, questions_checked: Object.keys(expected).length, files: files.map(({ question_ids, ...f }) => f), problems };
}

export async function participantPreflight({ everyday, studyId, startUrl, welcomeText, questions, expected, shotPath }) {
	const at = new Date().toISOString();
	const before = await interviewIds(everyday, studyId);
	const once = () => checkWelcomePage(startUrl, { welcomeText, shotPath }).catch(e => ({ ok: false, error: true, excerpt: `could not load the page: ${e.message}` }));
	let page = await once();
	if (!page.ok && !page.closed) {
		await sleep(20_000); // one retry for a slow or flaky load; "Study closed" is a clear answer and is not retried
		page = await once();
	}
	const after = await interviewIds(everyday, studyId);
	const created = before && after ? [...after].filter(id => !before.has(id)) : [];
	const images = await checkStimuli(everyday, studyId, { questions, expected });
	const problems = [];
	if (!page.ok) {
		problems.push(page.closed ? 'the participant link shows "Study closed"'
			: page.unsupported ? 'the participant link says the browser is not supported'
				: page.error ? `the participant link shows an error (${page.excerpt.slice(0, 120)})`
					: 'the participant link shows neither the welcome message nor a start button');
	}
	problems.push(...images.problems);
	return { ok: problems.length === 0, at, start_url: startUrl, page, images, created_interviews: created, problems };
}

/** The check for one arm of a study round, from its saved ids; writes preflight.json and preflight.png beside them. */
export async function preflightArm(slug, roundN, armName, everyday) {
	const study = loadStudy(slug);
	const { round, arm } = findArm(study, roundN, armName);
	const dir = join(studyDir(slug), 'rounds', `r${roundN}`, `arm-${armName}`);
	const outset = JSON.parse(readFileSync(join(dir, 'outset.json'), 'utf8'));
	const guide = JSON.parse(readFileSync(join(studyDir(slug), round.guide ?? `guide-r${roundN}.json`), 'utf8'));
	const expected = Object.fromEntries(Object.entries(outset.stimuli ?? {}).map(([k, v]) => [k, { file: v.file, sha256: v.sha256 }]));
	const result = await participantPreflight({
		everyday,
		studyId: arm.outset.study_id,
		startUrl: arm.outset.start_url ?? outset.start_url ?? `https://outset.ai/start/${arm.outset.study_id}`,
		welcomeText: guide.welcome_message ?? '',
		questions: outset.questions ?? {},
		expected,
		shotPath: join(dir, 'preflight.png'),
	});
	writeFileSync(join(dir, 'preflight.json'), JSON.stringify(result, null, 1));
	return result;
}

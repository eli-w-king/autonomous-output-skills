// Read a User Interviews project's launch readiness without launching: step status icons and the launch panel's errors.
//   node ui-readiness.mjs <projectId> [shot]
import { ensureUiBrowser } from './lib/ui-chrome.mjs';

const [pid, shot] = process.argv.slice(2);
const { page } = await ensureUiBrowser();
await page.goto(`https://www.userinterviews.com/projects/${pid}/research-design/recruitment`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const text = await page.evaluate(() => document.body.innerText);
const errs = /Can't launch project([\s\S]*?)Incentive amount/.exec(text)?.[1]?.trim() ?? '';
// Step tabs: an svg check (or a class) marks a finished step.
const steps = await page.$$eval('a[href*="/research-design/"]', as => as.map(a => ({ step: a.innerText.trim(), done: !!a.querySelector('svg[class*="check" i], [data-testid*="check" i], [aria-label*="complete" i]') || /check/i.test(a.innerHTML) })));
console.log(JSON.stringify({ pid, launchErrors: errs || 'none', steps }, null, 1));
if (shot) { await page.screenshot({ path: shot }); }
process.exit(0);


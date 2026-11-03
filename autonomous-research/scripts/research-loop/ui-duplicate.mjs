#!/usr/bin/env node
// Duplicate a User Interviews project from the dashboard (the app's own Duplicate flow), as a draft.
//   node ui-duplicate.mjs --source <projectId> --title "<internal title>" --description "<internal description>"
// Prints the new project id. Creating a draft costs nothing; launching is launch.mjs's job.
import { ensureUiBrowser, uiSignedIn } from './lib/ui-chrome.mjs';
import { jsClick } from './lib/ui-browser.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const source = opt('source'), title = opt('title'), description = opt('description') ?? '';
if (!source || !title) {
	console.error('usage: ui-duplicate.mjs --source <projectId> --title <title> [--description <text>]');
	process.exit(2);
}
const { page } = await ensureUiBrowser();
if (!(await uiSignedIn(page))) {
	console.error('User Interviews needs a sign-in; the loop never types a password');
	process.exit(4);
}
await page.goto('https://www.userinterviews.com/researcher', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
const card = page.locator(`a[href="/projects/${source}"]`).first().locator('xpath=ancestor::*[.//button[normalize-space()="Duplicate"]][1]');
if (!(await card.count())) {
	console.error(`project ${source} is not on the dashboard`);
	process.exit(1);
}
await jsClick(card.getByRole('button', { name: 'Duplicate' }));
for (let i = 0; i < 20 && !/\/researcher\/start\?sourceProjectId=/.test(page.url()); i++) {
	await page.waitForTimeout(500);
}
const dialog = page.getByRole('dialog').filter({ hasText: 'Create a new project' });
await dialog.locator('input[type="text"], input:not([type])').first().fill(title);
await dialog.locator('textarea').first().fill(description);
await jsClick(dialog.getByRole('button', { name: 'Create project' }));
for (let i = 0; i < 40 && !/\/projects\/\d+\//.test(page.url()); i++) {
	await page.waitForTimeout(1000);
}
const id = /\/projects\/(\d+)\//.exec(page.url())?.[1];
if (!id) {
	console.error(`no new project after Create project (at ${page.url()})`);
	process.exit(1);
}
console.log(id);
process.exit(0);

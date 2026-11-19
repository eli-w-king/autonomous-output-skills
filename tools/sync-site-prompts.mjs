#!/usr/bin/env node
// Pins the workshop site's prompts for the tests, word for word, in tools/fixtures/site-prompts.json: every
// ```text label="Prompt ..."``` block in the site's module pages (content/pages/modules/*.md), and the setup page's
// Computer Use try-its ("On a Mac" and "On Windows"). tools/test-ai-first-setup.mjs checks that each prompt in
// autonomous-setup/ai-first/resources/prompts.md is one of them, that the setup canvas's try-its are the site's, and,
// with AI_FIRST_SITE set to the site's checkout, that this copy still matches the site. Rerun it when they change.
//
//   node tools/sync-site-prompts.mjs --site <the site's checkout> [--check]
//
// --check changes nothing and exits 1 when the pinned copy differs from the site.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE = path.join(REPO, 'tools', 'fixtures', 'site-prompts.json');

export function sitePrompts(site) {
	const dir = path.join(site, 'content', 'pages', 'modules');
	const prompts = [];
	for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort()) {
		const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
		for (const m of text.matchAll(/```text label="(Prompt [^"]+)"\n([\s\S]*?)\n```/g)) {
			prompts.push({ file, label: m[1], text: m[2] });
		}
	}
	return prompts;
}

// The setup page's Computer Use try-its, by computer.
export function siteTryIts(site) {
	const text = fs.readFileSync(path.join(site, 'content', 'pages', 'modules', 'setup.md'), 'utf8').replace(/\r\n/g, '\n');
	const block = (label) => (new RegExp('```text label="' + label + '"\\n([\\s\\S]*?)\\n```').exec(text) || [])[1] || null;
	return { mac: block('On a Mac'), win: block('On Windows') };
}

export function fixtureText(prompts, computerUse) {
	return JSON.stringify({ source: 'https://github.com/eli-w-king/ai-first-design-workshop, content/pages/modules', prompts, computerUse }, null, 1) + '\n';
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
	const args = process.argv.slice(2);
	const at = args.indexOf('--site');
	if (at < 0 || !args[at + 1]) {
		console.error('Usage: node tools/sync-site-prompts.mjs --site <the site\'s checkout> [--check]');
		process.exit(2);
	}
	const site = path.resolve(args[at + 1].replace(/^~(?=$|[\\/])/, os.homedir()));
	const want = fixtureText(sitePrompts(site), siteTryIts(site));
	const have = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : '';
	if (args.includes('--check')) {
		console.log(want === have ? 'the pinned prompts match the site' : 'the site\'s prompts changed: run this without --check');
		process.exit(want === have ? 0 : 1);
	}
	fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
	fs.writeFileSync(FIXTURE, want);
	console.log(`${JSON.parse(want).prompts.length} prompts pinned in ${path.relative(REPO, FIXTURE)}`);
}

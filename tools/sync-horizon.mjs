#!/usr/bin/env node
// Copies the Horizon visual kit's runtime into the setup canvas, verbatim. Rerun it whenever the kit changes, and
// never edit the copies by hand: the canvas themes the kit only through its --hz-* variables (web/welcome.css,
// web/flow.css).
//
//   node tools/sync-horizon.mjs --from <the kit's folder> [--check]
//
// Copied unchanged into plugins/workshop-setup/extensions/setup-checklist/web/horizon/:
//   horizon.css, horizon.js, and the font licenses in fonts/.
// Not copied: the woff2 fonts, because this repo publishes text only. The sync writes their names, sizes and
// SHA-256 to web/horizon-fonts.json, and autonomous-setup/scripts/ai-first.mjs (canvas) downloads them next to the
// copy from the workshop site, checking each one. Without them the canvas uses the system's faces. The kit's README,
// demos and tools aren't copied either: they name the event and local paths, which never go in this repo.
//
// --check changes nothing and exits 1 when the copy differs from the kit.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(REPO, 'plugins', 'workshop-setup', 'extensions', 'setup-checklist', 'web');
const TARGET = path.join(WEB, 'horizon');
const MANIFEST = path.join(WEB, 'horizon-fonts.json');

const args = process.argv.slice(2);
const at = args.indexOf('--from');
const check = args.includes('--check');
if (at < 0 || !args[at + 1]) {
	console.error('Usage: node tools/sync-horizon.mjs --from <the kit\'s folder> [--check]');
	process.exit(2);
}
const from = path.resolve(args[at + 1].replace(/^~(?=$|[\\/])/, os.homedir()));
if (!fs.existsSync(path.join(from, 'horizon.js')) || !fs.existsSync(path.join(from, 'horizon.css'))) {
	console.error(`No horizon.js and horizon.css in ${from}`);
	process.exit(1);
}

const fontsDir = path.join(from, 'fonts');
const fonts = fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir).sort() : [];
const wanted = ['horizon.css', 'horizon.js', ...fonts.filter((name) => /\.txt$/i.test(name)).map((name) => `fonts/${name}`)];
const versionMatch = /Horizon kit ([0-9.]+)/.exec(fs.readFileSync(path.join(from, 'horizon.js'), 'utf8'));
const manifest = {
	kit: versionMatch ? versionMatch[1] : null,
	note: 'Written by tools/sync-horizon.mjs. The woff2 fonts the kit\'s horizon.css loads, fetched next to it by ai-first.mjs canvas.',
	fonts: fonts.filter((name) => /\.woff2$/i.test(name)).map((name) => {
		const data = fs.readFileSync(path.join(fontsDir, name));
		return { name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
	}),
};
const manifestText = JSON.stringify(manifest, null, 1) + '\n';

const differs = wanted.filter((rel) => {
	const target = path.join(TARGET, rel);
	return !fs.existsSync(target) || !fs.readFileSync(target).equals(fs.readFileSync(path.join(from, rel)));
});
const present = [];
const walk = (dir, rel = '') => {
	for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
		const name = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			walk(path.join(dir, entry.name), name);
		} else if (!/\.woff2$/i.test(entry.name)) {
			present.push(name);
		}
	}
};
walk(TARGET);
const extra = present.filter((rel) => !wanted.includes(rel));
const manifestDiffers = !fs.existsSync(MANIFEST) || fs.readFileSync(MANIFEST, 'utf8') !== manifestText;

if (check) {
	const out = [...differs, ...extra.map((rel) => `${rel} (not in the kit)`), ...(manifestDiffers ? ['horizon-fonts.json'] : [])];
	console.log(out.length ? `out of date: ${out.join(', ')}` : `the canvas copy matches kit ${manifest.kit}`);
	process.exit(out.length ? 1 : 0);
}
for (const rel of differs) {
	fs.mkdirSync(path.dirname(path.join(TARGET, rel)), { recursive: true });
	fs.copyFileSync(path.join(from, rel), path.join(TARGET, rel));
}
for (const rel of extra) {
	fs.rmSync(path.join(TARGET, rel), { force: true });
}
if (manifestDiffers) {
	fs.writeFileSync(MANIFEST, manifestText);
}
const changes = [...differs, ...(extra.length ? [`removed ${extra.join(', ')}`] : []), ...(manifestDiffers ? ['horizon-fonts.json'] : [])];
console.log(changes.length ? `kit ${manifest.kit}: ${changes.join(', ')}` : `already current with kit ${manifest.kit}`);

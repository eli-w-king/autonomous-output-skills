#!/usr/bin/env node
// Probe both Outset connections. Prints tool counts and whether each can launch; never prints tokens.
//   node probe-outset.mjs [--dump <dir>]   also writes the tool schemas to <dir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { outsetEveryday, outsetLaunchConnection, LAUNCH_TOOLS } from './lib/outset.mjs';

const dumpAt = process.argv.indexOf('--dump');
const dumpDir = dumpAt > 0 ? process.argv[dumpAt + 1] : null;
let ok = true;

const everyday = await outsetEveryday();
const eTools = await everyday.listTools();
const eLaunch = eTools.filter(t => LAUNCH_TOOLS.has(t.name)).map(t => t.name);
const workspaces = await everyday.json('list_workspaces').catch(e => ({ error: e.message }));
console.log(`everyday: ${eTools.length} tools; launch tools: ${eLaunch.join(', ') || 'none (as intended)'}`);
console.log(`everyday: workspaces ${Array.isArray(workspaces?.workspaces) ? workspaces.workspaces.length : JSON.stringify(workspaces).slice(0, 120)}`);
if (eLaunch.length) {
	ok = false;
	console.log('PROBLEM: the everyday connection can launch; re-authorize it without studies:launch');
}

const launch = await outsetLaunchConnection();
const lTools = await launch.listTools();
const missing = [...LAUNCH_TOOLS].filter(n => !lTools.some(t => t.name === n));
console.log(`launch:   ${lTools.length} tools; has ${[...LAUNCH_TOOLS].filter(n => !missing.includes(n)).join(', ') || 'none'}; scope includes studies:launch: ${/studies:launch/.test(launch.scope)}`);
if (missing.length) {
	ok = false;
	console.log(`PROBLEM: the launch connection lacks ${missing.join(', ')}`);
}

if (dumpDir) {
	mkdirSync(dumpDir, { recursive: true });
	writeFileSync(join(dumpDir, 'outset-tools-everyday.json'), JSON.stringify(eTools, null, 1));
	writeFileSync(join(dumpDir, 'outset-tools-launch.json'), JSON.stringify(lTools.filter(t => LAUNCH_TOOLS.has(t.name)), null, 1));
	console.log(`schemas written to ${dumpDir}`);
}
process.exit(ok ? 0 : 1);

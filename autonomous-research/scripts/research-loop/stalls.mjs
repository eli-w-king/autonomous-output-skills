#!/usr/bin/env node
// List agent sessions on this machine that have waited more than 10 minutes for an approval (see lib/stalls.mjs), and
// save the result for the morning summary. Exit 1 when there is a stall.
//   node stalls.mjs [--older-than <minutes>] [--window <hours>]
import { recordStalls } from './lib/stalls.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : undefined; };
const r = recordStalls({ olderThanMin: opt('older-than') ?? 10, windowHours: opt('window') ?? 72 });
console.log(JSON.stringify(r, null, 1));
process.exit(r.stalls.length ? 1 : 0);

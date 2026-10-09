#!/usr/bin/env node
// Stop a Code OSS instance this run started, and nothing else. Verifies that the main-process
// inspector port belongs to the expected pid, asks Electron to exit (`app.exit(0)` skips quit
// prompts that wait on running agents), waits, and only then falls back to SIGTERM and SIGKILL on
// that same pid. Never use name-based kills.
//
// Usage: node stop-demo-oss.mjs --pid <main pid> [--inspect <main inspector port>] [--wait 15000]
//        node stop-demo-oss.mjs --run ~/.demo-runs/<name>      (reads pid and port from launch.json)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// EPERM means the process exists but belongs to someone else: alive, and never ours to stop.
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

let pid = Number(arg('pid', 0));
let inspectPort = Number(arg('inspect', 0));
const run = arg('run');
if (run) {
	const receipt = JSON.parse(fs.readFileSync(path.join(run.replace(/^~/, os.homedir()), 'launch.json'), 'utf8'));
	pid = pid || receipt.pid;
	inspectPort = inspectPort || receipt.inspectPort;
}
if (!pid) {
	console.error('usage: node stop-demo-oss.mjs --pid <main pid> [--inspect <port>] | --run <run dir>');
	process.exit(2);
}
const waitMs = Number(arg('wait', '15000'));

async function exitViaInspector() {
	const response = await fetch(`http://127.0.0.1:${inspectPort}/json/list`, { signal: AbortSignal.timeout(2000) });
	const url = (await response.json()).find(t => t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
	if (!url) {
		throw new Error('no inspector target');
	}
	const socket = new WebSocket(url);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', () => reject(new Error('inspector socket error')), { once: true });
	});
	const call = (id, expression) => new Promise(resolve => {
		const onMessage = event => {
			const message = JSON.parse(String(event.data));
			if (message.id === id) {
				socket.removeEventListener('message', onMessage);
				resolve(message.result?.result?.value);
			}
		};
		socket.addEventListener('message', onMessage);
		socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, includeCommandLineAPI: true, returnByValue: true } }));
	});
	const owner = await call(1, 'process.pid');
	if (owner !== pid) {
		socket.close();
		throw new Error(`inspector port ${inspectPort} belongs to pid ${owner}, not ${pid}; refusing`);
	}
	socket.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: "(() => { const { app } = require('electron'); setTimeout(() => app.exit(0), 50); return 'exiting'; })()", includeCommandLineAPI: true } }));
	await sleep(200);
	socket.close();
}

if (!alive(pid)) {
	console.log(JSON.stringify({ pid, stopped: true, how: 'already gone' }));
	process.exit(0);
}
let how = 'app.exit';
if (inspectPort) {
	try {
		await exitViaInspector();
	} catch (error) {
		if (/refusing/.test(error.message)) {
			console.error(error.message);
			process.exit(1);
		}
		how = 'SIGTERM';
	}
} else {
	how = 'SIGTERM';
}
if (how === 'SIGTERM') {
	try { process.kill(pid, 'SIGTERM'); } catch { }
}
const deadline = Date.now() + waitMs;
while (alive(pid) && Date.now() < deadline) {
	await sleep(250);
}
if (alive(pid)) {
	try { process.kill(pid, 'SIGKILL'); } catch { }
	how += ' then SIGKILL';
	await sleep(500);
}
console.log(JSON.stringify({ pid, stopped: !alive(pid), how }));
process.exit(alive(pid) ? 1 : 0);

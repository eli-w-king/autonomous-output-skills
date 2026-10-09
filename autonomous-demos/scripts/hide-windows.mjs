#!/usr/bin/env node
// Hide (or restore) every window of a running Code OSS instance through its MAIN-process Node
// inspector, so a demo can be driven and recorded over CDP without ever touching the user's screen.
//
//   invisible  opacity 0, never focusable, ignores the mouse, dock icon hidden. CDP still renders,
//              screenshots, and screencasts it. Default for video recording.
//   offscreen  parked past the right edge of the right-most display, never focusable, ignores the
//              mouse. Use when you need real window pixels (for example `screencapture -l`).
//   show       undo either mode: restore focus behavior, opacity, mouse input, center the window,
//              and show it. Use when the user wants to try or live-demo the same instance.
//
// Works with instances started by `launch-demo-oss.mjs` (which calls this automatically) and with
// the vscode repo `launch` skill (pass its main inspector port). Only patches the process behind the
// given port, so other agents' windows are never affected.
//
// Usage: node hide-windows.mjs --inspect <mainInspectorPort> [--pid <expected main pid>]
//                              [--mode invisible|offscreen|show] [--size 1440x900] [--timeout 30000]
// Pass --pid whenever you know it (the launch skill prints it): the patch is refused if the port
// belongs to any other process.

const PATCH = (mode, width, height) => `(() => {
	const { app, BrowserWindow, screen } = require('electron');
	const mode = ${JSON.stringify(mode)};
	const size = [${width}, ${height}];
	const remember = w => {
		if (!w.__demoOriginal) {
			w.__demoOriginal = { show: w.show, focus: w.focus, moveTop: w.moveTop };
		}
	};
	const hide = w => {
		remember(w);
		try { w.setFocusable(false); } catch { }
		try { w.setIgnoreMouseEvents(true); } catch { }
		try { w.webContents.setBackgroundThrottling(false); } catch { }
		w.show = () => w.showInactive();
		w.focus = () => { };
		w.moveTop = () => { };
		try { w.setContentSize(size[0], size[1]); } catch { }
		if (mode === 'invisible') {
			try { w.setOpacity(0); } catch { }
		} else {
			const right = Math.max(...screen.getAllDisplays().map(d => d.bounds.x + d.bounds.width));
			try { w.setOpacity(1); } catch { }
			try { w.setPosition(right - 40, 40); } catch { }
		}
	};
	const show = w => {
		if (w.__demoOriginal) {
			w.show = w.__demoOriginal.show;
			w.focus = w.__demoOriginal.focus;
			w.moveTop = w.__demoOriginal.moveTop;
			delete w.__demoOriginal;
		}
		try { w.setOpacity(1); } catch { }
		try { w.setIgnoreMouseEvents(false); } catch { }
		try { w.setFocusable(true); } catch { }
		try { w.center(); } catch { }
		try { w.show(); } catch { }
	};
	if (app.__demoListener) {
		app.off('browser-window-created', app.__demoListener);
		delete app.__demoListener;
	}
	if (mode === 'show') {
		if (app.__demoOriginalFocus) { app.focus = app.__demoOriginalFocus; delete app.__demoOriginalFocus; }
		try { app.dock?.show(); } catch { }
		BrowserWindow.getAllWindows().forEach(show);
		return 'shown ' + BrowserWindow.getAllWindows().length;
	}
	if (!app.__demoOriginalFocus) { app.__demoOriginalFocus = app.focus; }
	app.focus = () => { };
	try { app.dock?.hide(); } catch { }
	app.__demoListener = (_event, w) => hide(w);
	app.on('browser-window-created', app.__demoListener);
	BrowserWindow.getAllWindows().forEach(hide);
	return 'patched ' + mode + ' ' + BrowserWindow.getAllWindows().length;
})()`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function inspectorUrl(inspectPort, deadline) {
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${inspectPort}/json/list`, { signal: AbortSignal.timeout(1000) });
			const targets = await response.json();
			const url = targets.find(t => t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
			if (url) {
				return url;
			}
		} catch { }
		await sleep(25);
	}
	throw new Error(`no Node inspector answered on port ${inspectPort}`);
}

/** Applies the patch, retrying until Electron's modules resolve (they do once startup runs). */
export async function patchWindows({ inspectPort, mode = 'invisible', width = 1440, height = 900, timeout = 30000, expectPid }) {
	if (!['invisible', 'offscreen', 'show'].includes(mode)) {
		throw new Error(`unknown mode ${mode}`);
	}
	const deadline = Date.now() + timeout;
	const url = await inspectorUrl(inspectPort, deadline);
	const socket = new WebSocket(url);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', () => reject(new Error('inspector socket error')), { once: true });
	});
	let id = 0;
	const evaluate = (expression = PATCH(mode, width, height)) => new Promise(resolve => {
		const callId = ++id;
		const onMessage = event => {
			const message = JSON.parse(String(event.data));
			if (message.id === callId) {
				socket.removeEventListener('message', onMessage);
				resolve(message);
			}
		};
		socket.addEventListener('message', onMessage);
		socket.send(JSON.stringify({ id: callId, method: 'Runtime.evaluate', params: { expression, includeCommandLineAPI: true, returnByValue: true } }));
	});
	try {
		if (expectPid) {
			// Never patch a process we did not start: the port must belong to the expected pid.
			const pid = (await evaluate('process.pid')).result?.result?.value;
			if (pid !== expectPid) {
				throw new Error(`inspector port ${inspectPort} belongs to pid ${pid}, not ${expectPid}; refusing to patch`);
			}
		}
		while (Date.now() < deadline) {
			const message = await evaluate();
			const value = message.result?.result?.value;
			if (typeof value === 'string' && /^(patched|shown)/.test(value)) {
				return { value, attempts: id };
			}
			await sleep(25);
		}
		throw new Error(`patch did not apply within ${timeout} ms`);
	} finally {
		socket.close();
	}
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('hide-windows.mjs');
if (isMain) {
	const argv = process.argv.slice(2);
	const arg = (name, fallback) => {
		const index = argv.indexOf(`--${name}`);
		return index >= 0 ? argv[index + 1] : fallback;
	};
	const inspectPort = Number(arg('inspect'));
	if (!inspectPort) {
		console.error('usage: node hide-windows.mjs --inspect <mainInspectorPort> [--mode invisible|offscreen|show] [--size 1440x900]');
		process.exit(2);
	}
	const [width, height] = String(arg('size', '1440x900')).split('x').map(Number);
	patchWindows({ inspectPort, mode: arg('mode', 'invisible'), width, height, timeout: Number(arg('timeout', '30000')), expectPid: arg('pid') ? Number(arg('pid')) : undefined })
		.then(result => console.log(JSON.stringify(result)))
		.catch(error => { console.error(String(error?.message ?? error)); process.exit(1); });
}

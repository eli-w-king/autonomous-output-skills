// Full-window CDP capture loop. Captures a COMPOSITED window (including native
// browser-view overlays) from a Code OSS / Electron / Chrome page target and writes
// JPEG frames + a manifest.json with real per-frame timestamps.
//
// WHY captureScreenshot and not startScreencast:
//   Page.startScreencast only streams the page's own layer, so for the VS Code
//   Agents window it captures ONLY the embedded browser preview's webContents, not
//   the whole three-pane window. Page.captureScreenshot with fromSurface:true
//   composites native overlays into every frame, which is what we want.
//
// Requires the `ws` module. Run with NODE_PATH pointing at a node_modules that has it,
// e.g. from a vscode checkout:  NODE_PATH="$REPO/node_modules" node caploop.js ...
//
// Usage: node caploop.js <cdpPort> <outDir> <seconds> [fps=12] [scale=2] [targetUrlSubstr=vscode-file]
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const cdpPort = process.argv[2];
const outDir = process.argv[3];
const seconds = parseFloat(process.argv[4] || '20');
const fps = parseFloat(process.argv[5] || '12');
const scale = parseFloat(process.argv[6] || '2');
const targetUrlSubstr = process.argv[7] || 'vscode-file';
const intervalMs = 1000 / fps;

fs.mkdirSync(outDir, { recursive: true });
const manifest = [];
let idx = 0, id = 0;
const pending = {};

function getTargets() {
	return new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port: cdpPort, path: '/json' }, res => {
			let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
		}).on('error', reject);
	});
}

(async () => {
	const targets = await getTargets();
	const tgt = targets.find(t => t.type === 'page' && (t.url || '').includes(targetUrlSubstr));
	if (!tgt) { console.error('no page target matching', targetUrlSubstr); process.exit(1); }
	const ws = new WebSocket(tgt.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
	function send(method, params) {
		return new Promise(resolve => { const mid = ++id; pending[mid] = resolve; ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
	}
	ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; } });
	ws.on('error', e => { console.error('ws error', e.message); process.exit(1); });

	await new Promise(r => ws.on('open', r));
	await send('Page.enable');
	const metrics = await send('Runtime.evaluate', { expression: 'JSON.stringify({w:window.innerWidth,h:window.innerHeight})', returnByValue: true });
	const { w, h } = JSON.parse(metrics.result.value);
	console.error('RECORDING ' + w + 'x' + h + ' scale' + scale + ' (device ' + (w * scale) + 'x' + (h * scale) + ')');
	const start = Date.now();
	let stopped = false;
	async function stop() {
		if (stopped) return; stopped = true;
		fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ fps, scale, frames: manifest }));
		console.error('STOPPED frames=' + manifest.length);
		try { ws.close(); } catch (e) {}
		process.exit(0);
	}
	process.on('SIGTERM', stop); process.on('SIGINT', stop);

	while (!stopped && (Date.now() - start) < seconds * 1000) {
		const tick = Date.now();
		const res = await send('Page.captureScreenshot', {
			format: 'jpeg', quality: 92, fromSurface: true, captureBeyondViewport: false,
			clip: { x: 0, y: 0, width: w, height: h, scale }
		});
		if (res && res.data) {
			const t = Date.now() - start;
			const file = 'f' + String(idx).padStart(6, '0') + '.jpg';
			fs.writeFileSync(path.join(outDir, file), Buffer.from(res.data, 'base64'));
			manifest.push({ file, t }); idx++;
		}
		const elapsed = Date.now() - tick;
		if (elapsed < intervalMs) { await new Promise(r => setTimeout(r, intervalMs - elapsed)); }
	}
	await stop();
})();

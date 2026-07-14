// Dispatch key presses to a SPECIFIC CDP page target (selected by URL substring).
// Use this to drive content inside an embedded browser preview (a separate
// webContents/target) that @playwright/cli cannot reliably reach because it snaps
// to the focused tab. Example: navigate a slide deck rendered in the Agents-window
// browser preview while caploop.js records the whole workbench window.
//
// Requires the `ws` module (set NODE_PATH to a node_modules that has it).
//
// Usage: node presskeys.js <cdpPort> <urlSubstr> <key> <count> <delayMs>
//   key one of: ArrowRight ArrowLeft ArrowUp ArrowDown Enter Space PageDown PageUp
const http = require('http');
const WebSocket = require('ws');
const [, , cdpPort, urlSub, key, countS, delayS] = process.argv;
const count = parseInt(countS || '1', 10);
const delay = parseInt(delayS || '600', 10);

const keyMap = {
	ArrowRight: { windowsVirtualKeyCode: 39, code: 'ArrowRight', key: 'ArrowRight' },
	ArrowLeft: { windowsVirtualKeyCode: 37, code: 'ArrowLeft', key: 'ArrowLeft' },
	ArrowUp: { windowsVirtualKeyCode: 38, code: 'ArrowUp', key: 'ArrowUp' },
	ArrowDown: { windowsVirtualKeyCode: 40, code: 'ArrowDown', key: 'ArrowDown' },
	Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter' },
	Space: { windowsVirtualKeyCode: 32, code: 'Space', key: ' ' },
	PageDown: { windowsVirtualKeyCode: 34, code: 'PageDown', key: 'PageDown' },
	PageUp: { windowsVirtualKeyCode: 33, code: 'PageUp', key: 'PageUp' },
};
const k = keyMap[key];
if (!k) { console.error('unsupported key', key); process.exit(2); }

function getTargets() {
	return new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port: cdpPort, path: '/json' }, res => {
			let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
		}).on('error', reject);
	});
}
(async () => {
	const targets = await getTargets();
	const tgt = targets.find(t => t.type === 'page' && (t.url || '').includes(urlSub));
	if (!tgt) { console.error('no target for', urlSub); process.exit(1); }
	const ws = new WebSocket(tgt.webSocketDebuggerUrl, { perMessageDeflate: false });
	let id = 0; const pending = {};
	function send(method, params) { return new Promise(r => { const mid = ++id; pending[mid] = r; ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }
	ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; } });
	await new Promise(r => ws.on('open', r));
	await send('Page.bringToFront').catch(() => {});
	for (let i = 0; i < count; i++) {
		await send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
		await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
		await new Promise(r => setTimeout(r, delay));
	}
	console.error('sent', count, key);
	ws.close(); process.exit(0);
})();

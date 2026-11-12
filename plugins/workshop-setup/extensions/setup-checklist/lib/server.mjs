// One small HTTP server per open canvas instance, bound to 127.0.0.1 on a port the OS picks. It serves the page,
// the current state as JSON, live updates as server-sent events, and the few things the page can change.
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SetupError } from './errors.mjs';
import { renderPage } from './page.mjs';
import { validateChoiceBody, validateEmptyBody, validateSimBody } from './validate.mjs';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const ASSETS = {
	'/app.css': ['app.css', 'text/css; charset=utf-8'],
	'/app.js': ['app.js', 'text/javascript; charset=utf-8'],
	'/intro.js': ['intro.js', 'text/javascript; charset=utf-8'],
};
const MAX_BODY = 8 * 1024;
const MAX_CLIENTS = 16;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

function headers(extra = {}) {
	return {
		'Content-Security-Policy': CSP,
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'no-referrer',
		'Cache-Control': 'no-store',
		...extra,
	};
}

function sendJson(res, code, value) {
	res.writeHead(code, headers({ 'Content-Type': 'application/json; charset=utf-8' }));
	res.end(JSON.stringify(value));
}

function sendText(res, code, text) {
	res.writeHead(code, headers({ 'Content-Type': 'text/plain; charset=utf-8' }));
	res.end(text);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				reject(new SetupError('invalid_input', 'The request is too large.'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			const text = Buffer.concat(chunks).toString('utf8').trim();
			if (!text) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(text));
			} catch {
				reject(new SetupError('invalid_input', 'The request isn\'t valid JSON.'));
			}
		});
		req.on('error', reject);
	});
}

export class CanvasInstance {
	// simulation, when given, is a Simulation (simulation.mjs): the page plays it, and its model replaces model.
	constructor({ instanceId, model, simulation = null, log = () => {} }) {
		this.instanceId = instanceId;
		this.simulation = simulation;
		this.model = simulation ? simulation.model : model;
		this.log = log;
		this.server = null;
		this.port = 0;
		this.url = null;
		this.clients = new Set();
		// The intro plays once for each server, the first time a page asks for it (and again on a simulation's replay).
		this.introPending = true;
		this.onChange = () => this.broadcast();
		this.onModel = (next) => this.setModel(next);
		this.unwatch = null;
	}

	get alive() {
		return !!this.server?.listening;
	}

	async start() {
		this.server = http.createServer((req, res) => {
			this.handle(req, res).catch((error) => {
				this.log(`setup canvas request failed: ${error.message}`, 'warning');
				if (!res.headersSent) {
					sendJson(res, 500, { error: 'Something went wrong on the canvas server.' });
				} else {
					res.destroy();
				}
			});
		});
		await new Promise((resolve, reject) => {
			this.server.once('error', reject);
			this.server.listen(0, '127.0.0.1', () => {
				this.server.off('error', reject);
				resolve();
			});
		});
		this.port = this.server.address().port;
		this.url = `http://127.0.0.1:${this.port}/`;
		this.hosts = new Set([`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`]);
		this.origins = new Set([...this.hosts].map((host) => `http://${host}`));
		this.model.on('change', this.onChange);
		if (this.simulation) {
			this.simulation.on('change', this.onChange);
			this.simulation.on('model', this.onModel);
		}
		return this;
	}

	// A simulation's replay starts over with a new model; the page and the agent's actions follow it.
	setModel(model) {
		if (model === this.model) {
			return;
		}
		this.model.off('change', this.onChange);
		if (this.unwatch) {
			this.unwatch();
			this.unwatch = null;
		}
		this.model = model;
		this.model.on('change', this.onChange);
		if (this.clients.size) {
			this.unwatch = this.model.watch();
		}
		this.broadcast();
	}

	viewPayload() {
		const view = this.model.view({ intro: { play: this.introPending } });
		view.welcome = { show: this.model.welcomePending() };
		if (this.simulation) {
			view.simulation = this.simulation.info();
		}
		return view;
	}

	async handle(req, res) {
		// Only answer requests addressed to this loopback port, so other sites can't reach it through DNS tricks.
		if (!this.hosts.has(String(req.headers.host || ''))) {
			sendText(res, 403, 'Forbidden');
			return;
		}
		const url = new URL(req.url || '/', this.url);
		if (req.method === 'GET' || req.method === 'HEAD') {
			if (url.pathname === '/') {
				res.writeHead(200, headers({ 'Content-Type': 'text/html; charset=utf-8' }));
				res.end(req.method === 'HEAD' ? undefined : renderPage({ title: 'Workshop setup' }));
				return;
			}
			if (ASSETS[url.pathname]) {
				const [file, type] = ASSETS[url.pathname];
				const body = await fsp.readFile(path.join(WEB_DIR, file));
				res.writeHead(200, headers({ 'Content-Type': type }));
				res.end(req.method === 'HEAD' ? undefined : body);
				return;
			}
			if (url.pathname === '/api/state') {
				sendJson(res, 200, this.viewPayload());
				return;
			}
			if (url.pathname === '/api/events') {
				this.openStream(req, res);
				return;
			}
			sendText(res, 404, 'Not found');
			return;
		}
		if (req.method !== 'POST') {
			res.writeHead(405, headers({ Allow: 'GET, HEAD, POST' }));
			res.end();
			return;
		}
		const origin = req.headers.origin;
		const site = req.headers['sec-fetch-site'];
		if ((origin && !this.origins.has(origin)) || (site && site !== 'same-origin')) {
			sendText(res, 403, 'Forbidden');
			return;
		}
		if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
			sendJson(res, 415, { error: 'Send JSON.' });
			return;
		}
		try {
			const body = await readBody(req);
			if (url.pathname === '/api/check') {
				validateEmptyBody(body, 'Refresh');
				this.model.refresh().catch(() => {});
				sendJson(res, 202, { ok: true });
				return;
			}
			if (url.pathname === '/api/sim' && this.simulation) {
				const { action } = validateSimBody(body);
				if (action === 'start') {
					this.simulation.start();
				} else if (action === 'pause') {
					this.simulation.pause();
				} else if (action === 'play') {
					this.simulation.resume();
				} else {
					await this.simulation.replay();
					this.introPending = true;
					this.broadcast();
				}
				sendJson(res, 200, { ok: true, simulation: this.simulation.info() });
				return;
			}
			if (url.pathname === '/api/choice') {
				const choice = validateChoiceBody(body);
				await this.model.setChoice(choice);
				sendJson(res, 200, { ok: true });
				return;
			}
			if (url.pathname === '/api/intro') {
				validateEmptyBody(body, 'The intro');
				this.introPending = false;
				sendJson(res, 200, { ok: true });
				return;
			}
			if (url.pathname === '/api/welcome') {
				validateEmptyBody(body, 'The welcome');
				await this.model.markWelcomed();
				sendJson(res, 200, { ok: true });
				return;
			}
			sendText(res, 404, 'Not found');
		} catch (error) {
			if (error instanceof SetupError) {
				sendJson(res, error.code === 'invalid_input' ? 400 : 500, { error: error.message });
				return;
			}
			throw error;
		}
	}

	openStream(req, res) {
		if (this.clients.size >= MAX_CLIENTS) {
			sendText(res, 503, 'Too many open pages');
			return;
		}
		res.writeHead(200, headers({ 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }));
		res.write('retry: 2000\n\n');
		this.clients.add(res);
		if (this.clients.size === 1) {
			this.unwatch = this.model.watch();
		}
		this.send(res);
		const ping = setInterval(() => res.write(': ping\n\n'), 25000);
		req.on('close', () => {
			clearInterval(ping);
			this.clients.delete(res);
			if (!this.clients.size && this.unwatch) {
				this.unwatch();
				this.unwatch = null;
			}
		});
	}

	send(res) {
		res.write(`event: state\ndata: ${JSON.stringify(this.viewPayload())}\n\n`);
	}

	broadcast() {
		for (const res of this.clients) {
			this.send(res);
		}
	}

	async stop({ keepSimulation = false } = {}) {
		this.model.off('change', this.onChange);
		if (this.simulation) {
			this.simulation.off('change', this.onChange);
			this.simulation.off('model', this.onModel);
			if (!keepSimulation) {
				this.simulation.dispose();
			}
		}
		if (this.unwatch) {
			this.unwatch();
			this.unwatch = null;
		}
		for (const res of this.clients) {
			res.end();
		}
		this.clients.clear();
		if (this.server) {
			const server = this.server;
			this.server = null;
			await new Promise((resolve) => server.close(() => resolve()));
			server.closeAllConnections?.();
		}
	}
}

// Keeps one instance per instanceId. Opening an id again reuses its live server, or replaces it if it stopped or if
// it switches between the real checklist and a simulation.
export class CanvasHub {
	constructor({ model, log = () => {} }) {
		this.model = model;
		this.log = log;
		this.instances = new Map();
	}

	async open(instanceId, { simulation = null } = {}) {
		let instance = this.instances.get(instanceId);
		if (!instance || !instance.alive || instance.simulation !== simulation) {
			if (instance) {
				await instance.stop({ keepSimulation: !!simulation && instance.simulation === simulation }).catch(() => {});
			}
			instance = await new CanvasInstance({ instanceId, model: this.model, simulation, log: this.log }).start();
			this.instances.set(instanceId, instance);
		}
		return instance;
	}

	get(instanceId) {
		return this.instances.get(instanceId) || null;
	}

	// The model an instance shows: a simulation's own, or the real one.
	modelFor(instanceId) {
		return this.instances.get(instanceId)?.model || this.model;
	}

	async close(instanceId) {
		const instance = this.instances.get(instanceId);
		if (instance) {
			this.instances.delete(instanceId);
			await instance.stop();
		}
	}

	async closeAll() {
		await Promise.all([...this.instances.keys()].map((id) => this.close(id)));
	}
}

// Outset clients for the research loop. Two OAuth connections, never mixed:
//   everyday  OUTSET_OAUTH_CLIENT_ID + OUTSET_REFRESH_TOKEN          everything except launching
//   launch    OUTSET_LAUNCH_CLIENT_ID + OUTSET_LAUNCH_REFRESH_TOKEN  publish_study, unpublish_study and
//             launch_recruitment only, and only from launch.mjs after the budget check
// Tokens are never printed. Refresh tokens rotate on every use; rotation is serialized and persisted by env.mjs.
//
// Outset facts encoded here (see the gotchas in autonomous-research's references/platforms.md):
//   - MCP replies arrive as SSE frames; parse the last `data:` frame.
//   - Tool errors come back as text with isError, not as JSON-RPC errors; treat both as failures.
//   - REST wants `Authorization: Api-Key <key>` and a trailing slash on every path.
import { loadEnv, sharedAccessToken } from './env.mjs';

const TOKEN_URL = 'https://api.outset.ai/users/oauth/token/';
const DEFAULT_MCP_URL = 'https://api.outset.ai/mcp';

export const CONNECTIONS = {
	everyday: { clientIdKey: 'OUTSET_OAUTH_CLIENT_ID', tokenKey: 'OUTSET_REFRESH_TOKEN' },
	launch: { clientIdKey: 'OUTSET_LAUNCH_CLIENT_ID', tokenKey: 'OUTSET_LAUNCH_REFRESH_TOKEN' },
};
export const LAUNCH_TOOLS = new Set(['publish_study', 'unpublish_study', 'launch_recruitment']);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function refreshWith(clientId, refreshToken) {
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
	});
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return { error: `http_${res.status}`, error_description: text.slice(0, 120) };
	}
}

function parseSse(text) {
	const frames = [...text.matchAll(/^data: (\{[\s\S]*?\})\s*$/gm)];
	const payload = frames.length ? frames[frames.length - 1][1] : text;
	return JSON.parse(payload);
}

export class OutsetToolError extends Error {
	constructor(tool, text) {
		super(`${tool}: ${String(text).slice(0, 600)}`);
		this.tool = tool;
		this.text = text;
	}
}

class OutsetMcp {
	#kind; #url; #access = null; #expiresAt = 0; #sid = null; #id = 0; #ready = null;
	scope = '';

	constructor(kind, url) {
		this.#kind = kind;
		this.#url = url;
	}

	get kind() {
		return this.#kind;
	}

	async #token({ rejected = null } = {}) {
		if (rejected || !this.#access || Date.now() > this.#expiresAt - 120_000) {
			const conn = { ...CONNECTIONS[this.#kind], kind: this.#kind };
			const cached = await sharedAccessToken(conn, refreshWith, { rejected });
			this.#access = cached.access_token;
			this.#expiresAt = Date.parse(cached.expires_at);
			this.scope = cached.scope ?? '';
		}
		return this.#access;
	}

	async #post(message, { retry401 = true } = {}) {
		for (let attempt = 0; ; attempt++) {
			const headers = {
				authorization: `Bearer ${await this.#token()}`,
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
			};
			if (this.#sid) {
				headers['mcp-session-id'] = this.#sid;
			}
			const res = await fetch(this.#url, { method: 'POST', headers, body: JSON.stringify(message) });
			const sid = res.headers.get('mcp-session-id');
			if (sid) {
				this.#sid = sid;
			}
			if (res.status === 401 && retry401) {
				await this.#token({ rejected: this.#access });
				retry401 = false;
				if (message.method !== 'initialize') {
					this.#sid = null;
					this.#ready = null;
					await this.#init();
				}
				continue;
			}
			if ((res.status === 429 || res.status >= 500) && attempt < 4) {
				const wait = Number(res.headers.get('retry-after')) * 1000 || 5_000 * 2 ** attempt;
				await sleep(Math.min(wait, 120_000));
				continue;
			}
			const text = await res.text();
			if (message.id === undefined) {
				return null; // notification
			}
			if (!res.ok && !text.includes('"jsonrpc"')) {
				throw new Error(`Outset MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
			}
			return parseSse(text);
		}
	}

	async #init() {
		this.#ready ??= (async () => {
			const r = await this.#post({
				jsonrpc: '2.0', id: ++this.#id, method: 'initialize',
				params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'research-loop', version: '1' } },
			});
			if (r?.error) {
				throw new Error(`Outset MCP initialize failed: ${JSON.stringify(r.error).slice(0, 300)}`);
			}
			await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null);
			return r;
		})();
		return this.#ready;
	}

	async listTools() {
		await this.#init();
		const r = await this.#post({ jsonrpc: '2.0', id: ++this.#id, method: 'tools/list', params: {} });
		return r?.result?.tools ?? [];
	}

	/** Call a tool; returns its text. Throws OutsetToolError on a tool error. */
	async call(name, args = {}) {
		if (this.#kind === 'everyday' && LAUNCH_TOOLS.has(name)) {
			throw new Error(`${name} is a launch tool; only the guarded launcher may call it`);
		}
		if (this.#kind === 'launch' && !LAUNCH_TOOLS.has(name)) {
			throw new Error(`the launch connection is reserved for ${[...LAUNCH_TOOLS].join(', ')}; use the everyday connection for ${name}`);
		}
		await this.#init();
		const r = await this.#post({ jsonrpc: '2.0', id: ++this.#id, method: 'tools/call', params: { name, arguments: args } });
		if (r?.error) {
			throw new OutsetToolError(name, r.error.message ?? JSON.stringify(r.error));
		}
		const text = (r?.result?.content ?? []).map(c => c.text ?? '').join('\n');
		if (r?.result?.isError) {
			throw new OutsetToolError(name, text);
		}
		return text;
	}

	/** Call a tool whose result must be JSON. A non-JSON reply throws with the text, so errors never look like {}. */
	async json(name, args = {}) {
		const text = await this.call(name, args);
		try {
			return JSON.parse(text);
		} catch {
			throw new OutsetToolError(name, `expected JSON, got: ${text}`);
		}
	}
}

/** The everyday connection: authoring, analysis, harvesting, costing. Cannot launch. */
export async function outsetEveryday(env = loadEnv()) {
	return new OutsetMcp('everyday', env.OUTSET_MCP_URL || DEFAULT_MCP_URL);
}

/** The launch connection. Import it ONLY from launch.mjs, after the budget check passed and was recorded. */
export async function outsetLaunchConnection(env = loadEnv()) {
	return new OutsetMcp('launch', env.OUTSET_MCP_URL || DEFAULT_MCP_URL);
}

export async function outsetRest(path, init = {}, env = loadEnv()) {
	if (!path.endsWith('/') && !path.includes('?')) {
		throw new Error(`Outset REST paths need a trailing slash: ${path}`);
	}
	const res = await fetch(`${env.OUTSET_BASE_URL}${path}`, {
		...init,
		headers: { authorization: `Api-Key ${env.OUTSET_API_KEY}`, ...(init.headers ?? {}) },
	});
	return { status: res.status, body: await res.json().catch(() => null) };
}

export const studyUrl = (projectId, studyId, suffix = 'guide') => `https://outset.ai/project/${projectId}/survey/${studyId}/${suffix}`;
export const startUrl = studyId => `https://outset.ai/start/${studyId}`;


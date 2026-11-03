// Verified client for the UX research platforms. Import from scripts, or run
// directly for a smoke test:  node research-client.mjs
//
// Everything here was confirmed against the live APIs on 2026-07-24.
// The non-obvious facts this encodes (all discovered the hard way):
//   - Outset REST wants  Authorization: Api-Key <key>   NOT Bearer.
//   - Outset REST paths REQUIRE a trailing slash; without it you get 404,
//     which reads like "no such endpoint" and sends you down a rabbit hole.
//   - Outset MCP is separate from Outset REST: it needs an OAuth Bearer token,
//     and the API key is NOT accepted there.
//   - Marvin MCP needs BOTH scope=mcp:read AND resource=<mcp url> on the token
//     request, and its ids must be passed as STRINGS.
//   - Both MCP servers reply as SSE (`data: {...}`), not plain JSON.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sharedAccessToken } from './research-loop/lib/env.mjs';

const ENV_PATH = join(homedir(), '.copilot', 'research.env');

export function loadEnv() {
	const raw = readFileSync(ENV_PATH, 'utf8');
	return Object.fromEntries(
		[...raw.matchAll(/^([A-Z_]+)=(.+)$/gm)].map(m => [m[1], m[2].trim()])
	);
}

// Both platforms' MCP servers stream SSE. Take the last data frame.
function parseRpc(text) {
	const frames = [...text.matchAll(/^data: (\{[\s\S]*?\})\s*$/gm)];
	const payload = frames.length ? frames[frames.length - 1][1] : text;
	try {
		return JSON.parse(payload);
	} catch {
		return { parseError: text.slice(0, 300) };
	}
}

class McpClient {
	#url; #headers; #sessionId = null; #id = 0; #ready = null;

	constructor(url, headers) {
		this.#url = url;
		this.#headers = headers;
	}

	async #rpc(method, params = {}) {
		const headers = {
			...this.#headers,
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		};
		if (this.#sessionId) {
			headers['mcp-session-id'] = this.#sessionId;
		}
		const res = await fetch(this.#url, {
			method: 'POST',
			headers,
			body: JSON.stringify({ jsonrpc: '2.0', id: ++this.#id, method, params }),
		});
		const sid = res.headers.get('mcp-session-id');
		if (sid) {
			this.#sessionId = sid;
		}
		return parseRpc(await res.text());
	}

	async #init() {
		this.#ready ??= this.#rpc('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'vscode-research-automation', version: '1' },
		});
		return this.#ready;
	}

	async listTools() {
		await this.#init();
		return (await this.#rpc('tools/list'))?.result?.tools ?? [];
	}

	/** Call a tool and return its text content. Throws on tool error. */
	async call(name, args = {}) {
		await this.#init();
		const res = await this.#rpc('tools/call', { name, arguments: args });
		if (res.error) {
			throw new Error(`${name}: ${res.error.message ?? JSON.stringify(res.error)}`);
		}
		const text = res?.result?.content?.map(c => c.text).join('\n');
		if (text === undefined) {
			throw new Error(`${name}: unexpected response ${JSON.stringify(res).slice(0, 200)}`);
		}
		return text;
	}

	/** Convenience: call a tool whose text content is JSON. */
	async callJson(name, args = {}) {
		const text = await this.call(name, args);
		try {
			return JSON.parse(text);
		} catch {
			return { text };
		}
	}
}

// --- Hey Marvin -----------------------------------------------------------
// Read-only analysis repository. Current key carries mcp:read ONLY, so the
// REST import endpoints (file/survey/insight write) are unavailable until a
// broader key is minted in Settings -> MCP.

export async function marvinMcp(env = loadEnv()) {
	const body = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: env.MARVIN_CLIENT_ID,
		client_secret: env.MARVIN_CLIENT_SECRET,
		scope: 'mcp:read',
		resource: env.MARVIN_MCP_URL,
	});
	const res = await fetch(`${env.MARVIN_BASE_URL}/api/v1/oauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body,
	});
	const json = await res.json();
	if (!json.access_token) {
		throw new Error(`Marvin token failed: ${JSON.stringify(json)}`);
	}
	return new McpClient(`${env.MARVIN_MCP_URL}/`, { authorization: `Bearer ${json.access_token}` });
}

// --- Outset REST ----------------------------------------------------------

export async function outsetRest(path, env = loadEnv(), init = {}) {
	if (!path.endsWith('/') && !path.includes('?')) {
		throw new Error(`Outset REST paths need a trailing slash: ${path}`);
	}
	const res = await fetch(`${env.OUTSET_BASE_URL}${path}`, {
		...init,
		headers: { authorization: `Api-Key ${env.OUTSET_API_KEY}`, ...(init.headers ?? {}) },
	});
	return { status: res.status, body: await res.json().catch(() => null) };
}

// --- Outset MCP -----------------------------------------------------------
// Access tokens last 1h; the stored refresh token renews them silently. A refresh rotates the refresh token AND
// revokes the access token other processes hold (platforms.md, gotchas 7 and 23), so every process on this machine
// shares one access token per connection: refreshed under one lock, persisted atomically, cached user-only.

export async function outsetMcp(env = loadEnv()) {
	const refresh = async (clientId, refreshToken) => {
		const res = await fetch('https://api.outset.ai/users/oauth/token/', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
		});
		return res.json();
	};
	let json;
	try {
		json = await sharedAccessToken({ clientIdKey: 'OUTSET_OAUTH_CLIENT_ID', tokenKey: 'OUTSET_REFRESH_TOKEN', kind: 'everyday' }, refresh);
	} catch (e) {
		throw new Error(`Outset refresh failed: ${e.message}\nRe-run the device flow to reauthorize.`);
	}
	return new McpClient('https://api.outset.ai/mcp', { authorization: `Bearer ${json.access_token}` });
}

// --- Smoke test -----------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
	const env = loadEnv();

	const marvin = await marvinMcp(env);
	const mTools = await marvin.listTools();
	const projects = await marvin.callJson('list_projects');
	console.log(`Marvin  : ${mTools.length} tools, ${projects.projects?.length ?? '?'} projects`);

	const studies = await outsetRest('/v1/studies/', env);
	console.log(`Outset  : REST ${studies.status}, ${studies.body?.results?.length ?? '?'} studies`);

	const outset = await outsetMcp(env);
	const oTools = await outset.listTools();
	const org = await outset.callJson('get_organization');
	console.log(`Outset  : MCP ${oTools.length} tools, org "${org.name}"`);
	console.log(`          launch capable: ${oTools.some(t => /launch|publish/i.test(t.name))}`);
}

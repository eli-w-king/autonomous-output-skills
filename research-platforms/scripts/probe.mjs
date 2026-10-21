#!/usr/bin/env node
// Probe the research-platform APIs with whatever credentials are present in
// ~/.copilot/research.env, and report exactly what works.
//
//   node probe.mjs            # probe everything that has credentials
//   node probe.mjs marvin     # probe one platform only
//   node probe.mjs outset
//
// Secrets are read from disk and never printed. Outset publishes no public
// API docs, so its section brute-forces auth styles and candidate paths to
// discover the real surface empirically.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV_PATH = join(homedir(), '.copilot', 'research.env');

function loadEnv() {
	let raw;
	try {
		raw = readFileSync(ENV_PATH, 'utf8');
	} catch {
		console.error(`No credentials file at ${ENV_PATH}`);
		console.error(`Create it with:  cp ${ENV_PATH}.template ${ENV_PATH} && chmod 600 ${ENV_PATH}`);
		process.exit(1);
	}
	const env = {};
	for (const line of raw.split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
		if (m && m[2].trim()) {
			env[m[1]] = m[2].trim();
		}
	}
	return env;
}

const ok = s => `  \x1b[32mPASS\x1b[0m ${s}`;
const bad = s => `  \x1b[31mFAIL\x1b[0m ${s}`;
const info = s => `  \x1b[90m....\x1b[0m ${s}`;

async function tryFetch(url, opts = {}) {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), 15000);
	try {
		const res = await fetch(url, { ...opts, signal: ctl.signal });
		const text = await res.text();
		let json;
		try { json = JSON.parse(text); } catch { /* not json */ }
		return { status: res.status, text, json };
	} catch (err) {
		return { status: 0, error: err.message };
	} finally {
		clearTimeout(timer);
	}
}

// --- Hey Marvin -----------------------------------------------------------
// Documented: OAuth2 client_credentials -> 1h JWT -> REST import + MCP read.

async function marvinToken(env, scope, resource) {
	const body = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: env.MARVIN_CLIENT_ID,
		client_secret: env.MARVIN_CLIENT_SECRET,
		scope,
	});
	if (resource) {
		body.set('resource', resource);
	}
	const res = await tryFetch(`${env.MARVIN_BASE_URL}/api/v1/oauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body,
	});
	return res;
}

async function probeMarvin(env) {
	console.log('\n=== Hey Marvin ===');
	if (!env.MARVIN_CLIENT_ID || !env.MARVIN_CLIENT_SECRET) {
		console.log(info('no MARVIN_CLIENT_ID / MARVIN_CLIENT_SECRET set, skipping'));
		return;
	}

	// Which scopes does this key actually carry? Ask for each individually so
	// one rejected scope doesn't fail the whole exchange.
	const scopes = ['project:read', 'project:write', 'file:write', 'survey:write', 'insight:write'];
	const granted = [];
	for (const scope of scopes) {
		const res = await marvinToken(env, scope);
		if (res.status === 200 && res.json?.access_token) {
			granted.push(scope);
		}
	}

	const restScopes = granted.filter(s => s !== 'mcp:read');
	if (!restScopes.length) {
		console.log(ok('token exchange works'));
		console.log(info('key carries mcp:read only -> READ-ONLY.'));
		console.log(info('REST import (file/survey/insight write) unavailable.'));
		console.log(info('To enable writes, mint a broader key in Marvin Settings -> MCP.'));
	} else {
		console.log(ok(`REST scopes granted: ${restScopes.join(', ')}`));
	}

	const restRes = restScopes.length ? await marvinToken(env, restScopes.join(' ')) : null;
	if (restRes?.json?.access_token) {

		const projects = await tryFetch(`${env.MARVIN_BASE_URL}/api/v1/developer/import/projects`, {
			headers: { authorization: `Bearer ${restRes.json.access_token}` },
		});
		console.log(projects.status === 200
			? ok(`GET /import/projects -> HTTP 200`)
			: bad(`GET /import/projects -> HTTP ${projects.status}`));
	}

	// MCP is the only documented read path for transcripts/tags/highlights,
	// and it needs its own token bound to the MCP resource.
	const mcpRes = await marvinToken(env, 'mcp:read', env.MARVIN_MCP_URL);
	if (mcpRes.status !== 200 || !mcpRes.json?.access_token) {
		console.log(bad(`mcp:read token failed (HTTP ${mcpRes.status}) - MCP reads unavailable`));
		return;
	}
	console.log(ok('mcp:read token exchange'));

	const tools = await tryFetch(`${env.MARVIN_MCP_URL}/`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${mcpRes.json.access_token}`,
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
	});
	// Marvin's MCP also replies as SSE, so json is undefined; parse the frame.
	const mFrames = [...(tools.text ?? '').matchAll(/^data: (\{[\s\S]*?\})\s*$/gm)];
	let toolList;
	try { toolList = JSON.parse(mFrames.at(-1)?.[1] ?? tools.text)?.result?.tools; } catch { /* ignore */ }
	if (toolList) {
		console.log(ok(`MCP tools/list -> ${toolList.length} tool(s)`));
		for (const t of toolList) {
			console.log(info(`${t.name}: ${(t.description ?? '').slice(0, 80)}`));
		}
	} else {
		console.log(bad(`MCP tools/list -> HTTP ${tools.status} ${(tools.text ?? '').slice(0, 160)}`));
	}
}

// --- Outset.ai ------------------------------------------------------------
// Undocumented publicly. Discover the auth style, then map reachable paths.

// VERIFIED 2026-07-24: Outset uses `Api-Key`, not Bearer. Kept the rejected
// styles so a future auth change is diagnosed rather than guessed at.
const OUTSET_AUTH_STYLES = [
	['Api-Key (verified)', k => ({ authorization: `Api-Key ${k}` })],
	['Bearer token', k => ({ authorization: `Bearer ${k}` })],
	['Token', k => ({ authorization: `Token ${k}` })],
	['x-api-key', k => ({ 'x-api-key': k })],
	['Authorization raw', k => ({ authorization: k })],
];

// Trailing slash is REQUIRED; without it Outset returns 404 and looks dead.
const OUTSET_PATHS = [
	'/v1/studies/', '/v1/projects/', '/v1/interviews/',
	'/.well-known/oauth-protected-resource',
	'/.well-known/oauth-authorization-server',
];

async function probeOutset(env) {
	console.log('\n=== Outset.ai ===');
	if (!env.OUTSET_API_KEY) {
		console.log(info('no OUTSET_API_KEY set, skipping'));
		return;
	}

	const root = await tryFetch(env.OUTSET_BASE_URL);
	console.log(root.status === 200 ? ok(`API root reachable (HTTP 200)`) : bad(`API root HTTP ${root.status}`));

	// Find an auth style that changes the response versus no auth at all.
	const probePath = '/v1/studies/';
	const anon = await tryFetch(`${env.OUTSET_BASE_URL}${probePath}`);
	let authStyle = null;
	for (const [name, mk] of OUTSET_AUTH_STYLES) {
		const res = await tryFetch(`${env.OUTSET_BASE_URL}${probePath}`, { headers: mk(env.OUTSET_API_KEY) });
		const accepted = res.status !== 401 && res.status !== 403 && res.status !== anon.status;
		console.log(accepted ? ok(`auth style "${name}" -> HTTP ${res.status}`) : info(`auth style "${name}" -> HTTP ${res.status}`));
		if (accepted && !authStyle) {
			authStyle = [name, mk];
		}
	}

	if (!authStyle) {
		console.log(bad('no auth style accepted on /v1/studies; mapping paths unauthenticated for shape only'));
	}
	const mkHeaders = authStyle ? authStyle[1] : () => ({});

	console.log(info('mapping candidate paths...'));
	const found = [];
	for (const p of OUTSET_PATHS) {
		const res = await tryFetch(`${env.OUTSET_BASE_URL}${p}`, { headers: mkHeaders(env.OUTSET_API_KEY) });
		if (res.status && res.status !== 404) {
			found.push([p, res.status, (res.text ?? '').slice(0, 120).replace(/\s+/g, ' ')]);
		}
	}
	if (found.length) {
		for (const [p, status, sample] of found) {
			console.log(ok(`GET ${p} -> HTTP ${status}  ${sample}`));
		}
	} else {
		console.log(bad('no candidate path responded with anything other than 404'));
	}

	// Outset MCP is OAuth-gated and does NOT accept the REST API key.
	// Delegate to research-client.mjs: refresh tokens rotate on use, so the
	// persist-the-new-token logic must live in exactly one place.
	if (env.OUTSET_MCP_URL && env.OUTSET_REFRESH_TOKEN) {
		try {
			const { outsetMcp } = await import('./research-client.mjs');
			const mcp = await outsetMcp(env);
			const toolList = await mcp.listTools();
			console.log(ok(`MCP tools/list -> ${toolList.length} tool(s)`));
			const canLaunch = toolList.some(t => /launch|publish/i.test(t.name));
			console.log(canLaunch
				? bad('token CAN launch studies - scope is too broad')
				: ok('token cannot launch studies (studies:launch withheld)'));
		} catch (err) {
			console.log(bad(err.message.split('\n')[0]));
			console.log(info('re-authorize with: node outset-auth.mjs'));
		}
	} else {
		console.log(info('OUTSET_MCP_URL / OUTSET_REFRESH_TOKEN not set; skipping MCP probe'));
	}
}

const env = loadEnv();
const which = process.argv[2];
if (!which || which === 'marvin') { await probeMarvin(env); }
if (!which || which === 'outset') { await probeOutset(env); }
console.log('');

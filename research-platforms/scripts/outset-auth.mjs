#!/usr/bin/env node
// Authorize (or re-authorize) Outset via OAuth device flow.
//
//   node outset-auth.mjs
//
// Run this when research-client.mjs reports `invalid_grant`. Refresh tokens
// rotate on every use, so any process that refreshes MUST persist the new
// token; if two processes refresh independently, one invalidates the other.
// Everything funnels through research-client.mjs to keep that in one place.
//
// Scope policy: request read + authoring scopes but deliberately WITHHOLD
// `studies:launch`. Recruiting real paid participants is a human decision, so
// the stored token is made structurally incapable of it rather than relying on
// the agent choosing not to. To launch, a human uses the Outset UI.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const ENV_PATH = join(homedir(), '.copilot', 'research.env');
const SCOPES = 'projects:read studies:read studies:write analytics:read usage:read wallet:read';

function persist(updates) {
	let s = readFileSync(ENV_PATH, 'utf8');
	for (const [k, v] of Object.entries(updates)) {
		s = new RegExp(`^${k}=.*$`, 'm').test(s)
			? s.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`)
			: `${s}\n${k}=${v}\n`;
	}
	writeFileSync(ENV_PATH, s);
}

const meta = await (await fetch('https://api.outset.ai/.well-known/oauth-authorization-server')).json();

const client = await (await fetch(meta.registration_endpoint, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		client_name: 'VS Code Research Automation',
		grant_types: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		scope: SCOPES,
	}),
})).json();

if (!client.client_id) {
	console.error('Client registration failed:', JSON.stringify(client));
	process.exit(1);
}

const device = await (await fetch(meta.device_authorization_endpoint, {
	method: 'POST',
	headers: { 'content-type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams({ client_id: client.client_id, scope: SCOPES }),
})).json();

if (!device.device_code) {
	console.error('Device authorization failed:', JSON.stringify(device));
	process.exit(1);
}

console.log(`\n  Code: ${device.user_code}`);
console.log(`  URL : ${device.verification_uri}`);
console.log(`\n  Opening Chrome. Sign in and approve.\n`);

// A real Chrome window, not the integrated browser.
execFile('open', ['-na', 'Google Chrome', '--args', '--new-window', device.verification_uri_complete], () => { });

const deadline = Date.now() + device.expires_in * 1000;
let interval = (device.interval || 5) * 1000;

while (Date.now() < deadline) {
	await new Promise(r => setTimeout(r, interval));
	const res = await fetch(meta.token_endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: device.device_code,
			client_id: client.client_id,
		}),
	});
	const json = await res.json().catch(() => ({}));

	if (json.access_token) {
		persist({
			OUTSET_OAUTH_CLIENT_ID: client.client_id,
			OUTSET_REFRESH_TOKEN: json.refresh_token,
		});
		console.log(`\nAuthorized. Scopes: ${json.scope}`);
		console.log(`Launch capable: ${json.scope.includes('studies:launch') ? 'YES (unexpected)' : 'no'}`);
		process.exit(0);
	}
	if (json.error === 'slow_down') {
		interval += 5000;
		continue;
	}
	if (json.error && json.error !== 'authorization_pending') {
		console.error(`\nFailed: ${json.error} ${json.error_description ?? ''}`);
		process.exit(1);
	}
	process.stdout.write('.');
}

console.error('\nDevice code expired. Re-run.');
process.exit(1);

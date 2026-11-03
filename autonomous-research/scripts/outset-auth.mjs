#!/usr/bin/env node
// Authorize (or re-authorize) Outset via OAuth device flow.
//
//   node outset-auth.mjs            the everyday connection (no launch scope)
//   node outset-auth.mjs --launch   the research loop's separate launch connection
//
// Run this when research-client.mjs reports `invalid_grant`. Refresh tokens
// rotate on every use, so any process that refreshes MUST persist the new
// token; if two processes refresh independently, one invalidates the other.
// Everything funnels through research-client.mjs to keep that in one place,
// and this script writes under the same lock (scripts/research-loop/lib/env.mjs).
//
// Scope policy: request read + authoring scopes but deliberately WITHHOLD
// `studies:launch`. Recruiting real paid participants is a human decision, so
// the stored token is made structurally incapable of it rather than relying on
// the agent choosing not to. To launch, a human uses the Outset UI.
// The one exception is `--launch`: a second connection with `studies:launch`,
// saved under its own keys, for a research loop the user pre-approved to launch
// within caps. Only that loop's launch.mjs uses it, after its budget check.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { withLock } from './research-loop/lib/lock.mjs';
import { TOKEN_LOCK, STATE_DIR } from './research-loop/lib/env.mjs';

const ENV_PATH = join(homedir(), '.copilot', 'research.env');
const LAUNCH = process.argv.includes('--launch');
const SCOPES = `projects:read studies:read studies:write${LAUNCH ? ' studies:launch' : ''} analytics:read usage:read wallet:read`;
const ISSUER = 'https://api.outset.ai';

// Under the token lock, so a refresh in another process cannot interleave; the connection's cached access token is
// dropped because it belongs to the previous authorization.
async function persist(updates) {
	await withLock(TOKEN_LOCK, () => {
		let s = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
		for (const [k, v] of Object.entries(updates)) {
			s = new RegExp(`^${k}=.*$`, 'm').test(s)
				? s.replace(new RegExp(`^${k}=.*$`, 'm'), () => `${k}=${v}`)
				: `${s}\n${k}=${v}\n`;
		}
		writeFileSync(ENV_PATH, s, { mode: 0o600 });
		rmSync(join(STATE_DIR, `outset-access-${LAUNCH ? 'launch' : 'everyday'}.json`), { force: true });
	}, { label: 'the Outset token lock' });
}

// The default browser on every OS. On Windows the URL stays quoted for cmd, so & in it is not a command separator.
function openUrl(url) {
	if (process.platform === 'win32') {
		execFile('cmd.exe', ['/d', '/s', '/c', `start "" "${url.replace(/"/g, '%22')}"`], { windowsVerbatimArguments: true, windowsHide: true }, () => { });
	} else {
		execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => { });
	}
}

const meta = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)).json();

const client = await (await fetch(meta.registration_endpoint, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		client_name: LAUNCH ? 'VS Code Research Loop (launcher)' : 'VS Code Research Automation',
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
console.log(`\n  Opening it in your default browser. Sign in and approve.\n`);

openUrl(device.verification_uri_complete || device.verification_uri);

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
		await persist(LAUNCH
			? { OUTSET_LAUNCH_CLIENT_ID: client.client_id, OUTSET_LAUNCH_REFRESH_TOKEN: json.refresh_token }
			: { OUTSET_OAUTH_CLIENT_ID: client.client_id, OUTSET_REFRESH_TOKEN: json.refresh_token, OUTSET_MCP_URL: `${ISSUER}/mcp` });
		const canLaunch = String(json.scope ?? '').includes('studies:launch');
		console.log(`\nAuthorized${LAUNCH ? ' the launch connection' : ''}. Scopes: ${json.scope}`);
		console.log(`Launch capable: ${canLaunch ? 'YES' : 'no'}${canLaunch === LAUNCH ? '' : ' (unexpected)'}`);
		process.exit(canLaunch === LAUNCH ? 0 : 1);
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

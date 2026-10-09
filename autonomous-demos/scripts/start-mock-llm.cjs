#!/usr/bin/env node
// Start the vscode repo's deterministic mock LLM (scripts/chat-simulation/common/mock-llm-server.ts)
// for scripted demos. It implements the Copilot CAPI endpoints (/models, chat completions, responses,
// Auto routing), so a Code OSS instance launched with `launch-demo-oss.mjs --mock-llm <url>` streams
// the same thinking, tool calls, and answers on every take, with no account and no network model.
//
// Usage (Node 24+, which strips TypeScript types natively; use the checkout's .nvmrc Node):
//   node start-mock-llm.cjs --repo <vscode-checkout> [--port 47331] [--scenarios my-scenarios.cjs]
//                           [--default <scenarioId>] [--perf] [--verbose]
//
// --scenarios  a CommonJS module: module.exports = ({ registerScenario, ScenarioBuilder }) => { ... }
//              (see mock-scenarios.example.cjs).
// --default    serve this scenario for every prompt that has no [scenario:<id>] tag. Demo prompts are
//              typed on camera, so never put tags in them; one scenario per instance via --default
//              (or a multi-turn scenario) keeps the prompt clean.
// --perf       also register the repo's built-in perf scenarios (reads, edits, terminal, thinking).
//
// Tool calls in scenarios are REAL tool invocations by the client (files are read, edits applied,
// commands run) inside the demo workspace, so only script harmless tools in a throwaway workspace.

const path = require('path');
const os = require('os');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const expandHome = p => p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;

const repo = path.resolve(expandHome(arg('repo', process.env.VSCODE_REPO || process.cwd())));
const serverPath = path.join(repo, 'scripts', 'chat-simulation', 'common', 'mock-llm-server.ts');
let server;
try {
	server = require(serverPath);
} catch (error) {
	console.error(`could not load ${serverPath}: ${error.message}`);
	console.error('Use Node 24+ (the checkout .nvmrc) and a vscode checkout that has scripts/chat-simulation.');
	process.exit(1);
}
const { startServer, registerScenario, ScenarioBuilder, getScenarioIds } = server;

process.on('uncaughtException', error => console.error('[mock-llm] uncaught', error));
process.on('unhandledRejection', error => console.error('[mock-llm] unhandled', error));

if (argv.includes('--perf')) {
	require(path.join(repo, 'scripts', 'chat-simulation', 'common', 'perf-scenarios.js')).registerPerfScenarios();
}
const defined = {};
const scenariosModule = arg('scenarios');
if (scenariosModule) {
	const register = (id, value) => {
		defined[id] = value;
		registerScenario(id, value);
	};
	require(path.resolve(expandHome(scenariosModule)))({ registerScenario: register, ScenarioBuilder });
}
// Background requests (titles, summaries, follow-ups) get a short harmless reply by default.
if (!getScenarioIds().includes('text-only')) {
	registerScenario('text-only', [{ content: 'Done.', delayMs: 10 }]);
}
const defaultScenario = arg('default');
if (defaultScenario) {
	if (!defined[defaultScenario]) {
		console.error(`--default ${defaultScenario} is not defined by the --scenarios module`);
		process.exit(1);
	}
	// The server serves its default id to every prompt without a [scenario:<id>] tag.
	registerScenario('text-only', defined[defaultScenario]);
}

const port = parseInt(arg('port', '47331'), 10);
startServer(port, { verbose: argv.includes('--verbose') }).then(handle => {
	console.log(JSON.stringify({ url: handle.url, scenarios: getScenarioIds(), default: defaultScenario || 'text-only' }));
});

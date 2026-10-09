// Example scenarios for start-mock-llm.cjs. Copy this file next to your demo, edit the text, and
// start the mock with:  node start-mock-llm.cjs --repo <vscode> --scenarios my.cjs --default fix-leak
//
// A multi-turn scenario streams thinking, then real tool calls (the client executes them inside the
// demo workspace, so keep them harmless), then the final answer. The server picks the next model turn
// from how many tool round-trips are already in the conversation.

module.exports = ({ registerScenario, ScenarioBuilder }) => {
	registerScenario('fix-leak', {
		type: 'multi-turn',
		turns: [
			{
				kind: 'thinking',
				thinkingChunks: new ScenarioBuilder()
					.wait(400, 'Looking for event listeners that are registered without being disposed. ')
					.stream(['The voice session registers on connect ', 'and should release on close.'], 120)
					.build(),
				chunks: new ScenarioBuilder().wait(200, 'I will read the session code first.').build(),
			},
			{
				kind: 'tool-calls',
				toolCalls: [
					{ toolNamePattern: /read.?file/i, arguments: { filePath: 'src/voice/session.ts', startLine: 1, endLine: 120 } },
				],
			},
			{
				kind: 'content',
				chunks: new ScenarioBuilder()
					.wait(300, '## Found it\n\n')
					.stream([
						'`VoiceSession.connect()` adds a `devicechange` listener on every reconnect, ',
						'but `close()` never removes it, so each reconnect leaks one listener.\n\n',
						'I registered the listener through `this._register()` so it is disposed with the session.',
					], 90)
					.build(),
			},
		],
	});

	// A plain streamed answer.
	registerScenario('summary', new ScenarioBuilder()
		.wait(300, 'Here is what changed:\n\n')
		.stream(['- Renamed the status label\n', '- Swapped the icon\n', '- Kept the pulse animation\n'], 150)
		.build());
};

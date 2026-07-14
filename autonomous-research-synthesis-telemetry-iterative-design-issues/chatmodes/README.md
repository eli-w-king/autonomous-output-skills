# Chat-mode templates (optional wrappers)

These are **optional** thin custom chat modes that wrap the `autonomous-research-synthesis-telemetry-iterative-design-issues` skill so you get
the native "plan then auto-handoff to build" UX and a discoverable entry in the chat mode picker. The
procedure and scripts stay in the skill; these files just add the mode UI and the handoff.

Files:
- `plan-synthesis.chatmode.md` confirms the studies, topic, window, repo, solution count, and account
  email, then hands off (`send: true`) to Synthesize Research.
- `synthesize-research.chatmode.md` is the handoff target; it follows the skill end to end.

## Activate
Copy both files into one of:
- a workspace: `<workspace>/.github/chatmodes/`
- your user prompt-files location (see the "Chat: Configure Chat Modes" command / `chat.modeFilesLocations`).

Then pick **Plan Synthesis** in the chat mode picker. Under the Autopilot permission level the handoff to
Synthesize Research fires automatically; otherwise you get a one-click "Continue on Agent" button.

## Guardrail
Never put a public-repo post behind an auto-send handoff. Only plan to build should auto-advance; posting
to a repo you do not control (e.g. microsoft/vscode) requires explicit confirmation.

## Note
The handoff `agent:` value must match the target mode's name ("Synthesize Research"). If you rename a
mode, update the `handoffs.agent` reference.

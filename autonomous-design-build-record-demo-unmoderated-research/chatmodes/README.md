# Chat-mode templates (optional wrappers)

These are **optional** thin custom chat modes that wrap the `autonomous-design-build-record-demo-unmoderated-research` skill so you get
the native "plan then auto-handoff to build" UX and a discoverable entry in the chat mode picker. The
actual procedure and scripts stay in the skill; these files just add the mode UI and the handoff.

Files:
- `plan-study.chatmode.md` gathers inputs (topic, audience, participants, account email) and hands off
  (`send: true`) to Build Study.
- `build-study.chatmode.md` is the handoff target; it follows the skill to capture + author, and stops
  at a review-ready Draft (launch stays human-gated).

## Activate
Copy both files into one of:
- a workspace: `<workspace>/.github/chatmodes/`
- your user prompt-files location (see the "Chat: Configure Chat Modes" command / `chat.modeFilesLocations`).

Then pick **Plan Study** in the chat mode picker. Under the Autopilot permission level the handoff to
Build Study fires automatically; otherwise you get a one-click "Continue on Agent" button.

## Guardrail
Never put the Phase 4 launch (recruiting real paid participants) behind an auto-send handoff. Only plan
to build should auto-advance; launching always requires an explicit human okay.

## Note
The handoff `agent:` value must match the target mode's name ("Build Study"). If you rename a mode,
update the `handoffs.agent` reference.

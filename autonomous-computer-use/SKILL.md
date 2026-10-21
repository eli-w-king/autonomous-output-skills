---
name: autonomous-computer-use
description: "Autonomous: Computer Use. Background-only macOS app automation with a private virtual input lane. Use whenever a task asks to open, inspect, click, type, edit, or send through a native desktop app such as Notes, Messages, Slack, Finder, System Settings, or Office. Keeps the user's mouse, keyboard, focus, and current app untouched; launches and drives target apps in the background; handles one-time permissions; validates ambiguous actions; prevents duplicate sends; and prefers APIs or browser automation when truly headless execution is available."
---

# Autonomous: Computer Use

Operate desktop applications without taking over the user's Mac. The user should be able to keep
working in another app while the task runs. Detailed targeting, editor, and app-specific gotchas are
in the
[`Computer Use reference`](../autonomous-skill-glossary/references/computer-use.md).

## The contract

1. **Use a private background input lane.** Address every read, click, key, scroll, drag, and text
   edit through the Computer Use tools with an explicit app and, when needed, window id. On macOS
   these app-targeted actions are the automation mouse and keyboard. Never activate the app, move
   the real pointer, synthesize foreground keys, or use AppleScript, System Events, shell launch
   commands, or window-manager tricks.
2. **Be invisible by default.** The target app may have a real window because native GUI automation
   is not literally headless, but it stays backgrounded. Do not ask the user to bring it forward,
   watch it, keep their hands off the whole laptop, or manage windows for you. If a supported API,
   browser tool, or CDP route can complete the task with no native window, prefer that truly
   headless route.
3. **Start automatically.** If Computer Use tools are available, use them without asking the user
   to run `/computer on` again. If the server is not yet exposed, use tool discovery once. Only
   surface the one-time setup when the tools remain unavailable.
4. **Share the machine.** User input in another app is harmless. If input in the target app causes
   `interrupted`, re-read that app and retry the same action once. If it keeps happening, defer that
   app, continue independent work, and return later rather than fighting for control.
5. **Fail closed.** A refused or ambiguous action is not permission to foreground the app or switch
   to unguarded OS input. Re-read, choose a safer semantic target, or stop that step with exact
   evidence.

## One-time macOS setup

The host needs:

```json
"chat.agentHost.computerUse.enabled": true
```

The first activation may use `/computer on`. Grant `Copilot Computer Use.app`:

- **Privacy & Security -> Screen & System Audio Recording**
- **Privacy & Security -> Accessibility**

Fully quit and reopen the Copilot host after changing either permission. If macOS attributes the
helper to the parent process and the helper still reports a missing grant, grant the active host
(for example, VS Code Insiders) under the same two panes.

Do not request Input Monitoring, Full Disk Access, Contacts, Automation, Camera, or Microphone for
ordinary desktop control. After screenshots/reads and clicks work, `no_viable_candidate` is a
safe-targeting problem, not a missing-permission problem.

## Headless-first routing

Choose the least intrusive route that can finish the task:

1. Service API or dedicated tool.
2. Browser automation or CDP for browser-only and owned Electron surfaces.
3. Computer Use text/accessibility actions against a backgrounded native app.
4. Computer Use screenshot coordinates only when the accessibility tree cannot address the custom
   surface.
5. Stop that step if none is safe. Never fall back to foreground OS input.

Do not use Computer Use for simple file, folder, or URL opening when filesystem, shell, or browser
tools can do it without UI automation.

## Operating loop

1. **Read text first.** Call `get_window_state` directly with a known app name. Use `list_apps` only
   when the app is unknown or a specific window is needed. Let `get_window_state` launch a missing
   app in the background.
2. **Verify the destination.** Confirm the window, document, conversation, recipient, or channel
   before entering content.
3. **Use the latest index.** Every state-changing action can invalidate element indexes. Re-read
   before the next action when the UI changed.
4. **Use semantic actions first.** Click or edit indexed accessibility nodes. Request a screenshot
   only when a custom surface has no usable node, then use coordinates from that exact image.
5. **Choose the advertised text primitive.**
   - Simple whole-value `(settable, string)` field: `set_value`.
   - `(patchable)` rich text, document, slide, Monaco, or Slack composer: `patch_text`.
   - Insertion at a proven focused input: `type_text`.
6. **Verify the effect from the returned state.** Do not take an extra screenshot merely to confirm
   text already exposed by accessibility.

For large Electron trees, reduce `max_children` while retaining enough `max_depth` to reach the main
view. Search offloaded output narrowly, then read only the relevant range.

## Ambiguous actions

Treat `dispatched_unverified`, `post_verify_failed`, timeouts, and unknown outcomes as actions that
may already have happened:

1. Do not repeat the action.
2. Fresh-read the target.
3. Inspect both input state and output state.
4. Continue only after proving the result.

For a message, inspect both the composer and transcript. A non-empty composer does not prove that
no message was sent, and an empty composer does not prove that exactly one message was sent.

## Messages, forms, and other consequential actions

Respect the Computer Use action policy. Sending a message needs explicit approval of the exact
recipient and body. Approval covers one send.

Before sending:

- Verify the exact one-to-one recipient or channel.
- Verify the complete draft and formatting.
- Verify an ambiguous edit did not already post it.
- Ignore separate prompts to add, invite, subscribe, or notify someone unless separately approved.

Send once. Then verify an empty composer and exactly one matching outgoing transcript entry. Never
delete a duplicate without separate approval.

## Keep the user out of the loop

Do not narrate routine setup, ask the user to watch the app, or request window management. Handle
transient failures by re-reading and trying the correct semantic route. Ask only when policy
requires approval or when a one-time OS grant is genuinely missing. During unattended work, record
the blocked step, continue everything else, and leave exact recovery instructions.


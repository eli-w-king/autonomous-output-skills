# Computer Use on a shared Mac

Use these rules when driving native macOS or Electron applications with the Computer Use MCP
server. The engine is background-first and fail-closed: a refused action is usually protecting the
user from focus theft or mistargeted input, not asking for a shell workaround.

## A private input lane, not a foreground takeover

- Address all UI input through Computer Use with an explicit app/window target. On macOS, these
  app-targeted actions are the automation mouse and keyboard; they must not move the real pointer,
  activate the app, or type into the user's foreground app.
- Computer Use can inspect and operate a backgrounded app while the user works elsewhere.
- Native GUI automation is not literally headless: the app still needs a real window and
  accessibility surface. The window does not need to be frontmost. Prefer a service API, browser
  tool, or CDP when a genuinely windowless path exists.
- Negative screen coordinates can be valid on a display positioned above or left of the primary
  display. Treat them as a diagnostic, not proof that a window is off-screen. A normal
  positive-coordinate rectangle can make a custom app surface more reliable without foregrounding
  it.
- If user input in the same app causes `interrupted`, re-read that app to clear the guard and retry
  the same action once. Other apps remain usable.
- Never use AppleScript, System Events, shell launch/focus commands, or window-manager tricks to
  bypass a refusal.

## macOS permissions

Computer Use requires:

1. **Privacy & Security -> Screen & System Audio Recording**
2. **Privacy & Security -> Accessibility**

Grant them to `Copilot Computer Use.app` (normally
`~/.copilot/computer-use/Copilot Computer Use.app`, bundle id
`com.github.computeruse.service`) and fully quit and reopen the Copilot host after changing either
permission. If macOS attributes the helper to its parent process, grant the active host only when
the helper still reports the grant missing.

Successful text reads/screenshots prove Screen Recording is effective; successful clicks or edits
prove Accessibility is effective. `no_viable_candidate` after those successes is a targeting or
safe-dispatch limitation, not evidence that Input Monitoring or Full Disk Access is needed.

**Reads work but every action is refused.** If an app's tree and screenshots read fine but every
action returns `no_viable_candidate` (indexed: "no safe way to dispatch this verb in the
background"; coordinates: "the background click could not be delivered"), including a harmless
click on an already-selected tab, the engine has lost its input lane, not the target. A fresh
session then reports that Computer Use "could not arm the physical Escape stop handler". Stop after
one harmless probe click; don't cycle text primitives or spawn more sessions to retry. Hand the user
the exact ready-to-paste text and note that fully quitting and reopening the Copilot host restores
it (which also ends every running session, so leave that choice to the user).

## Read and target safely

1. Start with a text-only `get_window_state`. Use `list_apps` only for an unknown app or a specific
   window id.
2. Treat every state-changing action as invalidating prior element indexes.
3. Prefer indexed accessibility actions. Use coordinates only after an image read proves that a
   custom surface has no usable node, and use coordinates from that exact image.
4. Verify the destination by its window or conversation title before entering content. A click
   reporting success is not proof that a custom list item opened.
5. Large Electron trees can be dominated by a sidebar. Reduce `max_children` while keeping enough
   `max_depth` to expose the main view. Search offloaded output narrowly and read only the relevant
   range.

Do not request screenshots to reconfirm text already exposed by accessibility. Use screenshots for
pixel-only custom controls or information absent from the tree.

## Use the correct text primitive

- Use `set_value` only for a simple `(settable, string)` field whose entire value should be
  replaced.
- Use `patch_text` for `(patchable)` rich-text, native document, Monaco, and Slack composer nodes.
- Use `type_text` for insertion only when the target has a viable focused input path.

An empty rich-text composer may be one blank paragraph. Replace the blank line rather than preserve
it and append another:

```diff
@@
-
+message
```

Avoid preserving a blank context line and adding the message after it. That creates another
paragraph and can interact badly with applications where newline means Send.

Slack may flatten formatted rich text in the text area's accessibility `Value`: inline-code
delimiters disappear, line breaks concatenate, and a separately styled heading may be omitted.
Inspect child runs or the custom surface rather than assuming those spans were lost.

## Treat ambiguous results as actions that may have happened

`dispatched_unverified` and `post_verify_failed` are indeterminate outcomes, not failures safe to
retry:

1. Do not repeat the edit or press Send.
2. Perform a fresh read.
3. Inspect both the composer and transcript.
4. Continue only after proving whether the content is still a draft or already posted.

In one Slack run, an ambiguous rich-text edit was followed by an explicit Send click and two
identical messages appeared. The exact app-internal cause was not proven, but checking only the
composer after the ambiguous edit was insufficient.

## Sending messages safely

Sending on the user's behalf requires approval of the exact recipient and body. Approval covers one
send.

Before sending:

- Verify the one-to-one recipient or exact channel.
- Verify the complete draft and formatting.
- Verify the transcript does not already contain the intended post after any ambiguous action.
- Ignore separate prompts to add, invite, or notify a mentioned person unless separately approved.

Send exactly once. Verify both an empty composer and exactly one matching outgoing message. Duplicate
deletion requires separate approval.

## App-specific observations

- **Notes:** an initial `No Notes` state can be transient while iCloud loads. Re-read before using
  toolbar indexes. Note bodies are patchable text areas; a fresh read can make a previously refused
  input path viable.
- **Messages:** pinned conversations may be static text without a press action. A screenshot-based
  double-click can open the intended one-to-one conversation. Verify the title, use `set_value` for
  the simple message field, verify the exact value, then press Return once.
- **Slack:** the Electron composer is patchable, not a simple field. Tune tree depth/children to
  reach it, replace the empty paragraph, and treat failed post-verification as indeterminate. Never
  infer exactly-once delivery from a cleared composer alone.

## Minimal checklist

1. Read text-only.
2. Verify app, window, conversation, or channel.
3. Re-read after UI changes or same-app user input.
4. Use the node's advertised text primitive.
5. On an ambiguous result, inspect composer and transcript before retrying.
6. Verify the exact draft and absence of a prior copy.
7. Send once.
8. Verify an empty composer and exactly one transcript copy.


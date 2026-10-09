# Glossary: recording and capturing Code OSS

Reusable facts for clean screenshots, recordings, and storyboard frames of Code OSS: driving the UI on
camera, theme and state setup, native window stills, parallel sessions, hover frames, invisible
capture, post-production, and Compare Models runs. Part of the
[`autonomous-skill-glossary`](../SKILL.md); used by `autonomous-demos`. The standing demo rules and the
recording toolkit live in [`autonomous-demos`](../../autonomous-demos/SKILL.md).

---

## Clean screen recording of Code OSS

**Bind dev/simulate commands to keys; never trigger them via the command palette on camera.**
Typing `F1` + a command name during a recording opens the palette, leaks characters into focused
inputs (e.g. the chat box), and can even start a session. Write a `keybindings.json` into the
launched profile and press keys silently instead. Example:

```jsonc
// <userDataDir>/User/keybindings.json
[
  { "key": "f8", "command": "workbench.action.agentSessions.simulateNeedsInput" },
  { "key": "f9", "command": "workbench.action.agentSessions.cycleNeedsInputVariant" },
  { "key": "f7", "command": "notifications.clearAll" }
]
```

Reload the window once after writing the file so it takes effect. Driving becomes
`page.keyboard.press('F8')` with zero palette on screen.

**Clear dev-build toasts right before AND during the take.** A dev build pops toasts that never
ship: most often *"Extension host did not start in 10 seconds, that might be a problem."*, plus
the Copilot CLI banner and your own simulate confirmations. Bind `notifications.clearAll` to a
key (F7 above) and press it immediately after each trigger. The ext-host toast **reappears
~10s after any launch/reload**, so either wait for the ext host to settle before recording or
clear again just before the take. Verify the status-bar bell is empty.

**Start recordings from a genuinely calm, clean state.** Open a fresh session (`Cmd+N`) so the
chat pane has no leftover text from earlier automation, ensure the state you will trigger is
currently OFF (toggle it off if a prior run left it on), then begin.

**Full-window > tight crop.** Frame the whole relevant surface (chat + panel-under-test +
files) so reviewers see where the feature lives; a tight crop reads as a mockup.

**Drive action buttons by their component CSS class, not a `text=` locator.** A `text=` /
`getByText` locator for a button label repeatedly hit the wrong node during a recording (a
backdrop, or a same-text step card) and closed the surface, wasting the take. Target the real
control by its class (e.g. `.automations-home-new-button`, `.automations-sidebar-row`); text
locators are fine only for uniquely-worded prose.

**Clear leftover editors/overlays BEFORE every take, or a recording silently times out.** A
full-bleed modal editor left open from a prior step keeps a `.monaco-modal-editor-block` in the
DOM that **intercepts pointer events**, so the next physical click never lands and the whole
~30s recording is lost to a locator timeout. Before starting caploop: run
`workbench.action.closeAllEditors` (or `View: Close All Editors`) and assert
`document.querySelectorAll('.monaco-modal-editor-block').length === 0`. For stacking overlays,
press Escape twice and count the overlay nodes before you re-record (a `.last()` locator
otherwise targets a stale hidden copy).

**macOS shell caveats:** there is no `setsid` and no `timeout`. Launch persistent processes
with `nohup ... &` and detach; use node/Playwright timeouts instead of the `timeout` binary.

### Driving the chat composer + model picker for a take (hard-won)

**Typing into the chat input often silently no-ops; focus the Monaco edit-context first.**
`@playwright/cli` `type`/`fill` and a plain click on the input frequently do nothing because the
target is Monaco's `.native-edit-context`. Focus it via eval, THEN type:
```bash
$P eval "() => { const el = document.querySelector('.interactive-input-editor .native-edit-context') || document.querySelector('.native-edit-context'); if(el){el.focus();return 'ok';} return 'none'; }"
$P type "the prompt text"
```
The launch skill's `monaco-paste.sh` is the intended helper but returned `{"ok":false,"error":"@playwright/cli eval failed"}` here; the eval-focus-then-type fallback above worked reliably. Screenshot to confirm the text landed before proceeding.

**On camera, click the model row the way a person would** (glide onto the row with real pointer
moves, then down and up; see the action-widget note below). The user rejects searching for a model
that is visible in the list. The older trick below is for off-camera setup only.

**Off-camera setup: filter-text + Enter.** In an older picker build, clicking a model row just
reopened the picker. What works: open the picker (click the current-model button),
click the "Search models" field, type a unique fragment (e.g. `Opus 4.8`), then press `Enter` on the
single highlighted match. Beware: if the picker has already closed, that typed fragment lands in the
chat input instead, so verify state after.

**Reset-to-known-state between takes is several steps; script it.** New Chat does NOT clear a
pre-send nudge overlay (it is an overlay, not conversation), and after an auto/selected switch the
model persists as the cheaper one. A clean reset is: dismiss any overlay -> New Chat -> reopen picker
-> filter to the expensive model -> Enter. This ran ~15 times this session; it belongs in a helper.

**Action-widget menus block Playwright `click()`; click with real pointer moves.** ActionList popups
(profile, model, and value pickers) cover the window with a `.context-view-pointerBlock` that is only
removed on the first pointer move, so `locator.click()` times out with "context-view-pointerBlock
intercepts pointer events". Move the mouse onto the row (`page.mouse.move`), then `down`/`up`; the
pcap `glide`/`glideClick` helpers already do this.

**A save that returns focus to a pill leaves its rich hover open.** Focus-triggered managed hovers
stay up until focus moves, so they linger through the lead-out. End the take by clicking into the
chat input (focus moves, hover closes), then glide to rest.

**Finding existing recordings:** macOS Screen Recording filenames put a narrow no-break space
(U+202F) before AM/PM, so a quoted path typed with a normal space fails with "No such file". Use
globs (`Screen\ Recording\ 2026-09-08\ at\ 4.31.31*.mov`), then pull a few ffmpeg frames per file
(or one tiled contact sheet) to identify the feature before opening anything.

### Setting the theme deterministically (palette-drive is flaky)

**Force the theme by writing `workbench.colorTheme` into the launched profile's settings.json, then
relaunch; do NOT rely on driving "Preferences: Color Theme" through the palette.** The palette route
fell through to the Extensions view more than once this session (the quick-pick lost focus / the
Enter landed on the wrong list), leaving a light theme on camera. Writing
`"workbench.colorTheme": "Dark 2026"` (plus `"window.autoDetectColorScheme": false`,
`"window.systemColorTheme": "dark"`) into `<userDataDir>/User/settings.json` and relaunching is
deterministic. "Dark 2026" is a real installed theme id and matches the standing capture rule; list
exact ids by opening the theme quick-pick and reading the `.label-name` rows if unsure. A live
palette switch *can* work, but always screenshot to confirm the `body` class shows
`vscode-theme-...-dark` before recording.

### Element-level frame capture (larger, cleaner, no window-hunting)

**For a single component demo, capture the ELEMENT in a timed loop, not the whole window.** Once the
component is mounted in the main window (the main-window overlay pattern in [`code-oss.md`](code-oss.md)), a tiny driver that calls
`locator('.your-component').screenshot()` in a loop yields crisp, tightly-framed frames with zero
window-bounds math and no aux-window problem. ~12 fps is easily achievable
(`for i in 0..N { await card.screenshot({path: fN.png}) }`), then encode with ffmpeg:
```bash
# mp4 (loop the frames a few times for a longer clip), even dims required by yuv420p
ffmpeg -y -stream_loop 2 -framerate 12 -i frames/f%03d.png \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -movflags +faststart out.mp4
# gif via palette for quality
ffmpeg -y -framerate 12 -i frames/f%03d.png \
  -vf "scale=520:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 out.gif
```
The primary demo still frames the full relevant window (a tight crop reads as a mockup); element
capture is for secondary close-ups, PR GIFs, and component detail shots. (Note this is per-component
demo media; for study stimulus the standing preference is still a big static screenshot, see the
synthesis skill.)

### Capture timing (avoid the re-record loop)

**The countdown and the response render in real wall-clock time, and the payoff often lands AFTER a
fixed-duration capture window closes.** Most re-records this session were "the carousel/switch
appeared 2s after caploop stopped." Two fixes:
- Do trigger -> interact -> capture as ONE continuous take with generous duration (the whole
  type -> send -> question -> submit -> model-switched flow needs ~25s, not 10s), then trim the dead
  lead-in afterward (`ffmpeg -ss <start> -i in.mp4 -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4`).
- Better: an **event-driven capture** (start recording, drive the flow, stop when the target selector
  appears/disappears) removes the guesswork entirely. `autonomous-demos/scripts/demo-driver.mjs` does
  this: `startRecording`, drive, `waitFor({selector|text})`, `mark()` around idle spans, then
  `stopRecording`. Keep `caploop.js` (fixed `<seconds>`) for composited captures only.

---

## Real native window stills for storyboards (no recreations)

**Stills must be real product pixels; never draw or recreate VS Code UI.** The user rejects mockups.
Do not add dimmed "highlight" frames either: the user asked to remove them (storyboard v3) and prefers
showing different tasks with different selections (workspace, harness, model, approvals) to carry the story.
The only dimming in a frame should be VS Code's own modal backdrop.

**Native window capture without touching other apps:** launch Code OSS with the repo `launch`
skill (it passes `--inspect=<mainPort>`). Over that Node inspector, `Runtime.evaluate` with
`includeCommandLineAPI: true` exposes `require('electron')`, so you can read
`BrowserWindow.getMediaSourceId()` (`window:<CGWindowID>:0`), `setBounds()` your own windows onto a
spare display, and `app.focus({steal:true}); w.focus()` only your own window so macOS draws active
chrome. Then `screencapture -x -l <CGWindowID> out.png` gives title bar, traffic lights and shadow
at 2x. Drive UI over CDP (Playwright `connectOverCDP`), never OS mouse/keyboard, so a parallel
computer-use session is unaffected. Captures never include the pointer; describe it in notes.

**Keep ONE long-lived CDP connection** (a tiny local HTTP driver) with
`Emulation.setFocusEmulationEnabled`; reconnecting per step drops focus emulation and closes
open dropdowns/hovers.

**Match the user's chrome:** their Insiders uses `window.titleBarStyle: native`; if macOS is in
Dark Mode but the theme is Light, set `window.systemColorTheme: "auto"` so the native title bar is
light. Force an ExP treatment with `experiments.override.<treatmentName>` (e.g.
`agentSessionsTitleBarNewSession` puts New in the Agents title bar).

**Agents window, sessions side by side:** Option-click (Alt) the New button opens a new-session
composer to the side of the active session; repeat for a third column. The session's
"1 File +N" changes pill opens the real Changes diff beside the grid.

---

## Story demos with real parallel sessions in the Agents window

Hard-won from a two-minute, two-session continuous take (plan in one column, a parallel session in the other).

- **Only the active column shows its chat input toolbar.** `.session-view:not(.is-active)` hides the
  input toolbar by design, so a probe of an inactive column finds no pickers. Click into a column's input to
  activate it before capturing or dragging anything in its toolbar.
- **Prefer read-only prompts for the parallel session.** An Autopilot "fix it" prompt ran validation commands
  whose `MODULE_NOT_FOUND` output landed on camera. A read-only ask (for example "List every hard-coded color
  in styles.css") finishes in about 30s with a clean table. Use a New Worktree so agents never touch the
  demo repo's own checkout, and list the worktrees they leave behind in the summary.
- **A single Plan-mode question submits when its option is clicked; there is no Submit button.** Click Submit
  only if one is visible. Questions arrive 10 to 25s after sending, so start the parallel session first and
  answer on return instead of blocking on it.
- **Never open a session with an enormous diff while driving.** A session showing `+225153 -85288` hung the
  renderer for over 30s (the Changes view creates a model reference per file). A hang shows up as CDP
  timeouts on elements that already resolved; `Debugger.pause` over CDP gives the stack.
- **Drags under a running screencast are slow.** Each pointer move relayouts the grid, so a 60-step glide takes
  5 to 10 times longer than planned. Drag a sash in about 15 even steps, and re-read a target's box after a
  glide, since toolbars refit while the pointer travels.
- **Relaunching with SIGTERM can leave windows behind** when a quit prompt waits on running agents. Exit your
  own instances through their main inspector (`app.exit(0)`), after matching the pid to its `--inspect` port.
- **Hygiene rejects unknown CSS custom properties.** Variables set from code must be listed in
  `build/lib/stylelint/vscode-known-variables.json` (`others`).

---

## Clean storyboard states (model, git, framing, grid, tools)

- **Model warnings:** a model with `metadata.statusIcon` (for example "currently experiencing issues") puts a
  warning glyph on the model button. Switch models and hide the flagged one with Manage Language Models
  (`workbench.action.chat.manage`) › Hide Model. The Agents window has its own model list.
- **No failure text in agent summaries:** give the demo checkout the same-commit `node_modules` (root and the
  extension) or the agent reports that lint or typecheck could not run.
- **Git decorations** (tab M, SCM badge) refresh only while the window is focused (`whenIdleAndFocused`); hold
  focus a few seconds after touching files, before the capture.
- **Exact editor framing:** Monaco wheel steps are about 3 lines. Bind `revealLine` with `at: 'top'`; it keeps 5
  lines of context above the requested line.
- **Stacking sessions:** Session Layout › Move Session Below only moves toward an existing neighbor. To stack a
  side-by-side pair, right-click the session in the list › Open in Grid › Below Active Session.
- **Tools picker:** "Configure Tools..." is hidden when chat is locked to an agent-host harness, and the Agents
  Tools page lists MCP tools only after a server connects (OAuth servers need a sign-in).
- **Claude harness:** "Edit Automatically" still asks before shell commands; approving on camera (Allow in this
  Session) makes a good human-in-the-loop beat.
- **Dev-only chrome:** `chat.customizations.migration.enabled: false` hides the Migrations shortcut (warning
  icon, 0 items) in Agent Customizations.
- **A tidy Agents window:** `sessions.developerJoy.enabled: false` removes the Aquarium easter egg (the fish
  toggle above the chat). Customizations can only collapse, not hide: seed
  `agentSessions.customizationsShortcuts.collapsed` = `true` in the agents profile's
  `User/profiles/builtin/agents/globalStorage/state.vscdb`. Close the side panel (secondary side bar plus editor)
  with `workbench.action.agentToggleSidePanel` (Cmd+Alt+B) before sending. New sessions show it by default, and
  a sent draft keeps its layout, so it stays closed. Theme ids are `Dark 2026` (the demo default) and `Light 2026`. The Agents window always uses
  the modern UI styling; `workbench.experimental.modernUI: true` covers the regular window.

---

## Hover frames without hover text, readable diffs, customizations in action

- **Hover without tooltips:** reviewers want the hover state, never the hover text. Set
  `workbench.hover.delay` and `workbench.hover.reducedDelay` to `600000` in the demo profile. Action-list rows
  (harness, approvals) still grow a description card after about 500 ms and ignore that setting, so capture
  those within about 200 ms of the pointer landing (cache the CGWindowID, hold focus in one burst).
- **Stage Manager parking:** with Stage Manager on and only the built-in display, macOS keeps most of an
  off-screen window visible. Parking needs an external display; park at the rightmost display's right edge.
- **Diffs that are not mostly blank:** in the Agents Changes pane use the header's second More Actions ›
  Diff View › Inline, plus Expand Full File in the file toolbar, then wheel-scroll over
  `.monaco-diff-editor .editor.modified` so the change sits among the surrounding content.
- **Customizations in action beat modal tours:** show plugin and repo skills in the slash menu (type `/figma`,
  `/workiq`, `/code-r`) and a skill run landing in chat, then the Plugins and MCP Servers pages last, so the
  modal backdrop shows the finished turn in order. Installed but not signed-in plugin MCP servers make running
  turns show "require authentication" (drop that frame or sign in). A repo `.mcp.json` whose servers need a local
  build shows red errors on MCP Servers; turn them off and collapse the Workspace group.
- **Storyboard PDF shape:** no cover page. Start with one thumbnail overview page per scene, then one page per
  frame, then the appendix.

---

## Invisible background capture and live agent states

- **Rejected direction (do not repeat):** a narrative-only storyboard (one invented sample app, no customization
  screens, washed-out focus areas, page captures without window chrome) was rejected outright. The approved
  baseline is the v4 style: real VS Code repo tasks, editor plus Agents window, full native window captures.
- **Real sidebar states on demand:** Working is any running session. For Input needed, start that session in
  Interactive mode with a prompt like "Ask me which accent color to use"; the agent raises the real question
  carousel and the row reads "Input needed" while the others keep working. Answering flips it back to Working.
- **Invisible capture (Stage Manager, single display):** `screencapture -l` returns only the Stage Manager
  thumbnail for a background window. CDP `page.screenshot` still works (2x, but no title bar). In the main
  process, shim `show` to `showInactive`, no-op `focus` and `app.focus`, `setOpacity(0)`,
  `setIgnoreMouseEvents(true)`, `app.dock.hide()` and `setBackgroundThrottling(false)`; the window never shows.
- **Invisible windows still take real input:** also call `setFocusable(false)`. Otherwise the window can turn key
  at launch and the user's own keystrokes land in the chat input (a stray "In" ruined a take). CDP keys still
  work in a non-focusable window. `setIgnoreMouseEvents(true)` misses some real pointer events too, so drop
  trusted mouse events far from the driver's placed pointer in capture-phase listeners. Before recording,
  clear the composer and assert it is empty.
- **Fake-token demos need the mock keychain:** pass `--use-mock-keychain` when all credentials and responses
  are simulated. Otherwise Electron can block its main thread in `SecItemAdd` / `AuthorizationCopyRights`,
  leaving CDP ports listening but both HTTP and WebSocket connections unresponsive. Never authenticate the
  macOS prompt: stop the owned instance and relaunch the isolated mock. Keep omitting this flag for genuine
  signed-in demos that need real tokens.
- **Integrations without sign-in:** Figma's hosted MCP rejects dynamic client registration from Code - OSS
  ("Forbidden"). Figma desktop's local MCP (`http://127.0.0.1:3845/mcp`) answers `tools/list` only while a design
  file is open. The Azure DevOps MCP accepts `-a azcli` to reuse the az login. The built-in GitHub MCP server reads
  public issues with no setup.

---

## Compare models (Judge) runs and the scorecard

- **On the Copilot CLI harness with a Claude Judge, the verdict never lands while agent-host tool search is on**
  (`chat.agentHost.copilot.toolSearch.enabled`, default true). The Judge's VS Code tools (`readAttemptComparison`,
  `completeAttemptComparison`) are deferred behind `tool_search_tool`. The forwarded search then fails with "The
  selected model 'agent-host-copilotcli:<model>' is not available". The Judge guesses the schema, every call is
  "invalid", and the group ends at "Review incomplete". Set the flag to `false` in the demo profile; it is pushed
  live, so new sessions pick it up without a relaunch.
- **Diagnose a rejected verdict from the Judge's real transcript**, because the tool's error never names the field.
  Look in `~/.copilot/session-state/<judge-id>/events.jsonl`: `assistant.message` holds `toolRequests[].arguments`,
  and `tool.execution_complete` holds the result. The limits are `explanation` at most 240 characters, each
  rationale point at most 180, and state/source pairs from the schema. A single 187-character `codeQuality` point
  was enough to reject one payload.
- **Attempts branch from the committed baseline, not the dirty checkout.** Pick a task that `git show HEAD:<file>`
  proves is missing. Otherwise every attempt answers "already exists", there are no diffs, and the scorecard is empty.
- **Manual permissions:** "Allow in this Session" adds the whole tool (every later shell command) to that session.
  Use its dropdown's "Allow Once" for a one-off syntax check, and Skip servers and browser pages. Edits inside the
  session's worktree and read-only commands auto-approve. A watcher must read the command text with the button
  labels stripped (they share the card's `innerText`).
- **Status strings to wait on:** "Comparison · N attempts working" or "need input", then "Reviewing attempts" or
  "Judge needs input", then "Review ready" (the verdict exists), "Review incomplete" (finished with no verdict), or
  "Review failed". Clicking the group header reopens the attempts grid. "Mark All as Done" archives the whole group
  after a confirm dialog, and the group can be restored later.
- **The model pill is a split control.** Click `.chat-input-picker-split-primary`. The outer
  `[aria-label^="Models,"]` group's center can land on the config half ("Balance") and open nothing. Stale hidden
  `.action-widget` copies stay in `.context-view`, so filter every picker locator by visibility.
- **Hot-swap CSS in a running dev build:** copy the file into `out/`, then insert a clone of its `<link>` with a
  cache-busting `?v=` href and remove the old one. No reload is needed, so the instance does not degrade.
- **The workbench's `.monaco-workbench button:focus` rule also draws a ring on mouse focus.** Custom buttons need
  `:focus:not(:focus-visible) { outline: none; }`, a pattern used widely in the codebase.
- **The scorecard is docked above the chat input, so expanding a row grows it upward.** Re-read a toggle's box
  before every click; coordinates from before an expansion land on the moved content.

---

## Post-produced screencast demos

- **CDP screencast frames are damage-driven:** a still scene yields about 2 fps, while a spinner yields 46. Edit
  from "latest frame at or before t" to get constant 30 fps, render with PIL into an ffmpeg rawvideo pipe (3,700
  frames at 2000x2000 in about 40 s), and composite the click cursor from a logged pointer path (show, hide,
  down, up) so it never touches the product UI.
- **Continuity hazards across cuts:** reloading the Agents window re-renders restored turns differently ("10 steps
  in 3m 2s" became "9 steps in 3m 14s"). Crossfades ghost small text changes like that, so use hard cuts there
  and keep crossfades for list rows appearing.

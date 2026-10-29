# Glossary: Code OSS build, run, and components

Reusable facts for building, launching, and changing Code OSS (VS Code from `microsoft/vscode`): finding
the real component, simulating states, build and launch traps, Agents window surfaces, Component
Explorer, and the PR flow inside the Agents window. Part of the
[`autonomous-skill-glossary`](../SKILL.md); used by `autonomous-prototypes` and `autonomous-demos`.

---

## Identify the real component before you build (confirm, do not infer)

**When a task says "reuse the existing X UI", the plain-language name is NOT enough to pick the
component; confirm the exact file + class before building.** This session cost a full
build/record/push/issue-edit cycle because "the ask questions UI" was matched to a lookalike
(`SimpleChatConfirmationWidget`, the tool-confirmation card) when the user meant the Plan-mode
clarifying-questions **question carousel** (`ChatQuestionCarouselPart`). VS Code has several
visually similar "title + message + buttons" surfaces that are distinct components:
- `ChatQuestionCarouselPart` (`chatQuestionCarouselPart.ts`) - the clarifying-questions carousel
  (numbered single/multi-select + optional freeform "Enter custom answer", a step indicator, and a
  Submit button with a "⌘↵ to submit" hint). This is the "ask questions" UI shown in Plan mode.
- `ChatElicitationContentPart` / `ChatConfirmationWidget` v2 (`.chat-confirmation-widget2`) - the
  mid-turn elicitation an agent/MCP server raises.
- `SimpleChatConfirmationWidget` (`.chat-confirmation-widget`) - the tool-confirmation card
  (Continue/Cancel).

**Cheap confirmation beats an expensive rebuild.** Before writing code: grep a distinctive string
from the user's screenshot (a button label, the "to submit" hint, a CSS class), open the file, and
either state "this is `ChatQuestionCarouselPart`, building on that" or ask a one-line confirming
question with the candidate names. A 30-second locate step would have avoided the whole redo.

**Reusing a response content part in a non-response overlay:** parts like the carousel take an
`IChatContentPartRenderContext` but often read only ONE field (the carousel reads only
`context.element`, to detect a completed response and show its read-only summary). Grep the part for
`context.` / `_context` first; if it ignores the pools, pass a minimal context (real `container`,
`currentWidth: observableValue(...)`, `onDidChangeVisibility: Event.None`, and `undefined!` for the
pool fields it never touches) rather than plumbing a full renderer. Confirm with typecheck +
`valid-layers-check` (this adds a cross-folder import from `input/` into `chatContentParts/`).

---

## Forcing / simulating VS Code UI states for a demo

**Override at the CONSUMPTION layer via a shared observable, never by mutating provider
internals.** When you need a session (or any model) in a specific state for a demo
(e.g. "needs input") and there is no built-in simulate command, do NOT try to poke the
provider's cached model:
- Provider `ISession` wrappers frequently expose `status` as a **`.map()`-derived** observable
  (e.g. `chatsObs.map(...)`), so setting a private `_status` on the underlying object does
  **not** propagate to the UI.
- Provider caches (e.g. `_ensureSessionCache()` / `_refreshSessionCache()`) **re-sync and
  overwrite** your mutation on the next read.

Instead, add a tiny dev service holding a `observableValue<ReadonlySet<string>>` of "simulated"
ids, and have **every surface that renders the state read that set** (the list-row autorun, the
model that computes the badge/count, etc.), treating membership as the forced state. Then a
dev-only command just flips the set. This is deterministic, reactive, and needs no live agent.
Registered example from the needs-input work: `INeedsInputVariantService.simulatedNeedsInputSessionIds`
consumed by both the sessions list renderer and the `BlockedSessions` model.

**Match "which sessions" to what the user actually sees.** If a simulate command picks "the
first N from `getSessions()`", those may not be the N rows visible at the top of the list. Sort
candidates by `updatedAt` desc (the list's own order) so the simulated state lands on the
visible rows.

**Prefer a real built-in simulate/dev command when one exists** (grep the feature first, e.g.
`agentsVoice.simulateConnection`). Only add your own dev override when there is none.

### Aux-window / popout features: mount the real component as a main-window overlay (do NOT chase the popout)

**A frameless auxiliary/popout window is nearly impossible to drive or capture; render the real
component in a centered overlay in the MAIN window instead.** This session's onboarding normally
lives in a 400px frameless voice popout, and going after it wasted a full hour:
- The popout is **not a CDP target** (absent from `/json/list` and from `browser.contexts()[0].pages()`),
  so Playwright cannot screenshot or drive it.
- On multi-monitor it drifts off-screen; repeated dev "open" calls **stack multiple popouts** with
  transitional 26x34-ish bounds, and `screencapture -l<windowId>` (via Quartz `CGWindowListCopyWindowInfo`)
  is brittle and pulls stale copies.
- The popout's own window service may be **half-wired in the branch** (e.g. `registerSingleton` exists
  but nothing imports the module), so a dev command that calls `accessor.get(IThatService)` throws
  `[invokeFunction] unknown service '...'`.

The reliable pattern: a dev command that instantiates the **real** component and appends it to a
fixed overlay in the main window, so it is CDP-capturable and shares the workbench theme. Two
non-obvious requirements:
- **Mount inside `.monaco-workbench`, not `document.body`.** Only descendants of the workbench element
  resolve the `--vscode-*` theme variables. Mounting on `body` gives a transparent background and
  dark-on-dark text (the card looked broken the first try). Use
  `(doc.querySelector('.monaco-workbench') as HTMLElement) ?? doc.body`.
- **If the component's surface uses an aux-only background var** (e.g. `--vscode-agentsChatInput-background`),
  wrap it in a shell that sets a resolvable fallback (`--vscode-input-background`) and replicate the
  popout's own inner padding so any negative-margin bleed in the card still lines up.

Bonus: this also unlocks **element-level frame capture** (`locator('.card').screenshot()` in a loop),
which is larger, cleaner, and completely sidesteps window-hunting. See the clean recording section in [`recording.md`](recording.md).

---

## Building / running Code OSS for a spike or capture

- **`TMPDIR=/tmp`** when launching (the default long macOS `$TMPDIR` overflows the UNIX socket
  path length and the main process dies with `EINVAL … .sock`).
- **Omit `--use-mock-keychain`** for the signed-in variant (the mock keychain blocks the real
  GitHub/Copilot tokens).
- **Build with the exact `.nvmrc` Node** (`preinstall` hard-fails on the wrong major). A built
  sibling checkout only helps if it actually contains the feature under test; siblings go stale,
  so verify (grep for a feature symbol) or build the feature branch yourself.
- **Validate client TS with `npm run typecheck-client`**, never `npm run compile` for the
  typecheck loop; run `npm run compile` only to produce the launchable build. Also run
  `npm run valid-layers-check` and the relevant unit tests before claiming done.
- **Reloading a dev instance reliably DEGRADES it; prefer a fresh launch after any code
  change.** Repeated `page.reload()` eventually leaves the ext host unable to reactivate the
  copilot-chat extension (`Cannot find module .../extensions/copilot/dist/extension` when
  `dist` is not built), which flips `ChatContextKeys.enabled` **off**. That silently hides every
  chat-gated surface: the sessions header toolbar (New/Filter/Find) AND any chat-gated sidebar
  section vanish, so the thing you wanted to demo is simply not there. Reload only for pure CSS
  tweaks; for TS/behavior changes, relaunch a fresh instance.
- **Probe ext-host health before driving; a relaunch can hang the ext host too.** One
  `page.evaluate` that returns whether `.agent-sessions-header-actions` exists (plus a snippet of
  `body.innerText`) tells you in a single call whether the ext host is up. If the header actions
  are absent, the instance is degraded, do not waste screenshots on it, relaunch. A fresh
  relaunch can itself hang ("Extension host did not start in 10 seconds") and a reload of the
  wedged window does NOT recover it; `kill <pid>` and launch again. Before driving chat, also
  gate on the chat input area being present (selector/screenshot check) and budget an extra
  relaunch. The toast alone is not proof of a hang: a fresh profile's first launch can log it and
  still finish activating a few seconds later, so wait about 20 s and re-probe (the
  `Signed in as <user> with GitHub` aria-label, no toasts) before killing anything.
- **Seed state with `--source-user-data-dir`, not by reusing a run-dir.** The launch script has
  no reuse-run-dir flag; it copies a seeded user-data-dir cleanly into a fresh run-dir on every
  launch. Seed the sqlite ledger (and write `settings.json`) into that source UDD **while the
  app is stopped** (a running app overwrites the ledger on save/reload), then launch pointing at
  it. This survives the fresh-launch-per-change workflow above.
- **`kill "$VAR"` is refused by the bash tool.** Always resolve the numeric pid first
  (`lsof -ti tcp:PORT | head -1`), read the literal number, then `kill <number>`. Never pass a
  variable to `kill`. **After a compile, prefer a full kill + relaunch over
  `Developer: Reload Window`**: a palette reload intermittently races the incremental build and
  fails to fetch the freshly written bundle (same blank-workbench symptom below), whereas a fresh
  launch reliably loads the new `out/`.

### Blank workbench after a spike = a bad import in YOUR new files (not the launcher)

**Symptom:** the whole window is blank/white, `document.querySelector('.monaco-workbench')` is null,
and the log shows only a generic
`TypeError: Failed to fetch dynamically imported module: .../out/vs/workbench/workbench.desktop.main.js`.
This error names the top-level bundle, not the real culprit, so it looks like a launcher/build
problem. It is almost always a module your spike added that fails to ESM-link, which cascades and
takes the entire workbench down. Two specific causes bit this session:

- **Cross-module `export const enum` produces no runtime object.** esbuild cannot inline a `const enum`
  across files in the dev (unbundled ESM) build, so importing it **as a value** in another module
  breaks the link. Fix: use a plain `export enum` for anything imported across files. (`const enum`
  is only safe when used within its own file.)
- **A relative CSS/asset import that is wrong once compiled.** `import './media/x.css'` from a file in
  a `components/` subfolder resolves at runtime to `components/media/x.css`; if the CSS actually lives
  at `browser/media/x.css` it 404s and kills the link. Resolve import paths relative to the **source
  file's own directory**, and confirm the compiled JS emits the path you expect.

**Fastest triage (do this instead of staring at the workbench error): probe each new module directly
over CDP.** Connect to the workbench page and `import()` your new compiled files one by one; the one
that throws (or 404s) is the culprit, and for a value-vs-type problem the working ones report their
real exports:
```js
const base = 'vscode-file://vscode-app/<repo>/out/vs/workbench/contrib/<area>/browser/';
for (const m of ['components/foo.js', 'components/bar.js']) {
  const r = await page.evaluate(async u => {
    try { const mod = await import(u); return 'OK keys=' + Object.keys(mod).join(','); }
    catch (e) { return 'ERR ' + (e.message || e); }
  }, base + m);
  console.log(m, '=>', r);
}
```
Calibrate against a **known-good** module that also imports CSS (e.g. a shipping contrib file) so an
`OK` there confirms the loader itself is fine and isolates the failure to your file. Also cheap:
`node --check out/.../yourFile.js` for syntax, and grep the compiled `.js` for the emitted
`import "...css"` path.

**Keep eager bootstrap imports minimal.** A dev-only preview command that pulls in a component (and
its CSS) is safer as a **dynamic `await import('./component.js')` inside the command body** than as a
top-of-file import in the always-loaded `*.contribution.ts`; a broken import then fails only that
command instead of blanking the whole workbench at startup.
- **`npm install` after a rebase can fail on `foundry-local-sdk`'s native download** (`Failed to download
  Microsoft.ML.OnnxRuntime ... from any configured feed`), and npm then rolls back every dependency bump, so
  typecheck keeps failing against the old packages. When the prototype does not need local transcription,
  `FOUNDRY_LOCAL_SKIP_INSTALL=1 npm install` completes the install. Then rebuild changed built-in extensions
  (`npm run gulp compile-extension:<name>`, `npm run compile-copilot`) before relaunching.
- **Unit tests run from `out/`.** Run `npm run transpile-client` before `./scripts/test.sh`, or it silently runs
  the previous build's tests (renamed or new tests just do not appear).
- **Flip a setting in a running dev instance by editing `<runDir>/user-data/User/settings.json`.** VS Code picks
  the change up live, which is faster than a relaunch for comparing variants (for example `off`/`v1`/`v2`).
- **Seed demo settings into the launched profile's `User/settings.json`, do not click them in.**
  VS Code watches the file live, so writing e.g. `chat.costAwareNudge.enabled` / `...mode` there
  makes the feature deterministic from first paint. Selecting the demo model still needs the picker
  (see [`recording.md`](recording.md)), so re-seed + re-pick after every fresh launch.
- **Older branches can fail `npm run compile` with "monaco.d.ts is no longer up to date".** The check
  has already rewritten `src/vs/monaco.d.ts`, so rerun the compile (it passes), then
  `git checkout -- src/vs/monaco.d.ts` to keep the branch clean.
- **preLaunch can 403 on GitHub API rate limits while syncing built-in extensions.** APFS clone
  `.build/builtInExtensions` from a sibling checkout whose versions match `product.json`
  `builtInExtensions` (or export `GITHUB_TOKEN`), then relaunch.
- **Archived Agents-window sessions delete their worktree but keep the branch**, ending in a
  "Saving uncommitted changes before archiving session" commit. Recreate it with
  `git worktree add <path> <branch>`; the old session's `workspace.yaml` has the original path, and
  its `files/` folder keeps the screenshots that show what "done" looked like.
- **"Open PR N in the OSS Agents window, authed and detached" (about 12 min end to end):**
  `gh pr view N --json headRefName,body` (the body's "How to test" lists the feature flags), then
  `git fetch microsoft <head>` and `git worktree add --track -b <head> ../microsoft-vscode.worktrees/pr-N-<slug> microsoft/<head>`.
  Seed deps from the donor with the same `.npmrc` `target` and the smallest lockfile shortstat (see
  Seeding deps from a sibling checkout, below); cloning all ~57 nested `node_modules` takes about 7 min (per-file clonefile, not
  instant), then `npm install` about 20 s and `npm run compile` (client + copilot) about 70 s. To
  pre-enable flags without touching `~/.vscode-oss-dev`, slim-rsync it into a session `files/` seed,
  add the flags to the seed's `User/settings.json` (the Agents window reads the normal profile
  settings), and run `launch.sh --agents --source-user-data-dir <seed>` via the bash tool's
  `detach: true` mode with stdout/stderr redirected to files (the JSON line lands in the stdout file;
  the process ends up with PPID 1). Verify with one CDP probe: aria-label `Signed in as <user> with
  GitHub`, a visible `.native-edit-context`, no toasts. Icon-only entry points (for example the tabbed
  model picker's `Codicon.layers` "Compare Models" action) carry their label only in a tooltip, so a
  text probe misses them; confirm with a source grep. Playwright `browser.close()` after
  `connectOverCDP` only disconnects; the instance keeps running.
- **Seeding deps from a sibling checkout:** APFS `cp -cR` of `node_modules` is fast, but a stale clone
  fails `gulp compile` with "package.json declares Copilot runtime X, but @github/copilot-sdk bundles
  Y"; run `npm install` once to reconcile (about 20 s), then `npm run compile`. Pick the donor with the
  smallest `git diff --shortstat <donorHEAD> <branch> -- package-lock.json build/package-lock.json
  extensions/copilot/package-lock.json`, and clone every nested `node_modules`
  (`find . -type d -name node_modules -prune`) plus `.build/electron`, not just the root.

---

## Building a foreground surface in the Agents window (sessions "chat space")

Hard-won from building a full-page Automations workspace that opens where the New Session
composer lives, not as an overlay.

**A plain editor opens cramped inside ONE session column; use `RequiresModal` to fill the main
area.** Opening a normal `EditorInput` in the sessions main area renders it inside a single
session's column (a narrow middle strip), not across the whole main area. Adding
`EditorInputCapabilities.RequiresModal` routes it through the modal editor part, which covers the
full main area (this is how the Customizations management editor fills the space).

**But `RequiresModal` alone renders modal chrome; add a chromeless `fullBleed` option to make it
read as a page.** The modal editor part wraps content in a dimmed backdrop, a header with
X/maximize, a drop shadow and rounded corners, and dims the window, all of which read as "a
modal on top of the app". If the requirement is "a whole workflow I start and live in, in the
foreground" (explicitly NOT a modal), extend `IModalEditorOptions` with a `fullBleed` flag that:
pins the surface to the full main area (top-left, no centering/resize), skips
`hostService.setWindowDimmed`, and via a `.full-bleed` class hides the header and removes the
backdrop/shadow/border/radius. The editor input returns `{ fullBleed: true }` from
`getModalEditorOptions()`. Net effect: full-area coverage with zero modal chrome. The content is
then expected to supply its own header / back affordance.

**Deep-link with a singleton input carrying a target + change event.** For "click item X opens
X" (not a generic list), the singleton `EditorInput` holds a target
(`{ view: 'detail'|'create'|'list', automationId? }`) and fires `onDidChangeTarget`. The entry
point sets the target before `openEditor`; because the input is a singleton, clicking a second
item re-fires the event and the already-open pane re-renders to the new item instead of opening a
duplicate.

**Sidebar SplitView index gotcha.** The sessions sidebar is a vertical `SplitView` whose
Customizations pane index is hardcoded in resize/size helpers. Append a new section AFTER it
(higher index) so you never reindex the existing panes, and remember `removeView(index, sizing?)`
takes a `Sizing` as its second arg (not a boolean), and `addView(view, size, index, skipLayout)`.
Add/remove the section live from an `autorun` on the variant observable.

**One-entry-point discipline.** If a feature becomes a first-class sidebar section (like Sessions
or Customizations), it should be the SINGLE entry point. A leftover header/toolbar button that
opens the same surface is redundant; remove it rather than shipping two doors to one room.

---

### Regrouping the new-session composer's pickers (session presets spike)

**Never flatten another component's split control with `display: contents`.** Pickers anchor their dropdowns
to their own wrapper (the model picker anchors to `div.model-picker-split`); with `display: contents` that
wrapper has no box, so the dropdown opens at the window's top-left and the picker looks broken. Treat each
toolbar `li` as the unit you move, and flatten only the toolbar/action-bar/ul wrappers above it.

**Draw a grouping capsule with CSS anchor positioning, not a wrapper.** To show some controls inside a
rounded capsule and others after it in one flex row, make all `li`s flex items of one container (ordered with
`style.order`) and draw the capsule as an absolutely positioned element with
`left: anchor(--start left); right: anchor(--end right)` (Chromium 150 in the Agents window supports
`anchor-name`, `anchor-scope`, and `interpolate-size`). The fill follows the controls during transitions for free.

**Responsive layout pitfalls (`ChatInputPickerResponsiveLayout`).** It measures a clone with inline
`width/min-width: max-content` on each item, so size compact states with padding, not width, or they
measure smaller than they render and the row never compacts enough. It reads `getBoundingClientRect`
(which includes drag transforms), so exclude a dragged or animating item from `getItems()`. The model picker
sets an inline `min-width` on its `li`, so collapsing it needs `min-width: 0 !important`.

**Re-collected items break identity checks.** If a layout pass rebuilds item objects, compare a dragged item
by its element, not by object identity, or live drag previews silently stop moving.

**Capture-phase drag handling:** call `stopPropagation()` only (not `preventDefault()`) on mousedown, so the
click still focuses natively. Otherwise pickers opened by a synthetic passthrough mousedown inherit keyboard
`:focus-visible` and show rings after a mouse pick. After a completed drag, return focus to where it was.

**A sticky `showInstantHover` returns `undefined` while another hover is current;** call `hideHover(true)` first
(for example, before showing an icon picker right after a quick input closes).

**Tabbed model picker rows size their leading icon with `flex: 0 0 var(--vscode-spacing-size200)`.** A custom
icon in that slot (for example a checkbox drawn through the action list item's `iconClasses`) must override
`flex-basis`, not just `width`, or it stays 20px wide and collides with the label. For icon-only footer buttons
next to a text button, use `supportIcons: true` with the label `$(icon-id)` plus `title`/`ariaLabel`; setting
`button.icon` instead renders a shorter glyph button that does not line up with the text button's height.

---

## Settle the interaction/IA contract BEFORE a redesign

A redesign in this session took four full build/verify/record rounds largely because the
information-architecture constraints arrived as late review feedback, not as inputs. Before
writing any redesign code, settle three questions and write the answers into the plan. Ask the user
only when they are present and the answer truly blocks; otherwise choose the safest answer, record it
as an assumption to confirm, and keep going:

1. **Entry points:** how many, and where? (One sidebar section, or also a toolbar icon? Two
   doors to one surface is almost always wrong.)
2. **Item-click target:** what does clicking a specific item do? (Open THAT item, or a generic
   list? "Click opens the wrong thing" is the classic miss.)
3. **Modal policy:** what, if anything, may be a modal? (E.g. "nothing except creation, and even
   that can render inline in the main area.") This single answer can invalidate an entire
   surface choice, cheaper to know first.

These are cheap to ask and expensive to discover after a full build-and-demo loop. A 30-second
contract up front would have caught "redundant entry points" and "click opens the generic list"
in round 1 instead of round 4.

---

## Component Explorer from a worktree on a shared Mac

- **Do not run the "Component Explorer Server" task (`component-explorer serve ... --kill-if-running`) when other
  agents are active.** It claims the shared redirection port 5337 and kills whichever worktree's server holds it.
  Run the dev server from your own worktree root instead: `npm run serve-out-rspack` picks a free port starting at
  5123 and prints `http://localhost:<port>/`; the explorer is `/___explorer`.
- **URL scheme:** `/___explorer?fixture=<id>` selects a tree node. A group path such as
  `sessions/comparisonResultExplorations` opens the whole group as one scrolling page, which is the best link to hand
  a reviewer. For one clean variant with no explorer chrome, use
  `/___explorer?mode=embedded&fixture=<group>/<Fixture>/<Theme>`; embedded mode is the best source for screenshots.
- **A fixture id includes the file's name.** The id is the group path, then the fixture file's name (without
  `.fixture.ts`, and minus a leading part equal to the path's last segment; nothing if that leaves it empty), then
  the fixture, then the theme: path `sessions/automations/` in `automationsView.fixture.ts` gives
  `sessions/automations/automationsView/Populated/Dark`. Check a real id in the explorer's tree before writing it
  into a brief or a script.
- **Popup fixtures (pickers, action widgets) show in only one theme tile at a time** in the folder or fixture view,
  and the other tiles look empty. That is not a regression; capture each variant in embedded mode.
- **Headless Playwright can be missing its browser** (`chromium_headless_shell-<n>` not found). Launch with
  `chromium.launch({ channel: 'chrome' })` instead of downloading browsers.
- **Content appended inside a chat response's `.value` inherits the transcript's text wrapping.** One-line controls
  such as disclosure toggles collapsed to their min-content width and wrapped word by word. Give single-line
  controls `white-space: nowrap` (and `text-align: left` on buttons) instead of relying on inherited wrapping. The
  chat list re-measures rows with a `ResizeObserver`, so appending to the last reply and then calling
  `listWidget.scrollToEnd()` works.
- **The chat fixture harness does not load the editor placeholder contribution**, so
  `inputEditor.updateOptions({ placeholder })` renders nothing until the fixture imports
  `editor/contrib/placeholderText/browser/placeholderText.contribution.js`. Real context pills render fine via
  `inputPart.attachmentModel.addContext({ kind: 'generic', ... })`.
- **Delayed hovers intercept Playwright clicks** when an element slides under the resting pointer (for example a
  chip list after one chip hides). Use `locator.dispatchEvent('click')`, or move the pointer away first.

---

## Agents window PR flow and extensions

- **The Agents window disables every non-built-in extension** unless `product.sessionsWindowAllowedExtensions`
  lists it, and OSS `product.json` ships `[]`. So the GitHub Pull Requests extension (the `PullRequestOverview`
  that docks as "Changes | #N …" tabs) never loads there. In a running dev instance, push the id onto
  `globalThis._VSCODE_PRODUCT_JSON.sessionsWindowAllowedExtensions` from the main inspector and reload only the
  Agents window: reloads reuse the main process product object. Add it to
  `trustedExtensionAuthAccess.github` the same way, or GHPR shows "you must sign in to GitHub" instead of reusing
  the signed-in session. Also set `githubPullRequests.openPullLinks: true`; without it the "#N" PR pill falls
  through to an "open external website?" dialog.
- **Agent-host Create PR pushes with plain `git push`,** so system credential helpers run (Git Credential Manager
  can pop a GUI). On the demo repo only: `git config --local credential.helper ""` then
  `--add credential.helper '!/opt/homebrew/bin/gh auth git-credential'`. The form's Create PR does nothing until
  the generated title and description arrive; wait for the Title field to fill before clicking.
- **Agents told "don't push" will not validate CI fixes.** Put it in AGENTS.md: CI can build the local `agents/*`
  branch, so commit, queue the run on the branch, and wait for green. A mock CI server should poll briefly for the
  branch to move past `main`, because agents commit and queue in parallel.

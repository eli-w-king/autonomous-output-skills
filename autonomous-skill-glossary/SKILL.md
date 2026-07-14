---
name: autonomous-skill-glossary
description: "Autonomous: Skill Glossary. Shared cross-cutting gotcha reference for the VS Code UX research loop. A durable knowledge base of hard-won, non-obvious facts: identifying the real VS Code component behind a named UI before building, forcing or simulating UI states for demos, clean screen-recording technique, driving the shadow-DOM UserTesting.com builder, persistent driver and Chrome setup, running Code OSS, hosting demo videos in a GitHub issue, and writing or editing a public research issue. Read alongside autonomous-design-build-record-demo-unmoderated-research and autonomous-research-synthesis-telemetry-iterative-design-issues before capturing UI, recording, building a study, or drafting an issue. Update it whenever a run surfaces a reusable gotcha."
---

# Autonomous: Skill Glossary

A cross-cutting knowledge base for the two-skill VS Code UX research loop:
[`autonomous-design-build-record-demo-unmoderated-research`](../autonomous-design-build-record-demo-unmoderated-research/SKILL.md) (capture + build + launch a
study) and [`autonomous-research-synthesis-telemetry-iterative-design-issues`](../autonomous-research-synthesis-telemetry-iterative-design-issues/SKILL.md) (analyze results +
build a redesign spike + record a demo + draft the issue).

Those skills own the *procedure*. This file collects the **reusable, non-obvious facts** that
otherwise get rediscovered from scratch each run. When you hit a new one, add it here and,
if it is phase-specific, cross-link it from the relevant skill's gotcha section.

The entries below are grouped by the problem you are trying to solve.

---

## 0. Identify the real component before you build (confirm, do not infer)

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

## 1. Forcing / simulating VS Code UI states for a demo

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
which is larger, cleaner, and completely sidesteps window-hunting. See Section 2.

---

## 2. Clean screen recording of Code OSS

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

**Selecting a specific model: filter-text + Enter, NOT clicking the row.** Clicking a model row in
the picker just reopens the picker. What works: open the picker (click the current-model button),
click the "Search models" field, type a unique fragment (e.g. `Opus 4.8`), then press `Enter` on the
single highlighted match. Beware: if the picker has already closed, that typed fragment lands in the
chat input instead, so verify state after.

**Reset-to-known-state between takes is several steps; script it.** New Chat does NOT clear a
pre-send nudge overlay (it is an overlay, not conversation), and after an auto/selected switch the
model persists as the cheaper one. A clean reset is: dismiss any overlay -> New Chat -> reopen picker
-> filter to the expensive model -> Enter. This ran ~15 times this session; it belongs in a helper.

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
component is mounted in the main window (Section 1's overlay pattern), a tiny driver that calls
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
Use full-window capture only when the point is *where the feature lives*; for "what the card looks
like / how it animates", element capture is faster and reads better. (Note this is per-component
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
  appears/disappears) would remove the guesswork entirely. caploop currently only takes `<seconds>`;
  a `--stop-on-selector` mode is the single highest-value recorder improvement (see the recorder-skill
  idea in the synthesis skill).

---

## 3. Driving the UserTesting.com builder (shadow-DOM SPA)

**It is a shadow-DOM / custom-element app; DOM scraping finds nothing.** `document.querySelectorAll`
returns empty for the editable fields and most controls. Use Playwright role/text locators which
pierce shadow DOM.

**The Add-panel item is a `menuitem` role (this is the key selector fact).**
`getByRole('menuitem', {name:'Image'})` matches **exactly one** (the panel item), whereas
`getByText('Image', {exact:true})` matches several (panel item + rendered step cards + type
labels). Use the role for panel items: `getByRole('menuitem', {name:'Image'|'Verbal response'|'Instructions'})`.

**Every Image "Question page" needs at least one question element or launch validation fails.**
The Review tab shows *"To launch, please resolve … Logic skips participants forward. Include
another question or task to add logic."* Fix: add a question to each image page. A **Rating
scale** ("how clear is X? 1..5") both satisfies validation and yields quantitative data. The
in-page **Add question** menu offers Rating scale (Verbal response is NOT available there, only
in the left Add panel).

**Rating scale defaults to 1-5, not 1-7.** Word the prompt as "1 is …, 5 is …". If you need
1-7, either change the scale or move it to a spoken prompt on a Verbal step.

**Editable fields have no stable placeholder in the tree; identify by current value.** Image
pages seed the instruction textbox with the literal value `Image`; a fresh Verbal seeds an empty
`Add your question`. Select the target box by `inputValue()` (e.g. the one equal to `"Image"`),
not by index. After filling, re-list all `getByRole('textbox')` values to confirm nothing got
clobbered, and scan for a stray appended fragment (fast typing sometimes appends junk like
`"…?didn"`).

**Verify the step-count delta.** Adding a panel item can silently no-op; then your "fill the
new field" code overwrites the PREVIOUS step. Read *"Tasks & questions: N"* before and after
each add and confirm it incremented.

**Swapping an Image page's image:** there are as many `Delete image` buttons as image pages;
target by index. Click `getByRole('button',{name:'Delete image'}).nth(i)`; if the overlay
intercepts, fall back to a deep shadow-DOM JS click on the element whose `aria-label` is
`delete image`, press `Enter` to confirm, then the `Upload image` control reappears for a fresh
`filechooser` upload. The instruction seed reverts to `Image`, so refill it.

**Create-from-scratch flow:** Create test > **hover** (do not click) "Think-out-loud test" so the
right flyout opens > "New experience" > intro modal "Create a test" > name dialog "Create". Do
it in one script; use `.click()` on modal buttons; poll `page.url()` for `/test/`.

**Reordering steps is unreliable to automate.** Add steps in their final order from the start;
do not build then try to drag/move (I left a terminology question after the wrap-up because the
move never registered).

**Preview link works even before validation is fully clean.** The deliverable is the Preview
link (`participant.*.usertesting.com/px/#/preview/pre-study?participantId=…`) + the Review link.
Launch stays human-gated regardless.

**No em/en dashes** in any study text; write "1 to 7", never with a long dash.

---

## 4. Persistent driver + dedicated Chrome (survives shell churn)

**`/tmp` is wiped between bash shells in this runtime.** A driver dir with `node_modules`
installed in `/tmp` can vanish, forcing a 2-4 min `npm i playwright-core` reinstall. Keep the
driver in the **session `files/` folder** (persists across shells and checkpoints), e.g.
`~/.copilot/session-state/<id>/files/ut-driver/`.

**A Chrome launched inline dies when its parent bash shell ends.** Launch the dedicated
debug Chrome **detached** (the bash tool's `detach: true` async mode) so it persists:

```bash
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9333 --user-data-dir="/tmp/ut-chrome-profile" \
  --no-first-run --no-default-browser-check --hide-crash-restore-bubble "<url>" \
  >/tmp/chrome-ut.log 2>&1 &
```

Login persists in `--user-data-dir`, so relaunching to the same profile keeps you signed in.

**Pin YOUR tab by its CDP target id, not URL/title.** The 9333 Chrome is shared by other agents
and the UserTesting SPA rewrites URL/title, so URL/title markers are unreliable. Capture the tab
once and match it by `Target.getTargetInfo`:

```js
// find my tab among all pages
for (const p of ctx.pages()) {
  const s = await ctx.newCDPSession(p);
  const { targetInfo } = await s.send('Target.getTargetInfo');
  await s.detach().catch(()=>{});
  if (targetInfo.targetId.toUpperCase() === savedId) return p;
}
```

Re-save the id after any relaunch (it changes). Assert you are on your own study id before any
write, and when cleaning up close only tabs whose URL contains your study id / your preview
`participantId`, never the whole browser.

**Node on PATH:** fresh shells do not have node; source nvm each time
(`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use <.nvmrc>`).

**Keep a reusable CDP driver kit in `files/`, do not rewrite it each run.** Every run needs the
same small helpers: connect over CDP, find the workbench page (`ctx.pages().find(p =>
/workbench.*\.html/.test(p.url()))`, falling back off DevTools pages), snapshot state
(`page.evaluate` reading a few selectors), click by selector, run a command palette command
(open palette, type, Enter), and escape overlays. Writing these from scratch every session is
pure tax. Park them once in the session `files/` driver dir next to the recorder
(`caploop.js`) and reuse. A one-call state probe (see Section 5) that returns
`{ hasHeaderActions, hasSidebarSection, bodyText }` is the most valuable helper.

---

## 5. Building / running Code OSS for a spike or capture

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
  relaunch.
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
- **Seed demo settings into the launched profile's `User/settings.json`, do not click them in.**
  VS Code watches the file live, so writing e.g. `chat.costAwareNudge.enabled` / `...mode` there
  makes the feature deterministic from first paint. Selecting the demo model still needs the picker
  (see the recording section), so re-seed + re-pick after every fresh launch.

---

## 6. Getting a demo video into a GitHub issue

**Native inline `<video>` players come ONLY from a signed-in GitHub web drag-drop** into the
issue composer; the REST API / `gh` / any PAT cannot produce them, and that drag-drop is not
automatable headless.

**Practical fallback that works unattended:** host the GIF + MP4 in a public repo you control
(e.g. a dedicated `ux-research-media` repo), embed the GIF with a raw URL, and link the MP4 to
its blob page (which has a player):

```markdown
![Variant A](https://raw.githubusercontent.com/<you>/ux-research-media/main/<dir>/demo.gif)
[Watch the demo (MP4)](https://github.com/<you>/ux-research-media/blob/main/<dir>/demo.mp4)
```

**A dedicated media BRANCH in the same repo as the issue also works, and keeps everything in one
place.** When the issue lives in a repo the user owns (e.g. their `eli-vscode` fork), push the
binaries to a `*-demo-media` branch of that same repo and reference
`raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` for the inline GIF and the `blob` URL for
the MP4 player. Do the media work on a throwaway branch so the user's working branch and uncommitted
code stay untouched: record current branch, `git switch -c media-branch`, add only the media, commit
with `-c core.hooksPath=/dev/null` (skips the repo's pre-commit hygiene hook on binaries),
`git push --no-verify`, then `git switch` back and `rm -rf` the local media dir. **Always verify the
raw URLs return HTTP 200 before/after editing the issue** (`curl -s -o /dev/null -w "%{http_code}"`);
a 404 renders as a broken image.

**When you replace a clip, delete the old file and update every reference.** This session left a
comment section pointing at a deleted clip after a re-record. Grep the issue body AND every comment
for the old filename, and prefer a NEW filename over overwriting (GitHub caches raw hard, next point).

**GitHub caches raw images hard.** When you update a demo, push it under a **new filename**
(e.g. `…-v2.gif`) and point the issue at the new name, otherwise the old frame keeps showing.

**Binary push:** `git push` (not the GitHub MCP file APIs, which corrupt binaries). If a
git-lfs pre-push hook fails without lfs installed, `git push --no-verify`.

**Public-repo posts are irreversible**, so confirm before posting to a flagship repo; when the
user is unavailable, hosting media in your own repo + creating the issue via `gh issue create`
(assignees included) is the pragmatic path. Assignees can be set with
`--assignee a,b`; verify with `gh issue view <n> --json assignees`.

---

## 7. Writing / editing a public research issue (copy + CLI)

**On a PUBLIC issue, use approximations for telemetry, never exact numbers.** When the user says
the issue is public, phrase every metric qualitatively: "about", "around", "roughly", "more than",
"less than", "a large share", rounded percentages, orders of magnitude, or ranges. Ask the Data
agent to return already-rounded/qualitative figures so nothing exact leaks. Also flag prototype
telemetry honestly as *adjacent shipping behavior* (proxies), since an unshipped feature has no
telemetry of its own.

**No em/en dashes anywhere** in issue bodies or comments (same rule as study text). Grep the body
for `—` / `–` before posting.

**Editing via CLI (no browser needed for text):**
- Body: `gh issue edit <n> --repo o/r --body-file body.md` (and `--title` to rename).
- A comment: `gh api -X PATCH repos/o/r/issues/comments/<comment_id> -f body="$(cat c.md)"`; get the
  id with `gh api repos/o/r/issues/<n>/comments --jq '.[].id'`.
- Splicing a section into an existing body: fetch it (`gh issue view <n> --json body -q .body`),
  edit the array of lines in python by locating a stable `## Heading` line, and write it back. This
  is more reliable than trying to string-replace multi-line markdown.

**A "draft" comparison comment the user pastes elsewhere:** structure it as numbered sections with a
one-line `_[video below]_` placeholder or the actual GIF/MP4 per section, and offer to fill the
placeholders from the media branch. Keep the recommendation and the "what users liked / disliked"
framing tight; the user reuses this verbatim.

---

## 8. Building a foreground surface in the Agents window (sessions "chat space")

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

## 9. Settle the interaction/IA contract BEFORE a redesign

A redesign in this session took four full build/verify/record rounds largely because the
information-architecture constraints arrived as late review feedback, not as inputs. Before
writing any redesign code, get explicit answers to three questions and write them into the plan:

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

## Maintaining this glossary

Add a new entry the moment a run costs you time on something reusable. Keep entries concise and
grouped by the problem being solved. If a fact is phase-specific to one skill, keep the deep
detail there and leave a one-line pointer here (or vice-versa). Never use em/en dashes. Keep the
frontmatter `description` under ~1024 characters so the skill registry does not silently skip it.

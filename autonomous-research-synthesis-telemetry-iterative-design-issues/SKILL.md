---
name: autonomous-research-synthesis-telemetry-iterative-design-issues
description: "Autonomous: Research Synthesis, Telemetry Data, Iterative Design Build, Issue Documentation. Turn completed UserTesting.com studies into a decision: harvest transcripts and audience, run thematic analysis, triangulate with product telemetry, build up to 3 redesign solutions in real Code OSS, record a high-resolution demo video, and open a review-ready draft GitHub issue that leads with the recommendation and embeds the demo. This is the back half of the VS Code UX research loop and pairs with autonomous-design-build-record-demo-unmoderated-research and launch. Use when asked to analyze user test results, synthesize a study, decide what to build, or document the research in an issue."
---

# Autonomous: Research Synthesis, Telemetry Data, Iterative Design Build, Issue Documentation

Turn one or more **completed UserTesting studies** into a **review-ready draft GitHub issue** that a
human can act on: recommendation first, a real demo video of the change running, findings backed by
verbatim quotes and telemetry, an A/B decision, and honest caveats, with the redesign spiked in the
real repo.

The front half (create + launch studies) is the `autonomous-design-build-record-demo-unmoderated-research` skill. This skill starts
once studies have **completed** and results are available.

Pipeline:

1. **Harvest** transcripts + audience from the UserTesting Results tab (Export data XLSX).
2. **Analyze** into ranked findings (A/B thematic analysis; store in SQLite with qual + quant evidence).
3. **Triangulate** each finding with product telemetry (Data agent / Kusto), staying on the study's topic.
4. **Build** up to 3 redesign solutions (A/B/C) in **real Code OSS** (microsoft-vscode repo), switchable
   via a dev command; use fewer options when the problem does not warrant three.
5. **Record** a real high-resolution demo **video** of the running build (demo the A/B/C toggle if there
   is more than one option); not a slideshow, not a GIF.
6. **Draft** the GitHub issue: recommendation/summary first, then the video, then findings, A/B, method + study links.

> **HARD RULE, never recreate VS Code UI in a browser.** Do NOT build an HTML/CSS/JS mockup of the
> VS Code / Agents window to illustrate a redesign. Every spike and every demo comes from **Code OSS
> launched from the microsoft-vscode repo** (Agents window or editor window, matching where the
> research applies). Building a mockup was tried once and explicitly rejected. The only legitimate
> browser use here is (a) driving UserTesting.com to harvest results and (b) driving a signed-in
> GitHub session to upload the demo video.

> **HARD RULE, demos by the agent are VIDEOS.** Deliver an MP4 recorded from the running build. A GIF
> is only ever an inline fallback preview, never the primary demo.

> **Launch your own Code OSS.** Other agents run their own OSS and their own Chrome. Always launch a
> fresh, isolated instance (the `launch` skill handles ports/profile isolation) and drive your own
> browser window. Never resize/close windows you did not open (there may be a second `Code - OSS`).

---

## Inputs

| Input | Example | Notes |
|-------|---------|-------|
| `STUDIES` | study names or ids, or the Results-tab URL(s) | The completed study/studies to harvest. A/B = two related studies. |
| `TOPIC` | "the Agents-window browser preview" | The feature under study; keeps telemetry and the spike on-topic. |
| `WINDOW` | `agents` or `editor` | Which Code OSS surface the research applies to. Build + demo there, not the other one. |
| `REPO` | `microsoft/vscode` | Where the draft issue goes. **Confirm before posting to a public flagship repo.** |
| `WORKSPACE` | a real project to demo against, e.g. `~/Code/live-slides` | An HTML/app project that shows the change well (a live preview target, etc.). |
| `PROJECT_DIR` | `~/Desktop/Automated User Testing/<study>/` | Keep ALL artifacts per project: downloads, transcripts, analysis, demo, issue body. |

If a required input is missing and there is no reasonable default, ask **once**, then proceed. In
autopilot, state assumptions and keep going; the only steps that genuinely require a human are
(a) confirming a public-repo post and (b) signing into GitHub for the native video upload.

Keep everything for a study in ONE per-project folder (the user cares about organization): move every
download into `PROJECT_DIR`, do not scatter files in `~/Downloads` or `/tmp`.

---

## Modes: plan first, then implement (automatic handoff)

Question that comes up: can the loop start in **plan mode** (ask clarifying questions, propose the
approach) and then switch itself to **agent mode** (implement) without the user manually toggling? Yes,
two ways, and neither needs a human to flip the mode picker.

**Option 1, one agent, two phases (simplest, always works).** This skill already runs as a single agent.
Just behave in two phases: open with clarifying questions via the `ask_user` tool (audience, which
findings to spike, how many solutions), get answers, then proceed straight into Phases 1 to 6. No mode
machinery, no toggle. Use this by default.

**Option 2, native Plan mode with a handoff to Agent (matches the built-in UX).** VS Code chat modes
have a first-class **handoff** mechanism. A custom mode file (`*.chatmode.md`) declares in its YAML
header a `handoffs:` list; each entry is `{ agent, label, prompt, send?, showContinueOn?, model? }`.
When the plan finishes, the handoff switches to the target agent and, if `send: true`, **auto-submits**
the handoff prompt. Example header on a Plan mode:

```yaml
---
description: Plan the change, then hand off to Agent to implement.
handoffs:
  - agent: agent            # target mode/agent to switch to
    label: Implement plan   # button label when not auto-sent
    prompt: Implement the approved plan above.
    send: true              # auto-submit to Agent (no manual click)
    model: Claude Sonnet 4.5 (copilot)   # optional: switch model on handoff
---
```

Key behaviors (verified in the VS Code source):
- **Under Autopilot permission level, the first `send: true` handoff fires automatically with zero user
  interaction**, the plan flows straight into implementation (`chatWidget.ts` triggers it). Outside
  autopilot, the user gets a one-click **"Continue on Agent"** button instead (no retyping).
- **Switching Plan or Ask into Agent does NOT clear the session or lose context.** Only transitions
  into or out of **Edit** mode with pending edits prompt to discard, so plan to agent carries the whole
  conversation forward.
- Programmatic switch (if ever needed) is `workbench.action.chat.toggleAgentMode` with args
  `{ modeId: 'agent', sessionResource }`.
- **Caveat:** the org policy `chat.tools.global.autoApprove = false` disables the auto-send handoff
  (it falls back to the manual "Continue on Agent" button). A skill file by itself cannot flip the mode
  picker; the switch lives in the chat mode/handoff, so ship it as a `*.chatmode.md` if you want the
  native Plan to Agent UX, otherwise use Option 1.

So: for this synthesis loop, Option 1 (ask questions, then build) is the default. If the user wants the
literal "Plan mode then Agent mode" experience, provide a Plan chat mode whose handoff targets `agent`
with `send: true`; in autopilot it is fully automatic, otherwise it is a single click.

---


## Composability: run phases independently and out of order

These phases are a **default order, not a locked pipeline**. Run only the phases you need, and chain
with the `autonomous-design-build-record-demo-unmoderated-research` skill in any order. The phases talk to each other through a shared
**artifact contract**, not through required state:

- **Shared root:** keep everything for a piece of work under `~/Desktop/Automated User Testing/<slug>/`
  (`PROJECT_DIR`). Both skills use this root, so artifacts produced by one are found by the other.
- **Demo video:** the real-build recording lives at `<PROJECT_DIR>/new-ui-demo.mp4` (+ `.gif`, + the
  `frames/` dir). This is the hand-off token between skills.

Common non-linear entry points:
- **Build-first, then just record + issue.** If a change was already built from your own instructions
  (normal agent work, using the `launch` skill), skip Phases 1 to 4 and run only **Phase 5** (record the
  demo video) and **Phase 6** (draft the issue). With no study yet, write a **build + demo issue**
  (summary of the change, the demo video, what it does and why, and how to try it), not a research
  findings issue. Drop the findings/telemetry/A-B sections until research exists.
- **Record once, research later.** The `new-ui-demo.mp4` you record here is exactly the real-build
  stimulus the `autonomous-design-build-record-demo-unmoderated-research` skill needs. Hand it off to that skill to run a study on the
  video (its capture phase can be skipped, see that skill's "compose" note), then come back and run
  **Phases 1 to 3** here to fold the results into the issue.
- **Analyze an existing study without rebuilding.** Run **Phases 1 to 3** and **Phase 6** only, no spike.

When you run a subset, say which phases you ran and which you skipped, and keep the issue honest about
what is evidence-backed versus a proposal.

### Optional Windows / UTM validation handoff

Windows validation is **optional, not mandatory** for every redesign. Invoke
[`automation-windows-os`](../automation-windows-os/SKILL.md) at any point in the build, comparison,
or recording phases when Windows adds meaningful evidence:

- the finding is Windows-specific;
- the redesign touches native window controls or Electron window behavior;
- accessibility, high contrast, scaling, focus, hover, maximize, or restore behavior needs checking;
- a real Windows demo is more representative than the normal local Code OSS capture;
- the only available Windows environment is a UTM VM.

This skill still owns synthesis, telemetry, design choices, source implementation, and issue
documentation. `automation-windows-os` owns the Windows transport, build provenance, interactive
execution, state matrix, evidence capture, and reversible cleanup. Its video and screenshots can
become `<PROJECT_DIR>/new-ui-demo.mp4` and the corresponding frames when Windows is the intended
review surface.

---


## Credentials: email yes, password never

Signing into UserTesting (Phase 1) and GitHub (Phase 6) is fine to do in a browser you drive. The
boundary is simple:

- **The agent MAY ask for and type a non-secret identifier**, an email address or username, into a
  login form. Ask for it in plan mode (or via `ask_user`) and type it into the Chrome field. An email
  is not a secret.
- **The agent MUST NEVER ask for, type, request, store, or log a password, one-time code, or 2FA
  token.** When the form reaches the password/2FA step, hand control to the human: stop and ask them to
  finish the sign-in, then continue once they confirm. Prefer an **already-signed-in session** so no
  credential entry is needed at all.
- **Do not persist the email** into committed files, the issue body, logs, screenshots, or the session
  DB. Keep it in memory for the current run only. Never put any personal identifier in a public artifact.
- Type the email into the specific login target (see `autonomous-design-build-record-demo-unmoderated-research` for the Chrome-over-CDP
  driver); if the driver keeps snapping to the wrong tab, target the login tab directly rather than
  guessing.

---

## Phase 1, Harvest results

Only the **transcript** and the **audience** matter. The rest of the UserTesting export is low value;
do not build the write-up around it.

Drive a **dedicated Chrome** signed into UserTesting with `playwright-core` over CDP (see
`autonomous-design-build-record-demo-unmoderated-research` for the full driver setup; do not depend on the chrome-devtools MCP). Then,
per study, on the study's **Results** tab:

1. Click **Export data** to download the XLSX (sheet name `Data`).
   - Row 0/1 are section + question headers; row 2 has sub-labels; rows 3+ are participants.
   - The "Participant ID" column looks like `P## - handle`; `Complete` appears in col 0/1.
2. Save the XLSX into `PROJECT_DIR/downloads/`.
3. Extract the **transcripts** (speech-to-text, per participant) into
   `PROJECT_DIR/transcripts/<variant>-transcripts.md` and a machine-readable
   `_extracted.json`; extract **audience/screener** answers into `_audience.json`.

Store the study metadata in SQLite (`ut_study`, `ut_participant`, `ut_transcript`) so later phases and
future runs can query it.

Playwright download handling gotcha: attach a `page.waitForEvent('download')` and `saveAs(exactPath)`;
the default download UI cannot be driven blind.

---

## Phase 2, Analyze into ranked findings

Run the heavy thematic analysis as a **subagent** (keeps the main context clean). For an A/B pair,
analyze both variants together and look for signals that show up in BOTH.

For each finding capture:
- a short claim (one sentence),
- **qual_evidence**: 2 to 4 verbatim participant quotes with `P##` attribution,
- **quant_evidence**: the telemetry that supports (or fails to support) it (filled in Phase 3),
- a rank (1 = strongest).

Persist to a SQLite `finding` table (`id, rank, claim, qual_evidence, quant_evidence`). Minimize
assertions; prefer the participants' own words over paraphrase.

Write the human-readable analysis to `PROJECT_DIR/analysis.md`.

---

## Phase 3, Triangulate with telemetry

Consult the **Data agent** (Kusto). Keep every query **on the study's topic**, e.g. for a browser
preview: side-by-side editor usage, diff/changes-view opens, preview-and-chat overlap, competing
extension adoption (Live Preview vs Simple Browser). Do not pad the issue with unrelated metrics.

Caveats to bake into the write-up:
- VS Code Stable desktop; raw events retained ~45 days, so use a ~42-day window for adoption and ~7
  days for heavy joins.
- `workbenchactionexecuted` fires only for **keyboard/palette** actions, so context-switch and
  diff-open counts are **lower bounds** (mouse clicks on tabs/files are not instrumented). Say so.
- There is no telemetry for an unshipped prototype; the numbers are **adjacent shipping behavior**,
  present them that way.

Fold the numbers into each finding's `quant_evidence`.

---

## Phase 4, Build the redesign spike(s) (real Code OSS)

Implement the top finding(s) as small, real spikes in the **microsoft-vscode** checkout, in the layer
that matches `WINDOW`:
- Agents window logic lives under `src/vs/sessions/**` (e.g. layout orchestration in
  `src/vs/sessions/contrib/layout/browser/desktopSessionLayoutController.ts`).
- Editor-window browser lives under `src/vs/workbench/contrib/browserView/**`.

### Required project skills before UI implementation

Load the relevant project skills before editing. Reference them as the source of truth rather than
copying their guidance:

- Always load `accessibility` for new or changed interactive UI.
- Load `ux-css-layout` before writing CSS, changing layout, or changing control sizing.
- Load `ux-theming` before changing colors, theme tokens, focus indicators, or high-contrast behavior.
- Load `sessions` before changing code under `src/vs/sessions/**`.

Then read every path-specific instruction file required by the checkout.

### Generate up to 3 solutions behind a dev command toggle

When a finding has more than one credible design response, build **up to three** distinct solutions
(A, B, C) rather than committing to one, and make them **switchable at runtime via a developer
command** so a reviewer can compare them live:

- Register a dev-only command (e.g. `Developer: Cycle <Feature> Solution (A/B/C)` or one command per
  option) reachable through the Command Palette (Cmd+Shift+P / Ctrl+Shift+P). Invoking it switches the
  active solution in the UI without a rebuild, so the reviewer walks A, then B, then C from the palette.
- Back the choice with a single source of truth (an observable value or a `Developer`-scoped setting)
  that each solution reads, so exactly one option renders at a time and the toggle is instant.
- Gate the command as developer/experimental (do not surface it to end users): keep it out of normal
  menus, and, for chat/agent-adjacent surfaces, respect the standard AI-feature gating so nothing
  leaks when AI features are disabled.

Implementation sketch (adapt to the surface):
- Define an enum of options and a single `observableValue` (or a `Developer`-scoped configuration key)
  holding the active option; every solution's code path reads that one value so exactly one renders.
- Register the palette command(s) via `registerAction2` / a `MenuRegistry` contribution with a
  `Developer:` category and a `when` clause that keeps it dev-only; the command body advances the enum
  (cycle A to B to C to A) or sets a specific option, then triggers the layout/render update.
- If you use an observable, an `autorun` that re-applies layout on change keeps the switch instant with
  no rebuild; if you use a setting, react to the config-change event.

**Do not force three.** The count depends on the problem: use **1** when the direction is obvious,
**2** for a genuine either/or, and **3** only when there are three meaningfully different approaches
worth a reviewer's time. State in the issue how many options exist and how to switch between them
(the exact palette command names). Prefer fewer, sharply differentiated options over three
near-duplicates.

Each option should be independently coherent (each one compiles and demos on its own). Mirror existing
patterns (e.g. reuse the existing reveal/guard rules rather than inventing new control flow). Then
validate before claiming anything:
- `npm run typecheck-client` (client sources) and/or the watch task output; never `npm run compile`.
- `npm run valid-layers-check`.
- Commit on a dedicated branch; let the pre-commit hygiene hook run.

These spikes are what the demo will show: if there are multiple options, demo the toggle (walk A/B/C
from the palette). Keep each option focused; open questions go in the issue, not in scope creep.

---

## Phase 5, Record the demo VIDEO (from the running build)

The output must be a smooth, high-resolution MP4 of the **real** running build, showing the change in
context. A 5-frame slideshow upscaled to 720p reads as blurry and low-effort; do not ship that.

Setup:
1. Launch the target surface with the `launch` skill (`--agents` for the Agents window), pointing at
   `WORKSPACE`. Env gotchas: `TMPDIR=/tmp`; node exactly 24.x and >=24.17.0 (`nvm use 24.17.0`);
   `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` in every shell.
2. Get the window into the demo state (e.g. open the integrated browser preview via the command
   palette "Browser: Open Integrated Browser", point it at a local server for `WORKSPACE`, so chat +
   preview + changes are visible together).
3. If you built multiple solutions (Phase 4), plan to demo the **A/B/C toggle**: start on option A, then
   invoke the dev command from the palette to switch to B, then C, so the video shows each option and
   how a reviewer reaches them. Either record one continuous clip that walks all options, or one clip
   per option; a single clip showing the palette switch is usually the most convincing.

Capture (scripts live next to this SKILL.md in `scripts/`; resolve relative to the skill dir):
- Use `scripts/caploop.js <cdpPort> <outDir> <seconds> [fps=12] [scale=2]` to record the **workbench**
  target. Run with `NODE_PATH="$REPO/node_modules"` so `ws` resolves.
  - **Why not startScreencast:** `Page.startScreencast` only captures the page's own layer, i.e. just
    the embedded browser preview's webContents, NOT the whole window. `Page.captureScreenshot` with
    `fromSurface:true` (what caploop uses) composites the native overlay into every frame. This is the
    single most important gotcha in this phase.
  - `scale=2` on a retina display yields ~4x the CSS resolution (very crisp).
  - **Crop math: caploop frames are `dpr × scale` times the CSS size** (on a retina 2x display with `scale=2` that is 4x). So a panel at CSS `x=520,y=36,w=293,h=570` maps to an ffmpeg `crop=1172:2280:2080:144` (multiply every number by 4). Read the actual frame dimensions with `ffprobe` on one `.jpg` before writing the crop, and get the CSS rect with a `getBoundingClientRect()` eval on the running window. That said, prefer a full-window demo over a cropped one (see Standing rules); crop only when explicitly asked.
- To animate content INSIDE the preview (e.g. navigate a slide deck), use
  `scripts/presskeys.js <cdpPort> <preview-url-substr> ArrowRight <count> <delayMs>`. This targets the
  preview's own CDP target directly, because `@playwright/cli` snaps to the focused tab and cannot
  reliably reach the embedded preview.
- Drive the workbench itself (focus chat, paste a prompt to show the control loop) with the `launch`
  skill's playwright patterns (`monaco-paste.sh`, `Control+Meta+i` to focus chat). Typing a prompt you
  do not send is fine and safe; do not fire an agent run mid-demo.

Encode:
- `scripts/frames-to-mp4.sh <outDir> <PROJECT_DIR>/new-ui-demo.mp4 1920` (uses the manifest's real
  timestamps so motion timing is faithful; outputs yuv420p + faststart).
- `scripts/frames-to-gif.sh <outDir> <PROJECT_DIR>/new-ui-demo.gif 1000` for the inline fallback.

ffmpeg lives at `/opt/homebrew/bin/ffmpeg`; `export PATH="/opt/homebrew/bin:$PATH"`.

**Pace for humans, do NOT aggressively dedupe.** Reviewers complained that clips felt "rushed" and too fast to follow. Two rules:
- Build the pacing into the **driver**, not the encoder: put deliberate `sleep`s between steps (e.g. ~3s to read the first screen, ~2s after each action, ~2s after typing) and type text at a **human delay** (`keyboard.type(text, {delay: 95})`, roughly 80-110ms/char). A good full flow is ~20-25s, not 3-5s.
- Encode with `frames-to-mp4.sh` (preserves real per-frame timestamps). **Avoid `mpdecimate`/`setpts` to "trim dead air"**: even capped, it collapses the natural holds a viewer needs and produces an unwatchable 2-4s blur. If a clip genuinely drags, re-record with tighter driver timing rather than post-trimming.

**Drive with real physical actions, not injected DOM clicks.** When recording (caploop) and driving the same window over CDP, use Playwright's physical APIs on the visible element (`locator(sel).last().click()`, `.selectOption(...)`, `keyboard.type(...)`). Fire-and-forget in-page `el.click()` / setTimeout choreography frequently updates a **hidden** DOM node while the visible UI never changes, so the recording shows nothing happening. Physical clicks/keystrokes always hit the topmost rendered element.

**Overlay/modal apps: relaunch fresh instead of re-triggering.** For flows shown as an overlay (e.g. the sessions/onboarding walkthrough), repeatedly running the dev "reset/show" command **stacks multiple overlays**; a `.last()` locator then targets a stale hidden copy. A fresh Code OSS launch starts with exactly one (or zero) overlay. Verify with `document.querySelectorAll('.<overlay-class>').length === 1` before recording; if a password/secret field won't visibly accept typed characters over CDP, capture that state as a **static screenshot** instead and lean on the video for the rest.

**Clear dev-build toasts/banners before (and during) recording.** A Code OSS dev build pops toasts that would never ship, most often *"Extension host did not start in 10 seconds, that might be a problem."*, plus the *"Run tasks in the background with the Copilot CLI"* banner and update/telemetry prompts. None of these may appear in the demo video. Run `workbench.action.clearNotifications` (F1) and dismiss any inline banner right before caploop starts, and confirm the status-bar notification bell is empty. The ext-host toast can reappear ~10s after launch/reload, so clear it again immediately before the take (or wait for the ext host to finish starting); do not record around it.

Verify by extracting a couple of frames from the final MP4 and eyeballing them before proceeding.

**Prefer big static screenshots over looping GIFs as study stimulus.** Feedback from real sessions: participants feel rushed watching a GIF loop in front of them, and small images are hard to read. For UserTesting image pages, capture a **card/element screenshot** (`locator('.card').screenshot(...)`), not a full-window shot: it is far larger and cleaner. Use the static image as the primary stimulus so the participant paces themselves; keep the MP4/GIF for the issue write-up.

Clean up: kill the Code OSS instance and any local server you started (pass literal numeric PIDs; the
bash tool refuses `kill "$VAR"`), and close your playwright daemon (`@playwright/cli -s=... close`).

---

## Phase 6, Draft the GitHub issue

Write for a human already on GitHub who expects a demo. Concise, plain, decision-oriented.

**Order (the recommendation leads):**
1. **Executive summary** with the recommendation up top.
2. **Demo** (the video), directly under the summary.
3. **What we heard** (findings), each with verbatim `P##` quotes + the telemetry line.
4. **A vs B** decision (state it is directional at small n, then give the direction).
5. **Options to try** (only if you built more than one solution): briefly describe each option (A/B/C),
   what makes it different, and the **exact Command Palette command(s)** to switch between them
   (Cmd+Shift+P / Ctrl+Shift+P). Note it is a developer/experimental toggle. Skip this section entirely
   when there is a single solution.
6. **Method and caveats**, including a **link to each UserTesting study** so reviewers can watch the
   sessions.

**Copy rules (learned from review):**
- Lead with the summary/recommendation, then the demo. Do not open with the demo.
- Cut meta narration: no "real build, not a mockup", no "where it gets built" implementation section
  with file paths. Reviewers want the finding and the demo, not the code tour.
- **No em dashes or en dashes** anywhere. Use commas, parentheses, or a plain hyphen with spaces.
- Include the **UserTesting study link(s)** in Method (URL form:
  `https://app.usertesting.com/workspaces/<workspaceId>/test/<studyId>`).

**The video (native inline player):**
- A native inline `<video>` player in an issue comes ONLY from GitHub's web upload
  (user-attachments). The REST API and any PAT **cannot** do it.
- To get it: drive a **signed-in GitHub browser session** and drag/drop `new-ui-demo.mp4` into the
  issue body composer at the top of the Demo section; GitHub inserts a `user-attachments` URL that
  renders as a player. Use the user's real Chrome (a dedicated debuggable instance, driven with
  `playwright-core` over CDP), not the integrated browser, and ask the user to sign in if needed.
  Credential rule applies (see "Credentials" above): you may type the user's GitHub email if asked to,
  but the human enters the password and any 2FA.
- Fallback when no signed-in session is available: push the MP4 to a branch and link the blob page
  (which has a player) as "Watch the demo video (MP4)", plus an inline GIF preview. Say a native
  player will be added on publish.

**Creating the issue:**
- Use `scripts/create-issue.sh create <owner> <repo> "<title>" <bodyFile> [--enable-issues]`, or
  `... patch <owner> <repo> <num> <bodyFile>` to iterate.
- Traps this helper handles: the GitHub MCP `issue_write` only **renders a form** (it does not create
  anything), and **forks have Issues disabled** (POST -> HTTP 410; pass `--enable-issues`).
- `git push` fails on the git-lfs pre-push hook when git-lfs is not installed; push with
  `git push --no-verify`. Binary assets (mp4/gif) go via a normal `git push` of a branch, not the
  GitHub MCP file APIs (which corrupt binaries).
- GitHub issues have no native "draft" state. "Draft" = an open issue clearly labeled a preview, for
  review. **Do not post to `microsoft/vscode` without explicit confirmation**; when unsure, stage an
  interim reviewable copy in a repo you control and hand off the one-step publish.

Save the final body and assets into the session's `files/` folder plus `PROJECT_DIR`, and write a
short PUBLISH-NOTES with the exact remaining steps (title, drag-in file, submit).

---

## Standing rules

> **See also the shared [`autonomous-skill-glossary`](../autonomous-skill-glossary/SKILL.md)** for
> cross-cutting, reusable gotchas across this loop: recording cleanly (bind dev commands to keys
> instead of using the command palette, clear dev-build toasts), forcing/simulating VS Code UI states
> via a render-layer observable, persistent driver + detached Chrome that survive shell churn, pinning
> your own tab by CDP target id, and getting a demo video into a GitHub issue (native player limits,
> raw-embed fallback, cache-busting filenames). Read it before recording a demo or drafting the issue,
> and add new gotchas there.

- Real Code OSS only, never a browser mockup of the UI. Agents window vs editor per the research.
- Offer up to 3 solutions (A/B/C) switchable via a dev Command-Palette toggle; use 1 or 2 when the
  problem does not warrant three, and never ship three near-duplicates.
- Demos are videos. GIF is only an inline fallback. Demo the A/B/C toggle when there is more than one option.
- **Show full context in demos, not a tight crop.** Frame the demo on the whole relevant surface (e.g. the
  entire Agents window: chat pane + the panel under test + files pane), not just the single control. A tight
  crop reads as a mockup and hides where the feature lives; reviewers asked for full context.
- **Issue order (reinforced): recommendation FIRST, then the demo directly under it**, then problem,
  findings, next steps, telemetry, method. Do NOT open with the problem or bury the demo below findings.
  When there is more than one variant, put the recommended one's demo first.
- Keep artifacts organized per project in one folder; move all downloads there.
- No em/en dashes in anything the user or reviewers read.
- Telemetry must relate to the study topic; present prototype-adjacent numbers honestly with caveats.
- **If telemetry is unreachable, say so; never fabricate.** The `ddtelvscode` cluster needs the Azure VPN;
  if the Data agent returns `TELEMETRY_UNAVAILABLE`, state plainly in the issue that no live numbers were
  pulled and none were estimated, and keep the prepared query set for a later run.
- **When the reader asks for approximations, use only magnitude words** (most / more than half / some / a
  small number / around N out of 7) and omit exact counts and percentages, even if you have them.
- Launch your own isolated Code OSS and your own browser; never touch windows you did not open; pass
  literal PIDs to `kill`. **The dedicated 9333 Chrome is shared by other agents:** leave it running, and
  close only your own tabs (match your study id / preview participantId); do not close the browser.
- Confirm before any public-repo post. Prefer a reversible interim over an unattended public action.
- Credentials: you may ask for and type an email/username into a login form; never ask for, type,
  store, or log a password or 2FA code (the human enters those). Never persist the email to any file,
  issue, log, or the session DB.

## Skill vs custom agent (how to package this)

This is a **skill** on purpose: it is procedural knowledge plus scripts that any agent loads on demand,
it stays out of the mode picker, and it is user-global across sessions with one source of truth. Keep it
that way.

Wrap it in a **custom agent / chat mode** only for what a skill cannot do:
- You want the native **plan then auto-handoff** UX (only `*.chatmode.md` files can declare `handoffs:`).
- You want a **discoverable, user-selectable** entry in the mode picker rather than relying on the model
  to pick the skill.
- You want a **scoped tool set, pinned model, or gating** for a phase.

The right shape is a **thin** chat mode that defers to this skill (its body is essentially "follow the
`autonomous-research-synthesis-telemetry-iterative-design-issues` skill"), never a copy of the procedure. Ready-to-use templates live in
`chatmodes/` next to this file; activate by copying them into a workspace `.github/chatmodes/` or your
user prompt-files location. **Guardrail:** never put an irreversible step behind an auto-send handoff.
Recruiting real participants and posting to a public repo stay explicitly human-gated; only plan to
build should auto-advance.

## Self-maintenance

When you discover a new gotcha or the user corrects the output (ordering, tone, format, hosting), fold
the fix back into this SKILL.md (and scripts) so the next run starts from the improved baseline.

**Keep the frontmatter `description` under ~1024 characters.** A longer description can make the skill
registry silently skip the skill (it still installs on disk and works when read manually, but does not
register as invocable). This skill's description is intentionally kept under that limit.

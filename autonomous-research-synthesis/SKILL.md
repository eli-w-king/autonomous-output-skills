---
name: autonomous-research-synthesis
description: "Autonomous: Research Synthesis. Turn research into decisions without supervision: harvest completed Outset studies (MCP or the results watcher), UserTesting exports, or local export folders; screen participant quality; run traceable thematic analysis with verbatim, attributed quotes; triangulate with telemetry from the VS Code data agent; then deliver what was asked: a light Markdown readout organized by feature, a quote pull, a minimal HTML slideshow, a decision digest of an issue epic, or the full loop (redesign spikes in real code, a demo video, and a review-ready GitHub issue that leads with the recommendation). Never invents quotes or metrics and never cites synthetic participants. Use for 'analyze these studies', 'pull quotes that support X', 'make a slideshow of the results', 'summarize what was decided in these issues', or 'turn the findings into an issue'. Pairs with research-platforms, autonomous-user-studies, autonomous-demos, and autonomous-prototypes."
---

# Autonomous: Research Synthesis

Turn completed studies (Outset, UserTesting, or exported transcripts) and related research into
decisions. The output ranges from a light readout or a quote pull to the full loop: a
**review-ready draft GitHub issue** that a human can act on, with the recommendation first, a real
demo video of the change running, findings backed by verbatim quotes and quantitative evidence, a
clear decision, and honest caveats, with the redesign spiked in the real repo.

The front half (create + launch studies) is the `autonomous-user-studies` skill. This skill starts
once studies have **completed** and results are available.

Pipeline:

1. **Harvest** the complete evidence bundle: study metadata, stimuli, questions and answers,
   audience, transcripts, and behavior or video observations (Outset, UserTesting, or local exports).
2. **Analyze** into ranked, traceable findings with verbatim quotes, contradictions, and confidence.
3. **Triangulate** each finding with quantitative data appropriate to the target surface.
4. **Iterate** in the real target repo: Code OSS for app work, the website/prototype repo for web
   work, up to 3 switchable solutions when the problem warrants them.
5. **Record** a real high-resolution demo **video** of the running target (per `autonomous-demos`)
   and validate the file.
6. **Draft** the GitHub issue: recommendation first, then video, findings, decision, method, and
   study links.

Most requests need only part of this. See "Pick the output" below before starting.

> **HARD RULE, iterate in the real target surface.** App redesigns and demos come from **Code OSS
> launched from microsoft-vscode**. Website redesigns come from the actual website/prototype repo and
> are demonstrated at the real hosted/local URL. Never use a browser facsimile to stand in for the
> desktop app, and never use a static mock to claim a web implementation works.

> **HARD RULE, demos by the agent are VIDEOS.** Deliver an MP4 recorded from the running build. A GIF
> is only ever an inline fallback preview, never the primary demo.

> **Own every automation target.** Other agents run their own Code OSS, browsers, and local servers.
> Always launch fresh isolated targets and record their numeric PIDs, ports, profile paths, and CDP
> target ids. Never focus, resize, navigate, close, or kill a target you did not create.

---

## Pick the output

| Ask | Output | Phases |
|-----|--------|--------|
| "Light analysis", "interim readout" | `analysis.md` with metrics, verbatim quotes, and insights, organized by feature section | 1, 2 (3 if telemetry helps) |
| "Pull quotes that support X" | a quote pull in a `.txt` or `.md`, opened on request | 1, quote rules |
| "Make a slideshow of the results" | a minimal self-contained HTML deck, visually QA'd | 1, 2, slideshow rules |
| "What was decided in these issues" | a decision digest of an issue epic | decision digest rules |
| "Turn the findings into an issue", "decide what to build" | spikes, demo video, review-ready issue | 1 to 6 |

### Quote rules

- Verbatim only, attributed to the participant and paragraph (`D-0007, P0176`), never invented,
  never from synthetic interviews. Trim only for repetition and say so ("lightly trimmed for
  repetition").
- Lead with the claim and the count ("5 of 8 participants asked to see the models in the pool"),
  then the best headline quote, then supporting quotes grouped by sub-theme, then counter-evidence.
- Keep the variant visible (default versus experimental) when the study is a comparison.

### Light readouts

- Organize by feature section (the user asked for this) with per-participant metrics where the
  guide has ratings, the strongest quotes, and plain insights. Name the sample size and caveats
  (in-progress, monadic, no media in exports) up front. No em or en dashes.

### Slideshows

- One self-contained HTML file, minimal and calm ("cute minimal"), one idea per slide, real quotes
  and numbers only, keyboard navigation, readable on small screens and in dark mode. Render it to
  images and look at them before handing it over.

### Decision digests from issues and epics

- Read the epic, every linked issue, and their comments; the latest comment beats the original
  proposal. Output simple action bullets ("change the menu order to X", "rename Y to Z"), grouped by
  UI section (for example composer, session list), each with a link to its source comment.
- Mark state per item: done items get a checkmark at the start of the first line and a second,
  indented line naming the PR or reason; items under investigation get a clear marker. Keep the
  checklist format the user approved rather than switching to tables or columns.
- Compare each decision with the current product (an upstream build) and list gaps as action items.
  If asked for a demo of the current state, record it per `autonomous-demos` from a clean upstream
  build, covering every state discussed, and never fix or fake the product to make the demo complete.
- Put the demos in one row at the top when the user asks, and keep internal telemetry out of public
  or shared issues unless the user asks for it (and remove it when asked).

---

## Inputs

| Input | Example | Notes |
|-------|---------|-------|
| `STUDIES` | Outset study ids or names, UserTesting study URLs, or local export folders | The completed studies to harvest. A/B = two related studies. Resolve Outset names with `search` or `list_studies`. |
| `TOPIC` | "the Agents-window browser preview" | The feature under study; keeps telemetry and the spike on-topic. |
| `SURFACE` | `agents`, `editor`, `website`, or `prototype` | The real target surface. `WINDOW` remains a compatible alias for app studies. |
| `TARGET_URL` | deployed site or hosted/local prototype URL | Required for web studies; pin the exact version used for each round. |
| `REPO` | `microsoft/vscode` | Where the draft issue goes. **Confirm before posting to a public flagship repo.** |
| `SOURCE_REPO` | `microsoft/vscode` or the website/prototype repo | Where the implementation under test lives. |
| `WORKSPACE` | a real project to demo against, e.g. `~/Code/live-slides` | Optional supporting workspace for app demonstrations. |
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
with the `autonomous-user-studies` skill in any order. The phases talk to each other through a shared
**artifact contract**, not through required state:

- **Shared root:** keep everything for a piece of work under `~/Desktop/Automated User Testing/<slug>/`
  (`PROJECT_DIR`). Both skills use this root, so artifacts produced by one are found by the other.
- **Demo video:** the real-target recording lives at `<PROJECT_DIR>/new-ui-demo.mp4` (+ `.gif`, + the
  `frames/` dir). This is the hand-off token between skills.

Common non-linear entry points:
- **Build-first, then just record + issue.** If a change was already built from your own instructions
  (normal agent work, using the `launch` skill), skip Phases 1 to 4 and run only **Phase 5** (record the
  demo video) and **Phase 6** (draft the issue). With no study yet, write a **build + demo issue**
  (summary of the change, the demo video, what it does and why, and how to try it), not a research
  findings issue. Drop the findings/telemetry/A-B sections until research exists.
- **Record once, research later.** The `new-ui-demo.mp4` you record here is exactly the real-build
  stimulus the `autonomous-user-studies` skill needs. Hand it off to that skill to run a study on the
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

Outset harvesting needs no login (API calls via `research-platforms`). UserTesting harvesting and
GitHub uploads (Phase 6) use a browser you drive. The boundary is simple:

- **The agent MAY ask for and type a non-secret identifier**, an email address or username, into a
  login form. Ask for it in plan mode (or via `ask_user`) and type it into the Chrome field. An email
  is not a secret.
- **The agent MUST NEVER ask for, type, request, store, or log a password, one-time code, or 2FA
  token.** When the form reaches the password/2FA step, hand control to the human: stop and ask them to
  finish the sign-in, then continue once they confirm. Prefer an **already-signed-in session** so no
  credential entry is needed at all.
- **Do not persist the email** into committed files, the issue body, logs, screenshots, or the session
  DB. Keep it in memory for the current run only. Never put any personal identifier in a public artifact.
- Type the email into the specific login target (see `autonomous-user-studies` for the Chrome-over-CDP
  driver); if the driver keeps snapping to the wrong tab, target the login tab directly rather than
  guessing.

---

## Phase 1, Harvest results

Preserve the evidence needed to trace every recommendation. Transcripts and audience are essential,
but they are not the whole study: structured answers, task context, stimulus versions, observed
behavior, completion state, and video moments can change the interpretation.

Results come from one of three sources; use the matching subsection:

- **1A Outset**: the results watcher or the Outset MCP via [`research-platforms`](../research-platforms/SKILL.md).
- **1B UserTesting**: the study's Results tab export from a dedicated signed-in Chrome.
- **1C Local exports**: folders the user downloaded (for example
  `~/Downloads/Outset Study - <name>/` with one DOCX per interview).

### 1A Outset

```js
const { outsetMcp } = await import(`${process.env.HOME}/.copilot/skills/research-platforms/scripts/research-client.mjs`);
const outset = await outsetMcp();
```

#### 1.0 Prefer the watcher: the transcripts may already be on disk

The results watcher polls for completed interviews and harvests them automatically, so a study that
finished overnight is usually already staged:

```bash
node ~/.copilot/skills/research-platforms/scripts/watch-studies.mjs --status
node ~/.copilot/skills/research-platforms/scripts/watch-studies.mjs --dry-run   # harvest now
```

Transcripts land in `PROJECT_DIR/transcripts/` as one JSON per interview. **Check there before
calling the API**; re-harvesting wastes time and quota.

#### 1.1 Harvest directly (when the watcher has not run)

```js
const ivs = await outset.callJson('list_interviews', {
  study_id: STUDY_ID,
  completed_only: true,
  interview_types: ['USER'],   // REQUIRED, see below
  limit: 50,
});
for (const iv of ivs.interviews) {
  const t = await outset.callJson('get_interview_transcript', { interview_id: iv.id });
  // write to PROJECT_DIR/transcripts/
}
```
Pagination is cursor-based: pass back `next_cursor` until it is null.

> **Always filter `interview_types: ['USER']`.** SYNTH interviews are LLM-simulated participants used
> for guide QA. They are **not research data**: their answers are a model's prior about a persona, not
> evidence, and nothing they say is falsifiable. A synthetic quote in an issue is worse than no quote,
> because it looks like evidence. Never cite one, never let one into the finding set.

#### 1.2 Screen for participant quality BEFORE analyzing

Every interview carries `is_low_quality`, `fraud_score`, `screened_out`, and
`total_engagement_time_seconds`. Check them first:

- Exclude `is_fraud` / high `fraud_score` outright.
- Treat `is_low_quality` as suspect: read it, but do not build a finding on it alone.
- A very short `total_engagement_time_seconds` relative to the others usually means a skimmer.

**Say in the write-up how many interviews you harvested and how many you excluded, and why.** A
finding drawn from 3 of 7 participants is a different claim than one drawn from 7 of 7.

#### 1.3 Pull the analysis Outset already did

Outset runs its own analysis passes. Use them as **leads to verify against transcripts**, never as
findings to copy:

- `peek_report` / `list_reports` / `get_topline_insights`, the AI executive summary.
- `search_report_answers` -> `list_answer_messages`, an answer plus its source quotes.
- `search_vision_observations` / `list_vision_aggregated_insights`, observed UX behavior for
  screenshare studies (where the participant struggled, what they missed).
- `search_vision_task_results`, per-question task-completion verdicts.
- `search_emotion_observations` / `get_emotion_crosstab`, emotion signal.
- `search_project_highlight_clips`, quotable moments with timestamps.

These have no UserTesting equivalent and are the biggest analysis upgrade in the new pipeline. Treat
every AI-generated claim as a hypothesis and confirm it in the transcript before it becomes a finding.

#### 1.4 Historical context from Marvin (read-only)

Marvin holds prior studies. Before writing findings, check whether this is already known:

```js
const { marvinMcp } = await import(`${process.env.HOME}/.copilot/skills/research-platforms/scripts/research-client.mjs`);
const marvin = await marvinMcp();
await marvin.call('ask', { question: 'What have we learned about <topic>?' });
```
`ask` is async: if it returns `in_progress`, poll `get_ask_status`. Also useful: `search`,
`list_projects`, `get_file_summary`.

A finding that **replicates** an earlier study is stronger, and worth saying so explicitly.

> **Marvin is read-only right now.** The key carries `mcp:read` only, so new Outset transcripts
> **cannot be pushed into Marvin** until a broader key is minted (Settings -> MCP, add `file:write` +
> `project:write`). Outset remains the system of record for new studies. Do not describe the loop as
> if it round-trips, and do not silently skip this step: if cross-study context would have mattered,
> say that it was unavailable.

### 1B UserTesting

Drive a dedicated Chrome signed into UserTesting with `playwright-core` over CDP (see
`autonomous-user-studies`; do not depend on the chrome-devtools MCP). Then, per study, on the
**Results** tab:

1. Record the study id, title, status, field dates, audience, exact question/task text, and stimulus
   checksums/URLs in `PROJECT_DIR/run.json` and `PROJECT_DIR/artifacts.json`.
2. Click **Export data** to download the XLSX (sheet name `Data`).
   - Row 0/1 are section + question headers; row 2 has sub-labels; rows 3+ are participants.
   - The "Participant ID" column looks like `P## - handle`; `Complete` appears in col 0/1.
3. Save the XLSX into `PROJECT_DIR/downloads/`.
4. Extract structured task/question answers plus completion metadata into `_responses.json`.
5. Extract the **transcripts** (speech-to-text, per participant) into
   `PROJECT_DIR/transcripts/<variant>-transcripts.md` and a machine-readable
   `_extracted.json`; extract **audience/screener** answers into `_audience.json`.
6. When a claim depends on what a participant did rather than what they said, record a timestamped
   observation linked to the participant, task, stimulus version, and source recording. Do not infer
   behavior from transcript text alone.

Store study metadata in SQLite (`ut_study`, `ut_participant`, `ut_transcript`, `ut_response`,
`ut_stimulus`, `ut_observation`) so later phases and future runs can query it. Use stable synthetic
participant ids in exported reports; do not persist names or handles unless access to the source
requires them.

Playwright download gotcha: attach `page.waitForEvent('download')` and `saveAs(exactPath)`; the
default download UI cannot be driven blind.

### 1C Local exports (DOCX or ZIP folders the user downloaded)

- Copy the folders into `PROJECT_DIR/downloads/` first; never edit the originals.
- Extract DOCX text losslessly from the `w:t` runs of `word/document.xml` into one JSON and one TXT
  per interview, numbering paragraphs (`P0001`, `P0002`, ...) with the speaker role, so every quote
  cites `<interview id>, P###` (for example `D-0007, P0176`).
- Interview ids encode the study variant (for example `C-` default and `D-` experimental in a
  monadic pair); keep that mapping in `run.json`.
- In-progress studies grow: when the user adds new completed interviews, add them and say what
  changed in the readout. Exports carry no screenshots or video, so do not describe what
  participants saw beyond what the transcript states.

### 1D Persist

Store study metadata and per-interview rows in SQLite (`study`, `participant`, `transcript`) so later
phases and future runs can query it without re-fetching. Keep every artifact under `PROJECT_DIR`.

---


## Phase 2, Analyze into ranked findings

Run the heavy thematic analysis as a **subagent** (keeps the main context clean). For an A/B pair,
analyze both variants together and look for signals that show up in BOTH.

Build an evidence matrix before writing prose. For each finding capture:
- a short claim (one sentence),
- **qual_evidence**: 2 to 4 verbatim participant quotes with `P##` attribution,
- **quant_evidence**: the telemetry that supports (or fails to support) it (filled in Phase 3),
- **observations**: linked behavior/video moments and structured responses,
- **contradictions**: evidence that does not fit the claim,
- **stimulus_version** and study round,
- **confidence**: high/medium/low with a one-line reason,
- a rank (1 = strongest).

Persist normalized sources plus links between `finding`, `evidence`, `recommendation`, and
`validation` records. A recommendation must be navigable back to its participant/source and forward
to the prototype change and rerun result. Minimize assertions; prefer participants' own words and
observed behavior over paraphrase.

Write the human-readable analysis to `PROJECT_DIR/analysis.md`.

---

## Phase 3, Triangulate with telemetry

Choose the quantitative source by surface:

- **VS Code app:** consult the **Data agent** (Kusto) for adjacent shipping behavior.
- **VS Code website:** use the approved web analytics source (for example CJA) and preserve the
  segment, date range, filters, and metric definition with each result.
- **Prototype:** state that direct product telemetry does not exist unless the prototype itself was
  instrumented; use baseline or adjacent behavior only as context.

Keep every query on the study's topic. Do not pad the issue with unrelated metrics.

Caveats to bake into the write-up:
- VS Code Stable desktop; raw events retained ~45 days, so use a ~42-day window for adoption and ~7
  days for heavy joins.
- `workbenchactionexecuted` fires only for **keyboard/palette** actions, so context-switch and
  diff-open counts are **lower bounds** (mouse clicks on tabs/files are not instrumented). Say so.
- There is no telemetry for an unshipped prototype; the numbers are **adjacent shipping behavior**,
  present them that way.

Fold the numbers into each finding's `quant_evidence`.

Quantitative disagreement is not a failed triangulation. Record whether data supports, weakens, or
cannot test the qualitative finding. Keep exact internal figures out of public write-ups; publish
approved rounded ranges or qualitative summaries.

---

## Phase 4, Build the redesign spike(s) in the real target repo

Implement the top finding(s) as small, real spikes in `SOURCE_REPO`:
- `agents` / `editor`: use **microsoft-vscode** in the layer matching the surface.
- `website` / `prototype`: use the actual site/prototype source and run the real target at
  `TARGET_URL` (or its documented local equivalent).

For Code OSS:
- Agents window logic lives under `src/vs/sessions/**` (e.g. layout orchestration in
  `src/vs/sessions/contrib/layout/browser/desktopSessionLayoutController.ts`).
- Editor-window browser lives under `src/vs/workbench/contrib/browserView/**`.

### Required project skills before UI implementation

For VS Code source changes, load the relevant project skills before editing. Reference them as the
source of truth rather than copying their guidance:

- Always load `accessibility` for new or changed interactive UI.
- Load `ux-css-layout` before writing CSS, changing layout, or changing control sizing.
- Load `ux-theming` before changing colors, theme tokens, focus indicators, or high-contrast behavior.
- Load `sessions` before changing code under `src/vs/sessions/**`.

Then read every path-specific instruction file required by the checkout.

### Iterate deliberately; generate only meaningful alternatives

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

Treat baseline, alternatives, and revisions as immutable rounds. Pin each round to a source commit,
stimulus checksum, study id, and field date. When feedback changes a prototype, create a new version
and rerun only the questions needed to test that change; never overwrite the earlier stimulus and
then compare results as if nothing changed.

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

Setup for `agents` / `editor`:
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

For `website` / `prototype`, open `TARGET_URL` in the run-owned browser at the pinned viewport and
record the actual rendered flow. Use the website repo's existing development server and browser test
tools when available. Do not record a design file or static screenshot and present it as a working
web implementation.

Record per [`autonomous-demos`](../autonomous-demos/SKILL.md): its rules, brief, driver, encoder, speed
ramps, and QA apply here. The capture scripts below now live in `../autonomous-demos/scripts/`.
Use the composited `caploop.js` path only when the integrated browser preview (a native overlay)
must be in frame:
- Use `caploop.js <cdpPort> <outDir> <seconds> [fps=12] [scale=2]` to record the **workbench**
  target. Run with `NODE_PATH="$REPO/node_modules"` so `ws` resolves.
  - **Why not startScreencast:** `Page.startScreencast` only captures the page's own layer, i.e. just
    the embedded browser preview's webContents, NOT the whole window. `Page.captureScreenshot` with
    `fromSurface:true` (what caploop uses) composites the native overlay into every frame. This is the
    single most important gotcha in this phase.
  - `scale=2` on a retina display yields ~4x the CSS resolution (very crisp).
  - **Crop math: caploop frames are `dpr × scale` times the CSS size** (on a retina 2x display with `scale=2` that is 4x). So a panel at CSS `x=520,y=36,w=293,h=570` maps to an ffmpeg `crop=1172:2280:2080:144` (multiply every number by 4). Read the actual frame dimensions with `ffprobe` on one `.jpg` before writing the crop, and get the CSS rect with a `getBoundingClientRect()` eval on the running window. That said, prefer a full-window demo over a cropped one (see Standing rules); crop only when explicitly asked.
- To animate content INSIDE the preview (e.g. navigate a slide deck), use
  `presskeys.js <cdpPort> <preview-url-substr> ArrowRight <count> <delayMs>`. This targets the
  preview's own CDP target directly, because `@playwright/cli` snaps to the focused tab and cannot
  reliably reach the embedded preview.
- Drive the workbench itself (focus chat, paste a prompt to show the control loop) with the `launch`
  skill's playwright patterns (`monaco-paste.sh`, `Control+Meta+i` to focus chat). Show the full flow
  (prompt typed and sent) per the demo rules; if a live agent run would have side effects, use a
  scripted mock (`autonomous-demos`) instead of stopping short.

Web capture: use the target repo's existing browser recorder when available. Otherwise, drive only
the run-owned page and capture timestamped full-viewport frames with Playwright `page.screenshot()`;
write the timestamps to the same manifest format consumed by `frames-to-mp4.sh`. Record navigation,
scroll, pointer, and keyboard actions through visible Playwright APIs, not DOM mutation.

Encode:
- `frames-to-mp4.sh <outDir> <PROJECT_DIR>/new-ui-demo.mp4 1920` (uses the manifest's real
  timestamps so motion timing is faithful; outputs yuv420p + faststart).
- `frames-to-gif.sh <outDir> <PROJECT_DIR>/new-ui-demo.gif 1000` for the inline fallback.

ffmpeg lives at `/opt/homebrew/bin/ffmpeg`; `export PATH="/opt/homebrew/bin:$PATH"`.

**Pace for humans, do NOT aggressively dedupe.** Reviewers complained that clips felt "rushed" and too fast to follow. Two rules:
- Build the pacing into the **driver**, not the encoder: put deliberate `sleep`s between steps (e.g. ~3s to read the first screen, ~2s after each action, ~2s after typing) and type text at a **human delay** (`keyboard.type(text, {delay: 95})`, roughly 80-110ms/char). A good full flow is ~20-25s, not 3-5s.
- Encode with timestamps (`encode-screencast.py` or `frames-to-mp4.sh`). **Avoid `mpdecimate` or blanket `setpts` to "trim dead air"**: it collapses the natural holds a viewer needs. Fast-forward only marked idle waits, in place, with `speed-ramp.mjs`; if a clip drags anywhere else, re-record with better driver timing.

**Drive with real physical actions, not injected DOM clicks.** When recording (caploop) and driving the same window over CDP, use Playwright's physical APIs on the visible element (`locator(sel).last().click()`, `.selectOption(...)`, `keyboard.type(...)`). Fire-and-forget in-page `el.click()` / setTimeout choreography frequently updates a **hidden** DOM node while the visible UI never changes, so the recording shows nothing happening. Physical clicks/keystrokes always hit the topmost rendered element.

**Overlay/modal apps: relaunch fresh instead of re-triggering.** For flows shown as an overlay (e.g. the sessions/onboarding walkthrough), repeatedly running the dev "reset/show" command **stacks multiple overlays**; a `.last()` locator then targets a stale hidden copy. A fresh Code OSS launch starts with exactly one (or zero) overlay. Verify with `document.querySelectorAll('.<overlay-class>').length === 1` before recording; if a password/secret field won't visibly accept typed characters over CDP, capture that state as a **static screenshot** instead and lean on the video for the rest.

**Clear dev-build toasts/banners before (and during) recording.** A Code OSS dev build pops toasts that would never ship, most often *"Extension host did not start in 10 seconds, that might be a problem."*, plus the *"Run tasks in the background with the Copilot CLI"* banner and update/telemetry prompts. None of these may appear in the demo video. Run `workbench.action.clearNotifications` (F1) and dismiss any inline banner right before caploop starts, and confirm the status-bar notification bell is empty. The ext-host toast can reappear ~10s after launch/reload, so clear it again immediately before the take (or wait for the ext host to finish starting); do not record around it.

Verify the media before publishing:

```bash
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,pix_fmt \
  -of json "$PROJECT_DIR/new-ui-demo.mp4"
ffmpeg -v error -i "$PROJECT_DIR/new-ui-demo.mp4" -f null -
```

Then extract opening, midpoint, and ending frames and inspect them. Use a versioned filename for every
replacement (`new-ui-demo-v2.mp4`), update `artifacts.json`, and verify the uploaded URL plays from a
fresh browser session. HTTP 200 alone does not prove a video decodes.

**Prefer big static screenshots over looping GIFs as study stimulus.** Participants feel rushed watching a GIF loop, and small images are hard to read. Capture the region around the component with about 56 px of surrounding UI (tight element crops read as cut-outs; tiny full windows are unreadable). Use the static image as the primary stimulus; keep the MP4/GIF for the issue write-up. Stimulus rules live in `autonomous-user-studies`.

Clean up: kill the Code OSS instance and any local server you started (pass literal numeric PIDs; the
bash tool refuses `kill "$VAR"`), and close your playwright daemon (`@playwright/cli -s=... close`).

---

## Phase 6, Draft the GitHub issue

Write for a human already on GitHub who expects a demo. Concise, plain, decision-oriented.

**Order (the recommendation leads):**
1. **Executive summary** with the recommendation up top.
2. **Demo** (the video), directly under the summary.
3. **What we heard** (findings), each with verbatim `P##` quotes + the telemetry line.
4. **Decision / iteration result** (state when it is directional at small n, then give the direction).
5. **Options to try** (only if you built more than one solution): briefly describe each option (A/B/C),
   what makes it different, and the **exact Command Palette command(s)** to switch between them
   (Cmd+Shift+P / Ctrl+Shift+P). Note it is a developer/experimental toggle. Skip this section entirely
   when there is a single solution.
6. **Method and caveats**, including study round, stimulus version, sample limits, harvested and
   excluded counts, contradictions, and a **link to each study** (Outset or UserTesting) so
   reviewers can watch the sessions.

**Copy rules (learned from review):**
- Lead with the summary/recommendation, then the demo. Do not open with the demo.
- Cut meta narration: no "real build, not a mockup", no "where it gets built" implementation section
  with file paths. Reviewers want the finding and the demo, not the code tour.
- **No em dashes or en dashes** anywhere. Use commas, parentheses, or a plain hyphen with spaces.
- Include the **study link(s)** in Method: Outset
  `https://outset.ai/project/<projectId>/survey/<studyId>/results` (or the per-interview
  `.../interview/<interviewId>/read`), UserTesting
  `https://app.usertesting.com/workspaces/<workspaceId>/test/<studyId>`.
- State **how many participants were harvested and how many excluded** for quality (Phase 1.2), and
  note that **no synthetic (AI-simulated) interviews were included**.
- Keep the evidence matrix in the project artifacts; the issue gets the concise claims, representative
  evidence, confidence/caveats, and links needed to audit them.

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
- Binary assets (mp4/gif) go via a normal `git push` of a branch, not text-oriented file APIs. Honor
  the repository's hooks; if a required git-lfs tool is missing, install/configure it or use a
  dedicated media repository whose normal validation accepts the files.
- GitHub issues have no native "draft" state. "Draft" = an open issue clearly labeled a preview, for
  review. **Do not post to `microsoft/vscode` without explicit confirmation**; when unsure, stage an
  interim reviewable copy in a repo you control and hand off the one-step publish.

Save the final body and assets into the session's `files/` folder plus `PROJECT_DIR`, and write a
short PUBLISH-NOTES with the exact remaining steps (title, drag-in file, submit).

---

## Standing rules

> **See also the shared [`autonomous-skill-glossary`](../autonomous-skill-glossary/SKILL.md)**: run
> ledger, evidence chain, media validation, and GitHub publishing in its `SKILL.md`; recording in
> `references/recording.md`; Code OSS build and state simulation in `references/code-oss.md`; study
> platforms in `references/studies.md`. Read the relevant part before recording or drafting the
> issue, and add new gotchas there.

- Real target only: Code OSS for app surfaces, actual site/prototype source for web surfaces.
- Offer up to 3 solutions (A/B/C) switchable via a dev Command-Palette toggle; use 1 or 2 when the
  problem does not warrant three, and never ship three near-duplicates.
- Demos are videos. GIF is only an inline fallback. Demo the A/B/C toggle when there is more than one option.
- **Show full context in demos, not a tight crop.** Frame the demo on the whole relevant surface (e.g. the
  entire Agents window: chat pane + the panel under test + files pane), not just the single control. A tight
  crop reads as a mockup and hides where the feature lives; reviewers asked for full context.
- **Issue order (reinforced): recommendation FIRST, then the demo directly under it**, then problem,
  findings, next steps, telemetry, method. Do NOT open with the problem or bury the demo below findings.
  When there is more than one variant, put the recommended one's demo first.
- Keep the complete evidence bundle and durable manifests organized per project in one folder.
- Link findings to source evidence, contradictions, stimulus version, recommendation, and rerun result.
- No em/en dashes in anything the user or reviewers read.
- Quantitative evidence must relate to the study topic and match the surface. Present adjacent
  numbers honestly and say whether they support, weaken, or cannot test the finding.
- **If telemetry is unreachable, say so; never fabricate.** The `ddtelvscode` cluster needs the Azure VPN;
  if the Data agent returns `TELEMETRY_UNAVAILABLE`, state plainly in the issue that no live numbers were
  pulled and none were estimated, and keep the prepared query set for a later run.
- **When the reader asks for approximations, use only magnitude words** (most / more than half / some / a
  small number / around N out of 7) and omit exact counts and percentages, even if you have them.
- Launch your own isolated Code OSS, browser/profile, and local server; record their ownership receipt
  in `run.json`, never touch windows you did not open, and pass literal PIDs to `kill`. If a legacy
  shared Chrome is unavoidable, close only your own tabs (match target id plus study id/participantId)
  and leave the browser running.
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
`autonomous-research-synthesis` skill"), never a copy of the procedure. Ready-to-use templates live in
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

---
name: autonomous-user-testing
description: "Autonomously create a review-ready UserTesting.com study for a VS Code feature. Can start in a plan phase that gathers missing inputs (topic, audience, participant count, and the account email) then auto-hands off to build. Drives a signed-in Code OSS build (Agents window or editor window) in the microsoft-vscode repo to capture the real UI flow (screenshots + walkthrough GIF), then authors a think-out-loud study whose questions sit alongside their screenshots. Stops at a review-ready Draft; launches (1 to 7 real paid participants) only on explicit approval. May type the account email into the sign-in form but never the password or 2FA. Use for 'run a user test', 'create a UserTesting study', or 'get user feedback on <feature>'. Pairs with the launch skill (drives Code OSS) and the companion user-research-synthesis skill (analyzes results)."
---

# Autonomous User Testing (VS Code UX Research Loop)

Turn a one-line research topic, e.g. *"I want to know how users interact with the new bidirectional voice mode in the editor window"*, into a **review-ready UserTesting.com study**, with **zero human clicks up to the launch gate**:

1. **Capture** the real feature flow inside a signed-in Code OSS build (screenshots per step + a stitched walkthrough GIF).
2. **Author** a think-out-loud UserTesting study where every question is shown **on the same screen as its screenshot**.
3. **Configure** the audience, then **prepare the study for review** (leave it as a Draft and hand back a Preview link + Review link). **Do NOT launch.**
4. **Launch only on explicit approval**, once the user says okay (or after you incorporate their comments), launch with the requested participant count (1 to 7).

This skill encodes the exact procedure plus every non-obvious gotcha discovered building the first study by hand. Follow it top to bottom; it is designed so a fresh agent can run it unattended **up to the launch gate**, which always requires a human okay.

> **HARD RULE, never recreate VS Code UI in a browser.** Do NOT build HTML/CSS/JS mockups or
> facsimiles of the VS Code / Agents window UI in a web page, ever. All capture (and any real
> implementation or redesign) happens in **Code OSS launched from the microsoft-vscode repo**, in the
> **Agents window or the editor window**. The only legitimate use of a browser in this workflow is to
> drive **UserTesting.com** (Phase 2+). Screenshots and demos must come from the real launched VS Code
> build, not a recreated UI.

> **When this runs.** The typical trigger is *"go test this"* right after an agent has been building
> or prototyping a feature. That means the invoking agent usually has **rich context** about the
> feature, the design intent, and the target user. Use that context to shape the `FEATURE_FLOW`, the
> questions, and especially the **audience** (who should evaluate this), rather than defaulting blindly.

> **Scope.** This skill covers **capture, author, prepare-for-review, and (on approval) launch**
> (Phases 1 to 4). The default endpoint is a **review-ready Draft with a Preview link**, not a live
> study; launching is a separate, explicitly-gated step. Harvesting results and analyzing
> transcripts/videos (scraping the Results tab, extracting insights, prototyping redesigns, recording a
> demo video, drafting the issue) is the companion **`user-research-synthesis`** skill, the back half of
> this loop.

---

## Inputs

The orchestrator provides:

| Input | Example | Notes |
|-------|---------|-------|
| `TOPIC` | "how users interact with bidirectional voice mode in the editor window" | The research question in plain English. |
| `FEATURE_FLOW` (optional) | "open editor, start voice mode, speak a command, hear the reply" | The concrete steps to capture. If omitted, derive from `TOPIC` by exploring the feature in the repo/UI. |
| `PARTICIPANTS` (default `1`) | `1` | How many panelists to recruit **at launch**. Never more than 7. Only used in Phase 4, after the user approves; the study is set to this count but not launched until then. |
| `AUDIENCE` (optional) | "voice-first vibe coders + devs who use agentic AI tools" | Who should evaluate this. If omitted, infer from `TOPIC` + prototype context (see Phase 3). Reuse a fitting shared audience or create a new clearly-named, reusable one. |
| `WINDOW` (optional, default agents) | `agents` or `editor` | Which signed-in Code OSS surface to capture (Agents window vs regular editor window). Usually stated in the prompt. |
| `WORKSPACE_URL` (optional) | the UserTesting test-plan URL | An existing study to edit. If omitted, **create a new study from scratch** (Phase 2.0a). |
| `TRACK_IN_GITHUB` (optional, default off) | `true` | If set, also mirror the study as a card on the shared **"VS Code UX Research"** GitHub Project and move its Status as it progresses (Phase 3.5). Optional, additive; never block the core loop on it. |
| `ACCOUNT_EMAIL` (optional) | `you@example.com` | The user's UserTesting account email. Ask for it in plan mode if not provided. The agent may **type** it into the sign-in form, but the human enters the password and any 2FA (see "Credentials"). |

If any required input is missing and no reasonable default exists, ask **once**, then proceed.

### Per-topic Demo Brief (resolve before capturing)

Before Phase 1, answer these from `TOPIC` (explore the feature in the repo/UI if needed). They
define *what* to capture; the standing rules in §1.0 define *how*.

1. **Arc**, the single entry point and the success/end state.
2. **Happy path**, the minimal representative sequence; what to deliberately skip.
3. **Meaningful states**, the distinct UI states that each deserve one screenshot.
4. **Prompt/goal text**, the realistic-but-generic goal to type (reveals nothing private).
5. **What we're probing**, the 1-2 UX questions this demo must surface (keeps capture focused).
6. **Edge states**, whether to intentionally show an error/empty state, or happy-path only.
7. **Preconditions**, does the flow need a git repo, a file open, or a specific panel visible?
8. **Who should test this**, the target audience for the feature (feeds Phase 3): people who code or vibe code, screened for the tools relevant to this surface.

---

## Modes: plan first, then auto-handoff to build

Prefer to start in a **plan phase** that gathers missing info before doing any capture, then hand off
automatically to the build/execute phase. Two ways, neither needs the user to flip the mode picker:

**Option 1, one agent, two phases (default, always works).** This skill runs as a single agent. Open by
resolving the inputs and Demo Brief with the user via `ask_user`, the `TOPIC`/`FEATURE_FLOW`, the
`AUDIENCE`, `PARTICIPANTS` (default 1), `WINDOW`, and the **`ACCOUNT_EMAIL`** for UserTesting, then flow
straight into Phase 1 to 4. No mode machinery. Ask only for what is genuinely missing; in autopilot,
state assumptions and continue.

**Option 2, native Plan mode with a handoff to Agent (matches the built-in UX).** VS Code chat modes
have a first-class **handoff** mechanism. A custom `*.chatmode.md` file declares a `handoffs:` list in
its YAML header; each entry is `{ agent, label, prompt, send?, showContinueOn?, model? }`. When the plan
finishes, the handoff switches to the target agent and, if `send: true`, **auto-submits** the prompt:

```yaml
---
description: Plan the study (gather topic, audience, participants, account email), then hand off to build it.
handoffs:
  - agent: agent
    label: Build the study
    prompt: Capture the flow and author the UserTesting study from the plan above.
    send: true
---
```

Verified behaviors (from the VS Code source):
- **Under Autopilot permission level, the first `send: true` handoff fires automatically with zero
  clicks**, the plan flows straight into capture/authoring. Outside autopilot the user gets a one-click
  **"Continue on Agent"** button (no retyping).
- **Plan or Ask into Agent does NOT clear the session or lose context** (only Edit-mode transitions with
  pending edits prompt to discard). The gathered inputs carry forward.
- Programmatic switch if ever needed: `workbench.action.chat.toggleAgentMode` with
  `{ modeId: 'agent', sessionResource }`.
- **Caveat:** org policy `chat.tools.global.autoApprove = false` disables the auto-send (falls back to
  the manual button). A skill file alone cannot flip the mode picker; ship a `*.chatmode.md` if you want
  the native Plan to Agent UX, otherwise use Option 1.

The launch gate in Phase 4 is unaffected: recruiting real participants still requires explicit human
approval regardless of how plan hands off to build.

---

## Composability: run phases independently and out of order

These phases are a **default order, not a locked pipeline**. Run only what you need and chain with the
`user-research-synthesis` skill in any order, via a shared **artifact contract**:

- **Shared root:** everything lives under `~/Desktop/Automated User Testing/<slug>/`. Both skills use
  this root, so a video/frames produced by one are found by the other.
- **Study stimulus:** a real-build recording (`walkthrough.mp4`/`.gif` here, or `new-ui-demo.mp4` from
  the synthesis skill) plus per-state screenshots.

**Skip Phase 1 capture when you already have real-build media.** If a change was built from your own
instructions and the demo was already recorded (e.g. the synthesis skill's `new-ui-demo.mp4` + `frames/`,
or any real Code OSS recording), do NOT recapture. Reuse that media as the study stimulus and jump
straight to **Phase 2** (author the study), using the existing clip in the "watch this clip, then tell
us" step (§2.3 step K, a concept/reaction study). The only hard requirement is that the media came from
a **real Code OSS build**, never a browser mockup, which the synthesis recording already satisfies.

Common non-linear flow: build from instructions, then use the synthesis skill for record + issue only,
then hand the recorded video here to run a study on it (capture skipped), then loop the results back
into synthesis Phases 1 to 3 to enrich the issue.

When you run a subset, say which phases you ran and which you skipped.

---

## Credentials: email yes, password never

Signing into UserTesting is fine to do in the dedicated Chrome you drive. The boundary is simple:

- **The agent MAY ask for and type a non-secret identifier**, the UserTesting account **email** (or
  username), into the sign-in form. Ask for it in plan mode (`ACCOUNT_EMAIL`) or via `ask_user`, then
  type it into the field. An email is not a secret.
- **The agent MUST NEVER ask for, type, request, store, or log a password, one-time code, or 2FA
  token.** When the form reaches the password/2FA step, hand control to the human: ask them to finish
  the sign-in, then continue once `page.url()` lands on `app.usertesting.com/workspaces/...`. Prefer an
  **already-signed-in profile** so no entry is needed at all.
- **Do not persist the email** into committed files, the study content, logs, screenshots, or anywhere
  public. Keep it in memory for the current run only.
- Type the email into the specific login tab (the Chrome-over-CDP driver in §2.1a). If the driver snaps
  to the wrong tab, target the login page directly rather than guessing.

---

## Prerequisites (verify before starting)

- **`launch` skill** available at `.agents/skills/launch/scripts/launch.sh`, used to boot a **signed-in** Code OSS build. Read that skill; this one depends on it.
- **A way to drive a logged-in Chrome for UserTesting.** The **recommended, battle-tested** approach
  (works even when no chrome-devtools/Playwright MCP is callable) is a **dedicated Chrome instance you
  control over CDP** with `playwright-core` (see §2.1a). Do **not** rely on the `chrome-devtools` MCP
  or its shared `~/.cache/chrome-devtools-mcp/chrome-profile`: in practice that MCP may be
  **uncallable in your runtime** (and can even be pulled mid-session), the VS Code **integrated
  browser is logged out** of UserTesting, and the shared devtools profile is often **in use by other
  agent sessions** (touching it disrupts them). A dedicated instance sidesteps all three.
- **`ffmpeg`** on PATH (stitch frames into a video and convert to GIF).
- **`jq`**, **`rsync`**, **`git`**, and **Node**, note the Code OSS build needs the **exact Node from
  `.nvmrc`** (e.g. 24.17.0); the VS Code `preinstall` hard-fails on a wrong major (see §1.2).
  `playwright-core` also runs fine under that Node.
- A **UserTesting study open** in that dedicated Chrome, on the `.../test/<id>/test-plan` page, with
  the user already signed in. Confirm the login persists (navigating there should NOT redirect to
  `auth.app.usertesting.com/login`). If it does, open the UT dashboard in that instance and sign in:
  you MAY type the `ACCOUNT_EMAIL` into the form, but the human enters the password and any 2FA (see
  "Credentials"). Prefer an already-signed-in profile so no entry is needed.

---

## Phase 1, Capture the feature flow in Code OSS

Goal: an ordered set of screenshots (one per meaningful UI state) plus a walkthrough video, saved to a per-topic media folder.

> **Skip this phase if you already have real-build media** (see "Composability" above): reuse an
> existing real Code OSS recording + screenshots and jump to Phase 2. Only capture fresh when you do not
> already have suitable real-build media.

### 1.0 Standing demo-capture rules (ALWAYS enforced)

These are fixed policies, do not vary them per topic. They exist so every demo is
consistent, legible, private-safe, and comparable across studies.

**Environment (locked):**
- **Repo/workspace:** always **microsoft-vscode** (the user's primary vscode checkout/worktree).
- **Auth:** always **signed in**, using the **user's real signed-in profile** (the launch skill's
  default source profile, do **not** pass `--use-mock-keychain`). **Verify** sign-in before
  capturing a single frame: screenshot and confirm the account avatar is present and there is no
  "Sign in to use Agents" modal. If unauthenticated, stop and ask the user to sign in.
- **Model:** always a **Claude** model. Select it in the session type / model picker before starting.
- **Theme:** always **light**. The launched profile is a clone of the user's, so force it after
  launch, e.g. set `"workbench.colorTheme": "Default Light Modern"` in the launched profile's
  `User/settings.json`, or run *Preferences: Color Theme → Light*, and confirm via a screenshot.
- **Window size:** aim for **1280×800** for reproducible framing, but **capture at a consistent size
  across all frames** for a given study rather than forcing an exact number. On Electron, resizing via
  CDP does **not** work (`Browser.getWindowForTarget` is absent), and AppleScript window control needs
  Accessibility permission (often blocked). If you can't set the exact size, just capture every frame
  at whatever the launched window's size is, consistency matters more than the specific dimensions.
- **DPI/zoom:** capture at **2× DPI** and keep default editor zoom so text stays legible when the
  GIF is downscaled to ~900px wide.

**Content / privacy:**
- Always use the **microsoft-vscode** folder/repo (the user's primary checkout). Because the user's
  real profile is in use, the Sessions sidebar and Files panel may show real work, and **the user's
  own name appearing in frame is fine**. Still keep **no secrets, tokens, other people's private
  data, or unrelated private repo contents** in frame; pick a benign folder/goal and avoid panning
  over sensitive session history.
- microsoft-vscode is itself a git repo, so it already satisfies the worktree/isolation requirement
  directly (no throwaway repo needed). Only create a scratch repo if a specific flow needs one that
  microsoft-vscode can't provide.

**Length / pacing (agreed target):**
- Target **≤ 45 seconds**, **8-12 key frames** for the walkthrough. Cut ruthlessly to the arc.
- Hold **decision-point** frames longer, **progress** frames shorter (the stitch script's per-frame
  hold handles this).

**Framing / correctness:**
- **Prefer the feature's own simulate/dev/mock command over driving the real thing.** For features
  that need hardware, a live backend, or human input (voice, camera, real agent runs, network calls),
  clicking the real control in a throwaway build usually illustrates **nothing**. Before hand-driving,
  grep the feature for a dev/simulate command (e.g. voice mode ships
  `agentsVoice.simulateConnection` = *"Voice: Simulate Connection (Dev)"*, which plays a deterministic
  scripted timeline: idle → live partial/committed transcript → assistant reply). Run it from the
  command palette (F1) and screenshot the scripted states, reliable, repeatable, no mic/backend
  needed. Reserve real clicks for the parts that genuinely render (entry point, toggles, tooltips).
- **One screenshot per meaningful state** (a decision or a state change), not per click.
- **No cursor overlay or click-annotation captions**, keep frames clean; the per-screen question
  text carries the ask. (Playwright/CDP screenshots render no synthetic
  cursor.) **Park the mouse away** (e.g. `page.mouse.move(650,400)`) before each shot so a hover
  tooltip doesn't pollute the frame.
- **Wait for async UI to settle** before each shot (e.g. agent *"Working…" → completed*).
- **Verify every screenshot** with the `view` tool before advancing.
- **End on an unambiguous success state.**

### 1.1 Pick a media folder
```bash
SLUG=$(echo "$TOPIC" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-' | cut -c1-40)
MEDIA="$HOME/Desktop/Automated User Testing/$SLUG"
mkdir -p "$MEDIA/frames"
```

### 1.2 Launch a signed-in Code OSS window (Agents window OR editor window)
Use the `launch` skill. **Choose the window type from the prompt:** the **Agents window** (pass
`--agents`) or a **regular signed-in VS Code editor window** (omit `--agents`). Not every feature
lives in the Agents window, and the initial prompt will usually specify which surface to capture;
default to whichever matches the feature under test.

**Two hard-won gotchas (apply to both window types):**

- **Short TMPDIR.** macOS `$TMPDIR` is a long `/var/folders/...` path; the launcher's IPC socket then exceeds the 103-char UNIX socket limit and the main process dies with `EINVAL ... .sock`. **Always override `TMPDIR=/tmp`.**
- **Do NOT pass `--use-mock-keychain`** when you need the signed-in variant. The mock keychain blocks the real macOS keychain where GitHub/Copilot tokens live, so the window boots to a sign-in modal. Omit it to inherit the real login.

```bash
cd /path/to/microsoft-vscode             # a BUILT checkout (has node_modules + out/)
LAUNCH=.agents/skills/launch/scripts/launch.sh
# Agents window:
INFO=$(TMPDIR=/tmp "$LAUNCH" --agents --repo "$PWD" 2>/tmp/launch.err | tail -n1)
# ...or a regular signed-in editor window (drop --agents):
# INFO=$(TMPDIR=/tmp "$LAUNCH" --repo "$PWD" 2>/tmp/launch.err | tail -n1)
CDP=$(jq -r .cdpPort <<<"$INFO"); PID=$(jq -r .pid <<<"$INFO")
```
If the current worktree isn't built (`no node_modules`/`out/`), you have two options, in order of preference:
1. **Build a sibling checkout** if one is already built, but **verify it actually contains the feature
   under test.** Built siblings can be **weeks stale** and missing the very feature you're testing
   (check with `git log`/`git diff` against the feature branch, or grep the sibling for a
   feature-specific symbol/command). If the feature isn't there, the sibling is useless for this study.
2. **Build the feature branch yourself** when no built checkout has the feature. This is the common
   case right after prototyping. Use the **exact Node from `.nvmrc`** (the VS Code `preinstall`
   hard-fails on a wrong major, e.g. it rejects Node 22 when `.nvmrc` says 24.17.0):
   ```bash
   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
   nvm install "$(cat .nvmrc)" && nvm use "$(cat .nvmrc)"
   npm install            # ~2-4 min
   npm run compile        # ~1-2 min incremental; do NOT use for typecheck loops
   ```
   `npm install` + compile is well under 10 min on a warm machine; budget more on a cold one.

### 1.3 Drive the UI and screenshot each step
Attach to the Code OSS window over `$CDP` with **`playwright-core` `chromium.connectOverCDP`** (same
technique as the UserTesting driver in §2.1a, install `playwright-core` once in a temp dir and reuse
it for both). Pick the workbench page by URL (`/workbench.*\.html/`). Typing gotchas: Monaco ignores
`fill`/`type` for the editor, but the **command palette (F1) accepts `keyboard.type`**, which is the
easiest way to run dev/simulate commands and open features. See the `launch` skill for the
`monaco-paste.sh` clipboard helper if you must inject text into a Monaco editor. Walk the
`FEATURE_FLOW`, screenshotting every meaningful state into `$MEDIA` with **zero-padded, ordered names**:

```
00-<state>.png, 01-<state>.png, ...   # main flow
frames/run-1.png ...                   # extra frames for the video
```
Verify each screenshot with the `view` tool before moving on (catch sign-in modals, empty inputs, wrong tab, etc.).

**Worktree/isolation note (if the feature involves the Agents "isolation" control):** the Worktree option is only enabled when the chosen folder is a **git repo**. Since we always work in **microsoft-vscode** (a git repo), this is satisfied out of the box; just point the session at the microsoft-vscode folder. Only if you deliberately need a different, non-repo folder would you create a scratch git repo and select it via the folder picker's **Select…** (the launch skill enables `files.simpleDialog.enable` so the quick-input folder dialog is drivable).

### 1.4 Build the walkthrough video, then a GIF
Stitch the ordered PNGs into an MP4 with per-frame holds, then convert to GIF.
**Critical: UserTesting's media uploader accepts only JPEG / PNG / GIF, MP4 is rejected.** So the deliverable that gets uploaded is the **GIF**.

```bash
# See scripts/make-walkthrough.sh, stitches $MEDIA/*.png into walkthrough.mp4
"$SKILL_DIR/scripts/make-walkthrough.sh" "$MEDIA"
# Convert to an upload-safe GIF:
"$SKILL_DIR/scripts/mp4-to-gif.sh" "$MEDIA/walkthrough.mp4" "$MEDIA/walkthrough.gif"
```

### 1.5 Clean up Code OSS
```bash
kill "$PID" 2>/dev/null || true          # Electron eats 1-4 GB; always clean up
```

---

## Phase 2, Author the UserTesting study

Drive the study's `test-plan` page in the logged-in Chrome. **Design principle learned the hard way:** put **each question on the SAME screen as its screenshot**.

### 2.0a Create the study from scratch

Do NOT rely on a pre-made copy; each run creates its own study. From the UserTesting dashboard:

1. Click **Create test** > **Think out loud test** > **New experience** > **Create test**.
2. Name it appropriately for the topic (no em-dashes/en-dashes in the title). Set **Device: Computer**,
   **Language: English**. Click **Create**.
3. The first step is always the **canonical intro** (Instructions) from §2.0 (verbatim).
4. Build out the rest of the study per §2.0 to §2.3 (one Image "Question page" per captured screen,
   with the question as a spoken Instruction-text prompt; conceptual questions as Verbal steps).

Once the tasks are built, do the audience in Phase 3.

### 2.0 Question-writing principles (elicit stories, not verdicts)

The demo is only the stimulus, the **questions** determine whether you get "yeah it's fine" or a
three-minute story. Author every prompt to pull **rich, open-ended verbal data**. This is the most
important lever on insight quality.

**The 10 rules:**
1. **Open, never closed.** Start with *What / How / Walk me through / Tell me about*, never
   *Do you / Is it / Would you*. If it's answerable in one word, rewrite it.
2. **Real past behavior beats hypotheticals.** *"Tell me about the last time you…"* > *"Would you…"*.
   People narrate memories richly and speculate poorly.
3. **Ask for the thinking, not the rating.** *"Walk me through what you expect to happen and why."*
4. **Non-leading.** Never embed the answer or praise the feature (no "this handy new…"). Neutral only.
5. **Expectation vs. reality.** *"What did you expect this to do? What actually happened?"*, surfaces
   mental-model gaps, the highest-value signal.
6. **Built-in follow-up.** End each prompt with a *why / what makes you say that / tell me more* so a
   single spoken answer goes several layers deep.
7. **Chase emotion & friction.** *"What was the most confusing / surprising / frustrating moment, and
   what caused it?"*
8. **Anchor to their world.** *"How does this compare to how you do this today?"*, reveals the real
   alternative and switching cost.
9. **Don't make them designers.** Never *"how would you design this?"* Ask about the underlying need
   (*"tell me about a time you needed…"*); let analysis drive design.
10. **Keep pure verbal pure.** Move any numeric 1-7 rating into its own **Rating scale** question on
    the same image page, so the story prompt isn't cut short by "…now give me a number."
11. **Keep it human: 2 to 3 questions per screen, maximum.** A real person answers these out loud,
    so a paragraph stuffed with 5 questions overwhelms them and fragments the answer. Pick the 2 to 3
    highest-value asks per screen (a good default trio: one observation/expectation, one story from
    their own experience, and one "why"). Depth comes from strong, open phrasing and the built-in
    follow-up, not from stacking more questions.

**Phrasing starters that work:** "Walk me through…", "Tell me about a time when…", "Describe out loud
what you think just happened…", "What were you expecting here, and why…", "What's going through your
mind as you…", "How does this compare to how you do this today…", "What would you want to check
before trusting…".

**Anti-patterns to delete on sight:** "Do you like…", "Is this clear? (yes/no)", "Would you use…",
"Rate this" *(as the only ask)*, "How would you design…", anything with the answer baked in.

**Writing style (HARD RULE): never use em-dashes or en-dashes (— or –) anywhere** in questions,
instructions, or study titles. Use periods, commas, colons, or parentheses instead. This applies to
every piece of text you type into the study. (For numeric ranges write "1 to 7" or "1-7" with a
plain hyphen.) Sanity-check before launch by scanning your generated text for the `—`/`–` characters.

**Intro-step framing** should prime narration: remind them there are no wrong answers, ask them to
**think aloud and explain their reasoning**, and say the more they talk, the more useful it is. Use
this exact canonical intro as step 1 (Instructions), adapting only "Agents window" to the surface
under test:

> Thanks for helping us explore an early build of the VS Code Agents window. There are no right or
> wrong answers here. We're testing the product, not you. The most useful thing you can do is think
> out loud: narrate what you're seeing, what you expected, and what surprises or confuses you, and
> why. Tell us stories from your own experience whenever they come to mind, and the more you talk,
> the more we learn. Have feedback afterward? File an issue at https://github.com/microsoft/vscode.
> Cheers, VS Code Team

### 2.1a Drive UserTesting via a dedicated Chrome over CDP (recommended driver)

This is the reliable way to author the study, and it also works for driving Code OSS in Phase 1.

**Launch a dedicated Chrome instance (own profile + debug port), then have the user sign in once:**
```bash
MYPROFILE="/tmp/ut-chrome-profile"; mkdir -p "$MYPROFILE"
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9333 --user-data-dir="$MYPROFILE" \
  --no-first-run --no-default-browser-check --hide-crash-restore-bubble \
  --new-window "https://app.usertesting.com/" >/tmp/chrome-ut.log 2>&1 &
sleep 5; curl -s http://localhost:9333/json/version | head -c 200   # confirm CDP is up
```
Use a **fresh port + profile** so you never touch the shared `chrome-devtools-mcp` profile that other
agent sessions rely on. If not already signed in, you MAY type the `ACCOUNT_EMAIL` into the login form,
then have the **user enter the password and any 2FA** (never handle the password yourself, see
"Credentials"). Poll for login: `page.url()` should land on `app.usertesting.com/workspaces/...`, not
`auth.app.usertesting.com`.

**Install and connect `playwright-core` once, reuse for every step:**
```bash
mkdir -p /tmp/ut-driver && cd /tmp/ut-driver && npm init -y >/dev/null && npm i playwright-core
```
```js
import { chromium } from 'playwright-core';
const b = await chromium.connectOverCDP('http://localhost:9333');
const page = b.contexts()[0].pages().find(p => p.url().includes('usertesting.com'));
```

**The single most important builder fact: UserTesting is a shadow-DOM / custom-element app.**
`page.evaluate(() => document.querySelectorAll(...))` returns **nothing** for the editable fields and
most controls, they live in shadow roots. **Use Playwright's role/text locators, which pierce shadow
DOM**, never DOM scraping:
- **Editable fields** (instruction text, question text, alt text): `page.getByRole('textbox')`. Fields
  have **no stable placeholder in the DOM tree**; identify the one you want by its **current value**
  (`await el.inputValue()` then `startsWith(...)`), or by index/order. Instruction/alt placeholders
  like `Add your instructions` / `Add alt text` do work via `getByPlaceholder(...).last()`.
- **Buttons that aren't `<button>`s** (`Create test`, the test-type cards, audience cards, the header
  tabs, `Launch test`): `getByRole('button',{name})` sometimes misses because they're divs/links. Fall
  back to `page.getByText('...', {exact:true}).first().boundingBox()` then `page.mouse.click(cx,cy)`.
  For cards, click the **card body** (title y + ~130px), not the title text, to avoid star/info icons.
- **File upload:** `const [fc] = await Promise.all([page.waitForEvent('filechooser'),
  page.getByText('Upload image',{exact:true}).last().click()]); await fc.setFiles(path);` then wait
  ~4s for the thumbnail to render.
- **No stale-uid bookkeeping needed** (unlike the chrome-devtools MCP): re-query by role/text on each
  call and the shadow-DOM churn is a non-issue.
- Navigation between tabs can be slow; after clicking `Create a test` / `Launch test`, **poll
  `page.url()` / body text for up to ~60s** rather than a fixed wait.

### 2.1 The key UserTesting limitation (do not fight it)
- A **"Verbal response"** step has only a question-text field, **it cannot hold an image**.
- An **image "Question page"**'s inline *Add question* offers Multiple choice, Written response, Rating scale, NPS, Matrix, Ranking, Image, Instructions, **"Verbal response" is NOT available there**.
- ⇒ You **cannot** co-locate a *formal* Verbal-response object with an image, in either direction.

**Workaround that preserves the spoken-answer experience AND shows the image:** create one **Image "Question page"** per screen and put the question **into that page's Instruction text**, phrased as a spoken prompt (e.g. *"…tell us out loud: …"*). Because the study is **think-out-loud with screen + audio always recording**, the participant answers by talking while the screenshot stays on screen. Keep genuinely image-less, conceptual questions (terminology, overall wrap-up) as standalone **Verbal response** steps.

### 2.2 Builder mechanics
- The study auto-saves ("Saved" appears in the header), never look for a Save button.
- **Add a step:** click **+ Add** to open the left "Add" panel (it shows headings Guidance / Tasks /
  Questions / Media), then click the item by its text (e.g. **Image**, **Verbal response**,
  **Instructions**). The panel item lives in the left column (x well under ~470px), disambiguate from
  right-pane content by x-position. **Image** creates a "Question page" with an instruction textbox +
  image uploader + Alt text + an "Add question" menu.
- **Set the spoken prompt:** fill the page's **Instruction text** (a `getByRole('textbox')`) with the
  context + question. To overwrite prefilled text (Image pages seed *"Review the image, then answer…"*),
  focus it, `Meta+a` then `Backspace`, then `fill()`.
- **Upload media:** use the filechooser pattern in §2.1a with the PNG (or the **GIF** for the
  walkthrough).
- **Standalone verbal:** add **Verbal response** → fill its "Question text" (`getByPlaceholder('Add
  your question').last()`).
- **Verify before moving on:** re-read all `getByRole('textbox')` values and the header
  *"Tasks & questions: N"* count; scan every value for `—`/`–` (must be none).

### 2.3 Recommended study shape
```
1. Intro (Instructions)                        , welcome + think-out-loud ask + "file issues at github.com/microsoft/vscode"
2. Image: first screen   + spoken question     , first impressions / what is this / where to start
3. Verbal: terminology                         , is the naming clear? (conceptual, no image)
4..N. Image: each flow screen + spoken question, one Image page per captured screenshot
K. Image: walkthrough GIF + spoken question    , "watch this clip, then tell us…"
last-1. Image: end-state screen + spoken question
last. Verbal: overall wrap-up                  , 1-7 ease rating + biggest confusion + one change
```
For 1-7 rating questions you can either bake the scale into the spoken prompt ("…on a scale of 1-7…") or, if you want structured data on an image page, add a **Rating scale** question to that page (Rating scale IS available on Question pages; Verbal is not).

### 2.4 Reconnect / recovery gotcha
`connectOverCDP` reattaches cleanly to the dedicated Chrome as long as the process is alive and the
`--remote-debugging-port` is up, just call `chromium.connectOverCDP('http://localhost:9333')` again
(cookies/login persist in the profile). If Chrome was closed or the port is dead, relaunch it with the
same `--user-data-dir=/tmp/ut-chrome-profile` (login survives via the profile) and re-navigate to the
`.../test/<id>/test-plan` URL. Only kill a Chrome PID by its **numeric pid**; never use name-based
kills. Warn the user first if they might be mid-preview in that window.

---

## Phase 3, Audience, validate, prepare for review (do NOT launch)

1. **Choose or build the audience to fit the feature.** On the **Audience tab** → **Add audience**, you can either:
   - **Reuse** an existing shared audience (e.g. "VS Code Developer, uses AI Tools") when it already fits the feature, **or**
   - **Create a new audience** when the topic calls for different screening. This skill is usually invoked right after building a prototype, so the invoking agent has rich context about the feature and its intended user, use that to shape who should test it.

   Read the audience's **screener questions and targeting** and make them match who should evaluate these designs. Tailoring guidance:
   - **Recruit people who code or "vibe code."** They do **not** have to be professional developers. Engineers, hobbyists, students, and vibe coders all count, as long as they actually build software.
   - **Keep the tools list current.** The older default lists are out of date. Screen for modern AI coding / agentic tools such as **Claude Code, Cursor, Codex, GitHub Copilot, Google Antigravity**, and similar, and replace stale entries.
   - **Match the tools list to the feature under test.** For example, a voice-mode study should screen for voice-first / agentic development tools specifically; a different surface should list the tools relevant to it.
2. **Name any new audience clearly and make it reusable.** Give it a **clear, descriptive name** (e.g. "Vibe coders + devs, uses agentic AI tools") and save it as a **shared/selectable** audience so other people and future runs can pick it. Do not leave it as a private one-off.
3. Set **Number of participants** to `PARTICIPANTS`. **Never more than 7** (default `1`). This just configures the count; it does **not** recruit anyone until Phase 4. Confirm the right-rail "Participants:" reflects it.
4. **Validate on the Review tab.** Confirm the summary (task count, audiences) and that there are **no validation flags** (scan page text for `required|error|incomplete|missing|fix`). Also scan all generated text for `—`/`–` (must be none). The **Launch test** button becoming enabled means it passed validation. **Do not click it.**
5. **Capture the Preview link.** On the Review (or Test builder) page click **Preview**, it opens the participant's-eye-view of the study in a new tab. Record that tab's URL as the **preview link**. (Preview requires being signed in to the same account; it is the best way for the user to experience the study before spending recruitment credits.) Also record the **review link** `https://app.usertesting.com/workspaces/<ws>/test/<id>/review`.
6. **Leave the study as a Draft** and proceed to the hand-back (Deliverables). **Do NOT launch.** Under this skill, launching is a distinct, explicitly-approved step (Phase 4).

> **Optional:** if asked, the study can be moved into the appropriate workspace/folder (e.g. a
> "vscode" folder) via the study's actions menu. This is optional and fine to skip.

**The default endpoint of a run is a review-ready Draft, never a live study.** Always hand back the
preview link + review link and stop. Launch happens only in Phase 4, on an explicit human okay.

---

## Phase 3.5, Optional GitHub Project tracking (only if `TRACK_IN_GITHUB`)

A durable, cross-run dashboard so studies awaiting review don't get lost. **Optional and additive:
never block the core loop on it**, if `gh` is missing, unauthenticated, or the project can't be
resolved, log a one-line note and continue with the conversational hand-back.

- **One shared board, reused every run.** Look for a GitHub Project (v2) named **"VS Code UX Research"**
  owned by the user (or the vscode org if that's where the user works); create it once if absent. Do
  **not** create a new project per study.
- **One item (card) per study.** Add a draft item titled like the study (`VS Code Voice Mode in the
  Editor (early build)`), with the body containing: the review link, the preview link, the media
  folder path, participant count, audience name, and the short gap summary.
- **Status field values** (create them once on the project if missing), moved as the study progresses:
  - `Needs review`, set now, at the end of Phase 3.5 (study is a Draft awaiting the user's okay).
  - `Changes requested`, the user left comments; you are revising (loop back to Phase 2/3).
  - `Approved`, the user said okay to launch (about to run Phase 4).
  - `Live`, set immediately after a successful launch (Phase 4).
  - `Done`, reserved for the future results/analysis skill.
- Recipe sketch (adapt owner/number; discover with `gh project list`):
  ```bash
  gh project list --owner "@me"                       # find or confirm "VS Code UX Research"
  gh project item-create <NUM> --owner "@me" \
    --title "<study title>" --body "<links + summary>"
  # set Status via: gh project item-edit ... --field-id <Status> --single-select-option-id <Needs review>
  ```
  If the `gh project` field plumbing is fiddly, a **tracking issue** in the user's repo (labeled
  `ux-research`, with a Status checklist in the body) is an acceptable lighter-weight fallback.

---

## Phase 4, Launch (ONLY on explicit approval)

**Never run this phase autonomously.** It recruits real paid participants and is effectively
irreversible once someone starts a session. Enter Phase 4 only when the user, after seeing the
preview/review links, gives an explicit go-ahead (e.g. "okay", "launch it", "ship with 3").

1. **Handle the two responses:**
   - **Comments / change requests** → treat as `Changes requested`: revise the tasks/audience (Phases
     2 to 3), re-capture the preview link, hand back again, and wait. Do **not** launch.
   - **Explicit okay** → proceed to launch. Confirm the participant count from the okay (honor an
     explicit number, else use `PARTICIPANTS`, default `1`); **max 7**.
2. **Re-validate** on the Review tab (no validation flags; no long dashes anywhere). Set the participant
   count if the user changed it.
3. **Click Launch test.** The Launch button is often unlabeled in the a11y tree, it's the last button
   in the right-rail Summary card, below Settings; click via its text/box coordinates if needed.
   Expect a **"Test launched!"** toast and the header switching to **"Live 0/N"** with a **Pause**
   control. Screenshot to confirm.
4. If tracking in GitHub, move the card to **`Live`**.
5. Report the live status and the monitor/review links.

> **Editing a study after launch:** to change anything on a live study you must **pause** first
> (header **Pause** → confirm), edit, then **resume** from the **Review** page (**Resume** → confirm).
> Pausing is safe when `Live 0/N` (no one has started). If completed sessions exist, editing may
> affect that data, so warn the user first.

---

## Deliverables to report back

**Default (end of Phase 3 / 3.5), review-ready, NOT launched:**
- The media folder path (`$MEDIA`) with all screenshots + `walkthrough.gif` (+ `walkthrough.mp4` for reuse).
- The **Preview link** (participant's-eye view) and the **Review link** `https://app.usertesting.com/workspaces/<ws>/test/<id>/review`.
- Status: **Draft / Needs review** (explicitly note it is NOT live and awaits the user's okay to launch, with the participant count that will be used).
- If tracking in GitHub: the Project/board link and the card's current Status.
- A short note of the identified UX gaps and any topic-specific adaptations or limitations hit.
- A clear prompt for the user: reply with **comments** to revise, or **okay to launch** (optionally with a 1 to 7 participant count).

**After Phase 4 (only if the user approved a launch):**
- Launch status (**Live N/M**) and the monitor/review links; GitHub card moved to **Live** if tracking.

---

## Consolidated gotchas (quick reference)

- **Standing capture rules (§1.0):** microsoft-vscode repo · signed in (real profile, verify avatar) · Claude model · **light** theme · consistent window size (~1280×800, exact not required) · ≤45s / 8-12 frames · no cursor overlay (park the mouse before each shot) · one shot per state.
- **NEVER recreate VS Code / Agents UI in a browser (hard rule).** No HTML/CSS/JS mockups of the UI. All capture and any real build happens in Code OSS from the microsoft-vscode repo (Agents window or editor window). Browser use is only for driving UserTesting.com.
- **Prefer the feature's simulate/dev command (§1.0):** for voice/camera/backend/agent features, run the built-in dev command (e.g. `agentsVoice.simulateConnection`) instead of driving the real thing; clicking the real control in a throwaway build usually shows nothing.
- **Driver = dedicated Chrome + `playwright-core` over CDP (§2.1a):** own `--user-data-dir` + `--remote-debugging-port=9333`; never touch the shared `chrome-devtools-mcp` profile (other sessions use it); the chrome-devtools MCP may be uncallable and the integrated browser is logged out.
- **UserTesting is shadow-DOM (§2.1a):** `document.querySelectorAll` finds nothing; use `getByRole('textbox')` / `getByText` / `getByPlaceholder`, identify fields by current value, click non-button controls via `getByText(...).boundingBox()` + `mouse.click`. No stale-uid bookkeeping.
- **Node version (§1.2):** build Code OSS with the exact `.nvmrc` Node (preinstall hard-fails on wrong major). A built sibling only helps if it actually contains the feature, siblings go stale; verify or build the feature branch yourself.
- **Create from scratch (§2.0a):** Create test > Think out loud test > New experience > Create test; name it; Device Computer, Language English; step 1 = canonical intro.
- **No long dashes (§2.0):** never type `—` or `–` in any study text; use commas/periods; "1 to 7" not "1–7".
- **Audience (§3):** reuse a fitting shared audience OR create a new one tailored to the feature; recruit people who code or vibe code (not necessarily pros); screen for current tools (Claude Code, Cursor, Codex, Copilot, Google Antigravity, etc.); name it clearly and make it shared/reusable; **max 7 participants** (default 1).
- **Default endpoint = review-ready Draft, NOT live (§3):** stop after capturing the **Preview link** + Review link and handing them back. Never auto-launch.
- **Launch is gated (Phase 4):** only on an explicit human okay. It spends credits on a real person and is effectively irreversible once someone starts. Honor the okay's participant count (else default 1); **max 7**. Comments → revise and re-hand-back (`Changes requested`), don't launch.
- **Optional GitHub tracking (§3.5):** if `TRACK_IN_GITHUB`, mirror onto one shared "VS Code UX Research" Project and move Status Needs review → Changes requested → Approved → Live. Additive; never block the loop on it.
- **Edit-after-launch:** pause (header) → edit → resume (Review page); safe at `Live 0/N`.
- **Question-writing (§2.0):** open-ended story prompts only, *What/How/Walk me through/Tell me about a time*; never yes-no, "do you like", "would you", or "how would you design"; end each with a *why*; move 1-7 ratings to their own Rating-scale step.
- `TMPDIR=/tmp` when launching Code OSS (socket-path length).
- Omit `--use-mock-keychain` for the signed-in variant.
- **Plan first, auto-handoff (Modes):** default is one agent, two phases, gather inputs (incl. `ACCOUNT_EMAIL`) then build. For native Plan to Agent UX, ship a `*.chatmode.md` with a `handoffs:` entry to `agent` `send: true`; auto-fires under Autopilot, one-click "Continue on Agent" otherwise; plan to agent keeps context. Launch (Phase 4) is still human-gated.
- **Credentials: email yes, password never.** You MAY ask for and type the UserTesting `ACCOUNT_EMAIL` into the login form; NEVER ask for, type, store, or log the password or 2FA (the human enters those). Never persist the email to files/logs/study content. Prefer an already-signed-in profile.
- **Verbal-response steps can't hold images**; merge questions into Image "Question pages" as spoken Instruction text.
- **UserTesting media = JPEG/PNG/GIF only**, convert MP4 → GIF before upload.
- **Reconnect (§2.4):** just call `connectOverCDP` again (login persists in the profile); relaunch Chrome with the same `--user-data-dir` if the process died. Kill only by numeric PID.
- Study **auto-saves**; `Create test`/`Launch test`/tabs are often non-`<button>`, click via text-box coordinates and poll `page.url()`/body text after (slow navigations).
- Window resize on Electron is unreliable (CDP `Browser.getWindowForTarget` absent; AppleScript needs Accessibility perms), capture at a consistent size instead.
- Always `kill` the Code OSS PID (by numeric pid) when done (memory).
- Monaco ignores `fill`/`type`; the command palette (F1) accepts `keyboard.type`, easiest way to run dev/simulate commands.

---

## Skill vs custom agent (how to package this)

This is a **skill** on purpose: procedural knowledge plus scripts that any agent loads on demand, kept
out of the mode picker, user-global across sessions, one source of truth. Keep it that way.

Wrap it in a **custom agent / chat mode** only for what a skill cannot do:
- The native **plan then auto-handoff** UX (only `*.chatmode.md` files can declare `handoffs:`).
- A **discoverable, user-selectable** entry in the mode picker instead of relying on the model to pick
  the skill.
- A **scoped tool set, pinned model, or gating** per phase.

Use a **thin** chat mode that defers to this skill (body: "follow the `autonomous-user-testing` skill"),
never a copy of the procedure. Ready-to-use templates are in `chatmodes/` next to this file; activate by
copying them into a workspace `.github/chatmodes/` or your user prompt-files location. **Guardrail:**
never put the Phase 4 launch (recruiting real paid participants) behind an auto-send handoff, only plan
to build should auto-advance; launch stays explicitly human-gated.

---

## Maintaining this skill (update it with your learnings)

You have **explicit permission and encouragement to improve this skill as you use it.** When you hit
a new gotcha, a selector or UserTesting UI that changed, a better question or audience pattern, or
anything that cost you time, **edit this `SKILL.md` (and the `scripts/`) so the next agent has an
easier run.** Keep edits concise and in the existing style:

- Add concrete, reusable facts (exact click paths, error strings, workarounds), not a narration of one run.
- Put quick facts in the **Consolidated gotchas** list; put deeper detail in the relevant phase section.
- If a documented step is now wrong, **fix it in place** rather than appending a contradiction.
- **Never use em-dashes or en-dashes** in your edits either; match the no-long-dash rule.
- Harvesting/analyzing results stays out of scope; that is the companion `user-research-synthesis` skill.

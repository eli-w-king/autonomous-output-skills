---
name: autonomous-demos
description: "Autonomous: Demos. Make consistently good product demos without supervision: video walkthroughs, screenshot sets, before/after pairs, storyboard PDFs, and PR or issue media, all from the REAL running product (Code OSS built from microsoft/vscode, a website, or a prototype). Enforces the user's standing demo rules (real UI only, no errors on screen, the full flow from a clean start, outcomes over configuration, at most two focal areas, Modern UI with Dark 2026, a visible pointer with a blue click ring, no random zoom, one continuous take with in-place speed ramps) and ships an off-screen CDP recording toolkit, a brief template, a QA checklist, and Desktop delivery conventions. Use for 'record a demo', 'make a video', 'take screenshots', 'before and after', 'storyboard', 'walkthrough', 'add the demo to the PR', or 'show off this feature'. Pairs with autonomous-prototypes, autonomous-runs, and the vscode repo launch skill."
---

# Autonomous: Demos

Produce demos the user does not have to fix: real product UI, one clear story, a visible and
deliberate pointer, nothing on screen that needs explaining away, delivered where the user expects
it. The quality bar is the compare-models executive demo and the website storyboard v11: continuous
real takes, calm pacing, every important moment held long enough to read.

This skill owns the rules, the brief, the recording pipeline, QA, and delivery. Building or changing
the feature first is [`autonomous-prototypes`](../autonomous-prototypes/SKILL.md). Multi-hour or
overnight demo runs also follow [`autonomous-runs`](../autonomous-runs/SKILL.md). Deep
technical gotchas live in the autonomous-runs references
[`recording.md`](../autonomous-runs/references/recording.md) and
[`code-oss.md`](../autonomous-runs/references/code-oss.md); read them before driving Code
OSS.

## Pick the profile

| Profile | Use when | Output | Defaults |
|---------|----------|--------|----------|
| Feature video | "record a demo of X" | MP4 master + `Stills/` | 1440x900 viewport at 2x, 1920x1200 master, pointer on |
| Executive demo | "impress an executive", "share with the team" | one detailed continuous take, 3 to 4 min after ramps | holds on every payoff, speed ramps on waits |
| State tour | "show all the states", "comprehensive" | one take per surface (editor and Agents window) | every state from the brief, real sessions created from scratch |
| Variant matrix | designs, plans (SKUs), phases, v1/v2 | one clip per variant + a master with title cards | identical prompt and flow per variant |
| Storyboard | website or marketing story | PDF + square takes + `storyboard.json` | see [`references/storyboards.md`](references/storyboards.md) |
| Screenshot set | "take screenshots of ..." | full-window PNG + tight crop per state | 2x, whitespace trimmed, one theme |
| Before/after | PR review, a change | paired PNGs per state and layout | same state, size, theme on both sides |
| PR media | "add the demo to the PR" | short GIF and/or MP4 | GIF under ~10 MB, MP4 for anything long |
| Study stimulus | UserTesting or Outset studies | static PNG per state, no pointer | used by [`autonomous-research`](../autonomous-research/references/running-a-study.md) |

Study stimulus is the one profile with different capture rules (static stills, no pointer, about
56 px of surrounding UI per crop); `autonomous-research` owns them. Every other profile follows
the rules below.

## The rules (always enforced)

These come from the user's feedback across every demo session; `DEMO-RULES.md` at the root of the
`autonomous-output-skills` repo has the same list with sources. An explicit
instruction in the current request wins; write the override into the brief.

**Truth**

1. **Real product only.** Every pixel comes from the running build: Code OSS built from
   `microsoft/vscode`, the real website, or the actual prototype. Never recreate, mock, or paint over
   UI. A browser page never stands in for the desktop app.
2. **Never show errors.** No error or warning toasts, failed tool calls, extension-host toasts,
   sign-in prompts, 404s, console overlays, model warning glyphs, or broken states. If one appears,
   fix the setup and retake. Never edit it out in post.
3. **Accurate to the product you claim.** A "how it works today" demo uses a clean upstream build and
   records only what it really does. Missing behavior goes into a gaps list, not into the video.
   Prototype demos may use scripted responses; the `Read me.txt` and PR say so.
4. **Current facts.** Use current, non-deprecated models; built-in themes are preinstalled (never
   show a Marketplace install for them); use the latest agreed terminology. When unsure how something
   behaves, check upstream code instead of guessing.

**Story**

5. **One story, told by outcomes.** Organize around a user's goal, not product surfaces. Show tools
   being used ("the agent pulls the design from Figma"), not settings, modals, or configuration.
6. **The full flow from a clean start.** Start a new session from scratch, type the prompt, send it,
   and show every state through to the result. No skipped states, no stale sessions, no jumping to a
   different session partway through.
7. **Realistic and compelling.** A believable task with real content: mid-session states, resized
   layouts, and parallel sessions where they matter. Public demos show a product that works and is
   improving, not one fixing its own bugs.
8. **Comprehensive when asked to cover a feature.** Show every state (for sessions: working, needs
   attention, queued, completed, cloud and remote, and so on) in every surface that has it, for
   example both the editor window and the Agents window.
9. **One idea per beat.** A newcomer should always know where to look. Make it unmistakable which
   control the beat is about, and never show two concepts changing at once. Cut text and UI that do
   not serve the beat; a marketing storyboard should read in under 30 seconds.

**Composition**

10. **Frame the full relevant window.** Do not crop it into something that looks like a mockup. Tight
    crops are only secondary detail shots.
11. **At most two focal areas.** Chat and editor (about 1/3 and 2/3), session list and one session
    (1/3 and 2/3), session and PR (50/50). Switch between sessions instead of tiling many of them.
12. **Clean chrome.** File explorer hidden, Agents window side panel closed, Customizations
    collapsed, Aquarium off, menus closed unless they are the subject, no notifications.
13. **Standard look.** Modern UI and compact density,
    `sessions.chat.experimental.newSessionComposerLayout` enabled, Dark 2026 unless another theme is
    requested, and one theme across every asset in a set (video, stills, PDF).
14. **A living sidebar.** When the session list is visible, fill it with sessions at different
    phases across several repos (about four).

**Motion and pacing**

15. **Visible, deliberate pointer.** Eased glides and clear clicks with a subtle blue click ring.
    Use controls the way a person would: click the model in the list instead of searching for it.
16. **No random zooms.** Prefer no zoom at all. Zoom only when legibility truly requires it.
17. **Hover states without tooltip text**, unless the hover content is the feature being shown.
18. **Let it breathe.** A calm 2 to 3 second lead-in and lead-out, holds long enough to read every key
    moment, and prompts typed at a human pace.
19. **One continuous take.** Fast-forward only idle waiting, in place, with speed ramps instead of
    cuts. Never splice different sessions or takes into something that looks continuous.

**Delivery and QA**

20. **Masters.** H.264 MP4, about 1920 x 1200 (or the requested size, such as square), 30 fps, plus
    full-resolution stills. GIFs only for PR previews and short loops.
21. **Watch it before you ship it.** Review the entire export, a contact sheet, and the frames around
    every hover and menu; `ffprobe` it and decode it fully. Redo anything that breaks a rule.
22. **Screenshots.** Full window plus a tight crop (whitespace trimmed) for details. Before/after
    pairs cover every relevant layout and setting, and no menu covers what is being compared.
23. **Iterations.** For revision rounds, share screenshots for approval first, then record videos.
    Label variants and phases clearly (title cards or file names, for example per plan or Design A/B).
24. **Desktop delivery.** One folder per project with `Round N - <what changed>` subfolders, the
    videos, `Stills/`, and a short `Read me.txt` (what changed, what is real versus scripted, branch
    and commit). Open the result. Delete superseded versions unless asked to keep them.
25. **Plain notes.** Straightforward bullets within any limit given, no marketing tone, and no
    narration of the process ("we recorded a demo").
26. **Never cut corners.** Take the time the work needs. If something cannot be shown honestly, say so
    in the `Read me.txt` instead of faking it or skipping it silently.

**Working on a shared Mac**

27. **Never steal focus or interfere.** Record invisible or off-screen windows driven over CDP, keep
    one persistent demo window, and never touch other agents' windows, ports, or sessions.
28. **Never need the user mid-run.** Use the mock keychain for scripted demos and never trigger OS
    prompts. When the user is away, skip and log blockers. When the user is present and a sign-in is
    truly required, open a `.txt` with the exact steps.
29. **Ready for a live demo when asked.** Stop stale Code OSS instances you own and leave one window
    open on the starting state.

## Step 0: Write the brief

Before touching the product, copy [`references/demo-brief-template.md`](references/demo-brief-template.md)
into the demo folder as `brief.md` and fill it in: purpose and audience, profile, build and commit,
auth mode, settings, starting state, scenario and exact prompts, beats with holds, must show, never
show, deliverables, and demo-specific QA. Merge every instruction from the conversation (including
pasted screenshots and meeting notes); later instructions override earlier ones. On feedback,
update the brief first, then re-record.

If the brief asks for something the product does not do, decide explicitly: a clearly labeled
prototype (scripted or behind a setting) or a documented gap. Never fake a state in a "today"
demo. When unsure how a feature behaves (for example queued messages), read the upstream code or
reproduce it before recording, and say how you verified it.

## Steps 1 to 5: build, record, edit, QA, deliver

After the brief, follow [`references/procedure.md`](references/procedure.md): choosing the build and the
isolated environment, driving and recording, editing and encoding, the QA that must pass before
delivery, delivery, and screenshot sets and before/after pairs. Read it before the first launch.

## Scripts

| Script | Purpose |
|--------|---------|
| `launch-demo-oss.mjs` | isolated scripted Code OSS instance, demo preset, invisible, JSON output |
| `hide-windows.mjs` | invisible, off-screen, or show mode for an instance you own, via its main inspector (pid-checked) |
| `stop-demo-oss.mjs` | stop an instance you own: pid check, `app.exit(0)`, then signals |
| `start-mock-llm.cjs` | the vscode repo's deterministic mock LLM with your scenarios |
| `mock-scenarios.example.cjs` | thinking, tool calls, and answer scenario example |
| `demo-driver.mjs` | persistent CDP driver: pointer, glides, clicks, typing, waits, preflight, screencast, marks |
| `take-template.mjs` | one continuous take, ready to fill in |
| `encode-screencast.py` | timestamp-accurate screencast to H.264 |
| `speed-ramp.mjs` | in-place fast-forward of marked idle ranges |
| `title-cards.py` | label variants and phases, join takes |
| `contact-sheet.py`, `validate-video.sh` | QA |
| `mp4-to-gif.sh`, `frames-to-gif.sh` | GIFs for PRs and UserTesting |
| `caploop.js`, `frames-to-mp4.sh`, `presskeys.js` | composited capture when native overlays must be in frame |
| `make-walkthrough.sh` | stitch ordered stills into a walkthrough (study stimulus) |

The Node scripts need Node 22+ (`start-mock-llm.cjs` needs the checkout's Node 24). The driver loads
`playwright-core` from `VSCODE_REPO`'s `node_modules`. Python scripts need Pillow and `ffmpeg`.

## Hard-won gotchas (details in the autonomous-runs references)

- Pass `--use-mock-keychain` only for scripted demos; a real keychain prompt stalls the main thread.
  Omit it for real-account demos.
- Launch with `TMPDIR=/tmp` and short run dirs (socket path limit).
- Reloading a dev instance degrades it; relaunch after code changes.
- Action-list popups (model, harness, effort pickers) need real pointer moves before clicks; the
  model pill is a split control, click `.chat-input-picker-split-primary`.
- Focus `.native-edit-context` before typing into the chat input.
- Action-list rows grow a description card after about 500 ms of hover; capture hover states fast.
- Screencast frames are damage-driven; always encode with timestamps (`encode-screencast.py`).
- Agent-host sessions escape `--user-data-dir` unless `COPILOT_HOME` is set (the launcher sets it).
- Never open a session with an enormous diff while driving; the renderer hangs.
- On the Copilot CLI harness, set `chat.agentHost.copilot.toolSearch.enabled: false` for Compare
  Models runs or the Judge never lands a verdict.
- On Windows (Cloud PC, dev box) the toolkit runs natively: `python` instead of `python3`, Git Bash for the
  `.sh` scripts, `--scale 2` plus the driver's `/viewport` for 2x frames, and Code OSS signs in with a device
  code. See the Windows section of `recording.md` in autonomous-runs.

## Maintaining this skill

Add new rules to both this file and the repo's `DEMO-RULES.md`; add technical gotchas to the
autonomous-runs references; fix wrong steps in place. Keep the description under 1024 characters and never
use em or en dashes.

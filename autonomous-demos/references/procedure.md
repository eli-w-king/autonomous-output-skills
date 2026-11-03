# Demos: the procedure after the brief

Steps 1 to 5 of [`autonomous-demos`](../SKILL.md), plus screenshot sets and before/after pairs. The rules and Step 0
(the brief) are in `SKILL.md`; every step here assumes them.

## Step 1: Build and environment

**Choose the build.**
- "The product today" (evidence, issues, gap reviews): a clean build of current upstream
  `microsoft/vscode` main, no prototype flags.
- Prototype or PR demos: the feature worktree, rebuilt after the last change (verify a feature
  symbol is in `out/`). Rebase on upstream main first when the user asks or the base is stale.
- Websites: the real URL, or the site repo's local dev server on the right branch and variant.

**Choose the auth mode.**

| Mode | When | How |
|------|------|-----|
| Real account | real agents, real models, compare runs, PR creation | vscode repo `launch` skill (`.agents/skills/launch/scripts/launch.sh --agents --disable-workspace-trust`), then `node scripts/hide-windows.mjs --inspect <its main inspector port> --pid <its pid>` |
| Scripted | prototypes, storyboards, deterministic flows | `node scripts/start-mock-llm.cjs --repo <vscode> --scenarios <file> --default <id>` then `node scripts/launch-demo-oss.mjs --repo <vscode> --agents --mock-llm http://127.0.0.1:47331` |

`launch-demo-oss.mjs` makes an isolated profile (own HOME for the Agents window, `COPILOT_HOME`,
`CODEX_HOME`, and its own `--shared-data-dir`), passes `--use-mock-keychain`, writes the demo settings preset (Dark 2026, Modern UI,
compact, composer layout, Aquarium off, long hover delays, no squiggles or prompts), collapses
Customizations, binds silent keys (F5 hover, F6 Agents side panel, F7 clear notifications, F8 close
sidebar, F9 new chat, F10 close panel), keeps the window invisible and unfocusable, and prints the
pid and ports as JSON. Add feature flags with `--settings extra.json`. Use `--size 1000x1000` for
square takes and `--mode offscreen` when real window pixels are needed. For the `launch` skill,
write the same settings into the run's `User/settings.json`.

**Never delete sessions you did not create.** A real-account instance can list the user's real
agent sessions (agent-host sessions live in `~/.copilot/session-state` unless `COPILOT_HOME` points
elsewhere). Prefer starting real-account demos with a run-specific `COPILOT_HOME` so the list starts
clean; if the harness then cannot sign in, keep the default and instead filter or scroll past real
sessions. Either way, delete only the session ids this run created and recorded.

**Starting state checklist** (assert with the driver's `/preflight`, which must return `[]`, and a
still):
- Sessions list: only sessions this run created; for a living sidebar, real harmless sessions
  created across about four repos at different phases.
- Composer empty; required toggles set (for example Auto off at first open); current models chosen.
- No notifications (press F7 again about 20 s after launch: the extension-host toast comes back),
  no banners or nudges in the chat input, no menus, hovers, dialogs, or quick input.
- File explorer hidden, side panel closed, Customizations collapsed, correct proportions.
- Theme and settings confirmed in a still before the first take.

Record every process you start (pid, ports, run dir) in the run ledger. Never connect to a port you
did not start; other agents may be recording.

## Step 2: Drive and record

1. Start the driver once and keep it: `DRIVER_PORT=47400 VSCODE_REPO=<vscode> node scripts/demo-driver.mjs`
   (detached), then `POST /connect {"port": <cdp>}`.
2. Copy [`scripts/take-template.mjs`](../scripts/take-template.mjs) per take and fill in the beats from the
   brief. Run it with `POST /run {"module": "<abs path>", "dir": "<abs take dir>"}`.
3. Structure of every take: preflight, start recording, 2 to 3 s lead-in with the pointer parked in
   empty space, beats with holds, `mark()` before and after every idle wait, payoff held 3 to 5 s,
   2 to 3 s lead-out, stop.
4. Motion: glides 500 to 700 ms, settle about 150 ms before a click, typing 30 to 70 ms per
   character. Hover only on purpose. Never rest the pointer on truncated text or labels.
5. Waits: wait on real UI signals (`waitFor` a selector or status text), never fixed sleeps for
   agent work. Long agent runs are fine; they get fast-forwarded.
6. Check every take immediately with a contact sheet before recording the next.

Capture method: CDP screencast (the driver) by default. When a native overlay such as the
integrated browser preview must be in frame, use `scripts/caploop.js` (composited
`captureScreenshot`). For stills with native window chrome, use `screencapture -l` on your own
off-screen window (see the recording reference in autonomous-runs).

## Step 3: Edit and encode

```bash
S=<this skill>/scripts
python3 $S/encode-screencast.py take-1 take-1.mp4                  # 1920 wide, 30 fps, CRF 16
node $S/speed-ramp.mjs take-1.mp4 demo.mp4 --marks take-1/frames.json --idle wait_start:wait_end@12
python3 $S/title-cards.py master.mp4 --card "Design A|Segmented" a.mp4 --card "Design B|List" b.mp4
bash $S/mp4-to-gif.sh demo.mp4 demo.gif 12 960                       # PR preview only
```

Speed ramps of 10x to 18x suit agent waits. Keep a second of real-time motion on both sides of a
ramp. Square takes come from a square viewport, not a crop. Use title cards to label variants and
phases; never add zoom effects, highlight overlays, or captions unless the brief asks.

## Step 4: QA (all must pass before delivery)

```bash
bash $S/validate-video.sh demo.mp4 --width 1920 --fps 30   # h264, yuv420p, 30 fps, faststart, full decode
python3 $S/contact-sheet.py demo.mp4                    # overview
python3 $S/contact-sheet.py demo.mp4 --every 0.5 --start 40 --end 48   # around a hover or menu
```

Look at the sheets and the start, middle, and end frames, then check against the brief: no errors,
toasts, tooltips, or sign-in prompts; the right theme and chrome; at most two focal areas; the
pointer visible with deliberate clicks; the full flow with no skipped states; every must-show beat
held long enough to read; nothing from the never-show list; no zoom; correct models and wording.
Anything wrong means fix the setup and re-record, never patch pixels. Delete the `-check` folders and
contact sheets before delivery unless the user wants them.

## Step 5: Deliver

- Folder: `~/Desktop/<Project> Demos/Round N - <what changed>/` (the Desktop is OneDrive-synced) with
  `<Feature> - <variant>.mp4`, `Stills/`, and `Read me.txt` (template in the brief reference). Put all
  demos for one project in one folder; a single quick demo can go straight into
  `~/Desktop/<feature>-demo/`.
- Open the result with `open "<file>"` when the user asks to see it now (or `open -R` to reveal it
  in Finder). During unattended runs use `open -g` so nothing steals focus. Never use computer use to
  open files.
- Delete superseded versions and temporary files unless the user asked to keep them.
- Live demo: stop the other Code OSS instances you own (`node scripts/stop-demo-oss.mjs --run
  <run dir>`) and leave one window on the starting state
  (`node scripts/hide-windows.mjs --inspect <port> --pid <pid> --mode show`, or relaunch with
  `--mode visible`).
- Otherwise stop every instance you started with `stop-demo-oss.mjs` (it verifies the pid, exits via
  the main inspector, and only then falls back to signals).
- PR or issue media: follow the GitHub posts reference in autonomous-runs (web attachments when a
  signed-in browser is available, otherwise a media branch or repo with raw URLs; never expiring
  signed URLs). Before/after images go in the PR description.

## Screenshots and before/after

- Full window at 2x plus a tight crop of the detail; trim whitespace; one theme; menus closed unless
  they are the subject.
- Component crops: Component Explorer embedded mode
  (`/___explorer?mode=embedded&fixture=<group>/<Fixture>/<Theme>`) served from your own worktree
  (`npm run serve-out-rspack`); popup fixtures render in one theme tile at a time.
- Before/after: same scenario, state, size, and theme on both sides; the baseline from upstream main
  (or the parent commit), the after from the branch; cover every relevant layout permutation (side
  bar positions, activity bar positions, labels on and off, empty and populated lists, active
  sessions) and name pairs `before-<state>.png` / `after-<state>.png`.
- For revision rounds, deliver screenshots for approval first (full window plus zoomed crop of each
  state), then record the videos.

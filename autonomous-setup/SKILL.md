---
name: autonomous-setup
description: "Autonomous: Setup. Gets a Mac or Windows machine ready for the autonomous skills and a hands-on workshop from one prompt, in two parts: part 1 checks the VS Code settings, Autopilot and Allow all, and part 2 opens a setup checklist canvas, installs what's missing, and has the person test each item with a Try-it prompt. Never handles passwords or keys. Covers the tools (VS Code Insiders, GitHub CLI, git, Node and Yarn 1, Python with Pillow, ffmpeg, Chrome or Edge), the workshop settings with cloud dictation, a private copy of the skills with the daily sync and the weekly update, Work IQ, the Playwright MCP server, Computer Use, the person's own voice and taste, and optional Azure, a dev box that stays on, and research keys. Resumable: the same prompt picks up where it stopped. Use for 'set me up for the workshop', 'set up the autonomous skills', 'check my setup', 'continue my setup', 'am I ready for the workshop', or 'run the setup interview'."
---

# Autonomous: Setup

One prompt takes a person from a fresh machine to ready: the tools, the workshop settings, their own private copy of
the skills, the connections agents use (Work IQ, Playwright, Computer Use), dictation, and the optional extras. Each
item gets installed, then the person tests it for real with a "Try it" prompt. It runs in the Agents window (or
Copilot CLI) on macOS and Windows, and the same prompt picks up again at any point.

People do this alone, before the workshop, so every message says plainly what's happening and what they need to do.
The prompt they paste can pass in values: `title`, `subtitle`, `presenter` and `checkInChat` (the meeting chat for
the Work IQ check-in). Save them first with `check-setup.py remember --set title=... --set checkInChat=...`, hand them
to the canvas, and never write the workshop's own names into this skill (it's published).

## The rules

1. **Detect first, then show the plan.** Run the check, show what is missing and what the standard setup will
   change, then continue. Do not add a separate "reply go" stop for work the setup request already authorizes.
2. **Stay within the requested setup.** The standard tools, private skills copy, daily sync, weekly update and
   connection plugins are the setup. New paid/cloud resources, destructive changes, study launches and sending
   messages still need explicit approval. Never run `sudo`. Anything needing an admin password is a command the
   person runs in their own terminal.
3. **Never handle secrets.** No passwords, tokens or API keys in the chat, in commands, or in files you write.
   Sign-ins happen in the person's own browser or terminal, and keys go into a file they edit themselves. Never print
   or read back a secret file.
4. **Install, then test.** An item is installed when a real check passes (a version prints, a setting reads back, a
   server is configured). It's tested when the person's own Try-it prompt works; record that with
   `check-setup.py tested <item>`. Record steps with `check-setup.py mark`, which the readiness checklist uses.
5. **Never send, post, publish or launch** anything unless the person typed the Try-it prompt that asks for it, or
   approved the exact text. The Work IQ check-in goes out once and is read back afterwards.
6. **Keep moving.** When a step is blocked (a license, an admin, an account limit, a person's sign-in), mark it
   `blocked` or `pending` with what to do next and go on. Offer the optional steps; never push them.
7. **Talk like a person.** Many attendees are designers. Say what each step is for in one sentence, what they'll see,
   and what you need from them. Short messages, no jargon, no walls of output.
8. **Shared machine manners.** Start nothing visible they didn't ask for, stop every process you started, and leave
   their other apps, windows and settings alone.
9. **Stay in this chat.** The setup runs in a session with no workspace (Chat). Never set, change or move the
   session's workspace (no `set_workspace`), even when a step names a folder: use full paths instead
   (`$HOME/.copilot/...`). In Autopilot the host confirms a workspace change for the person, so they'd never see it.

## Autopilot and Allow all: where it still stops

The person sets the picker to **Autopilot** and **Allow all** before pasting the prompt, so commands run without an
approval click each time. Some things still need them, and Autopilot changes how you ask:
- **Questions:** in Autopilot the host answers `ask_user` for the person ("The user is not available to answer your
  question..."), so never use `ask_user` for a decision. Write the question in chat (and on the canvas), then end
  your turn (call `task_complete` with the question if Autopilot keeps going). Their reply continues the setup.
- **Passwords:** a command that asks for a password or secret is cancelled ("Auto-approve / autopilot mode cannot
  safely supply secrets"). Homebrew's installer and anything with `sudo` are theirs to run in Terminal.
- **Sign-ins:** GitHub CLI (`gh auth login`), Work IQ's first sign-in and consent, `az login`, and on a dev box the
  Windows, VS Code and tunnel sign-ins all happen in their browser or terminal.
- **Computer Use:** in Autopilot the agent can't turn it on (the host reports it as unattended) and the app approval
  prompt is cancelled. They type `/computer on` themselves, allow the two macOS permissions in System Settings, and
  switch the picker to Interactive for the Computer Use Try-it (then back to Autopilot).
- **The restart** VS Code asks for after the settings (for Computer Use), and the **microphone** permission the first
  time they dictate.
- **New tools need a new session:** Work IQ's plugins and the Playwright MCP server load when a session starts.
- [check] Work IQ: if its server asks for a confirmation in chat, Autopilot cancels it; switch to Interactive for
  the check-in then.

## Where things are

- `<skill>` is this skill's folder: `~/.copilot/autonomous-output-skills/autonomous-setup` when the setup starts from
  the clone, `~/.copilot/skills/autonomous-setup` once the skills are installed. `COPILOT_HOME`, when set, replaces
  `~/.copilot` everywhere.
- Run the scripts with `python3` on macOS and `python` (or `py -3`) on Windows; `<py>` below means that one. On
  Windows, `python3` is the Microsoft Store stub, so never use it there. The scripts use only the standard library and
  never prompt.
- Windows shell habits: PowerShell 5.1 has no `&&` (run commands one at a time), use `curl.exe` (plain `curl` is an
  alias), write paths as `$HOME\.copilot\...` (it passes `~` to programs as is), and call `npm.cmd`, `npx.cmd` and
  `yarn.cmd`, which work under any PowerShell execution policy.

| Script (`<skill>/scripts/`) | What it does |
|-----------------------------|--------------|
| `check-setup.py` | the check (JSON, or `--format text`); `mark`; `tested`; `remember`; `readiness`; `state` |
| `workshop-settings.py` | `diff`, `apply` (backs up first), `restore` for the workshop's VS Code settings |
| `mcp-servers.py` | `status`, `add playwright`, `add devbox`, `remove` in Copilot's MCP config |
| `devbox.py` | a dev box that stays on: `status`, `pools`, `create`, `wait`, `link`, `delete` and the admin message |
| `practice-repo.py`, `screenshot.mjs` | the practice repo, for the workshop itself (not used during setup) |

- Workshop values are in [`references/workshop.json`](references/workshop.json), the settings in
  [`references/workshop-settings.jsonc`](references/workshop-settings.jsonc).
- Progress lives in `~/.copilot/workshop-setup/state.json` (steps, answers and tests, never secrets), backups and
  logs next to it.
- Per-OS install commands and traps: [`references/machine.md`](references/machine.md). Work IQ, Playwright and
  Computer Use: [`references/connections.md`](references/connections.md). Azure, dev box and research:
  [`references/optional.md`](references/optional.md).
- Every item in the check's JSON has `group` (basics, workshop, connections, yours, optional, later), `try_it` (the
  prompt the person copies to test it, or null) and `tested`. `summary` has `done` and `total` (required items, not
  counting `later`), `tested` and `later`.

## Before the prompt (what the person already did)

The workshop page has people do four things first, in this order. Part 1 checks them.
1. **Sign in to VS Code Insiders with the GitHub account that has Copilot.** Agents run on that account.
2. **Paste the workshop settings into User settings (JSON)** (the snippet in `references/workshop-settings.jsonc`),
   then restart. The snippet turns the agent sandbox off (with it on, the setup can't write outside its folder, so
   it can't clone the skills into `~/.copilot` or install tools, and a chat without a workspace can't start), turns
   on canvases (the setup checklist) and cloud dictation, and adds the settings later modules use. The restart is for
   Computer Use.
3. **Open the Agents window and set up this exact chat before pasting.** No project or folder is needed:
   - Workspace: **Chat**.
   - Model: **Claude Opus 5.5**.
   - Reasoning effort: **Max**.
   - Context: **1M**.
   - Mode: **Autopilot**.
   - Permissions: **Allow all** (click **Enable** when asked).
   - Sandboxing for terminal: **Off**.
   These are choices for the session receiving the prompt, not settings for another chat.
4. **Paste the one prompt.**

## Part 1: in chat

1. On Windows, if `python` doesn't run (or is the Microsoft Store alias), say so and offer to install Python first
   ([machine](references/machine.md), "Python and Pillow"), since every script needs it.
2. `check-setup.py remember` the values the prompt passed in, then `check-setup.py --quick` (JSON) and read
   `items.settings` (all six set?) and `items.dictation`.
3. Check the current session is set to **Claude Opus 5.5**, **Max** reasoning and **1M** context. If the host does
   not expose a choice, have the person check the visible picker rather than claiming you verified it.
   Autopilot: if a question you send with `ask_user` comes back with the host's automatic reply ("The user is not
   available..."), the session is on Autopilot. Allow all can't be read from here: ask them to check the picker says
   **Allow all**, and to tell you if an approval prompt ever shows up.
4. Something missing: say exactly what to change, in one short message. For the settings, show the plain list from
   the snippet and offer to add them yourself (`workshop-settings.py diff`, then `apply --json` on their
   okay; it backs up first and keeps everything else). For the session: "In this chat, choose Claude Opus 5.5,
   Max reasoning, 1M context, Autopilot and Allow all." For the sandbox: the same picker's **Sandboxing for terminal**
   switch, off.
5. After settings change: VS Code says "A setting has changed that requires a restart to take effect." Tell them to
   click **Restart**, reopen this session from the session list, and say "continue my setup". Canvases come on for
   the reopened session (or any new one) without a separate restart. Mark `settings ok` once the check shows all six.
6. **The setup canvas plugin.** Once the settings are in, install the plugin that draws the checklist (skip this when
   `list_canvas_capabilities` already lists `autonomous-setup-checklist`). When the `copilot` command is on your PATH,
   run `copilot plugin marketplace add eli-w-king/autonomous-output-skills`, then
   `copilot plugin install workshop-setup@autonomous-output-skills`. Otherwise ask them to send these two lines in
   this chat, one at a time:
   ```
   /plugin marketplace add eli-w-king/autonomous-output-skills
   /plugin install workshop-setup@autonomous-output-skills
   ```
7. **A new session.** The canvas loads in new sessions. Ask them to start one with **Chat**, **Claude Opus 5.5**,
   **Max**, **1M**, **Autopilot** and **Allow all**, then paste the setup prompt again; it picks up here and goes
   to part 2. Recheck these choices in every new session. Mark `settings ok` first.

## Part 2: the setup canvas

### Open the canvas

<!-- CANVAS: the setup canvas plugin (plugins/workshop-setup), canvas id autonomous-setup-checklist. -->
- Part 1 installed the plugin (`workshop-setup` from the `autonomous-output-skills` marketplace). If
  `list_canvas_capabilities` doesn't list `autonomous-setup-checklist`, try `extensions_reload` once; still missing,
  go back to part 1, step 6.
- `open_canvas` with canvasId `autonomous-setup-checklist`, instanceId `workshop-setup`, and input
  `{title, subtitle, presenter, checkInChat, skillsDir}` from the remembered answers (`skillsDir` is the clone,
  `~/.copilot/autonomous-output-skills`). Every field is optional; pass `{}` when there's nothing. Reopening the same
  instanceId keeps its state, so resuming is `open_canvas` again, then `getState`.
- The canvas runs `check-setup.py` itself. `getState` returns `progress {done, total}`, `step`, the person's
  `choices` for the optional items (`azure`, `devbox`, `research`: true, false or null), and `items` with each status.
- On each item: `setStep {id}`, then `setItem {id, status: "working"}`. When they have to act:
  `setItem {id, status: "needs-you", note, commands}` (plain steps, one per line, and copyable commands). After an
  install the check proves: `refresh` (or `setItem installed`), and the page shows its Try it prompt. After their Try
  it works: `check-setup.py mark <step> ok`, `check-setup.py tested <item>`, then `setItem {id, status: "tested"}`.
  Failures: `setItem failed` with the exact error line. Statuses: todo, working, needs-you, installed, tested,
  skipped, failed. Ids are the check's item ids plus `weekly`, `dictation`, `voice`, `taste`.
- `check-setup.py mark <step> ok` counts as tested on the canvas, so mark a step `ok` only after its Try it worked
  (items without a test, like the tools and the settings, are done when the check shows them).
- No canvas tools (an older host, or canvases off by policy): keep going in chat. Show `check-setup.py --format text`
  in a few lines at the start and after each item, and the Try-it prompts (`try_it` in the check) as a list.
<!-- /CANVAS -->

### Show the plan

Build the plan from the check: every missing tool with its install command, the private copy of the skills and
everything that step changes (`gh auth setup-git`, the skills installed into `~/.copilot/skills` with backups, the
daily sync job and its macOS "Background Items Added" notice, the weekly automation), the Work IQ plugins, the
Playwright MCP server, and the optional items they turned on (`getState` `choices`) or requested in their prompt.
Post a short explanation, then proceed with the requested standard setup. Pause only for a real choice, required
sign-in, secret entry or separately authorized change, not a second blanket confirmation. Plan on about 45 minutes for the
whole setup on a laptop that already has Homebrew, Node and git, up to 75 on a brand-new Mac [check].

### Then, without stopping

Work through the items in this order. After each one: prove it, mark it, and point at its Try-it prompt. Batch the
items that need a new session (Work IQ, Playwright): install both, then ask them once to start a new session and say
"continue my setup" there, where they test both.

#### Machine

Why: the tools every module uses.
- They're signed in to GitHub with Copilot (they're chatting with Copilot): `check-setup.py remember --set
  copilot_signed_in=yes`. When the check lists more than one GitHub CLI account, the plan names the one it will use
  (say which are Microsoft-managed). Missing tools are in the plan with their commands.
- Not signed in to the GitHub CLI: they run `gh auth login --hostname github.com --web --git-protocol https` in a
  terminal (Terminal > New Terminal in the editor window) and finish in the browser, then say done.
- Install one tool at a time, re-run the check after each, and refresh PATH on Windows. Homebrew missing: they install
  it themselves (it asks for their password). Details and traps: [machine](references/machine.md).
- Yarn 1 comes from `npm install -g yarn`, never Corepack. A global install ignores a project's `.npmrc`, and
  public npm is blocked or unreliable on Microsoft-managed devices, so when the check's `npm.uses_feed` is false, ask,
  then point npm at Microsoft's package feed first (no sign-in; managed Macs already have it):
  `npm config set registry https://packagefeedproxy.microsoft.io/npm/`. Say what it changes when you ask: npm uses
  the feed for all their projects from then on, and the feed holds brand-new package versions back for 7 days. On
  Windows use `npm.cmd` for both.
- Windows: when the check's `powershell.policy` is Restricted (the client default), `npm` and `yarn` typed in
  PowerShell fail with "running scripts is disabled on this system". Offer
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, since the modules have them type `yarn` themselves.
- Commit identity missing: ask for the name to use and suggest the GitHub noreply email. Offer `gh auth setup-git`
  so git never asks for a password.
- Prove: the check shows every machine item ok. Mark:
  `check-setup.py mark machine ok --set copilot_signed_in=yes --set github_account=<login>`.

#### Skills and the weekly update

Why: their own private copy of the skills, so the skills learn from their corrections every week and they review
each change as a pull request; Eli's updates come in the same way.
- Skip this step when the check's `skills.mode` is `maintainer` (the machine already runs the two-repo sync).
- The plan offers: a private copy `<login>/autonomous-output-skills` (recommended), one they already have, or just the
  skills without a copy for now.
- With a copy, from the clone (`~/.copilot/autonomous-output-skills`):
  `<py> tools/sync-skills.py setup-attendee --private-repo <owner>/<name> --create --dry-run --json` and check its
  `steps` against the shown setup plan: the private copy on GitHub, `gh auth setup-git` (git uses their GitHub
  CLI sign-in from then on), the skills installed into `~/.copilot/skills` (any old copies backed up), and a daily
  sync job (launchd or Task Scheduler). On a Mac, registering the job shows a "Background Items Added" notification;
  tell them it's expected. Then run it without `--dry-run`. It points `origin` at their copy and a fetch-only
  `public` at the shared repo, keeps the clone on the review branch, installs the skills with backups, and schedules
  the daily sync. On
  `ok: false`, each entry in `problems` has a `fix`; exit code 2 means it refused (a maintainer setup, a public repo).
- The weekly update: with the `configureAutomation` tool, call it with exactly
  `schedule.weekly.automation.configureAutomation` from that JSON (autopilot, full auto-approve, the top model at max
  effort), run it once with `runAutomation`, and check that run with the command in `schedule.weekly.automation.check`
  (`automations/run-weekly-skill-miner.py --check-run --json`; it passes when the run had max effort, the long context
  and no approval left waiting). Without the tool, walk them through `schedule.weekly.automation.steps` in the Agents
  window's Automations view, or import the blueprint `automations/weekly-skill-update.automation.md`. Then follow
  `next`, and `automations/ATTENDEES.md` in the clone for anything else. The person must have signed in with
  `gh auth login` (the machine step) before this runs.
- Without a copy: `node tools/install-devbox.mjs` installs the published skills (with backups) and nothing else.
  Mark it with `--set skills_private_copy=no`, so the checklist doesn't list the copy as missing.
- Prove: `<py> tools/sync-skills.py status --json` shows `mode` attendee, their copy as `origin`, and the daily sync
  registered: `setItem {id: "skills", status: "installed"}`. After the proof run's `--check-run` passes: `mark weekly
  ok`, `tested weekly`, `setItem weekly tested`.
- Try it (skills), in the new session: "List the skills from my copy." When that works: `mark skills ok
  --note "<owner>/<name>"`, `tested skills`, `setItem skills tested`.

#### Work IQ

Why: agents can read their mail, meetings and Teams (only what they can see) and post what they ask for.
- Install the two official plugins ([connections](references/connections.md), "Work IQ"): `copilot plugin ...` (yours
  to run when `copilot` is on your PATH, theirs in a terminal in the editor window otherwise). Mark
  `workiq pending --note "installed; test it in a new session"`.
- Try it: the canvas shows the check-in prompt from `items.workiq.try_it`. With a `checkInChat` it posts "Work IQ is
  set up" in that meeting chat (typing it is their okay), then reads the chat back and confirms exactly one copy is
  there; a timeout or unclear result is never a reason to post again. Without one, it reads their next meeting's
  subject. Sign-in, consent and license problems: mark `blocked` with the next step and who to ask.
- When it works: `mark workiq ok` and `tested workiq`.

#### Playwright

Why: agents open pages, click, fill forms and take screenshots in a real browser.
- `mcp-servers.py add playwright --dry-run --json`, then without `--dry-run`. It adds the Playwright MCP server
  (`@playwright/mcp`, pinned to the newest release, since a registry's "latest" can be an old build) on their
  installed Chrome or Edge, so no browser downloads. It's already there if `items.playwright.ok` is true.
- Try it, in a new session: "Use Playwright to open https://code.visualstudio.com, take a screenshot and show it to
  me." Show them the screenshot. Then `mark playwright ok` and `tested playwright`.

#### Computer Use

Why: agents can work in desktop apps in the background, like writing a line in Notes, with their approval per app.
- The setting is part of the snippet (part 1), and the restart turned it on. They type `/computer on` and click
  **Turn On** (Autopilot can't do this for them), then on a Mac allow Screen Recording and Accessibility in the Set Up
  Computer Use dialog until it says "Computer Use is ready." ([connections](references/connections.md)).
- Try it with the picker on **Interactive** (the app approval prompt can't show in Autopilot): "Use Computer Use to
  write "Computer Use works" in a new note in Notes." (on Windows: "...open Notepad and type "Computer Use works".
  Don't save it."). Then back to Autopilot, `mark computer-use ok` and `tested computer_use`.

#### Dictation

Why: talking to the agent is often faster than typing, and the cloud model needs no download.
- `items.dictation.ok` is true once the snippet's `"dictation.model": "mai"` is set (the same Microsoft AI voice
  service Voice Mode uses).
- Try it: "Click the mic in the chat input, say "Dictation works", and send it." The first time, macOS asks to allow
  the microphone. When their dictated message arrives: `mark dictation ok` and `tested dictation`.

#### Your voice and taste

<!-- VOICE-TASTE: the person's own voice and taste ships in a later version. Its step text goes here, with the
canvas items voice and taste and their check-setup.py items. Until then, skip it: nothing to do, nothing on the canvas. -->

#### Optional: Azure, a dev box, research

Only what they picked on the canvas or requested in their prompt. Follow [optional](references/optional.md) and mark the
rest `skipped`. Azure sign-in happens in their own terminal. A dev box: `devbox.py status --json` first (green when
they already have a box that stays on); otherwise create one only on their okay, keep going while it provisions (30
to 90 minutes), then hand off the sign-ins and the tunnel. Research keys go in `~/.copilot/research.env`, which they
fill in themselves. When the prompt requests Outset and User Interviews API setup, include it now:
`check-setup.py remember --set research_api_setup=yes`, then follow the research credential and read-only probe
steps. Missing admin access stays pending; it is not silently skipped or marked tested.

#### Readiness

1. `check-setup.py readiness`: it writes `Workshop readiness.md` on their Desktop (ready and tested, still to do,
   skipped, and what comes at the workshop) and prints the path. Summarize it in a few lines.
2. Tell them they can paste the same prompt again any time: it checks everything, skips what's done, and picks up new
   items.

## The practice repo

The workshop's example repo isn't part of setup: people choose at the workshop between their own work and the
example, and getting the example is a download then. `check-setup.py` reports it as `later` and leaves it out of the
done count. `practice-repo.py` and `screenshot.mjs` stay for that day.

## Resuming

"Continue my setup", a restart, or the same prompt again: run the check, read `steps` and `tests`, say in one line
where you're picking up, and continue at the first item that isn't installed or tested. Until the skills step
installs the skills, a new session doesn't have this skill: the person pastes the setup prompt again, which pulls the
clone and resumes from the progress file. A step that was `blocked` gets one retry before you move on. Nothing done
earlier is redone unless the check shows it's broken now.

## Testing this skill

- `check-setup.py` is read-only and safe on any machine (`--quick` skips the slow and network checks, including the
  dev box).
- Simulate a fresh machine with a scratch `HOME` and `COPILOT_HOME` (on Windows also `USERPROFILE`, `APPDATA` and
  `LOCALAPPDATA`, plus `WORKSHOP_SETUP_DESKTOP` for the readiness file). Remove scheduled jobs and repos you create,
  and never test against someone's real settings, skills or schedules.
- On macOS, GitHub CLI keeps its token in the login keychain, which it can't find under a scratch `HOME` (it reports
  401 "Bad credentials"). Give the test `GH_TOKEN` from `gh auth token` run with the real `HOME`, inline, never
  printed.
- `devbox.py create` and `delete` make and remove real dev boxes: test them with `--dry-run`.

## Maintaining this skill

Fix wrong steps in place, keep per-OS detail in `references/machine.md` and connection detail in
`references/connections.md`, and update `references/workshop.json` and `references/workshop-settings.jsonc` when the
workshop's settings change. Keep the description under 1024 characters, keep the workshop's own names out of this
skill (the prompt passes them in), and never use em or en dashes.

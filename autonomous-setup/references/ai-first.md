# The AI-First path

A light, public setup for a workshop on personal laptops: the person's own GitHub account, no work accounts, no
company tools. The prompt names the event, its host and a workshop folder, like
`Set me up for "<Series>: <Title>", hosted by <Host>, in ~/ai-first-workshop. Follow <link to SKILL.md>`.

SKILL.md ("The AI-First path") already put the skills in `<folder>/autonomous-output-skills`. From here: the setup
canvas opens in this chat, the person reads its steps and clicks Confirm, then you install what they checked, in
order, and they try Computer Use and dictation. **Nothing else is installed before they click Confirm.**

## Rules

SKILL.md's rules hold (never handle secrets, never `sudo`, never send, post, publish or buy, stay in this chat, talk
like a person, keep moving). Also:

- **Light and contained.** Missing tools go in `<folder>/tools` as portable copies, with one PATH entry. Never use
  Homebrew, winget, an installer that asks for a password, or a global npm install. Never change, upgrade or remove
  a tool the person already has.
- **Recorded.** The script records every change in `<folder>/.setup/installed.json` (and a plain summary next to it,
  `installed.md`), so the uninstall takes back exactly what was added.
- **The person is in Interactive mode with Allow all.** Ask in the chat only for real choices; what to install is
  chosen on the canvas.
- **One public thing, asked once.** Everything else stays on their computer. Their copy of the Excalidraw case study
  is a public repo with a live site, so ask once, right before step 2.5, and nowhere else.
- **Run the script as written here.** Each command does its whole step. Don't add flags, split a step, or run its
  parts (git, gh, npm) yourself, and never set, change or move this chat's workspace: the paths here are full paths.
  When a step stops partway (the Wi-Fi, a timeout), run the same command again; it picks up where it stopped.
- **Their names stay out of files.** Take the title, subtitle, host and folder from the prompt, pass them to the
  canvas, and never write them into this repo.

## Values from the prompt

- **The quoted name:** with a colon ("Series: Title"), `subtitle` is the part before the first colon and `title` the
  part after it. Without a colon, the whole name is the `title`.
- **"hosted by ..."** is the `presenter`, exactly as written.
- **"in ..."** is the workshop folder (`~/...`, `/...` or `C:\...`). `<folder>` below means it.

## The script

`<folder>/autonomous-output-skills/autonomous-setup/scripts/ai-first.mjs`. It only uses Node's built-ins. Run it with
`node` when `node --version` prints 18 or newer, otherwise with VS Code Insiders' own runtime, which needs nothing
installed:

- **macOS (zsh):** `ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders" "$HOME/ai-first-workshop/autonomous-output-skills/autonomous-setup/scripts/ai-first.mjs" check`
  (use `$HOME/Applications/...` when Insiders lives there).
- **Windows (PowerShell): always this whole line, in one command.** Your shell calls don't keep environment
  variables, so a separate `ELECTRON_RUN_AS_NODE` line opens the editor instead. And PowerShell doesn't wait for
  `Code - Insiders.exe` or keep its output unless it's piped, so keep `2>&1 | Out-String`:
  `$env:ELECTRON_RUN_AS_NODE='1'; & "$env:LOCALAPPDATA\Programs\Microsoft VS Code Insiders\Code - Insiders.exe" "$HOME\ai-first-workshop\autonomous-output-skills\autonomous-setup\scripts\ai-first.mjs" check 2>&1 | Out-String; Remove-Item Env:ELECTRON_RUN_AS_NODE`
  (a system-wide install is under `$env:ProgramFiles` instead). Once `node --version` works there, plain
  `node "<script>" check` is fine too.

`<run> <args>` below means that command with `<args>` where `check` is: on Windows, before `2>&1 | Out-String`. Add
`--folder <folder>` when the folder isn't `~/ai-first-workshop`, and `--json` for JSON (`ok`, `detail`, and on
failure `ok: false` with the reason).

| Command | What it does |
| --- | --- |
| `check` | What's here, each item's size on this computer, and the Microsoft sign-in. Read only. `--repo-name` adds the name their Excalidraw copy will get. |
| `canvas` | Copies the setup canvas into Copilot's extensions folder (`canvas-extension.py`'s job, without Python). |
| `install <item>` | One item: `git`, `node`, `gh`, `github`, `skills`, `skill_runs`, `skill_research`, `skill_taste`, `excalidraw`, `resources`, `demo_tools`. Safe to run again. |
| `env` | The PATH line for this shell, so it finds the tools the setup added. |
| `automation` | The `configureAutomation` input for the weekly taste update. |
| `record <key> --value <json>` | Records something you did, like the automation's id. |
| `uninstall` | Lists what the setup added; `--yes` removes it ([the uninstall](ai-first-uninstall.md)). |

## 1. Open the canvas, then wait for Confirm

1. `<run> canvas --json` first, before any canvas tool. When it says `reload_needed`, call `extensions_reload` (find
   it with tool search). Until both are done, don't call `list_canvas_capabilities` or `open_canvas`, and never guess
   a canvas id: the canvas isn't in this chat yet. It also fetches the canvas's fonts (about 0.6 MB) from the
   workshop site; when they can't be fetched, the canvas uses the system's fonts and the setup carries on.
2. `list_canvas_capabilities` with canvasId `autonomous-setup-checklist`, then `open_canvas` with that canvasId,
   instanceId `workshop-setup`, and input `{title, subtitle, presenter, workshop: "choose", workshopDir: "<folder>",
   skillsDir: "<folder>/autonomous-output-skills"}`. "Multiple canvases match": add extensionId `user:setup-checklist`.
   Still not listed after the reload: canvases are off in this chat. Ask them to check that `chat.canvases.enabled`
   is in their settings, restart VS Code Insiders, and paste the setup prompt again.
3. Tell them in two lines: the checklist next to this chat walks them through what gets installed, and nothing is
   installed until they click Confirm.
4. `invoke_canvas_action` with `waitForConfirm` and `{timeoutSeconds: 240}`. Call it again while it returns
   `waiting`.
   - `confirmed`: go on to 2 with `flow.install` (the ids to set up) and `flow.selections`.
   - `gate`: they picked the Microsoft workshop. See "The Microsoft workshop" below.
   - A chat message "I clicked Confirm on the setup checklist..." (the canvas sends it when you weren't waiting and
     didn't check within about 25 seconds) means the same as `confirmed`: `getState`, then go on. If you're already
     installing, carry on without answering it.

## 2. Install what they checked, in this order

Only the ids in `flow.install`. For each one: `setStep {id}`, then `setItem {id, status: "working", note: "<what's
happening, in a few words>"}`, run it, then `refresh` (the canvas checks again by itself). When a step fails:
`setItem {id, status: "failed", note: "<the script's detail>"}`, say so in one line, and go on with the next item
that doesn't need it.

1. **git:** `<run> install git --json`. On a Mac it's GitHub's portable Git (the one GitHub Desktop ships, about
   42 MB); on Windows, MinGit (about 40 MB). If it fails on a Mac, Apple's command line tools are the fallback: ask
   first (about 1.3 GB, often 10 minutes or more), then `xcode-select --install` opens Apple's dialog and they click
   **Install**.
2. **node:** `<run> install node --json` (Node.js 26, the current LTS, about 31 to 41 MB to download). Their own
   Node 22 or newer is used as it is.
3. **gh:** `<run> install gh --json`, then the sign-in, which you start and they approve:
   - `<run> env` prints a PATH line for this shell. Run it here before the next commands, and again in any new
     shell. (Or call `gh` by its path from `check --json`.)
   - In an async shell: `gh auth login --hostname github.com --web --git-protocol https`. It prints a one-time code
     and waits. Show the code in the chat and on the canvas: `setItem {id: "gh", status: "needs-you", commands:
     ["<CODE>"]}` (the canvas adds its own steps). Open https://github.com/login/device (`open` on macOS,
     `Start-Process` on Windows), and wait for the command to finish.
   - Then `<run> install github --json`: git signs in through the GitHub CLI (`gh auth setup-git`), and commits get
     their GitHub name and private noreply email when git has none yet.
   - Already signed in (the `gh` item shows a login)? Skip the login and run `install github`.
4. **skills:** `<run> install skills --json`: the four required light skills, into the personal skills folder
   (`COPILOT_HOME` is honored). A folder with the same name is saved to `~/.copilot/skills-backup/ai-first-workshop/`
   first. A full skills setup (a `skills-sync.json`, or a private clone in `~/.copilot/autonomous-output-skills`) is
   kept as it is; the result says so.
5. **excalidraw:** their own copy of the case study, the one public thing.
   - First `<run> check --json --repo-name`. `items.excalidraw.next_repo` is the name the install will create (the
     script already skipped the names they have), and `next_live` its site. Use them in the question; don't look
     names up yourself. When `items.excalidraw.repo` is already set, the copy exists: skip the question and run the
     install, which finishes it.
   - Ask once (`ask_user`, or one line in the chat): next you'll create their public copy, `<next_repo>`, and publish
     its site at `<next_live>`. That's the only question in this step. When they'd rather not,
     `setItem {id: "excalidraw", status: "skipped"}` and go on; the workshop's use case needs it, and "continue my
     setup" picks it up later.
   - Then `<run> install excalidraw --json`, once, as is. It creates the repo from the template, clones it into the
     folder, sets Pages to deploy from Actions, and installs the packages itself: `npm ci --ignore-scripts` inside
     the clone, from the template's own lockfile, so no package's install script runs. It takes a minute or two.
     Don't pass `--skip-npm` (the script refuses it), don't run npm yourself, and don't open the clone as this chat's
     workspace: the next prompt in the room opens the project.
   - Show them the repo link from the result.
6. **resources:** `<run> install resources --json`: the prompts, a cheat sheet and the settings in `<folder>/resources`.
7. **demo_tools:** `<run> install demo_tools --json`: Playwright Core with their Chrome or Edge and a small ffmpeg
   with H.264, in `<folder>/tools/demo` (paths in `demo-tools.json` there), checked with the demos skill's own
   `demo.mjs check`. Without Chrome or Edge it adds a small headless browser (about 105 to 130 MB).
8. **Extras they switched on:** `skill_runs`, `skill_research`, `skill_taste`, each with `<run> install <id> --json`.
9. **computer_use:** the setting is already on. They send `/computer on` in the chat and click **Turn On** (you can't
   do it for them). On a Mac, the Set Up Computer Use dialog asks for Screen Recording and Accessibility:
   `setItem {id: "computer_use", status: "needs-you"}` shows those steps. Then `setItem installed`, and the canvas
   shows the Try it: "Use Computer Use to write a short joke in a new note in Notes." (Windows: "Use Computer Use to
   write a short joke in a new note in Notepad.") When it works, `setItem tested`.
10. **dictation:** `setItem installed`; the canvas asks them to click the microphone, say "Dictation works" and send
    it. The first time, their computer asks to allow the microphone. When the dictated message arrives,
    `setItem tested`.
11. **taste_weekly**, only when they switched it on (My taste is installed first):
    - `<run> automation --json` prints the exact `configureAutomation` input: weekly on Monday at 10:00, in the
      workshop folder, GPT-6.2 Sol at medium effort, Autopilot with auto-approve. Call `configureAutomation` with it
      (find it with tool search). Automations made from a chat store no model, so keep `sessionTemplate` as printed;
      if `listAutomations` names GPT-6.2 Sol with a different id, use that id.
    - `listAutomations` for its id, then `<run> record taste_weekly --value '{"automationId":"<id>"}'`.
    - The proof run: `runAutomation` once, then check it with `listAutomations` (the run finished) and that
      `~/.copilot/skills/my-taste/updates/` has a new report (the weekly update writes one even when nothing
      changed). Then `setItem tested`.

## 3. Finish

- `refresh`. Every item they chose should be green.
- In a few lines: what's set up, their repo and its live link to come (`https://<login>.github.io/excalidraw-case-study/`),
  the summary in `<folder>/.setup/installed.md`, and the uninstall guide,
  https://eli-w-king.github.io/ai-first-design-workshop/uninstall.html.
- When the setup installed Git, Node.js or the GitHub CLI (`check --json` shows `by: "setup"`), new chats find them
  only after VS Code Insiders restarts. Ask them to quit and reopen it at a natural pause; this chat carries on
  after. Until then, run `<run> env` in each new shell.
- Stop there. The next prompt in the room opens the Excalidraw case study.

## The Microsoft workshop

`waitForConfirm` returned `gate`: they picked "Overnight Delegation at Scale". The canvas asks them to sign in with
their Microsoft account, and it continues once the GitHub CLI is signed in with a work account on GitHub (an
Enterprise Managed User: a username with an underscore and a short code).

1. No GitHub CLI yet: `<run> install gh --json` (it stays in the workshop folder).
2. Start the sign-in the same way as in step 2.3. They sign in with their Microsoft work account in the browser. Then
   `refresh`, and `waitForConfirm` again.
3. `microsoft`: they continued. From here it's the setup in SKILL.md, unchanged, from "Start here" step 1 (the clone
   goes in `~/.copilot/autonomous-output-skills`), with the prompt's title, subtitle and host. Open the canvas again
   the way SKILL.md says, without `workshop`, and it shows the usual checklist.

## Resuming

The same prompt again, "continue my setup", or a restart: get the skills again (SKILL.md, "The AI-First path"), run
`<run> canvas --json`, open the canvas with the same input, then `getState`. When `flow.confirmed` is true, carry on
with the first id in `flow.install` that isn't green; otherwise `waitForConfirm`. Nothing that's done is done again:
every `install` checks first.

## The uninstall

[ai-first-uninstall.md](ai-first-uninstall.md), and for people, the guide on the workshop site.

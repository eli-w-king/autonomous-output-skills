# Dev box mode

The detail behind SKILL.md, "Dev box mode". The same setup, on their dev box, so sessions that run there (overnight
runs, the dev box module) find the same tools, skills and connections as the laptop. Settings partly carry over from
the laptop (it picks the model, effort, mode and permissions, and pushes its agent host settings when it connects),
but nothing installed does: tools, skills, the Playwright MCP server, the Work IQ plugins and `research.env` all live
on the box. The prompt is pasted in a chat on the box itself, like `Set me up for "<Series>: <Title>", hosted by
<Host> + <Host>, on my dev box, including research. Follow <link to this file>`.

**Before the prompt, on the box** (the workshop's dev box page): open the box, install Google Chrome and sign in to
Teams, install or update VS Code Insiders and sign in to GitHub with the same account as the laptop, paste the same
workshop settings (the box's own Insiders pushes its sandbox setting too, so it must be off there as well), turn on
Dev Tunnels from the radio tower and keep Insiders open, then a new chat set up exactly as in "Before the prompt".

**What's the same:** "Start here", Part 1, the canvas in the same chat (on Windows, `canvas-extension.py` copies it
into `$HOME\.copilot\extensions`), the plan, and every item's install and Try-it, with Windows commands
([machine](machine.md)): `winget` for the tools, GitHub CLI signed in with the one-time code, git, Node and
Yarn 1, Python with Pillow and ffmpeg.

**What's different:**
- **Google Chrome is required**, not just Edge: Playwright and Computer Use on the box use it. The check's
  `items.browser` says so (`chrome_required`); install it with
  `winget install --id Google.Chrome -e --accept-source-agreements --accept-package-agreements --silent`. In dev box
  mode `mcp-servers.py add playwright` always writes `--browser chrome`, and the check flags an entry on Edge (remove
  it and add it again).
- **The skills:** use the private copy the laptop made (`setup-attendee --private-repo <owner>/<name>`, no
  `--create`), with the daily sync on the box, and `--weekly none`: one weekly update per person, the laptop's. The
  box's skill edits still reach the copy through its daily sync; only the weekly reading of typed messages stays on
  the laptop. No copy yet: make it on the laptop first, or install just the skills.
- **Work IQ:** the same plugins, installed the same way. Its Try-it reads their next meeting instead of posting: the
  laptop already posted the check-in. Open the canvas without `checkInChat` (pass `""`) so it shows that Try-it.
- **Computer Use:** its setting is local to the box, so it's set here and turned on here (`/computer on` in a chat on
  the box, then its Try-it with Notepad).
- **Research:** the Outset key in the box's own `research.env`, the Outset sign-in on the box, and User Interviews
  signed in once in the box's Playwright browser, so research loops can run there overnight.
- **Skipped on the box, and why** (mark each `skipped` with that note, and `setItem` it `skipped` on the canvas):
  dictation (they talk to the box's chats from the laptop, and a dev box has no microphone), the weekly update (the
  laptop's), Azure (not needed there), creating a dev box (this is the box), and the laptop's Dev Tunnels step (the
  page did it). The check reports these four as not required, with no Try-it.
- **Teams** isn't a checklist item: the dev box page has them sign in to the Teams app on the box. Agents reach Teams
  through Work IQ, which the Work IQ Try-it proves.

## On the canvas

- Open it in the same chat as on the laptop. On Windows, `python "$HOME\.copilot\autonomous-output-skills\autonomous-setup\scripts\canvas-extension.py" install --json`
  copies it into `$HOME\.copilot\extensions\setup-checklist`; then `extensions_reload` and `open_canvas` with the saved
  `title`, `subtitle` and `presenter`, and `checkInChat` `""`.
- Turn research on when the prompt asked for it (`setItem {id: "research", status: "todo", note: "You asked for this in
  your prompt."}`). Then `setItem` `dictation`, `weekly`, `azure` and `devbox` as `skipped`, each with its reason in a
  few words, and `check-setup.py mark <step> skipped --note "<reason>"` for the steps `dictation`, `weekly`, `azure` and
  `devbox`.
- The check's JSON says `mode: "devbox"`; those four items come back `required: false` with no Try-it and
  `devbox_skip: true`, which the canvas shows as Skipped by itself (out of the count, so the box can reach all done
  even if a report is missed), and `items.browser` has `chrome_required: true`. Still mark the steps `skipped`: the
  readiness file reads the steps.

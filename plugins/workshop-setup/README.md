# Workshop setup canvas

A live checklist that sits next to the chat while the setup skill (`autonomous-setup`) gets a machine ready. Each
item shows a green check when it's already set up, live progress while the agent works, and a **Try it** prompt the
person copies into the chat to test it for real. Optional items have a switch, so people choose them on the page.

The plugin carries only the canvas. The skills stay each person's own editable copy (installed by
`tools/sync-skills.py`), so installing this plugin never adds skills, agents, hooks or MCP servers.

## What you need

- VS Code Insiders with canvases on. Add this to your User settings (JSON), then restart VS Code Insiders:

  ```json
  "chat.canvases.enabled": true
  ```

  New sessions pick the setting up. Canvases open in Copilot sessions, in the Agents window and in the editor's chat.
- Agent plugins on, which is the default (`"chat.plugins.enabled": true`).

## Install

The plugin lives in this repo at `plugins/workshop-setup`, and `.plugin/marketplace.json` lists it, so the repo works
as a plugin marketplace named `autonomous-output-skills`. It's the same on Mac and Windows.

**In the Agents window**, in a Copilot session, send these two lines in the chat, one at a time:

```text
/plugin marketplace add eli-w-king/autonomous-output-skills
/plugin install workshop-setup@autonomous-output-skills
```

**Or in a terminal** with GitHub Copilot CLI (in VS Code, Terminal > New Terminal; the first time, VS Code offers to
install the CLI):

```text
copilot plugin marketplace add eli-w-king/autonomous-output-skills
copilot plugin install workshop-setup@autonomous-output-skills
```

**Or with one click** from a web page or email: this link opens VS Code Insiders, which asks before it adds the
marketplace and installs the plugin.

```text
vscode-insiders://chat-plugin/install?source=eli-w-king/autonomous-output-skills&plugin=workshop-setup
```

**From your own clone** (works before the public repo has the plugin, and loads live from the folder, so a pull
updates it):

```text
copilot plugin marketplace add ~/.copilot/autonomous-output-skills
copilot plugin install workshop-setup@autonomous-output-skills
```

On Windows in PowerShell, the first line is `copilot plugin marketplace add "$HOME\.copilot\autonomous-output-skills"`.

Start a new session after installing; the canvas is called **Workshop setup**. To remove it:
`copilot plugin uninstall workshop-setup@autonomous-output-skills`.

## The canvas contract

Canvas id `autonomous-setup-checklist`. Open it with one stable `instanceId` (for example `workshop-setup`); opening
the same id again shows the same state.

### Open input

All fields are optional strings. Pass `{}` when there's nothing to add. Values are saved, so a later `{}` keeps
them, and an empty string clears one. Nothing about an event is built in: the setup prompt passes it here.

| Field | What it is | Example |
|---|---|---|
| `title` | the event's name | `Design systems workshop` |
| `subtitle` | a short line with it, like a series name | `Team learning series` |
| `presenter` | the host's name, or both hosts' names (up to 60 characters); the intro resolves into it, on one line | `Your Name + Their Name` |
| `checkInChat` | the meeting chat where the Work IQ test posts a check-in | `Design systems workshop` |
| `skillsDir` | absolute path (or `~/...`) of the folder with `autonomous-setup/scripts/check-setup.py` | `~/.copilot/autonomous-output-skills` |
| `simulate` | for hosts previewing the workshop: `mac` or `windows` plays a first-time setup (see below); leave it out for a real setup | `mac` |

Without `checkInChat`, the Work IQ test reads the next meeting's subject instead of posting.

### Previewing a first-time setup

`simulate` plays a made-up setup on a new Mac or Windows PC, from the first check to all set, so hosts can see what
attendees will see. Open it with its own `instanceId` (for example `setup-simulation`), never the real one. It runs
in memory with the same status logic as a real setup: it never runs `check-setup.py`, never changes the saved
progress, and never installs anything. It borrows `title`, `subtitle`, `presenter` and `checkInChat` from the last
real open unless the input gives them. The page marks it **Simulation** and has **Pause**, **Play** and **Replay**;
it starts after the intro and takes about two minutes. Voice and taste aren't part of it, as in v1.

### Actions

| Action | Input | Returns |
|---|---|---|
| `getState` | none | `checkedAt`, `checking`, `checkError`, `progress {done, total}`, `allDone`, `step`, `choices` (optional items: true, false or null), `items` (`id`, `group`, `label`, `status`, and `how`, `tryIt`, `note`, `detail` when they apply), `later`, `meta` |
| `refresh` | `{quick?}` | runs the check again, waits for it, returns the same as `getState` |
| `setItem` | `{id, status, note?, commands?}` | `{ok, item, progress}` |
| `setStep` | `{id}`: an item id, a group id, or `none` | `{step}` |

`setItem` statuses:

- `working`: you're on it.
- `needs-you`: the person has to do something. Put plain steps in `note`, one per line (up to 8), and copyable
  commands in `commands` (up to 6). Without them, the canvas shows its own steps for that item and OS.
- `installed`: it's set up. The canvas shows the item's Try it prompt.
- `tested`: the person's Try it test worked. Green check, "Tested".
- `failed`: put the exact error line in `note`.
- `skipped`: the person chose to skip it. For optional items this also records their choice.
- `todo`: not started.

Item ids are check-setup.py's (`gh`, `node`, `settings`, `skills`, `playwright`, `workiq`, `computer_use`, `azure`,
`devbox`, `research`, and the rest) plus `weekly`, `dictation`, `voice` and `taste`. Step ids with dashes work too
(`computer-use`), and `ffprobe` counts as `ffmpeg`. An unknown id gets an error that lists the valid ones.

### How an item gets its status

- The canvas runs `check-setup.py --format json` itself when it opens, from **Refresh**, and from `refresh`
  (`python3` on Mac and Linux, `python` or `py -3` on Windows; it never runs the macOS `python3` stub that would open
  an install dialog).
- A check result of `ok: true` means installed. Items with a test show **Installed** and their Try it prompt; items
  without one (git, Node.js, settings and so on) turn green right away.
- "Already set up" means it was there at the first check; otherwise it says "Set up just now".
- `check-setup.py mark <step> ok` counts as tested, so the canvas and the readiness checklist agree. A `blocked` mark
  shows as needs-you with its note, `failed` as failed, `skipped` as skipped.
- A newer check that finds an item installed clears an older `working`, `needs-you` or `todo`.
- Items the check flags `later: true` (the practice project) aren't counted. They show in a quiet "At the workshop"
  note.
- `dictation` is installed once `dictation.model` is in the check's matching settings.

### When the setup skill calls what

1. Open the canvas with the event's text from the setup prompt. It runs the check on its own.
2. Before asking about optional items, call `getState` and read `choices`. People can switch them on the page.
3. For each item, `setStep {id}`, then `setItem {id, status: "working"}`.
4. When the person has to act, `setItem` with `needs-you`, the steps and the commands.
5. After an install, `refresh` (or `setItem installed`). The page shows the Try it prompt.
6. After the person sends the Try it prompt and the test works, `check-setup.py mark <step> ok`, then
   `setItem {id, status: "tested"}`.
7. To resume, open the canvas again with the same `instanceId`, then `getState`.

## Where things are

- `extensions/setup-checklist/extension.mjs` wires the canvas to `lib/`: the item catalog, the check runner, the
  status logic, storage, input checks and the page server. `web/` has the page, its styles and the intro.
- Progress is saved in `<copilot-home>/extension-data/autonomous-setup-checklist/setup-progress.json` (the Copilot home
  is `COPILOT_HOME` when it's set). Writes are atomic, and a file that doesn't read back cleanly is reported and left
  alone, never overwritten.
- The page is served on `127.0.0.1` only, on a port picked when it opens, and it only answers requests for that
  address. Nothing leaves the machine.
- The intro plays once per open, stops on a click or any key, pauses while hidden, and is replaced by a still title
  when the system asks for reduced motion.

## Trying it without a session

```text
node plugins/workshop-setup/tests/preview.mjs --home <a scratch folder> --title "Design systems workshop" --presenter "Your Name"
node plugins/workshop-setup/tests/preview.mjs --simulate mac --speed 2 --title "Design systems workshop" --presenter "Your Name"
```

The first serves the page against a made-up check result, the second plays the first-time setup (`--speed` speeds
it up), and both print the address. Every module passes `node --check`; the tests are
`node --test plugins/workshop-setup/tests/*.test.mjs`.

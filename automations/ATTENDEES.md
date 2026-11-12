# Self-improving skills on your own account

The skills get better from your own corrections. Each week, the skill miner reads what you told your agents,
turns repeated asks and corrections into rules, and opens a pull request in your private copy of this repo. You
review it, and merge what you want to keep. When the shared skills change, you get a second pull request with
those updates. Nothing is ever published, and your messages never leave your machine.

This is attendee mode: one GitHub account, one private repo. (The maintainer setup in [README.md](../README.md),
"How the skills stay current", uses two repos and publishes; you don't need it.)

## How it works

- **Your private copy.** `<you>/autonomous-output-skills` on GitHub, private. In the clone at
  `~/.copilot/autonomous-output-skills`, `origin` is your copy and `public` is the shared repo, fetch only (a push
  to it always fails).
- **Every day,** the sync brings in edits your sessions made to your installed skills, with the same 3-way merge the
  maintainer setup uses, so nothing is overwritten. They go to the `skill-updates` branch, never `main`. Your
  installed skills come from that branch, so an edit waiting for your review stays installed.
- **Every Monday at 11:00,** the skill miner reads the messages you typed to agents on this machine (only yours: never briefs,
  automations, or autopilot), updates your skills on `skill-updates`, and opens one pull request into `main`. When the
  shared repo has new commits, it merges them into `upstream-updates` and opens a pull request for those too.
- **You review.** Merge a pull request to keep it; the next daily sync installs it. Close the review pull request
  without merging to drop it: the next daily sync puts `skill-updates` and your installed skills back on `main`, and
  keeps a copy on a `declined/` branch.
- **Your voice and taste are yours.** Personalized setup is coming soon. The templates and procedure build
  your own `my-voice` and `my-taste` from your own work: what you
  sent, the design feedback you gave and got, and your chats with agents ([voice](../my-voice/references/voice-from-workiq.md),
  [taste](../my-taste/references/taste-from-workiq.md), `tools/personal-skills.py`). Once you've changed
  `my-voice/SKILL.md` or `my-taste/SKILL.md` (on `main` or waiting on `skill-updates`), a shared update keeps your
  version of that file whole.

## Set it up

The setup interview does this for you. By hand, after cloning this repo to `~/.copilot/autonomous-output-skills`:

```bash
python3 ~/.copilot/autonomous-output-skills/tools/sync-skills.py setup-attendee --create
```

```powershell
python "$HOME\.copilot\autonomous-output-skills\tools\sync-skills.py" setup-attendee --create
```

On Windows, call Python as `python` (or `py -3`), never `python3`: there it's only a Store stub.

It needs git, Python 3.8 or newer, and GitHub CLI signed in (`gh auth login`, in your own terminal). Run it with
`--dry-run` first: it lists every change it will make, in order, and makes none. Then it:

- makes `<you>/autonomous-output-skills` on GitHub, private (`--private-repo <owner>/<name>` picks another name;
  without `--create` it only uses one that exists), and starts its `main` from the shared skills;
- points the clone's `origin` at it and adds the shared repo as `public`, fetch only;
- runs `gh auth setup-git`, so git uses your GitHub CLI sign-in for github.com (a change to your global git config);
- installs the skills into `~/.copilot/skills` (any copies already there are backed up to `~/.copilot/skills-backup/`
  first; other skills there are left alone);
- schedules the daily sync at 10:30 and at login (launchd on macOS, Task Scheduler on Windows). On a Mac, macOS shows
  a "Background Items Added" notice for python3 when the job is added: that's this job, and it's safe to allow.

`--json` prints one JSON object for an agent, with the same list under `plan`. It refuses to run on a machine that
already uses the maintainer setup. If `<you>/autonomous-output-skills` already exists and is public (a fork of the
shared repo, say), pick another name with `--private-repo`: GitHub keeps forks of public repos public.

Then schedule the weekly run.

## The weekly run

### In the Agents window

1. Open Automations and choose Import Automation, then pick
   [`weekly-skill-update.automation.md`](weekly-skill-update.automation.md) (or drag it onto the list). The New
   automation dialog opens with the name, prompt, and schedule filled in: Mondays at 11:00, your time.
2. Set the folder to `~/.copilot/autonomous-output-skills`. Leave Worktree isolation and Run in the Cloud off.
3. Leave the harness on Copilot. In Models, pick your best model (Claude Opus 5.5 if you have it), with the highest
   thinking effort and the largest context size.
4. The mode and permissions picker starts on Interactive and Manual permissions. Choose Autopilot and Allow all, so
   the run never waits for a click: with Manual or Assisted permissions, the first shell command waits for a click
   that never comes. (An agent can confirm it: `listAutomations` should show
   `"config": {"mode": "autopilot", "autoApprove": "autoApprove"}` in the automation's `sessionTemplate`.)
5. Create it, and turn it on if it shows as off (imported automations start off).
6. Prove it: Run now, wait for the run to finish, then check it:

```bash
python3 ~/.copilot/autonomous-output-skills/automations/run-weekly-skill-miner.py --check-run
```

```powershell
python "$HOME\.copilot\autonomous-output-skills\automations\run-weekly-skill-miner.py" --check-run
```

It reads the run's session log (`~/.copilot/session-state/<session>/events.jsonl`) and passes when the run used max
effort and the long context and every approval it asked for was answered. When the run is done, its report is in
`~/.copilot/skill-miner/reports/`, and the pull request links are at the end.

The automation runs on this machine. If it was asleep or off at that time, choose Run now, or let the backup below
catch the week up.

### For agents: configureAutomation

`setup-attendee --json` prints this machine's exact input under `schedule.weekly.automation.configureAutomation`. Its
shape:

```json
{
  "name": "Weekly skill update",
  "prompt": "[weekly-skill-miner] Weekly skill update. In a terminal, run `python3 ~/.copilot/autonomous-output-skills/automations/run-weekly-skill-miner.py --automation` and follow what it prints, start to finish. Never ask me anything; if something blocks you, put it in the report and finish.",
  "schedule": { "interval": "weekly", "scheduleDay": 1, "scheduleHour": 11, "scheduleMinute": 0 },
  "target": { "kind": "workspace", "folderUri": "file:///<home>/.copilot/autonomous-output-skills",
              "providerId": "local-agent-host", "sessionTypeId": "copilotcli", "isolation": "folder" },
  "sessionTemplate": {
    "modelId": "agent-host-copilotcli:claude-opus-5.5",
    "modelConfiguration": { "thinkingLevel": "max", "contextTier": "long_context" },
    "config": { "mode": "autopilot", "autoApprove": "autoApprove" }
  },
  "enabled": true
}
```

- The prompt runs the same command as the blueprint: `python3` on macOS, and on Windows
  `python "$HOME\.copilot\autonomous-output-skills\automations\run-weekly-skill-miner.py" --automation`. No Python
  path is baked in, so a Python update never breaks the weekly run.
- Use the best model the person has; the model id is `<provider>:<model>` as `listAutomations` shows it.
  `thinkingLevel` is the effort key (`reasoningEffort` works too), and `contextTier: "long_context"` picks the
  model's largest context (the dialog saves it as `contextSize`, the largest size the model offers).
- `autoApprove` must be `"autoApprove"` (Allow all in the dialog), with `mode` `"autopilot"` (Autopilot).
  `"assisted"` or `"default"` (Assisted or Manual permissions) leave the run waiting for approvals.
- Then `listAutomations` to read it back, `runAutomation` once, and `run-weekly-skill-miner.py --check-run` on that
  run. Every `permission.requested` needs a `permission.completed`.

### Backup: launchd or Task Scheduler

When Copilot CLI is installed and signed in, the runner can run on its own as well:

```bash
python3 ~/.copilot/autonomous-output-skills/automations/run-weekly-skill-miner.py --install
```

```powershell
python "$HOME\.copilot\autonomous-output-skills\automations\run-weekly-skill-miner.py" --install
```

It checks at 11:00, 14:00, 17:00, 20:00, and at logon, and starts a run when one is due: Monday after 11:00, a week
that was missed, or a retry after a failed run. It shares the automation's lock and its record of the last run, so a
week never runs twice. It runs Copilot CLI at max effort with the long context, on the model you gave
`setup-attendee --model` (Claude Opus 5.5 by default); `--check --llm` proves the model answers. `--status`,
`--check`, `--now`, and `--uninstall` work as in the maintainer setup. `--dry-run` runs every step except the model:
it pushes `skill-updates` and opens or updates the pull requests with what is already there.

## Privacy

- Your messages, the miner's notes and ledger, and your voice samples stay in `~/.copilot/skill-miner/` on this
  machine (owner-only permissions). Only skill changes go to your private copy.
- Every push runs the secret scan first. The weekly run also checks every change with `tools/validate-skills.py`, so
  nothing private (personal paths, email addresses, the names in your `~/.copilot/skill-miner/private-terms.txt`)
  lands outside `private/`.
- Nothing is published: pushes to the shared repo always fail, and `tools/publish-public.py` refuses in attendee
  mode. To suggest a change to the shared skills, open a pull request on the shared repo from a fork.
- `my-voice` and `my-taste` are built from your own sent messages, design feedback, and agent chats, read only:
  [`voice-from-workiq.md`](../my-voice/references/voice-from-workiq.md) and
  [`taste-from-workiq.md`](../my-taste/references/taste-from-workiq.md). What they read (voice samples, taste notes,
  your agent chats, earlier copies) stays in `~/.copilot/skill-miner/private/`, which only you can read. The skills
  keep only short rules in general words, and `tools/personal-skills.py check` blocks quotes, links, email addresses,
  and the names in your private terms.

## Turn it off

- The weekly run: disable or delete the automation in Automations (and `run-weekly-skill-miner.py --uninstall` if you
  installed the backup).
- The daily sync: `python3 ~/.copilot/autonomous-output-skills/tools/sync-skills.py schedule --remove` (Windows:
  `python "$HOME\.copilot\autonomous-output-skills\tools\sync-skills.py" schedule --remove`).
- Your installed skills stay as they are. `sync-skills.py review-reset` drops whatever waits on `skill-updates` (it
  keeps a copy on a `declined/` branch first), and you can delete your private copy on GitHub any time.

## Commands

| Command | What it does |
|---------|--------------|
| `sync-skills.py setup-attendee [--private-repo O/N] [--create] [--json] [--dry-run]` | set up this machine (above) |
| `sync-skills.py sync` | the daily sync, now |
| `sync-skills.py status [--json]` | the differences, plus mode, remotes, last sync and schedule with `--json` |
| `sync-skills.py review-pr` / `upstream-pr` | open or update the review pull request, or the shared updates one |
| `sync-skills.py review-reset` | drop what waits on `skill-updates` and reinstall `main` |
| `run-weekly-skill-miner.py --check-run [SESSION]` | check a weekly run's model, effort, context and approvals |
| `run-weekly-skill-miner.py --dry-run` | every step of the weekly run except the model |
| `tools/test-sync-attendee.py` | test all of this offline, in a scratch folder |
| `personal-skills.py status [--json]` | where your `my-voice` and `my-taste` stand (the setup items `voice` and `taste`) |
| `personal-skills.py collect` / `start` / `check` / `save` | read your agent chats into the private folder, make both skills yours, check the rules, save and install them |
| `tools/test-personal-skills.py` | test making them yours offline, in a scratch folder |

On Windows, run them with `python` (or `py -3`) instead of `python3`, which is only a Store stub there. The
scheduled jobs and the automation's prompt use the full path to `python.exe`. A schedule there can't carry a custom
`HOME` or `COPILOT_HOME`, so use the default folders.

## The weekly run in attendee mode (for the agent)

Follow the Procedure in [`weekly-skill-miner.md`](weekly-skill-miner.md) with these differences. "This run" says
"Mode: attendee" when they apply.

- The repo is on the review branch (`skill-updates`), not `main`. Commit there. Never check out `main`, never push,
  and never merge into `main`: the finish step pushes the review branch and opens the pull requests.
- Step 1 is the same, including `git merge --no-edit origin/main` when `origin/main` is not merged yet.
- Step 2: the messages come from this machine's sessions only. They are this person's, so learn their rules and their
  voice from them, and never from the shared repo's examples.
- Step 6: write the commit message file as usual. The finish step turns this run's commits into one commit with it,
  unless the run merged something in; then the commits stay as they are.
- Step 9: if "This run" has a Finish line, run that command after writing the report, and add what it prints (the pull
  request links) to the report and to your final message.
- Step 4, voice and taste: `my-voice` and `my-taste` are the person's own once `python3 tools/personal-skills.py status`
  says `started` or `built`. Put `voice` signals in `my-voice` and `design` signals in `my-taste` (not in
  `autonomous-prototypes/references/design-taste.md`), in the format their procedures give: sources, sightings, and the
  latest date, and for taste an area and whose it was. Rule 7's "never edit `my-taste/`" doesn't apply here. While one
  is still the shared one (`shared` or `missing`), leave it alone and keep its signals in the ledger; once it has 3 or
  more active rules, run `personal-skills.py start --skill voice` (or `--skill taste`) and write them in. Before
  committing, `personal-skills.py check` must pass. This run never reads Microsoft 365; "refresh my voice and taste"
  in a chat does that.
- The privacy gate still applies: this repo is private, but the person may share it or contribute back.

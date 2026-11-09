# Install the autonomous output skills

This repository holds seven user-global skills:

| Skill | Role |
|-------|------|
| `autonomous-computer-use` | background-only desktop app automation with a private virtual input lane; Windows build, launch, UI automation, and evidence |
| `autonomous-demos` | demos, screenshots, before/after, storyboards, PR media, recording toolkit |
| `autonomous-prototypes` | build, iterate, and ship UI changes and PRs |
| `autonomous-variations` | variation labs: N options per decision, rounds, porting the pick, one review page |
| `autonomous-runs` | operating rules for overnight and unattended work, and the shared gotchas by topic |
| `autonomous-research` | studies, synthesis, and the Outset, Marvin, and User Interviews plumbing |
| `my-voice` | writes what I send or post as me; kept current by the weekly skill miner |

Copilot CLI and VS Code (Insiders and the Agents window) both read `~/.copilot/skills/`, so one install
covers both. On each machine, `tools/sync-skills.py` keeps that folder and the repos in sync in both
directions, once a day and at logon (README.md, "How the skills stay current").

## 1. Authenticate GitHub CLI

Sign in to both accounts once on each machine: the default account, which can push to this public
repo, and the account that owns the private repo. The sync asks GitHub CLI for the private account's
token only for the private repo's URL, so the default account stays active.

```bash
gh auth login                      # the default (public) account
gh auth login                      # again, for the private repo's account
gh auth switch --user <default account>
gh auth status
```

## 2. Check prerequisites

Built on macOS; the sync, the research scripts, and the demo toolkit also run on Windows dev boxes
(Git Bash for the `.sh` scripts, `python` instead of `python3`).

Always:
- GitHub CLI, git, curl, jq, rsync, sqlite3, Google Chrome.
- `ffmpeg` and `ffprobe` on `PATH` (Homebrew: `/opt/homebrew/bin`).
- Node 22 or newer for the toolkit scripts; Python 3 with Pillow for the encoders and QA sheets.

For Computer Use:
- In VS Code Insiders Settings JSON: `"chat.agentHost.computerUse.enabled": true`.
- Activate with `/computer on` the first time if the host has not exposed the tools yet.
- Grant `Copilot Computer Use.app` Screen & System Audio Recording and Accessibility, then fully
  restart VS Code Insiders. No Input Monitoring or Full Disk Access is needed for ordinary app
  automation.

For Microsoft 365 work (Outlook, Teams, OneDrive, SharePoint, Planner):
- The official WorkIQ plugins on each machine, then a new session:
  `copilot plugin marketplace add microsoft/work-iq`, `copilot plugin install workiq@work-iq`, and
  `copilot plugin install workiq-productivity@work-iq`.
- `workiq` supplies the hosted connection and core instructions; `workiq-productivity` supplies report
  templates, not another server. The hosted plugin needs no local WorkIQ CLI. Follow the core skill's
  current routing even when a productivity example uses older `ask`-only instructions.
- For an existing installation, use `copilot plugin update <installed-name>`. A direct install pinned
  to a commit may stay at that revision; reinstall from the same official repository/subdirectory to
  update it without adding a duplicate marketplace copy. Restart the session to load new instructions.
- Verify the plugin's tools and a minimal read on each host before unattended work. Sign in through
  that host if requested; tenant consent and appropriate Microsoft 365 licensing are required.
  Do not assume another machine's authentication carries over, or diagnose missing tools as a sign-in
  failure without evidence.
- Prefer one active WorkIQ connection. If an older app connector overlaps, disable it only after
  checking the change's scope and the hosts that use it; do not revoke access needed by other runs.
- Without WorkIQ, browser or Computer Use can handle supported UI tasks. They are not workarounds
  for WorkIQ permission/policy denials or missing consent.

For websites and web forms (Playwright MCP):
- Each machine needs it in its own `~/.copilot/mcp-config.json`, under `mcpServers`:
  `"microsoft/playwright-mcp": { "type": "stdio", "command": "npx", "args": ["@playwright/mcp@latest"], "tools": ["*"] }`.
  It uses Google Chrome and Node. A laptop's `mcp-config.json` does not reach a dev box.
- Start a new session, then check it with one navigate and snapshot of a page you can see.
- Its Chrome profile (`~/Library/Caches/ms-playwright-mcp/` on macOS) keeps sign-ins per machine.
  Sign in once in that window if a site asks.

For Code OSS work (demos, prototypes, app studies):
- A `microsoft/vscode` checkout built with the Node from its `.nvmrc` (`npm install`,
  `npm run compile`), with `.build/electron` present.
- The checkout's `launch` skill (`.agents/skills/launch/`) for signed-in instances.
- The demo driver loads `playwright-core` from that checkout: `export VSCODE_REPO=<checkout>`.
- The mock LLM (`start-mock-llm.cjs`) needs the checkout's Node 24 and its
  `scripts/chat-simulation/common/mock-llm-server.ts`.

For variation labs:
- An existing Playwright install to reuse for headless checks (any project's `node_modules`, run with
  the system Chrome channel); no browser downloads mid-run.
- `sync-pick.sh` needs only bash and git; `check-manifest.mjs` needs Node 22 or newer.
- Labs across dev boxes: Node 22 for `drop-server.mjs` and `drop.mjs`; bash, git and curl for
  `drop-sync.sh` and `drop-watch.sh` (Git Bash on Windows); Python 3 for `make-briefs.py`; and the
  `devtunnel` CLI, signed in, on the hub when the lab spans more than one box.

For studies:
- Outset and Marvin, on each machine: create `~/.copilot/research.env` once from
  `~/.copilot/skills/autonomous-research/research.env.template` (its header has the macOS and Windows
  commands), fill in the keys, then run
  `node ~/.copilot/skills/autonomous-research/scripts/outset-auth.mjs` once on that machine (you
  approve the device code; the sign-in is per machine). Never commit `research.env`.
- UserTesting and User Interviews: an account email; you enter passwords and 2FA yourself.

Optional:
- `dap-cli` for breakpoint debugging while capturing Code OSS.
- A Windows host or a Windows VM in UTM for the Windows part of `autonomous-computer-use`.

## 3. Add the machine

From any shell on the machine (it needs git, Python 3.8 or newer, and both GitHub CLI accounts). The
exact commands for this setup, with the private repo filled in, are in `private/README.md` in the
private repo.

macOS or Linux:

```bash
R=~/.copilot/autonomous-output-skills; [ -d "$R/.git" ] || git clone -q https://github.com/eli-w-king/autonomous-output-skills.git "$R"; python3 "$R/tools/sync-skills.py" setup --private-url <private repo URL> --private-user <account> && python3 "$R/tools/sync-skills.py" sync && python3 "$R/tools/sync-skills.py" schedule
```

Windows (PowerShell):

```powershell
$r = "$HOME\.copilot\autonomous-output-skills"; if (!(Test-Path "$r\.git")) { git clone -q https://github.com/eli-w-king/autonomous-output-skills.git $r }; python "$r\tools\sync-skills.py" setup --private-url <private repo URL> --private-user <account>; if ($?) { python "$r\tools\sync-skills.py" sync; python "$r\tools\sync-skills.py" schedule }
```

- `setup` makes the private repo `origin` and this repo `public` in the clone, gives the private URL
  its own credential helper, runs `gh auth setup-git`, checks that git reaches both repos without a
  prompt, and saves the settings in `~/.copilot/skills-sync.json`.
- The first `sync` pulls, harvests edits sessions made to the installed copies before anything is
  replaced (a clean first run on a new machine harvests nothing), pushes them, installs every skill,
  and removes the retired names after backing them up. Only skills in the repo are managed; other
  skills in `~/.copilot/skills` are left alone. The first run takes up to a minute; later runs with
  nothing to do take a second or two. Once a day a run also exports the messages I typed to agents on
  that machine to `private/inbox/<host>/` (README.md, "My messages in one place"). The first run also
  sets Copilot CLI's defaults to the top model, max effort, and the long context, once (README.md,
  "Copilot CLI at the top settings"), and every run brings the weekly miner's state to this machine.
- `schedule` adds the daily and logon job, at the time `private/sync-schedule.txt` in the private repo
  sets for this machine (10:30 without that file; `--daily HH:MM` or `--every MINUTES` to choose):
  Task Scheduler on Windows ("Autonomous skills sync", below-normal priority, no window), launchd on macOS
  (`com.autonomous-output-skills.skills-sync`, background priority, low-priority I/O, Nice 10), or crontab
  lines on Linux. From then on every sync applies a change to that file by itself (README.md, "One sync on
  every machine").
- A machine that set up an older version: if its clone still has the older tools, run the new
  `sync-skills.py` from a fresh clone of the private repo with `--repo ~/.copilot/autonomous-output-skills`
  for `setup` and the first `sync`, then `schedule` from the clone itself. If it has the dev-box
  updater's "Autonomous skills update" task, delete it once the new job runs.
- A machine that should only use the published skills (a teammate's, for example) can run
  `node tools/install-devbox.mjs --schedule` instead: it pulls this repo and installs, and never
  publishes. Edits made to its installed copies are backed up, not sent anywhere.

## 4. Verify

```bash
python3 ~/.copilot/autonomous-output-skills/tools/sync-skills.py sync-status    # settings, schedule, last runs
python3 ~/.copilot/autonomous-output-skills/tools/sync-skills.py status | tail -1
python3 ~/.copilot/autonomous-output-skills/tools/validate-skills.py --quiet && echo "ok repo validates"
for s in autonomous-computer-use autonomous-demos autonomous-prototypes autonomous-variations autonomous-runs \
  autonomous-research my-voice; do test -f "$HOME/.copilot/skills/$s/SKILL.md" && echo "ok $s"; done
for s in $(grep -v '^#' ~/.copilot/autonomous-output-skills/retired.txt); do
  test -e "$HOME/.copilot/skills/$s" && echo "still installed: $s"; done

D="$HOME/.copilot/skills/autonomous-demos/scripts"
V="$HOME/.copilot/skills/autonomous-variations/scripts"
R="$HOME/.copilot/skills/autonomous-research/scripts"
for f in "$D"/*.mjs "$D"/*.cjs "$D"/*.js "$V"/*.mjs "$R"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
for f in "$D"/*.py "$V"/*.py; do python3 -m py_compile "$f" || echo "FAIL $f"; done
for f in "$D"/*.sh "$V"/*.sh "$R"/*.sh; do bash -n "$f" || echo "FAIL $f"; done
node "$R/probe.mjs"                # research keys and connections, on a machine with research.env
```

On Windows, run the `.sh` checks in Git Bash (`C:\Program Files\Git\bin\bash.exe`), not the WSL `bash`
that comes first on PATH. Then start a new agent session and confirm the seven skills appear in the
available-skills list and the retired names do not.

## 5. Optional chat modes

`autonomous-research` includes thin plan-then-build chat modes:

```bash
mkdir -p <workspace>/.github/chatmodes
cp ~/.copilot/skills/autonomous-research/chatmodes/*.chatmode.md <workspace>/.github/chatmodes/
```

Study launches, paid recruiting, and public-repository posts stay explicitly human-gated.

## 6. Publish to the public repo

```bash
python3 ~/.copilot/autonomous-output-skills/tools/publish-public.py --dry-run
python3 ~/.copilot/autonomous-output-skills/tools/publish-public.py
```

It merges `public/main` into the private main (teammates may push to the public repo), builds the
tree without `private/` and the `.publishignore` paths, validates it with the private terms in
`private/private-terms.txt`, and pushes one new commit on top of `public/main`. The private main then
records the publish as a merge that keeps its own tree, so the next merge only brings in new public
commits. The commit message must pass the validator, so it has no email addresses (and no
Co-authored-by trailer). Private history never goes to the public repo. While
`private/publish-hold.txt` exists in the private repo, every real publish stops before it changes
anything (dry runs still work); delete it to publish again.

## 7. Schedule the weekly skill update (one machine only)

Windows (Task Scheduler):

```powershell
python "$HOME\.copilot\autonomous-output-skills\automations\run-weekly-skill-miner.py" --check
python "$HOME\.copilot\autonomous-output-skills\automations\run-weekly-skill-miner.py" --install
```

macOS (launchd):

```bash
"$HOME/.copilot/autonomous-output-skills/automations/run-weekly-skill-miner.sh" --check
"$HOME/.copilot/autonomous-output-skills/automations/run-weekly-skill-miner.sh" --install
```

It runs on Mondays at 11:00 and checks again later that day and at login, to catch up after a missed
Monday or retry after a failed run. It waits for a running sync, pushes to the private repo, then
publishes. Reports land in `~/.copilot/skill-miner/reports/`. To move it to another machine, run
`--rehearse` there first, then `--install` there and `--uninstall` on the old one; its state is
already on every machine (README.md, "The weekly skill miner").

## Machine-specific checks

- Every shell that builds or launches Code OSS needs the checkout's `.nvmrc` Node
  (`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use`).
- Launch Code OSS with `TMPDIR=/tmp` and keep run directories short (socket path limit);
  `launch-demo-oss.mjs` does both.
- `~/Desktop` on this Mac is the OneDrive-synced Desktop; deliverables go there.
- Chrome's macOS executable is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- macOS has no `timeout` or `setsid`; use script-level timeouts and detached processes.

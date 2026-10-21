# Install the autonomous output skills

This repository holds eleven user-global skills:

| Skill | Role |
|-------|------|
| `autonomous-computer-use` | background-only macOS app automation with a private virtual input lane |
| `autonomous-demos` | demos, screenshots, before/after, storyboards, PR media, recording toolkit |
| `autonomous-prototypes` | build, iterate, and ship UI changes and PRs |
| `autonomous-variations` | variation labs: N options per decision, rounds, porting the pick, one review page |
| `autonomous-long-runs` | operating rules for overnight and unattended work |
| `my-voice` | writes what I send or post as me; kept current by the weekly skill miner |
| `autonomous-skill-glossary` | shared gotchas and topic references |
| `automation-windows-os` | optional Windows and UTM execution |
| `autonomous-user-studies` | research: UserTesting and Outset studies, User Interviews recruiting |
| `autonomous-research-synthesis` | research: readouts, quotes, slideshows, decision digests, findings to issue |
| `research-platforms` | research: Outset, Marvin, and User Interviews plumbing |

Installing means cloning the repository, installing those folders into `~/.copilot/skills/` with
`tools/sync-skills.py`, and starting a fresh agent session. Copilot CLI and VS Code (Insiders and the
Agents window) both read that folder, so one install covers both. After that, the weekly skill
miner in `automations/weekly-skill-miner.md` keeps the repo and the installed copies in sync (step 6
schedules it).

## 1. Authenticate GitHub CLI

The repository is public; the install commands use GitHub CLI:

```bash
gh auth login
gh auth status
```

## 2. Check prerequisites

Built and verified on macOS.

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

For studies:
- Outset and Marvin: create `~/.copilot/research.env` once with
  `cp ~/.copilot/skills/research-platforms/research.env.template ~/.copilot/research.env && chmod 600 ~/.copilot/research.env`,
  fill in the values, then
  `node ~/.copilot/skills/research-platforms/scripts/outset-auth.mjs` once (you approve the device
  code). Never commit `research.env`.
- UserTesting and User Interviews: an account email; you enter passwords and 2FA yourself.

Optional:
- `dap-cli` for breakpoint debugging while capturing Code OSS.
- A Windows host or a Windows VM in UTM for `automation-windows-os`.

## 3. Clone and install (also migrates the old skill names)

```bash
REPO="$HOME/.copilot/autonomous-output-skills"
if [ -d "$REPO/.git" ]; then git -C "$REPO" pull --ff-only; else gh repo clone eli-w-king/autonomous-output-skills "$REPO"; fi

# One time: retire the skill names used before October 2026 (backed up, not deleted).
BACKUP="$HOME/.copilot/skills-backup/$(date +%Y%m%d-%H%M%S)"
for s in autonomous-design-build-record-demo-unmoderated-research autonomous-research-synthesis-telemetry-iterative-design-issues; do
  [ -d "$HOME/.copilot/skills/$s" ] && mkdir -p "$BACKUP" && mv "$HOME/.copilot/skills/$s" "$BACKUP/"
done

python3 "$REPO/tools/sync-skills.py" status    # what differs, changes nothing
python3 "$REPO/tools/sync-skills.py" harvest   # bring edits sessions made to installed copies into the repo
python3 "$REPO/tools/sync-skills.py" install   # back up, copy, and record what was installed
```

`install` only manages skills that exist in this repo; other skills in `~/.copilot/skills` are never
touched. It moves the copies it replaces to `~/.copilot/skills-backup/<timestamp>/` and records what
it installed in `~/.copilot/skill-miner/`, so the next `harvest` knows exactly what sessions changed.
It refuses to install while installed copies have edits that are not in the repo yet; if `harvest`
reports a conflict, merge the saved files it lists into the repo file, run
`sync-skills.py resolve <skill/path>`, then run `install` again. The `../<skill>/` links
between skills assume the folders sit side by side.

## 4. Verify

```bash
SKILLS="autonomous-computer-use autonomous-demos autonomous-prototypes autonomous-variations autonomous-long-runs \
  my-voice autonomous-user-studies autonomous-research-synthesis autonomous-skill-glossary research-platforms \
  automation-windows-os"
OLD="autonomous-design-build-record-demo-unmoderated-research \
  autonomous-research-synthesis-telemetry-iterative-design-issues"
for s in $SKILLS; do test -f "$HOME/.copilot/skills/$s/SKILL.md" && echo "ok $s"; done
python3 "$HOME/.copilot/autonomous-output-skills/tools/sync-skills.py" status | tail -1
python3 "$HOME/.copilot/autonomous-output-skills/tools/validate-skills.py" --quiet && echo "ok repo validates"
for s in $OLD; do test -e "$HOME/.copilot/skills/$s" && echo "still installed: $s"; done

D="$HOME/.copilot/skills/autonomous-demos/scripts"
V="$HOME/.copilot/skills/autonomous-variations/scripts"
for f in "$D"/*.mjs "$D"/*.cjs "$D"/*.js "$V"/*.mjs "$HOME"/.copilot/skills/research-platforms/scripts/*.mjs; do
  node --check "$f" || echo "FAIL $f"
done
for f in "$D"/*.py; do python3 -m py_compile "$f" || echo "FAIL $f"; done
for f in "$D"/*.sh "$V"/*.sh "$HOME"/.copilot/skills/autonomous-research-synthesis/scripts/*.sh; do bash -n "$f" || echo "FAIL $f"; done
command -v ffmpeg ffprobe
node "$D/launch-demo-oss.mjs" --repo "$VSCODE_REPO" --dry-run > /dev/null && echo "ok launcher dry run"
```

Then start a new agent session and confirm the eleven skills appear in the available-skills list, and
that the two old names do not.

## 5. Optional chat modes

The study and synthesis skills include thin plan-then-build chat modes:

```bash
mkdir -p <workspace>/.github/chatmodes
cp ~/.copilot/skills/autonomous-user-studies/chatmodes/*.chatmode.md <workspace>/.github/chatmodes/
cp ~/.copilot/skills/autonomous-research-synthesis/chatmodes/*.chatmode.md <workspace>/.github/chatmodes/
```

Study launches, paid recruiting, and public-repository posts stay explicitly human-gated.

## 6. Schedule the weekly skill update (macOS)

```bash
"$HOME/.copilot/autonomous-output-skills/automations/run-weekly-skill-miner.sh" --check
"$HOME/.copilot/autonomous-output-skills/automations/run-weekly-skill-miner.sh" --install
```

It checks every day at 9:00 and at login and runs on Saturdays. Reports land in
`~/.copilot/skill-miner/reports/`. Each scheduled Mac mines its own sessions. On a machine without
the schedule, run `sync-skills.py install` after pulling to pick up the latest skills.

## Machine-specific checks

- Every shell that builds or launches Code OSS needs the checkout's `.nvmrc` Node
  (`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use`).
- Launch Code OSS with `TMPDIR=/tmp` and keep run directories short (socket path limit);
  `launch-demo-oss.mjs` does both.
- `~/Desktop` on this Mac is the OneDrive-synced Desktop; deliverables go there.
- Chrome's macOS executable is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- macOS has no `timeout` or `setsid`; use script-level timeouts and detached processes.

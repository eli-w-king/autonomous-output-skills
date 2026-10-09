# Install the autonomous output skills

This repository holds eight user-global skills:

| Skill | Role |
|-------|------|
| `autonomous-demos` | demos, screenshots, before/after, storyboards, PR media, recording toolkit |
| `autonomous-prototypes` | build, iterate, and ship UI changes and PRs |
| `autonomous-long-runs` | operating rules for overnight and unattended work |
| `autonomous-skill-glossary` | shared gotchas and topic references |
| `automation-windows-os` | optional Windows and UTM execution |
| `autonomous-user-studies` | research: UserTesting and Outset studies, User Interviews recruiting |
| `autonomous-research-synthesis` | research: readouts, quotes, slideshows, decision digests, findings to issue |
| `research-platforms` | research: Outset, Marvin, and User Interviews plumbing |

Installing means cloning the repository, copying those folders into the agent runtime's skill
directory (normally `~/.copilot/skills/`), and starting a fresh agent session.

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

For Code OSS work (demos, prototypes, app studies):
- A `microsoft/vscode` checkout built with the Node from its `.nvmrc` (`npm install`,
  `npm run compile`), with `.build/electron` present.
- The checkout's `launch` skill (`.agents/skills/launch/`) for signed-in instances.
- The demo driver loads `playwright-core` from that checkout: `export VSCODE_REPO=<checkout>`.
- The mock LLM (`start-mock-llm.cjs`) needs the checkout's Node 24 and its
  `scripts/chat-simulation/common/mock-llm-server.ts`.

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

SKILLS="autonomous-demos autonomous-prototypes autonomous-long-runs autonomous-user-studies \
  autonomous-research-synthesis autonomous-skill-glossary research-platforms automation-windows-os"
OLD="autonomous-design-build-record-demo-unmoderated-research \
  autonomous-research-synthesis-telemetry-iterative-design-issues"

mkdir -p "$HOME/.copilot/skills"
MISSING=0
for s in $SKILLS; do [ -f "$REPO/$s/SKILL.md" ] || { echo "missing $s in $REPO" >&2; MISSING=1; }; done
if [ "$MISSING" = 0 ]; then
  BACKUP="$HOME/.copilot/skills-backup/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$BACKUP"
  for s in $SKILLS $OLD; do
    [ -d "$HOME/.copilot/skills/$s" ] && mv "$HOME/.copilot/skills/$s" "$BACKUP/"
  done
  for s in $SKILLS; do cp -R "$REPO/$s" "$HOME/.copilot/skills/"; done
  echo "installed; previous copies in $BACKUP"
fi
```

The previous copies are kept in `~/.copilot/skills-backup/<timestamp>/`. If your runtime uses a
different skill directory, copy the same eight folders there. The folders are self-contained; the
`../<skill>/` links between them assume they sit side by side.

## 4. Verify

```bash
SKILLS="autonomous-demos autonomous-prototypes autonomous-long-runs autonomous-user-studies \
  autonomous-research-synthesis autonomous-skill-glossary research-platforms automation-windows-os"
OLD="autonomous-design-build-record-demo-unmoderated-research \
  autonomous-research-synthesis-telemetry-iterative-design-issues"
for s in $SKILLS; do test -f "$HOME/.copilot/skills/$s/SKILL.md" && echo "ok $s"; done
for s in $OLD; do test -e "$HOME/.copilot/skills/$s" && echo "still installed: $s"; done

D="$HOME/.copilot/skills/autonomous-demos/scripts"
for f in "$D"/*.mjs "$D"/*.cjs "$D"/*.js "$HOME"/.copilot/skills/research-platforms/scripts/*.mjs; do
  node --check "$f" || echo "FAIL $f"
done
for f in "$D"/*.py; do python3 -m py_compile "$f" || echo "FAIL $f"; done
for f in "$D"/*.sh "$HOME"/.copilot/skills/autonomous-research-synthesis/scripts/*.sh; do bash -n "$f" || echo "FAIL $f"; done
command -v ffmpeg ffprobe
node "$D/launch-demo-oss.mjs" --repo "$VSCODE_REPO" --dry-run > /dev/null && echo "ok launcher dry run"
```

Then start a new agent session and confirm the eight skills appear in the available-skills list, and
that the two old names do not.

## 5. Optional chat modes

The study and synthesis skills include thin plan-then-build chat modes:

```bash
mkdir -p <workspace>/.github/chatmodes
cp ~/.copilot/skills/autonomous-user-studies/chatmodes/*.chatmode.md <workspace>/.github/chatmodes/
cp ~/.copilot/skills/autonomous-research-synthesis/chatmodes/*.chatmode.md <workspace>/.github/chatmodes/
```

Study launches, paid recruiting, and public-repository posts stay explicitly human-gated.

## Machine-specific checks

- Every shell that builds or launches Code OSS needs the checkout's `.nvmrc` Node
  (`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use`).
- Launch Code OSS with `TMPDIR=/tmp` and keep run directories short (socket path limit);
  `launch-demo-oss.mjs` does both.
- `~/Desktop` on this Mac is the OneDrive-synced Desktop; deliverables go there.
- Chrome's macOS executable is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- macOS has no `timeout` or `setsid`; use script-level timeouts and detached processes.

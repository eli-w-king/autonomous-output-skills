# Install the autonomous output skills

This private repository contains three user-global skills for the VS Code UX research loop:

- `autonomous-design-build-record-demo-unmoderated-research`
- `autonomous-research-synthesis-telemetry-iterative-design-issues`
- `autonomous-skill-glossary`

The first skill creates and prepares unmoderated studies. The second synthesizes completed research,
triangulates it with telemetry, builds and records candidate solutions, and drafts issues. The
glossary contains shared guidance used by both.

Installing means cloning the private repository, copying those folders into the agent runtime's skill
directory, and starting a fresh agent session.

## 1. Accept access and authenticate

Accept the GitHub repository invitation from `eli-w-king`, then authenticate GitHub CLI:

```bash
gh auth login
gh auth status
```

The authenticated account must have access to `eli-w-king/autonomous-output-skills`.

## 2. Check prerequisites

The skills were built and verified on macOS. Most of the workflow also works on Linux with path
adjustments.

Required:

- A built `microsoft/vscode` checkout with `node_modules` installed.
- The `launch` skill, used to start and drive an isolated Code OSS instance.
- Node matching the VS Code checkout's `.nvmrc`.
- `ffmpeg` on `PATH`.
- GitHub CLI, git, curl, jq, and rsync.
- Google Chrome.
- A GitHub credential usable by `git credential fill` for the issue helper.
- A UserTesting account. The agent may enter the account email, but the human must enter passwords and
  2FA codes.

The JavaScript browser drivers use the `ws` package from the VS Code checkout:

```bash
export NODE_PATH="<vscode-repo>/node_modules"
```

Optional:

- `dap-cli` for breakpoint debugging while capturing Code OSS.

## 3. Clone and install

The normal user-global discovery location is `~/.copilot/skills/`:

```bash
mkdir -p ~/.copilot/skills
gh repo clone eli-w-king/autonomous-output-skills ~/.copilot/autonomous-output-skills

for skill in \
  autonomous-design-build-record-demo-unmoderated-research \
  autonomous-research-synthesis-telemetry-iterative-design-issues \
  autonomous-skill-glossary
do
  rm -rf "$HOME/.copilot/skills/$skill"
  cp -R "$HOME/.copilot/autonomous-output-skills/$skill" "$HOME/.copilot/skills/"
done
```

If that runtime uses a different skill discovery directory, copy the same three folders there instead.
The folders are self-contained and do not hardcode a user-specific absolute path.

The Git clone preserves helper-script permissions. If another transfer method strips them, run:

```bash
chmod +x ~/.copilot/skills/autonomous-design-build-record-demo-unmoderated-research/scripts/*.sh
chmod +x ~/.copilot/skills/autonomous-research-synthesis-telemetry-iterative-design-issues/scripts/*
```

## 4. Verify

```bash
for skill in \
  autonomous-design-build-record-demo-unmoderated-research \
  autonomous-research-synthesis-telemetry-iterative-design-issues \
  autonomous-skill-glossary
do
  test -f "$HOME/.copilot/skills/$skill/SKILL.md" && echo "ok $skill"
done

node --check \
  ~/.copilot/skills/autonomous-research-synthesis-telemetry-iterative-design-issues/scripts/caploop.js
node --check \
  ~/.copilot/skills/autonomous-research-synthesis-telemetry-iterative-design-issues/scripts/presskeys.js

for file in ~/.copilot/skills/*/scripts/*.sh; do
  test -e "$file" || continue
  bash -n "$file" && echo "ok $file"
done

command -v ffmpeg
```

Start a new agent session and confirm all three canonical names appear in the available-skills list.

## 5. Optional chat modes

The procedural skills work without custom chat modes. To expose their plan/build templates in a
workspace:

```bash
mkdir -p <workspace>/.github/chatmodes
cp ~/.copilot/skills/autonomous-design-build-record-demo-unmoderated-research/chatmodes/*.chatmode.md \
  <workspace>/.github/chatmodes/
cp ~/.copilot/skills/autonomous-research-synthesis-telemetry-iterative-design-issues/chatmodes/*.chatmode.md \
  <workspace>/.github/chatmodes/
```

Study launches, paid participant recruitment, and public-repository posts remain explicitly
human-gated.

## 6. Update

```bash
git -C ~/.copilot/autonomous-output-skills pull --ff-only

for skill in \
  autonomous-design-build-record-demo-unmoderated-research \
  autonomous-research-synthesis-telemetry-iterative-design-issues \
  autonomous-skill-glossary
do
  rm -rf "$HOME/.copilot/skills/$skill"
  cp -R "$HOME/.copilot/autonomous-output-skills/$skill" "$HOME/.copilot/skills/"
done
```

Start a fresh agent session after copying the updates.

## Machine-specific checks

- `ffmpeg` is commonly under `/opt/homebrew/bin` on Apple Silicon and `/usr/local/bin` on Intel Macs.
- Every shell running the drivers or `launch` skill must use the Node version from the VS Code
  checkout's `.nvmrc`.
- On macOS, `TMPDIR=/tmp` can avoid socket path-length failures when launching Code OSS.
- Chrome's default macOS executable is
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

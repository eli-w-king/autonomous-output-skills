# Autonomous output skills

Three portable agent skills for the VS Code UX research loop:

- **`autonomous-design-build-record-demo-unmoderated-research`**: capture a feature flow in a real
  Code OSS build, author a UserTesting.com study, prepare it for review, and launch only on explicit
  approval.
- **`autonomous-research-synthesis-telemetry-iterative-design-issues`**: harvest study results,
  analyze and triangulate them with telemetry, build candidate solutions in real Code OSS, record a
  demo video, and draft a GitHub issue.
- **`autonomous-skill-glossary`**: shared hard-won guidance used by both procedural skills.

The procedural skills pair with the `launch` skill, which drives Code OSS from source. Keep this
repository in sync across machines because the skills and glossary improve as they are used.

## Access

This is a private repository. Ask the owner for collaborator access, then authenticate GitHub CLI
before cloning:

```bash
gh auth login
gh auth status
```

An accepted repository invitation and a GitHub credential with private-repository access are required.

## Install

Agent skills are normally discovered under `~/.copilot/skills/`:

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

The repository preserves executable bits on helper scripts. If a transfer method strips them, restore
them with:

```bash
chmod +x ~/.copilot/skills/autonomous-design-build-record-demo-unmoderated-research/scripts/*.sh
chmod +x ~/.copilot/skills/autonomous-research-synthesis-telemetry-iterative-design-issues/scripts/*
```

Start a fresh agent session after installing. If the runtime uses a different skills directory, copy
the same three self-contained folders there instead.

## Update later

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

Start a fresh agent session after updating.

## Prerequisites

See [INSTALL.md](INSTALL.md) for the full checklist. In short: a built `microsoft/vscode` checkout,
the `launch` skill, Node matching the checkout's `.nvmrc`, `ffmpeg`, GitHub CLI, git, curl, jq, rsync,
Chrome, and a GitHub credential. The `caploop.js` and `presskeys.js` drivers need the `ws` module at
runtime; point `NODE_PATH` at the VS Code checkout's `node_modules`.

## Optional chat modes

The two procedural skills include chat-mode templates under `chatmodes/`. Copy those templates into a
workspace `.github/chatmodes/` folder or a configured user prompt-files location to expose their plan
and build modes. Study launches and public-repository posts remain explicitly human-gated.

## Contents

```text
autonomous-design-build-record-demo-unmoderated-research/
  SKILL.md, scripts/, chatmodes/
autonomous-research-synthesis-telemetry-iterative-design-issues/
  SKILL.md, scripts/, chatmodes/
autonomous-skill-glossary/
  SKILL.md
INSTALL.md
```

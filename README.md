# Autonomous output skills

Four portable agent skills for the VS Code UX research loop:

- **`autonomous-design-build-record-demo-unmoderated-research`**: capture the real target surface
  (Code OSS, deployed website, or hosted prototype), author a UserTesting.com study, prepare it for
  review, and launch only on explicit approval.
- **`autonomous-research-synthesis-telemetry-iterative-design-issues`**: harvest study results,
  preserve a traceable evidence bundle, triangulate with surface-appropriate quantitative data,
  iterate in the real target repo, validate the demo video, and draft a GitHub issue.
- **`autonomous-skill-glossary`**: shared hard-won guidance used by both procedural skills.
- **`automation-windows-os`**: optional Windows execution, validation, native UI automation, evidence
  capture, and reversible cleanup, either on a Windows host or through a Windows VM in UTM.

For app studies, the procedural skills pair with the `launch` skill, which drives Code OSS from
source. Website studies use the real deployed site or actual hosted/local prototype. Either workflow
may hand off to `automation-windows-os` when Windows-specific evidence is useful.

Every run keeps a durable project ledger (`run.json`, `decisions.md`, `artifacts.json`, and
`resume.md`) alongside its evidence. Do not rely on chat history to resume a study.

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
  autonomous-skill-glossary \
  automation-windows-os
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
the same four self-contained folders there instead.

## Update later

```bash
git -C ~/.copilot/autonomous-output-skills pull --ff-only

for skill in \
  autonomous-design-build-record-demo-unmoderated-research \
  autonomous-research-synthesis-telemetry-iterative-design-issues \
  autonomous-skill-glossary \
  automation-windows-os
do
  rm -rf "$HOME/.copilot/skills/$skill"
  cp -R "$HOME/.copilot/autonomous-output-skills/$skill" "$HOME/.copilot/skills/"
done
```

Start a fresh agent session after updating.

## Prerequisites

See [INSTALL.md](INSTALL.md) for the full checklist. All studies need `ffmpeg`, GitHub CLI, git,
curl, jq, rsync, Chrome, and a GitHub credential. App studies additionally need a built
`microsoft/vscode` checkout, the `launch` skill, and Node matching `.nvmrc`. The `caploop.js` and
`presskeys.js` drivers need the checkout's `ws` module through `NODE_PATH`.

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
automation-windows-os/
  SKILL.md
INSTALL.md
```

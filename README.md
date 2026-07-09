# VS Code UX Research skills

Two portable agent skills for the VS Code UX research loop:

- **`autonomous-user-testing`** (front half): capture a feature flow in a real Code OSS build, author a
  UserTesting.com study, prepare it for review, and launch only on explicit approval.
- **`user-research-synthesis`** (back half): harvest study results, analyze and triangulate with
  telemetry, build up to 3 solutions (A/B/C) in real Code OSS, record a real demo video, and draft a
  GitHub issue.

They pair with the `launch` skill (drives Code OSS from source). Both self-improve as they are used, so
keep them in sync across machines with `git pull`.

## Install (any machine)

Agent skills are discovered under `~/.copilot/skills/`. Clone this repo's two skill folders straight in:

```bash
mkdir -p ~/.copilot/skills
git clone https://github.com/eli-w-king/vscode-ux-research-skills.git /tmp/ux-skills
cp -R /tmp/ux-skills/autonomous-user-testing /tmp/ux-skills/user-research-synthesis ~/.copilot/skills/
chmod +x ~/.copilot/skills/autonomous-user-testing/scripts/*.sh
chmod +x ~/.copilot/skills/user-research-synthesis/scripts/*.sh ~/.copilot/skills/user-research-synthesis/scripts/*.js
rm -rf /tmp/ux-skills
```

Then start a fresh agent session; the two skills appear by name.

> If this agent runtime uses a different skills location than `~/.copilot/skills/`, copy the two folders
> there instead. The folders are self-contained and location-independent.

## Update later

```bash
cd /tmp/ux-skills && git pull   # or re-clone
# then re-copy the two folders into ~/.copilot/skills/ as above
```

## Prerequisites on the target machine

See `INSTALL.md` for the full checklist. In short: a built microsoft/vscode checkout, the `launch`
skill, Node matching the repo `.nvmrc` (via nvm), `ffmpeg` on PATH, git/curl/jq/rsync, Chrome, and a
GitHub credential usable by `git credential fill`. The `caploop.js`/`presskeys.js` drivers need the `ws`
module at runtime, run them with `NODE_PATH="<vscode-repo>/node_modules"`.

## Optional: custom chat modes (plan then auto-handoff)

Each skill ships thin chat-mode templates in its `chatmodes/` folder. Copy them into a workspace
`.github/chatmodes/` (or your user prompt-files location) to get a "plan mode, then auto-handoff to
build" UX and a picker entry. The study launch and any public-repo post stay explicitly human-gated.

## Contents

```
autonomous-user-testing/   SKILL.md, scripts/, chatmodes/
user-research-synthesis/   SKILL.md, scripts/, chatmodes/
INSTALL.md                 full install + prerequisites guide
```

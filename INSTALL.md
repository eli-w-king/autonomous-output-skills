# Install: VS Code UX Research skills (for an agent on another laptop)

You are installing two user-global skills that pair with the `launch` skill to run the VS Code UX
research loop:

- `autonomous-user-testing` (front half): capture a feature flow in a real Code OSS build, author a
  UserTesting study, prepare it for review, launch only on explicit approval.
- `user-research-synthesis` (back half): harvest study results, analyze + triangulate with telemetry,
  build up to 3 solutions (A/B/C) in real Code OSS, record a real demo video, draft a GitHub issue.

They are plain folders (`SKILL.md` + `scripts/` + optional `chatmodes/`). "Installing" = putting them
where the agent runtime discovers user-global skills, then making the scripts executable.

---

## 0. What you are given

A single bundle: `vscode-ux-research-skills.tar.gz` (about 42 KB) containing both skill folders. Get it
onto the target laptop by any means (AirDrop, scp, USB, shared drive). Example over ssh:

```bash
scp vscode-ux-research-skills.tar.gz you@other-laptop:~/
```

If you instead have the two folders directly (not the tarball), skip to step 2 and copy the folders in.

---

## 1. Prerequisites on the target laptop

The skills assume macOS (they were built and verified there). Most of it works on Linux with path
tweaks; the notes below call out the macOS specifics.

Required:
- **The microsoft/vscode checkout, built.** The `launch` skill runs Code OSS from source. You need
  `node_modules/` installed and the product compiled (`npm run compile` once, or `npm run watch`).
- **The `launch` skill** available to the agent (drives Code OSS over CDP). If it is not present, install
  it first; these skills depend on it for the real-build capture and demo recording.
- **Node exactly matching the repo `.nvmrc`** (e.g. 24.x and >= 24.17.0). Use nvm:
  ```bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install 24.17.0; nvm use 24.17.0
  ```
- **ffmpeg** on PATH (video/GIF encoding).
  - macOS Apple Silicon: `brew install ffmpeg` -> lands at `/opt/homebrew/bin/ffmpeg`
  - macOS Intel: usually `/usr/local/bin/ffmpeg`
  - Whatever the path, make sure it is on PATH before running the encoders:
    `export PATH="/opt/homebrew/bin:$PATH"` (adjust for Intel/Linux).
- **git**, **curl**, **jq**, **rsync** on PATH.
- **Playwright**: the vscode repo has `@playwright/cli` and `playwright-core` as dev deps, so run the
  driver from inside the repo (`npx @playwright/cli ...`), or `npm i playwright-core` in a scratch dir.
- **Google Chrome** installed (for driving UserTesting and for the GitHub video upload). A dedicated,
  debuggable Chrome instance is launched per the skills; do not reuse the shared chrome-devtools profile.
- **A GitHub credential** usable by `git credential fill` (so `create-issue.sh` can post). Signing into
  GitHub in the CLI or once via a browser is enough; the helper reads the stored credential.
- Optional: **dap-cli** if you want breakpoint debugging during capture (see the `launch` skill).

Accounts (entered by the human, never by the agent beyond the email):
- A **UserTesting** account. The agent may type the account email into the sign-in form; the human
  enters the password and any 2FA.

---

## 2. Install the skills

The agent runtime discovers user-global skills under `~/.copilot/skills/`. Put the folders there:

```bash
mkdir -p ~/.copilot/skills
tar -xzf ~/vscode-ux-research-skills.tar.gz -C ~/.copilot/skills
```

You should now have:
```
~/.copilot/skills/autonomous-user-testing/
~/.copilot/skills/user-research-synthesis/
```

Make the scripts executable (tar usually preserves this, but do it to be safe):

```bash
chmod +x ~/.copilot/skills/autonomous-user-testing/scripts/*.sh
chmod +x ~/.copilot/skills/user-research-synthesis/scripts/*.sh
chmod +x ~/.copilot/skills/user-research-synthesis/scripts/*.js
```

> If this agent runtime uses a different skills location than `~/.copilot/skills/`, put the two folders
> in that location instead. The folders are self-contained and location-independent; nothing hardcodes
> an absolute path.

---

## 3. Verify

```bash
# Both skills present with their SKILL.md
ls -1 ~/.copilot/skills/autonomous-user-testing/SKILL.md \
      ~/.copilot/skills/user-research-synthesis/SKILL.md

# Scripts present and executable
ls -l ~/.copilot/skills/user-research-synthesis/scripts/

# Node syntax check on the JS drivers (use the repo's node_modules for `ws`)
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.17.0
node --check ~/.copilot/skills/user-research-synthesis/scripts/caploop.js
node --check ~/.copilot/skills/user-research-synthesis/scripts/presskeys.js

# Bash syntax check on the shell helpers
for f in ~/.copilot/skills/*/scripts/*.sh; do bash -n "$f" && echo "ok $f"; done

# ffmpeg reachable
which ffmpeg && ffmpeg -version | head -1
```

Then start a new agent session and confirm the skills are listed as available (they should appear by
name, `autonomous-user-testing` and `user-research-synthesis`). Ask the agent to "run a user test on
<feature>" or "synthesize the results of <study>" to trigger them.

Note on `caploop.js` / `presskeys.js`: they need the `ws` module at runtime. Run them with `NODE_PATH`
pointing at a `node_modules` that has `ws`, easiest is the vscode repo:
`NODE_PATH="<vscode-repo>/node_modules" node caploop.js ...` (the SKILL.md says this too).

---

## 4. Optional: activate the custom chat modes (plan -> auto-handoff)

Each skill ships thin chat-mode templates in its `chatmodes/` folder. They are optional; the skills work
without them. To get the native "plan mode, then auto-handoff to build" UX and a picker entry, copy the
templates into a chat-mode location:

- Per workspace: `<workspace>/.github/chatmodes/`
- Or your user prompt-files location (see the "Chat: Configure Chat Modes" command /
  `chat.modeFilesLocations` setting).

```bash
# example: enable them in a workspace
mkdir -p <workspace>/.github/chatmodes
cp ~/.copilot/skills/autonomous-user-testing/chatmodes/*.chatmode.md <workspace>/.github/chatmodes/
cp ~/.copilot/skills/user-research-synthesis/chatmodes/*.chatmode.md <workspace>/.github/chatmodes/
```

Then pick "Plan Study" or "Plan Synthesis" in the chat mode picker. Under the Autopilot permission level
the handoff to the build agent fires automatically; otherwise it is a one-click "Continue on Agent".

Guardrail (already baked in): the study launch (recruiting real paid participants) and any public-repo
post stay explicitly human-gated. Only plan -> build auto-advances.

---

## 5. Machine-specific things to double check

- **ffmpeg path** differs by machine (Apple Silicon `/opt/homebrew`, Intel `/usr/local`, Linux distro
  paths). Export the right one before the encoders run.
- **NVM path / node version**: every shell that runs the JS drivers or the `launch` skill needs
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.17.0`.
- **TMPDIR**: on macOS set `TMPDIR=/tmp` when launching Code OSS (socket path length limit).
- **Chrome path**: default macOS is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`;
  adjust if Chrome is elsewhere.
- **kill by PID**: the agent tooling refuses `kill "$VAR"`; pass literal numeric PIDs when cleaning up.

---

## 6. Keeping them in sync later (optional)

These skills self-improve as they are used, so the two laptops can drift. To keep them in sync, either
re-share the tarball, or put `~/.copilot/skills/autonomous-user-testing` and
`~/.copilot/skills/user-research-synthesis` in a small git repo and `git pull` on each machine. If you
version them, keep the same folder names so discovery still works.

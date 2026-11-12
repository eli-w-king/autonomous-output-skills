# Optional steps: Azure, a dev box, research platforms

The detail behind the optional items. Offer each one in a sentence, recommend skipping what they won't use, and never
push, unless their prompt asked for it ("including research and a dev box"). Nothing here launches a study or
recruits anyone, and the only cloud resource is a dev box they okayed (the prompt's request is that okay, for one box,
after the plan).

## Azure

**When it's worth it.** Hosting a page or a demo that teammates open with a sign-in, when OneDrive (videos and
files) and a dev tunnel (a live page, signed in) aren't enough. Most people can skip it.

1. The Azure CLI: `brew install azure-cli` or `winget install --id Microsoft.AzureCLI -e`.
2. You start the sign-in: `az login` (on Windows, run `az config set core.login_experience_v2=off` first). It opens
   their browser; they sign in there, and the command returns once they're done (the Windows sign-in window closes
   without a message when it succeeds). Never `--use-device-code`: Conditional Access blocks device-code sign-in on
   managed machines.
3. Check it: `az account show --query "{subscription:name, user:user.type}" -o table`. If they have several,
   `az account list -o table`, and they pick one they're allowed to use: `az account set --subscription <id>`.
4. Say this plainly: a shared team subscription belongs to its owners; creating anything there brings compliance
   follow-ups and upkeep, so ask the owner first. Anything shared from Azure requires sign-in (Microsoft Entra), never
   anonymous access.
5. Mark it: `check-setup.py mark azure ok --note "signed in"` (no subscription names or ids in the note).
6. Try it: "Run az account show and tell me which subscription is selected." Then `check-setup.py tested azure`.

Skipping it: `check-setup.py mark azure skipped --note "OneDrive and dev tunnels instead"`.

## A dev box

**When it's worth it.** Work that keeps going with the laptop closed: overnight runs, several agents at once, a
Windows machine to test on. The one to have stays on: it can't hibernate and its pool has no auto-stop schedule, so it
doesn't stop when they disconnect or at night. (Dev Box only stops a box on disconnect if it can hibernate, and a
schedule stops every box in its pool.) `scripts/devbox.py` does all of this through the Azure CLI's sign-in, so Azure
comes first.

1. **Check first.** `<py> <skill>/scripts/devbox.py status --json` lists their projects, the pools (best first: stays
   on, then 16+ vCPU and 64+ GB, local admin, a nearby region) and their boxes. A running box that stays on means
   this item is done: skip to step 4.
2. **A pool that stays on exists:** the plan (part 2, "Show the plan") shows the box it would create in the top pool:
   `devbox.py create --project <p> --pool <pool> --name <name> --dry-run --json`, then without `--dry-run` once
   they've okayed it ("including ... a dev box" in the setup prompt is that okay, for one box, after the plan). It
   takes 30 to 90 minutes, so start it early, keep going with the other items and check back with
   `devbox.py wait --project <p> --name <name> --json` (it returns at once). `devbox.py link` gives the link to open
   it.
3. **No pool that stays on:** `devbox.py ask-admin --project <p>` prints a short message for their Dev Box admin with
   the pool settings (32 vCPU, no auto-stop schedule, stop on disconnect off, local admin on, a nearby region) and an
   image definition with the tools. They send it themselves. Mark `devbox pending --note "asked the Dev Box admin"`.
   With only a pool that can hibernate, a box still works, but it stops after they disconnect or on its schedule;
   skipping or delaying the schedule helps only with the scheduled stop. No project at all: they request one at
   https://devbox.microsoft.com.
4. **The person's part, on the box** (the workshop page's dev box setup walks through it; say it plainly):
   - Open the box from the link (https://devbox.microsoft.com) and sign in.
   - Install or update VS Code Insiders (`winget install --id Microsoft.VisualStudioCode.Insiders -e`), open it, and
     sign in to GitHub with the same account as on the laptop.
   - Paste the same workshop settings into User settings (JSON) there. The box's own Insiders pushes its sandbox
     setting to the box's agent host too, so it must be off on the box as well.
   - In the Agents window, the radio tower icon at the top right (tooltip "Remote Connections: Off"), then
     **Dev Tunnels**. The menu also shows "Will be shared as: <computer name>", **Off**, **GitHub Environments
     (Preview)** and **Manage Remote Environments...**. This route uses **Dev Tunnels**, not GitHub Environments.
   - Keep Insiders open on the box: this tunnel runs only while Insiders is open (there's no "install as a service"
     here), so a box that restarts needs Insiders opened again.
   - The radio tower again, **Manage Remote Environments...**: the **Remote Environments** view groups GitHub
     Environments, Dev Tunnels and SSH. Check the laptop is listed under **Dev Tunnels**.
   The laptop already has Dev Tunnels on (the workshop page has them turn it on before the prompt). Then verify on the
   laptop that the box appears as a remote agent host (`list_agent_hosts`), not only as a remote editor.
5. **Try it:** "Start a session on my dev box and have it say hello." Confirm the box with `list_agent_hosts`, then
   `check-setup.py mark devbox ok --note "<box name>"` and `check-setup.py tested devbox`.

Optional for later: `mcp-servers.py add devbox` adds Microsoft's Dev Box MCP server (an alpha) so agents can start,
stop and check boxes from chat.

## Research platforms

**When it's worth it.** Running user studies: Outset runs the interviews, and User Interviews finds the participants.
Drafting a study needs no accounts at all (the workshop's research module has a draft-only exercise), so skip this
unless they'll run studies or their prompt asked for research.

**What "ready" means.** Three things, and none of them is a key in the chat:
- **The Outset API key** (`OUTSET_API_KEY`) in `~/.copilot/research.env`. They get it from whoever runs Outset for
  their team, and paste it into the file themselves.
- **The Outset sign-in**, a device-code sign-in you start and they approve in the browser. It writes
  `OUTSET_OAUTH_CLIENT_ID` and `OUTSET_REFRESH_TOKEN` to the same file for the agent tools.
- **User Interviews, signed in once in the browser Playwright uses.** Agents work in User Interviews through
  Playwright, in that browser, so they need their own account (or a seat on their team's) and one sign-in there. The
  Playwright browser keeps its profile, so the sign-in lasts.

A User Interviews API key (`USERINTERVIEWS_API_KEY`) is optional: only accounts with API access have one, and
`probe.mjs` checks it when it's there.

1. Include this step when the prompt asked for research (`research_requested`), even if the canvas still shows it as
   optional. Say what each of the three is for, in a sentence each.
2. Keys live in one file on each machine, `~/.copilot/research.env`, readable only by them. Create it from the template
   if it doesn't exist (never overwrite one):
   - macOS: `cp ~/.copilot/autonomous-output-skills/autonomous-research/research.env.template ~/.copilot/research.env && chmod 600 ~/.copilot/research.env`
     (or the copy in `~/.copilot/skills/autonomous-research` once the skills are installed)
   - Windows: `Copy-Item $HOME\.copilot\autonomous-output-skills\autonomous-research\research.env.template $HOME\.copilot\research.env`,
     then `icacls $HOME\.copilot\research.env /inheritance:r /grant:r "${env:USERNAME}:F"`
3. Open it for them in VS Code: `code-insiders ~/.copilot/research.env` on macOS,
   `code-insiders "$HOME\.copilot\research.env"` on Windows (PowerShell passes `~` through as is, and VS Code would
   open a new, wrong file). They paste their Outset key after `OUTSET_API_KEY=` and save. Never ask for a key in the
   chat, never read the file back, never print it; the check reports names only. If a protected credentials file
   already exists, preserve every value: they add only what's missing. Marvin (`MARVIN_CLIENT_ID` and
   `MARVIN_CLIENT_SECRET`, from Settings > MCP in Marvin) is optional too.
4. **The Outset sign-in:** run `node ~/.copilot/autonomous-output-skills/autonomous-research/scripts/outset-auth.mjs`
   (on Windows, `node "$HOME\.copilot\autonomous-output-skills\autonomous-research\scripts\outset-auth.mjs"`); it
   opens their browser and they approve. Never copy the rotating refresh token between machines. The stored sign-in
   can't launch studies (that permission is withheld).
5. **User Interviews, in the next chat** (Playwright's tools load there): open https://www.userinterviews.com with
   Playwright and tell them to sign in in that browser window (password, SSO and 2FA are theirs; never type them).
   When they say they're in, check read only that the page shows their signed-in account (a snapshot, nothing
   clicked that changes anything), close the page, and save it:
   `check-setup.py remember --set userinterviews_signed_in=yes`. No account yet: they ask their team's User
   Interviews admin for a seat; mark it pending with that.
6. Check it: `node ~/.copilot/autonomous-output-skills/autonomous-research/scripts/probe.mjs outset` checks Outset with
   read-only requests and prints no keys. Run `probe.mjs userinterviews` only when `userinterviews_api_key_set` is true
   (it lists one recruit and never creates, invites, launches or charges anything). `check-setup.py` reports names
   only: `outset_api_key_set`, `outset_signed_in`, `userinterviews_signed_in`, `userinterviews_api_key_set` and
   `ready`. Configuration is not proof of access: mark `research` tested only after the Outset probe passes and the
   User Interviews sign-in was seen. A denied scope stays pending with its admin fix, not a green check.
7. Say this plainly: nothing launches or recruits without their explicit okay on the exact study and its cost, and
   publishing in Outset needs an org admin.
8. Mark it, names only: `check-setup.py mark research ok --note "Outset key and sign-in, User Interviews signed in"`,
   or with what's missing, for example `--note "waiting for the Outset key"`.

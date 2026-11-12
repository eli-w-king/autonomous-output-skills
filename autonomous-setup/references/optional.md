# Optional steps: Azure, a dev box, research platforms

The detail behind steps 8 to 10. Offer each one in a sentence, recommend skipping what they won't use, and never
push. Nothing here creates a cloud resource, launches a study, or recruits anyone.

## Azure

**When it's worth it.** Hosting a page or a demo that teammates open with a sign-in, when OneDrive (videos and
files) and a dev tunnel (a live page, signed in) aren't enough. Most people can skip it.

1. The Azure CLI: `brew install azure-cli` or `winget install --id Microsoft.AzureCLI -e`.
2. Sign-in happens in their own terminal, not the agent's: device-code sign-in is blocked by Conditional Access on
   managed machines, and an agent can't finish the browser flow. On Windows, run
   `az config set core.login_experience_v2=off` first; then `az login`. The Windows sign-in window closes without a
   message when it succeeds.
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
2. **A pool that stays on exists:** the plan (part 2, "Show the plan") offers to create a box in the top pool:
   `devbox.py create --project <p> --pool <pool> --name <name> --dry-run --json`, then without `--dry-run` on their
   okay. It takes 30 to 90 minutes, so keep going with the other items and check back with
   `devbox.py wait --project <p> --name <name> --json` (it returns at once). `devbox.py link` gives the link to open
   it.
3. **No pool that stays on:** `devbox.py ask-admin --project <p>` prints a short message for their Dev Box admin with
   the pool settings (32 vCPU, no auto-stop schedule, stop on disconnect off, local admin on, a nearby region) and an
   image definition with the tools. They send it themselves. Mark `devbox pending --note "asked the Dev Box admin"`.
   With only a pool that can hibernate, a box still works, but it stops after they disconnect or on its schedule;
   skipping or delaying the schedule helps only with the scheduled stop. No project at all: they request one at
   https://devbox.microsoft.com.
4. **The person's part, on the box** (say it plainly): open the box from the link and sign in; install VS Code
   Insiders if it isn't there (`winget install --id Microsoft.VisualStudioCode.Insiders -e`), open it and sign in to
   GitHub; then the Accounts menu > **Turn on Remote Tunnel Access...** and choose **Install as a service**, so the
   tunnel comes back after a restart (or run `code-insiders tunnel` in a terminal there and leave it running). On the
   laptop, in the Agents window: **Connect to Remote Agent Host via Dev Tunnel**, then pick that tunnel.
   This route uses **Dev Tunnels**, not **GitHub Environments**. Verify that the connected box appears as a remote
   agent host, not only as a remote editor. On Windows, service startup may still need a Windows sign-in after a
   reboot; do not promise unattended recovery until that exact setup has been tested.
5. **Try it:** "Start a session on my dev box and have it say hello." Confirm the box with `list_agent_hosts`, then
   `check-setup.py mark devbox ok --note "<box name>"` and `check-setup.py tested devbox`.

Optional for later: `mcp-servers.py add devbox` adds Microsoft's Dev Box MCP server (an alpha) so agents can start,
stop and check boxes from chat.

## Research platforms

**When it's worth it.** Running user studies with Outset or UserTesting, recruiting participants, or reading past
research in Marvin. Drafting a study needs no accounts at all (the workshop's research module has a draft-only
exercise), so skip this unless they'll run studies.

**Recruiting through Outset takes two accounts.** Outset runs the interviews; User Interviews finds the participants,
either as Outset's recruiting provider or as a User Interviews project that sends qualified people to the Outset
study. So someone who wants to recruit needs both: an Outset sign-in and User Interviews access (their own account,
or a seat on their team's). With only one of them, they can still build the draft.

1. Include this step when requested in the setup prompt, even if the canvas still shows it as optional.
   For API setup, save `check-setup.py remember --set research_api_setup=yes`. Establish which accounts they have
   (Outset, Marvin, User Interviews, UserTesting), and whether their User Interviews access is their own account,
   their team's, or not yet. Missing admin access stays pending, not tested. Save the answers:
   `check-setup.py mark research pending --set recruit_with_outset=yes --set userinterviews_access=own|team|no`.
2. Keys live in one file on each machine, `~/.copilot/research.env`, readable only by them. Create it from the template
   if it doesn't exist (never overwrite one):
   - macOS: `cp ~/.copilot/skills/autonomous-research/research.env.template ~/.copilot/research.env && chmod 600 ~/.copilot/research.env`
   - Windows: `Copy-Item ~\.copilot\skills\autonomous-research\research.env.template ~\.copilot\research.env`, then
     `icacls $HOME\.copilot\research.env /inheritance:r /grant:r "${env:USERNAME}:F"`
3. Open it for them in VS Code: `code-insiders ~/.copilot/research.env` on macOS,
   `code-insiders "$HOME\.copilot\research.env"` on Windows (PowerShell passes `~` through as is, and VS Code would
   open a new, wrong file). They paste their own values and save. Never ask for a key in the chat, never read the
   file back, never print it; the check reports names only.
   - Outset: `OUTSET_API_KEY`, from the Outset app or their admin.
   - User Interviews: `USERINTERVIEWS_API_KEY` from their approved API-enabled account, plus
     `USERINTERVIEWS_ACCOUNT_EMAIL`. An account admin enables API access; the key page is
     https://www.userinterviews.com/account/api-keys. Browser tasks still need their own sign-in and 2FA.
   - If a protected credentials file already exists, preserve every value. Have the person add only the missing
     fields in their editor. Never replace the file with a blank template.
   - Marvin: `MARVIN_CLIENT_ID` and `MARVIN_CLIENT_SECRET`, from Settings > MCP in Marvin.
   - UserTesting: nothing in the file; they sign in in the browser themselves.
4. Outset sign-in uses a device code: run `node ~/.copilot/skills/autonomous-research/scripts/outset-auth.mjs` (on
   Windows, `node "$HOME\.copilot\skills\autonomous-research\scripts\outset-auth.mjs"`); it opens the browser and
   they approve. This is separate from the API key: the device flow writes `OUTSET_OAUTH_CLIENT_ID` and
   `OUTSET_REFRESH_TOKEN` for the agent tools. Never copy rotating refresh tokens between machines.
   The stored sign-in can't launch studies (that permission is withheld).
5. Check it: `node ~/.copilot/skills/autonomous-research/scripts/probe.mjs` (the same `$HOME\...` form on Windows)
   checks configured platforms without printing keys. Run `probe.mjs outset` and `probe.mjs userinterviews`
   separately for the requested API setup. The User Interviews probe is only a GET to list one recruit; it does
   not create, invite, launch or charge anything. Require a positive API check, not just a populated file.
   `check-setup.py` reports names/presence only: `outset_api_key_set`, `userinterviews_api_key_set`,
   `outset_signed_in`, `userinterviews_email_set` and `api_credentials_configured`. Configuration is not proof of
   access; mark `research` tested only after the probes succeed. A denied API scope stays pending with its admin
   fix, not a green check. User Interviews browser access is checked by signing in read-only.
6. Say this plainly: nothing launches or recruits without their explicit okay on the exact study and its cost, and
   publishing in Outset needs an org admin.
7. Mark it, names only: `check-setup.py mark research ok --note "Outset and User Interviews credentials tested"`, or
   with what's missing, for example `--note "Outset only: drafts now; recruiting needs User Interviews access"`.

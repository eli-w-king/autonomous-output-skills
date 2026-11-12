# A dev box that stays on

`imagedefinition.yaml` is a Dev Box image definition (team customizations, `$schema: "1.0"`) for a Windows dev box
that coding agents can use around the clock. `scripts/devbox.py imagedef` prints the same file, and
`scripts/devbox.py ask-admin` turns it into a message for a Dev Box admin.

## What's on it

- Machine-wide (`tasks`, run while the box is created): PowerShell 7, Git, GitHub CLI, Node.js LTS, Chrome, Azure CLI
  and the Azure Developer CLI, all through the built-in `~/winget` task.
- Per person (`userTasks`, run when they first sign in): VS Code Insiders, Python 3.13, FFmpeg and jq through
  `~/winget`, then one `~/powershell` task: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`,
  `git config --global core.longpaths true`, npm on Microsoft's package feed, `npm install -g yarn`, and Pillow.
  Per-user installers (VS Code Insiders, Python) go in `userTasks`, so they land in the person's profile.
- Base image: Visual Studio 2022 on Windows 11 (`microsoftvisualstudio_visualstudioplustools_vs-2022-ent-general-win11-m365-gen2`).
  A plain Windows 11 Enterprise image works too; `az devcenter admin image list --dev-center-name <name>
  --resource-group <group>` lists what a dev center offers.

## The pool settings to ask for

- Built from this image definition, in a catalog attached to the project.
- 32 vCPU and 128 GB. Hibernation isn't a switch on image definition pools: Dev Box supports it when both the base
  image and the size do, and no 32 vCPU size does. A box that can't hibernate never stops on disconnect, because stop
  on disconnect only applies to boxes that can hibernate. (16 vCPU and 64 GB works too with a base image that doesn't
  support hibernation, like Windows 11 Enterprise + OS Optimizations.)
- Auto-stop on schedule off: a schedule stops every box in the pool, hibernation or not.
- Stop on disconnect and "hibernate dev boxes that have never been accessed": off.
- Dev box creator privileges: Local Administrator.
- A region near the people who use it. Microsoft hosted network is fine.

## Who can set it up

- Create or change a pool, or attach a catalog to a project: DevCenter Project Admin (or Owner or Contributor).
- Project-level catalogs have to be on for the dev center first: a dev center owner turns them on.
- The first image build creates a temporary dev box to run the tasks, then exports an image; it takes at least as
  long as creating a dev box (25 minutes or more) [check]. Builds run on their own when the catalog syncs a new or changed
  image definition, unless automatic builds are off.
- `scripts/devbox.py admin-plan` prints the exact Azure requests (catalog, pool, schedule check) for a project admin.
  It sends nothing.

## When the only pool can hibernate

A box from a pool that can hibernate still works for agents, but it stops after the person disconnects (if the pool
has stop on disconnect) and at the pool's auto-stop time. Skipping or delaying the schedule (in the developer portal,
or `schedule_resource` in the Dev Box MCP server) only helps with the scheduled stop.

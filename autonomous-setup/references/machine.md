# Machine setup on macOS and Windows

The detail behind step 1 of the interview. `check-setup.py` reports every tool with a `fix` command for the
platform; this file explains those commands and the traps that cost time.

## Package managers

- **macOS: Homebrew.** If it's missing, the person installs it in their own Terminal, because the installer asks for
  their Mac password, which only they type:
  `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`, then the
  `eval "$(/opt/homebrew/bin/brew shellenv)"` lines it prints at the end. It installs the Command Line Tools too.
- **Windows: winget** (App Installer), part of Windows 11. Pass `-e --accept-source-agreements
  --accept-package-agreements --silent` so it never waits for an answer. A managed laptop may block winget or
  prefer the Company Portal; say so and use that instead.
- **New commands after a winget install.** The agent's shell keeps its old PATH. Refresh it in the same shell:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
  On macOS, Homebrew's folder is already on PATH (`hash -r` if a command still isn't found).
- **Never sudo.** If an install asks for an admin password, stop and give the person the command to run in their own
  terminal. Never pipe a password anywhere.

## What gets installed

| Tool | Why | macOS | Windows |
|------|-----|-------|---------|
| Command Line Tools | git and python3 | `xcode-select --install` (a dialog asks to confirm) | |
| VS Code Insiders | the Agents window | `brew install --cask visual-studio-code@insiders` | `winget install --id Microsoft.VisualStudioCode.Insiders -e` |
| GitHub CLI | repos, PRs, git sign-in | `brew install gh` | `winget install --id GitHub.cli -e` |
| git | | the Command Line Tools, or `brew install git` | `winget install --id Git.Git -e` |
| Node.js 18 or newer | the practice app, Playwright, the demo toolkit (22 or newer) | `brew install node` (the current LTS) | `winget install --id OpenJS.NodeJS.LTS -e` |
| Yarn 1 | the practice repo pins `yarn@1.22.22` | `npm install -g yarn` (see below) | `npm.cmd install -g yarn` (see below) |
| Python 3 with Pillow | the demo encoders and contact sheets | `python3 -m pip install --user Pillow` | `winget install --id Python.Python.3.13 -e`, then `python -m pip install --user Pillow` |
| ffmpeg and ffprobe | demo videos | `brew install ffmpeg` | `winget install --id Gyan.FFmpeg -e` |
| Chrome or Edge | headless screenshots | `brew install --cask google-chrome`, or Edge | Edge comes with Windows |

Install one tool at a time, then run the check again; a tool counts as installed when its version prints.

## Node, npm and Yarn

- Keep a Node that's already 18 or newer. If they use nvm, fnm or Volta, install through it (`nvm install --lts`)
  and don't change their default without asking. Homebrew's `node` is the current LTS (26); the practice repo is
  tested on 22, 24 and 26.
- **Public npm is blocked on Microsoft-managed devices.** `registry.npmjs.org` and `registry.yarnpkg.com` fail in
  under a second (`read ENOTCONN`). Microsoft's package feed works without a sign-in:
  `https://packagefeedproxy.microsoft.io/npm/`. Managed Macs may already have it as npm's registry (the check shows
  `registry` and whether each one is reachable). The practice repo routes its own installs through the feed (its
  `.npmrc` and `yarn.lock`), so nothing there needs a setting.
- **Yarn 1 comes from npm:** `npm install -g yarn` (1.22.22). A global install ignores the practice repo's `.npmrc`, so
  point npm at the feed first when the check's `npm.uses_feed` is false (ask, it's their setting):
  `npm config set registry https://packagefeedproxy.microsoft.io/npm/`. Managed Macs already have it. npm 11 warns
  about Yarn's install script; Yarn still works.
- **Reachability means what Node sees.** The check probes the registries through Node, like npm does. curl can
  disagree (on one Windows box, schannel curl failed where Node got through), and so can python.org's Python.
- **No global Yarn needed** inside the practice repo: `npx yarn@1.22.22 install` works there (the repo's `.npmrc`
  sends the download to the feed), and `practice-repo.py` falls back to it by itself.
- **Not Corepack.** It downloads Yarn from `registry.yarnpkg.com`, which is blocked on these devices (pointing it at the
  feed gets a 404), and Node 25 and newer don't include it.
- `npm install -g` fails with EACCES when Node came from the nodejs.org installer on a Mac (its global folder belongs to
  root). Don't use sudo: on a Mac, `brew install yarn` installs the same Yarn 1 without npm.
- Yarn on Node 24 and newer prints `[DEP0169] DeprecationWarning: url.parse()` on every command. It's harmless.
- Check it inside the practice repo too: `yarn --version` there prints `1.22.22`.
- First install of the practice repo: one to two minutes on a Mac or Windows laptop with an empty cache (on Windows,
  Defender scanning the 48,000 files in `node_modules` adds to it); a new worktree about a minute on Windows.

## Windows habits

- PowerShell 5.1 has no `&&` chains; run commands one at a time. Use `curl.exe`, since plain `curl` is an alias for
  `Invoke-WebRequest`.
- PowerShell passes `~` to programs as is, so write `$HOME\.copilot\...` in commands. (The scripts here expand `~`
  themselves.)
- Python is `python` or `py -3`. `python3` is the Microsoft Store stub (exit 9009).
- **Execution policy.** PowerShell runs `npm.ps1` and `yarn.ps1` when people type `npm` or `yarn`, and the client
  default policy, Restricted, refuses them ("running scripts is disabled on this system"). The check reports it
  (`powershell.policy`). The fix, with their okay: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Until then,
  `npm.cmd` and `yarn.cmd` work.
- Keep code out of OneDrive: clone into `C:\Users\<you>\Code`, never Desktop or Documents, which OneDrive often
  syncs (`practice-repo.py` refuses OneDrive folders).
- Open the practice app at the `http://localhost:<port>/` address its start command prints.
- `git worktree remove --force` can return 0 and leave the folder behind: delete the folder, then `git worktree prune`.

## Python and Pillow

- macOS: `/usr/bin/python3` comes with the Command Line Tools and takes `python3 -m pip install --user Pillow`.
  Homebrew's Python refuses pip installs outside a virtual environment ("externally managed"): use
  `brew install pillow` for it.
- Windows: `python` can be the Microsoft Store alias, which only prints "Python was not found". Install Python with
  winget, refresh PATH, and use `py -3` if `python` still points at the alias (Settings > Apps > Advanced app
  settings > App execution aliases turns the alias off).
- The check reports both the Python running the script and the one on PATH; the demo scripts use the one on PATH.
- python.org's Python on macOS has no root certificates until its `Install Certificates.command` (in
  `/Applications/Python 3.x/`) runs, so its HTTPS calls fail with `CERTIFICATE_VERIFY_FAILED`. The check shows
  `https_certificates: false`; the setup scripts don't need HTTPS from Python, but other tools might.

## git

- **Identity.** `git config --global user.name "<name>"` and `git config --global user.email "<email>"`. Suggest the
  GitHub noreply address so their email stays private: `<id>+<login>@users.noreply.github.com`, with the id from
  `gh api user --jq .id`.
- **Credentials.** `gh auth setup-git` lets git use the GitHub CLI sign-in, so pushes never ask for a password.
  With two accounts signed in, don't switch the active one: `practice-repo.py --account` and the skills tool give
  each repo its own account.
- **Windows.** `git config --global core.longpaths true` when a clone fails with "Filename too long".

## GitHub accounts

- Personal accounts and Microsoft-managed accounts (Enterprise Managed Users) both work. A managed account's login
  ends in an underscore and a short code, like `alias_shortcode`; the check marks it `managed`.
- Managed accounts can own only private repos, can't fork from outside their enterprise, and their enterprise can
  turn off personal repos altogether ([GitHub's list](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/understanding-iam-for-enterprises/abilities-and-restrictions-of-managed-user-accounts)).
  `practice-repo.py copy` handles the first two (it pushes instead of forking). If personal repos are off, use a
  personal account, or keep a local-only copy: everything works except pull requests and cloud runs.
- GitHub-hosted runners and the Copilot cloud agent don't run in a managed account's personal repos, so
  "Run in the Cloud" automations need a repo somewhere else.
- **Signing in.** The person runs `gh auth login --hostname github.com --web --git-protocol https` in their own
  terminal (Terminal > New Terminal in VS Code) and finishes in the browser. A second account: the same command
  again, then `gh auth switch --user <login>` back to the one they want active.

## VS Code Insiders

- The check reads the installed version from the app itself and never launches it. Insiders updates itself daily;
  a restart picks up the newest build.
- Signing in to GitHub with Copilot can't be detected from outside, so ask. If they aren't, they sign in from the
  Accounts menu (bottom left) or the sign-in button in the title bar.
- The workshop settings go in the default profile's `settings.json`, even for someone who works in another profile:
  the Agents window always uses the default profile's settings. (Its Settings editor has an Agents Window tab next to
  User; the snippet goes in User.)

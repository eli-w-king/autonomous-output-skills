# Uninstall the AI-First setup

For an agent, when someone asks to take the AI-First workshop setup back out, for example with the prompt on the
workshop site's uninstall page. People can also follow that page by hand:
https://eli-w-king.github.io/ai-first-design-workshop/uninstall.html

## How

1. **Find the script.** It's in the workshop folder (`~/ai-first-workshop` unless the setup used another one):
   `<folder>/autonomous-output-skills/autonomous-setup/scripts/ai-first.mjs`. Run it with VS Code Insiders' own runtime
   ([ai-first.md](ai-first.md), "The script"), not with the Node.js in the workshop folder, which this removes. If the
   folder is already gone, use the manual steps on the uninstall page.
2. **Show the list first.** `<run> uninstall --json` lists every change the setup recorded, in order, and changes
   nothing. Show it in a few plain lines, plus what stays (their repo on GitHub, and their Copilot plan), and ask
   them to say yes. Nothing goes before they do.
3. **Then remove it.** `<run> uninstall --yes --json`. It:
   - removes the light skills it installed and puts back any earlier copy it saved (from
     `~/.copilot/skills-backup/ai-first-workshop/`); My taste goes with the rules it learned
   - removes the setup checklist and its saved progress
   - takes the workshop tools off PATH (the marked block in `~/.zprofile` or `~/.bash_profile`, or the user Path on
     Windows)
   - undoes the git changes it made: the GitHub CLI sign-in helper, and the name and email it set
   - signs the GitHub CLI out and removes its settings, only when the setup created them
   - removes the 16 workshop settings from VS Code's settings.json, keeping a copy next to it
     (`settings.json.before-uninstall`)
   - deletes the workshop folder last
4. **The weekly taste update**, when the list has one: `deleteAutomation` with the id it shows (find it with tool
   search; `listAutomations` first). The script can't remove automations.
5. **Say what's left for them:**
   - Their repo, `https://github.com/<login>/excalidraw-case-study`, stays on GitHub. To delete it: the repo's
     Settings, then Delete this repository. Never delete it for them unless they ask for exactly that.
   - The free month of Copilot renews on its own: they cancel it on GitHub (Settings, Billing and licensing,
     Licensing). Never cancel or change a plan for them.
   - Restart VS Code Insiders, so it stops looking for the removed tools.

## What it never touches

Tools, skills, settings and repos that were there before the setup, anything outside the person's home folder, and
anything the record doesn't list. A step that fails is reported with the reason; the others still run.

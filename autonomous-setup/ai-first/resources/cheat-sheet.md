# Cheat sheet

## The Agents window

- **New session:** the composer at the top. Pick the workspace (a folder, or Chat for no folder), the model and
  effort, and the mode and permissions, then type.
- **Model:** GPT-6.2 Sol at High effort for the workshop. Higher effort thinks longer and costs more credits.
- **Mode and permissions:** Interactive with Allow all, and Sandboxing for terminal off, so agents run commands
  without asking each time. They still can't send or buy anything without you.
- **The sessions list:** every session, grouped. Sessions an orchestrator starts sit under it. Pin, archive and
  collapse from here.
- **Steer:** open a running session, type, and choose **Steer with Message** from the Send button's menu. It reaches
  the session after its current step.
- **Queue:** choose **Add to Queue** instead. It runs when the session is done.
- **Move a chat:** a chat can move into a workspace, history and all ("Move this chat there").

## Look and show

- **The integrated browser:** agents open your localhost link next to the chat, click through it and test it.
- **Add to Chat:** in the integrated browser, **Add Area Screenshot to Chat** puts a screenshot in the chat input.
- **Mark Up:** click a screenshot in the chat input, then **Mark Up**: draw, ellipse, arrow, text and crop. **Done**
  attaches it.
- **Dictation:** the microphone in the chat box. Talk, then send.
- **Computer Use:** agents can use desktop apps like Notes, with your okay for each app. `/computer on` turns it on.

## The skills

- **autonomous-variations:** several different versions at once, one session each, in one lab you can flip through.
- **autonomous-prototypes:** a change on a branch, tested in the integrated browser, then a pull request, a merge and a
  live GitHub Pages link.
- **autonomous-demos:** a short narrated demo video of your real app, with captions.
- **autonomous-computer-use:** safe basics for desktop apps.
- Extras, if you chose them: **autonomous-runs** (long and overnight runs), **autonomous-research** (study plans and
  synthesis) and **my-taste** (your design taste).

## Your copy of Excalidraw

- Run it: `npm start` in `excalidraw-case-study` (on Windows PowerShell, `npm.cmd start`). The link is also in
  `.workshop/server.json`.
- Toolbars: one file each in `src/workshop/toolbars/`. `?toolbar=<name>` picks one; `[` and `]` switch.
- The page for everyone: `review/`, filled from `review/review.json`.
- Live: `https://<your-username>.github.io/excalidraw-case-study/` and `.../review/`.

## Credits

Your plan's AI credits pay for agent work: 1 credit is 1 cent. Effort, context size and the number of parallel
sessions change how many a task uses. Check usage in VS Code's Copilot status menu.

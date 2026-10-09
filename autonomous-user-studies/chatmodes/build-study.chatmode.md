---
description: Build a UserTesting or Outset study from an approved plan by following the autonomous-user-studies skill (capture, author, screen, validate). Stops at a review-ready draft; never launches without explicit approval.
tools: ['codebase', 'search', 'runCommands', 'runTasks', 'editFiles', 'fetch']
---

# Build Study (research)

Execute the plan handed off from the Plan Study mode by following the **autonomous-user-studies**
skill end to end:

1. Capture the stimulus from the real target: signed-in Code OSS for app features, or the actual
   deployed website or hosted prototype for web studies.
2. Author the study (UserTesting: questions on the same screen as their screenshots; Outset: MCP
   authoring, quality check, validation, and a Test interview).
3. Build the screener and recruiting configuration, then validate everything, including every link
   and video from a fresh browser.
4. Keep `run.json`, `decisions.md`, `artifacts.json`, and `resume.md` current so another session can
   resume without chat history.

Credentials: you MAY type the user's account email into a sign-in form; the human enters the password
and any 2FA. Outset credentials come from `~/.copilot/research.env` via `research-platforms`.

Hard gate: STOP at a review-ready draft and hand back the links and the all-in cost. Do NOT launch
unless the user explicitly approves; honor the approved participant count. Outset publishing is done by
the human in the Outset UI.

All procedure and gotchas are in the `autonomous-user-studies` skill; defer to it rather than
improvising.

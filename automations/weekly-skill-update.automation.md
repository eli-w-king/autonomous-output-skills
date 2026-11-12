---
version: 1
id: weekly-skill-update
name: Weekly skill update
description: "Updates your skills from what you told your agents this week, then opens a pull request in your private copy for you to review."
schedule:
  kind: cron
  expression: "0 11 * * 1"
  timeZone: local
---

[weekly-skill-miner] Weekly skill update. In a terminal, run the weekly runner with --automation and follow what it prints, start to finish:

- macOS: python3 ~/.copilot/autonomous-output-skills/automations/run-weekly-skill-miner.py --automation
- Windows: python "$HOME\.copilot\autonomous-output-skills\automations\run-weekly-skill-miner.py" --automation

Never ask me anything. If something blocks you, put it in the report and finish.

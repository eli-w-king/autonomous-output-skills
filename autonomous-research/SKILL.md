---
name: autonomous-research
description: "Autonomous: Research. User research, unattended: UserTesting think-out-loud tests and Outset AI-moderated interviews built from the real target, recruiting with fraud-resistant screeners (the platform panel or User Interviews), launching only on the user's okay; then harvesting results, quality screening, traceable analysis with verbatim quotes, telemetry, and the deliverable asked for: a readout, quote pull, slideshow, decision digest of an issue epic, or the full loop (redesign spikes, a demo video, a review-ready issue). Includes the Outset, Hey Marvin, and User Interviews plumbing. Never invents quotes or metrics or cites synthetic participants. Use for 'run a user test', 'set up a UserTesting study', 'create an Outset study', 'recruit on User Interviews', 'get user feedback on <feature or website>', 'analyze these studies', 'pull quotes that support X', 'make a slideshow of the results', 'summarize what was decided in these issues', or 'turn the findings into an issue'."
---

# Autonomous: Research

Research for decisions that need evidence from users: set up and run studies, harvest and synthesize
what they return, and keep the research platforms callable underneath. Turn a one-line research
topic, for example *"how do people react to the redesigned model picker"* or *"how do developers read
the current VS Code homepage"*, into a **review-ready study** with zero human clicks up to the launch
gate, and completed studies into decisions.

Running a study:

1. **Plan** the brief: topic, surface, platform, audience, participants, length, success criteria.
2. **Capture** stimulus from the real target (Code OSS, the deployed website, or the actual prototype).
3. **Author** the study in UserTesting (browser builder) or Outset (MCP).
4. **Screen and recruit**: a tight, fraud-resistant screener on the platform or in User Interviews.
5. **Validate and hand back** a draft with preview/review links and the all-in cost. **Do not launch.**
6. **Launch only on the user's explicit okay**, then monitor, fix, and hand the results to synthesis
   ([`references/synthesis.md`](references/synthesis.md)). A research loop the user set up with launching
   pre-approved within caps is the one exception (see the launch gate below).

Turning results into decisions:

1. **Harvest** the complete evidence bundle: study metadata, stimuli, questions and answers,
   audience, transcripts, and behavior or video observations (Outset, UserTesting, or local exports).
2. **Analyze** into ranked, traceable findings with verbatim quotes, contradictions, and confidence.
3. **Triangulate** each finding with quantitative data appropriate to the target surface.
4. **Iterate** in the real target repo: Code OSS for app work, the website/prototype repo for web
   work, up to 3 switchable solutions when the problem warrants them.
5. **Record** a real high-resolution demo **video** of the running target (per `autonomous-demos`)
   and validate the file.
6. **Draft** the GitHub issue: recommendation first, then video, findings, decision, method, and
   study links.

## Hard rules

> **HARD RULE, real target surface.** App features are captured from Code OSS launched from
> `microsoft/vscode`, never an HTML recreation. Website studies use the real deployed site (or the
> actual hosted prototype, pinned to a version). A browser is fine for websites and for driving
> UserTesting, Outset, and User Interviews; it never stands in for the desktop app.

> **HARD RULE, launch gate.** Building, validating, and costing are autonomous. Recruiting real paid
> participants is not: launch only after the user explicitly says so ("launch it", "you can launch
> when it's fixed"). "Set it up" or "make a study" means stop at the draft and send the links.
> The one exception is a run a research loop owns, when the user has pre-approved launching for it
> with a cap per round and a cap in total: then only the loop's `launch.mjs` launches, after computing
> the all-in cost, refusing anything over a cap or unknown, and recording every launch in the study's
> ledger ([`references/research-loop.md`](references/research-loop.md)). Everything else still stops
> at the draft.

> **HARD RULE, iterate in the real target surface.** App redesigns and demos come from **Code OSS
> launched from microsoft-vscode**. Website redesigns come from the actual website/prototype repo and
> are demonstrated at the real hosted/local URL. Never use a browser facsimile to stand in for the
> desktop app, and never use a static mock to claim a web implementation works.

> **HARD RULE, demos by the agent are VIDEOS.** Deliver an MP4 recorded from the running build. A GIF
> is only ever an inline fallback preview, never the primary demo.

> **Own every automation target.** Other agents run their own Code OSS, browsers, and local servers.
> Always launch fresh isolated targets and record their numeric PIDs, ports, profile paths, and CDP
> target ids. Never focus, resize, navigate, close, or kill a target you did not create.

## Where things are

| Task | Read |
|------|------|
| Plan, capture stimulus, author in UserTesting or Outset, write questions, screen and recruit, validate, launch, monitor | [`references/running-a-study.md`](references/running-a-study.md) |
| Pick the output, analyze into findings, triangulate with telemetry, spike the redesign, record the demo, draft the issue | [`references/synthesis.md`](references/synthesis.md) |
| Harvest results (Outset, UserTesting, local exports) | [`references/harvest.md`](references/harvest.md) |
| Outset, Marvin, and User Interviews: auth, the client, the results watcher, API gotchas, the launch safety property | [`references/platforms.md`](references/platforms.md) |
| Recording the demo video of a redesign | [`references/demo-video-capture.md`](references/demo-video-capture.md) |
| Run studies unattended in a loop: launch within a budget, check responses, synthesize, redesign, repeat; the schedule and its procedure | [`references/research-loop.md`](references/research-loop.md), [`references/research-loop-automation.md`](references/research-loop-automation.md) |
| Chat-mode wrappers and when to use them | [`references/packaging.md`](references/packaging.md), [`chatmodes/`](chatmodes/README.md) |
| Browser-driven builders (UserTesting, User Interviews, Outset UI): selectors and quirks | [`../autonomous-runs/references/studies.md`](../autonomous-runs/references/studies.md) |
| Capture technique for stimuli and demos | [`../autonomous-demos/SKILL.md`](../autonomous-demos/SKILL.md) |

Scripts, in `scripts/`: `research-client.mjs` (Outset REST and MCP, Marvin MCP), `probe.mjs` (checks
every key and connection), `outset-auth.mjs` (Outset sign-in on this machine), `watch-studies.mjs`
(polls and harvests new interviews), `create-issue.sh` (creates or updates an issue through the
REST API), and `research-loop/` (the unattended research loop). Keys live in `~/.copilot/research.env` on each machine; `research.env.template` lists them.

Everything for one study stays in one project folder, `~/Desktop/Automated User Testing/<slug>/` (on
Windows, under `[Environment]::GetFolderPath('Desktop')`), so each phase finds what the others made.

## Maintaining this skill

Fix wrong steps in place, put selector-level facts in
[`studies.md`](../autonomous-runs/references/studies.md) in autonomous-runs and API facts in
[`references/platforms.md`](references/platforms.md), and never use em or en dashes.

When you discover a new gotcha or the user corrects the output (ordering, tone, format, hosting), fold
the fix back into the reference it belongs in (and scripts) so the next run starts from the improved
baseline.

**Keep the frontmatter `description` under ~1024 characters.** A longer description can make the skill
registry silently skip the skill (it still installs on disk and works when read manually, but does not
register as invocable). This skill's description is intentionally kept under that limit.

When a run surfaces a new non-obvious platform fact (an auth change, a required argument, a tool that
does not behave as its description says), add it to the gotchas in `references/platforms.md` with the
date and the symptom it presents as. The symptom matters as much as the fix: these failures all look
like "the endpoint does not exist".

New parts of this skill go next to the others and get a row in "Where things are": a researcher's
guide in `references/researchers-guide.md`, study question patterns in `references/study-questions.md`,
and the autonomous research loop (check responses, synthesize, redesign, repeat) in
`references/research-loop.md`, with its scripts in `scripts/research-loop/`.

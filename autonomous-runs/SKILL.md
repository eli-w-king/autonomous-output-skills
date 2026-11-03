---
name: autonomous-runs
description: "Autonomous: Runs. Operating rules and hard-won gotchas for unattended or overnight agent work on the user's Mac and dev boxes, and for starting any new session: when told 'work overnight', 'you have 8 to 12 hours', 'I'm going to bed', 'I won't be at my laptop', 'don't ask me anything', 'keep going', 'make another session', or 'start a new chat'. Covers a live Desktop status list, never blocking on the user, the model every new session runs on (top model, max effort, largest context, verified), sharing the machine with other agents, parallel-agent briefs, detached services, run ledgers, handoffs, and the final report. Its references hold the gotchas by topic: Code OSS, recording, Computer Use, study platforms, evidence and media validation, GitHub media and issue copy, pages built from separate pieces, and dev boxes and remote agent hosts (sessions, tunnels, bundles, Windows). Read the matching one before driving apps, recording, or publishing. Used with every autonomous skill."
---

# Autonomous: Runs

How to work for hours without the user and hand back exactly what they expected. The domain work
itself follows [`autonomous-demos`](../autonomous-demos/SKILL.md),
[`autonomous-prototypes`](../autonomous-prototypes/SKILL.md),
[`autonomous-variations`](../autonomous-variations/SKILL.md),
or [`autonomous-research`](../autonomous-research/SKILL.md). Machine-sharing
mechanics (invisible windows, input guards, ownership receipts) and the other gotchas are in
[`references/`](#gotchas-by-topic), by topic. Native desktop-app work follows
[`autonomous-computer-use`](../autonomous-computer-use/SKILL.md).

## The rules

1. **Write the list first, keep it current.** Turn the request into a numbered checklist in
   `~/Desktop/<Project> status.txt` (what will be done, in order, with `[ ]` boxes), open it once with
   `open -g` (background, no focus change), and tick items the moment they are verified. The user checks it. New asks get appended, never dropped.
   Mirror it in the session todo list.
2. **Never block on the user.** No questions, no OS authentication or keychain prompts, no sign-in
   flows, nothing that needs the laptop. Pick the reasonable default, record it under "Assumptions"
   in the status file, and continue. If an item truly needs the user, skip it, say exactly what is
   needed in the status file, and move on to the next item.
3. **Use the time. Never cut corners.** Do not stop early, shrink scope silently, or skip the hard
   state to finish sooner. When the user sets a deadline ("the PDF in 20 minutes"), ship the best
   complete version at the deadline, then keep going on the rest unless told to stop.
4. **Answer pings briefly, then keep working.** "How is it going", "are you done", "almost done?":
   two to four lines (done, now, next, honest ETA). "Stop everything" means stop now. "End this turn"
   means end the turn.
5. **Share the Mac politely.** Never steal focus. Use APIs or CDP for owned browser/Electron
   surfaces and the dedicated background Computer Use lane for native apps. All Computer Use
   actions must be app-targeted; never move the real pointer, type through the foreground keyboard,
   or activate a target window. Keep one persistent owned window per task and do not repeatedly open
   and close it. Never touch the user's own VS Code or Chrome windows, another session's Code OSS,
   Chrome, CDP ports, or Computer Use target. Record every process you start (pid, ports, purpose)
   and stop only those (for Code OSS, `autonomous-demos/scripts/stop-demo-oss.mjs`). Open files for
   the user with `open -g` while they are away and plain `open` when they ask to see something now;
   do not use Computer Use for simple file opening.
6. **Brief background agents completely.** For big runs, split independent work across background
   agents. Each brief is self-contained: the goal, the hard rules (paste the relevant demo or data
   rules), exact inputs and output paths, what not to touch (for example "do not edit the website",
   "CDP port 9411 belongs to another agent; never connect to it"), and when to stop. Save each brief
   to a file in the run folder before starting its agent. Follow up with additions instead of
   starting over ("same rules as the brief").
7. **Every new session runs on the top model, at max effort and the largest context.** This holds
   for every session or chat you start, for any reason: `create_session`, `create_remote_session`,
   a hub, a base, a lab, or just "make another session". Use the best model the user permits, at
   maximum reasoning effort and the largest context it supports. Today that is Claude Opus 5.5
   (`claude-opus-5.5`) or GPT-6 Astra (`gpt-6-astra`), at max effort with 1M context. Never rely on
   a default, and never choose a smaller, faster or cheaper model or a lower setting, not even when
   the preferred one is slow or busy. Set all three when you start the session (which tools inherit
   or drop them is under "Remote agent hosts and dev boxes" in [`references/dev-boxes.md`](references/dev-boxes.md)), then verify them
   before it does real work: the brief's first step reads the session's own
   `~/.copilot/session-state/<id>/events.jsonl` (`selectedModel`, `reasoningEffort` `max`,
   `contextTier` `long_context` in `session.start`, `session.resume` and `session.model_change`) and
   stops on any shortfall, and you read the same file wherever you can reach it. A session saying
   which model it is proves nothing. Record the proof (link, model, effort, context, where you read
   it) in the ledger or status file. If you cannot set or verify all three, that is a blocker:
   give that session no work, put it under "Needs you", and redo anything that ran at lower
   settings. If the user says not to start new sessions, run the work as background agents of the
   current chat. Sub-agents count too: one that does real work (mining, building, reviewing,
   writing) starts with the same model, `reasoning_effort` max and `context_tier` long_context,
   because the task tool's own defaults are smaller models.
   **Automations and unattended sessions never wait for approval.** An Agent Host automation
   (`configureAutomation`) needs `sessionTemplate` with `modelId`, `modelConfiguration`
   (`reasoningEffort` max, `contextTier` long_context) and `config` `{ "mode": "autopilot",
   "autoApprove": "autoApprove" }`. `autoApprove: "autopilot"` or `"assisted"` look right but only
   allow reads inside the workspace: the first shell command or outside read waits for a click that
   never comes, and the run sits in "needs attention" all night. Create automations on the
   `local-agent-host` provider with a `file:///` folder target. After creating or changing one, run it
   once (`runAutomation`) and check its `events.jsonl`: every `permission.requested` must have a
   `permission.completed` from `host_policy`. Updating an automation does not fix runs already
   waiting; stop them, and delete one-off automations when their work is done so a stale run can
   never be resumed by an approval click.
8. **Keep claims honest.** Telemetry comes from the VS Code data agent or Kusto on the Azure VPN
   (ask the user to connect only when they are present), aggregate only, exact event names,
   denominators, or an explicit "unavailable". Quotes are verbatim and attributable, never invented.
   Prototype or scripted behavior is labeled. Unsupported ownership or metrics never go in.
9. **Checkpoint for resumption.** Keep the run ledger current (`run.json`, `decisions.md`,
   `artifacts.json`, `resume.md`; see [`references/evidence.md`](references/evidence.md)). Commit work in progress on the feature branch
   when it is in a good state. Rebase on upstream if the base has moved and the user allowed it.
10. **Hand off cleanly.** When the model or session must change, or another agent continues, write
   `~/Desktop/<Project> Handoff.txt`: goal, decisions and terminology, done, in progress, next steps
   in order, paths, worktrees, branches and commits, running processes, settings, the user's
   standing rules, and open questions. Open it with `open -g`. A new session reads the handoff and
   the ledger before doing anything.
11. **Finish with a report and a tidy machine.** Write the final summary (`Read me.txt` in the
    deliverable folder, or `FINAL-REPORT-<date>.txt` for multi-part runs): what was done and where,
    what is real versus scripted, how it was verified, what could not be done and why, and links.
    Open the deliverable folder. Stop the processes you started, except what the user asked to keep
    open (for example one Code OSS window for a live demo).

## Status file format

```text
<PROJECT> STATUS (updated <time>)

DONE
[x] 1. <item> - <where the result is>

IN PROGRESS
[ ] 2. <item> - <what is happening now>

NEXT
[ ] 3. <item>

ASSUMPTIONS
- <decision made without the user>

NEEDS YOU
- <only if something truly requires the user, with exact steps>
```

## Wrong-session messages

If the user realizes they sent instructions to the wrong session, write those prompts verbatim
(with their images, in order) to a `PROMPTS.md` in the target session's `files/` folder or on the
Desktop, tell the user the path to paste into the right session, and continue the original work.

## Writing for different readers

- **Engineering notes:** concrete call-outs of every change ("removed Copilot from the tab title";
  "added a lock next to plan-locked levels"), with settings and commits. Respect the requested count.
- **PM summary:** the decisions and what the prototype shows, in plain bullets. Not marketing copy.
- **Never** narrate the process ("we recorded a demo") or claim more than the evidence shows.

## Overnight lessons

- A scripted demo instance without `--use-mock-keychain` can stall all night on a macOS keychain
  prompt. Mock keychain for fake tokens; never answer an OS prompt.
- Do not run CPU-heavy encodes while agents are working in a recording; it slows the take and the
  agents. Encode after the take.
- Give long agent waits generous timeouts and wait on real UI signals, not fixed sleeps.
- Background `nohup` logs are block-buffered; check live state over CDP rather than trusting `tail`.
- After a reboot or model switch, reread the handoff, the ledger, and the status file before acting.

## Overnight lab runs

When many chats or background agents work at once (for example a variation lab per decision, per
[`autonomous-variations`](../autonomous-variations/SKILL.md)):

- **Detach what must outlive a turn.** Start lab servers and the wake lock (`caffeinate -is`) as
  detached processes and record their pids and ports in the ledger. Attached processes and background
  agents die when the session restarts.
- **Briefs on disk, commits early.** Every agent starts from a brief saved in the run folder and
  commits early and often. After a restart, relaunch from the brief; the new agent commits what it
  finds first, then continues from a resume note.
- **Message the owner, and check delivery.** One owner per asset: send requests to the owner and relay
  through it, never a duplicate request to someone else. Make every message self-contained (hashes,
  paths, placement, what changed). Queue to idle chats; steering only reaches a chat that is mid-turn.
  Verify that each message arrived.
- **End turns now and then.** Messages queued by other chats arrive only when your turn ends. On long
  runs, end a turn after each checkpoint instead of working for hours in one turn.
- **Never wait inside a chat.** A background command the chat started (a watcher, a poll loop, a
  long wait) keeps the chat marked busy even after task_complete, so nothing queued or steered to it
  is delivered until that command exits. One night a 20-hour Mac watcher froze a chat for 10 hours,
  and a chain of 30-minute waits for a worker froze another. Waiting belongs to an automation that
  checks on a schedule, or to the worker's own completion message (queued, which wakes an idle chat).
  End the turn instead of waiting.
- **Push shared changes outward.** When shared content changes (an example the user rejected), tell
  every chat or lab that shows it to merge and retake its stills, and track the replies.
- **Dev boxes run on their own.** When the work is spread over dev boxes so the user can close the
  laptop, the hub (the orchestrator session, the file drop and its tunnel, the review) is a dev box,
  and nothing after the launch depends on the laptop or on messages. Follow
  [`autonomous-variations/references/distributed-labs.md`](../autonomous-variations/references/distributed-labs.md).
- **"Send it to a dev box" means all of it.** When the user says to send work to a dev box, the
  builds, renders, servers and agents run there, not on the laptop, even when the laptop would be
  quicker to start. The laptop only starts the work and reviews the result.

## Gotchas by topic

Hard-won, non-obvious facts that otherwise get rediscovered from scratch each run, in `references/`.
Read the matching one before the work it names:

| Reference | Read before |
|-----------|-------------|
| [`references/code-oss.md`](references/code-oss.md) | building, launching, or changing Code OSS; finding the real component; simulating states; Component Explorer; Agents window PR flow |
| [`references/recording.md`](references/recording.md) | any screenshot, recording, or storyboard capture of Code OSS (including on Windows); Compare Models runs |
| [`references/computer-use.md`](references/computer-use.md) | driving macOS apps in the background; permissions; native and Electron text editing; consequential actions; duplicate-send prevention |
| [`references/studies.md`](references/studies.md) | authoring an Outset study or driving UserTesting, User Interviews, or Outset in a browser |
| [`references/evidence.md`](references/evidence.md) | research or demo work others will rely on: the real surface, the run ledger, evidence chains, validating stimuli and media |
| [`references/machine-sharing.md`](references/machine-sharing.md) | launching or driving windows on a machine other agents use: off-screen windows, input guards, shared state |
| [`references/github-posts.md`](references/github-posts.md) | media or research copy in GitHub issues, PRs, and comments |
| [`references/labs-and-pages.md`](references/labs-and-pages.md) | pages assembled from pieces built apart: CSS leaks, syncing from commits, local servers without CORS |
| [`references/dev-boxes.md`](references/dev-boxes.md) | sessions on other hosts, moving work between machines, sandboxes, tunnels, bundles, Windows hosts and sign-ins, optional Windows validation |

When you hit a new gotcha, add it to the right file and, if it is phase-specific, cross-link it from
the skill that owns the phase.

**Private local context.** This repository is public, so lessons that involve internal names,
teammates, unreleased products, or internal links live outside it in `~/.copilot/skill-miner/private/`
(`notes.md` for private lessons, `voice-samples.md` for `my-voice`); the skills sync keeps that folder
the same on every machine through a private repo that is never published. Read `notes.md` when it
exists and the task touches that context. Never copy anything from that folder into a skill, a public
repo, an issue, or a public post.

---

## Maintaining this skill

Add a new gotcha the moment a run costs you time on something reusable: keep entries concise and
grouped by the problem being solved, and when a fact is phase-specific to one skill, keep the deep
detail there and leave a one-line pointer here (or the other way round). Add reusable lessons to the
rules here or to the matching reference, fix wrong steps in place, keep each reference focused (move
an entry when it clearly belongs to another topic rather than duplicating it), keep this file small,
keep the description under 1024 characters, and never use em or en dashes. Use headings, not section
numbers, in cross-references.

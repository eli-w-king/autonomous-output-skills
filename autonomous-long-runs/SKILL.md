---
name: autonomous-long-runs
description: "Autonomous: Long Runs. Operating rules for unattended, multi-hour, or overnight agent work on the user's Mac: when told 'work overnight', 'you have 8 to 12 hours', 'I'm going to bed', 'I won't be at my laptop', 'don't ask me anything', or 'keep going'. Covers a live Desktop status list, never blocking on the user, background-only Computer Use with a private virtual input lane, no focus stealing, no corner-cutting, progress replies, parallel-agent briefs, detached services, early commits, verified messages, data and quote integrity, resumable handoffs, and the final report. Use with the other autonomous skills whenever work runs long or unattended."
---

# Autonomous: Long Runs

How to work for hours without the user and hand back exactly what they expected. The domain work
itself follows [`autonomous-demos`](../autonomous-demos/SKILL.md),
[`autonomous-prototypes`](../autonomous-prototypes/SKILL.md),
[`autonomous-variations`](../autonomous-variations/SKILL.md),
[`autonomous-user-studies`](../autonomous-user-studies/SKILL.md), or
[`autonomous-research-synthesis`](../autonomous-research-synthesis/SKILL.md). Machine-sharing
mechanics (invisible windows, input guards, ownership receipts) are in the
[`glossary`](../autonomous-skill-glossary/SKILL.md). Native desktop-app work follows
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
7. **Keep claims honest.** Telemetry comes from the VS Code data agent or Kusto on the Azure VPN
   (ask the user to connect only when they are present), aggregate only, exact event names,
   denominators, or an explicit "unavailable". Quotes are verbatim and attributable, never invented.
   Prototype or scripted behavior is labeled. Unsupported ownership or metrics never go in.
8. **Checkpoint for resumption.** Keep the run ledger current (`run.json`, `decisions.md`,
   `artifacts.json`, `resume.md`; see the glossary). Commit work in progress on the feature branch
   when it is in a good state. Rebase on upstream if the base has moved and the user allowed it.
9. **Hand off cleanly.** When the model or session must change, or another agent continues, write
   `~/Desktop/<Project> Handoff.txt`: goal, decisions and terminology, done, in progress, next steps
   in order, paths, worktrees, branches and commits, running processes, settings, the user's
   standing rules, and open questions. Open it with `open -g`. A new session reads the handoff and
   the ledger before doing anything.
10. **Finish with a report and a tidy machine.** Write the final summary (`Read me.txt` in the
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
- **New chats get the user's model.** Use the model and reasoning level the user prefers (for
  example the strongest model, with long context and maximum reasoning) unless told otherwise, and
  check a new chat's model after creating it, because defaults can silently differ. Work that ran on
  the wrong model gets redone on the right one. If the user says not to start new sessions, run the
  work as background agents of the current chat.
- **Message the owner, and check delivery.** One owner per asset: send requests to the owner and relay
  through it, never a duplicate request to someone else. Make every message self-contained (hashes,
  paths, placement, what changed). Queue to idle chats; steering only reaches a chat that is mid-turn.
  Verify that each message arrived.
- **End turns now and then.** Messages queued by other chats arrive only when your turn ends. On long
  runs, end a turn after each checkpoint instead of working for hours in one turn.
- **Push shared changes outward.** When shared content changes (an example the user rejected), tell
  every chat or lab that shows it to merge and retake its stills, and track the replies.
- **Dev boxes run on their own.** When the work is spread over dev boxes so the user can close the
  laptop, the hub (the orchestrator session, the file drop and its tunnel, the review) is a dev box,
  and nothing after the launch depends on the laptop or on messages. Follow
  [`autonomous-variations/references/distributed-labs.md`](../autonomous-variations/references/distributed-labs.md).

## Maintaining this skill

Add reusable lessons here or in the glossary, fix wrong steps in place, keep the description under
1024 characters, and never use em or en dashes.

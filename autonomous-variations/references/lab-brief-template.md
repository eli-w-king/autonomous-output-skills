# Lab brief template

Copy this into the run folder as `brief-<lab>.md`, fill in every `<placeholder>`, delete what does
not apply, and start the lab from the file. Keep it on disk: a background agent dies with its
session, and its replacement restarts from the brief. Paste rules in full; never write "the usual
rules".

For many sessions from one template (a lab across dev boxes, one session per variation), save it as
`brief-variation.template.md` and let [`../scripts/make-briefs.py`](../scripts/make-briefs.py) fill the
`{PLACEHOLDERS}` (`{KIND}`, `{HOST}`, `{PORT}` and the rest) and the `PASTE: <file>` lines for each session. The
blocks marked "labs across dev boxes" follow
[`distributed-labs.md`](distributed-labs.md).

---

You are building a variation lab for the user, <who they are and what they are working on>. <The
user is away: work autonomously for as long as it takes, never ask questions, decide, and record
assumptions in the lab's README.> The user reviews visually, so the quality of the result on screen
matters more than anything.

## Continue, don't restart (only for a lab that was interrupted)

A previous agent started this lab and was cut off. Its work is uncommitted in `<lab folder>`:
<files>. Read all of it first, commit it as found, keep what is good, and finish the job.

## Phase 0: study and plan (only when sessions start before the kit is ready)

The kit isn't ready yet, so work in two parts: study and plan now, writing no lab code and creating
no worktree; then build, once `kit-latest.txt` is on the drop.

1. Read the rules, read-only, in `<the base worktree>`: <the repo's rules files>.
2. Study today's page headlessly at `<this box's site URL>` once it answers, at 1440x900 and
   390x844, with motion on and with reduced motion. Keep the screenshots in
   `<lab home>/study/{KIND}/`, outside every repo, and look at them.
3. Read the code your idea depends on: <files>. Note the real states, parts and beats you will use,
   by name.
4. Write your plan to `<lab home>/plans/{KIND}.md`: the beats, the layout at desktop and on phones,
   the reduced-motion design, the length against today's, and what you need from the kit beyond its
   expected contract. Deliver it: `node <lab home>/drop.mjs put <lab home>/plans/{KIND}.md
   {KIND}-plan.md`.
5. Wait for the kit on the drop, never for a message: `node <lab home>/drop.mjs wait kit-latest.txt
   --timeout 14400`. If your shell tool moves the wait to the background, end your turn; its
   completion notice wakes you. Then `node <lab home>/drop.mjs recv kit <repo>`, create your worktree
   from `refs/lab/kit`, and go on with the steps below.

## Goal

The user's words: "<verbatim ask>". Build a <name> lab with **<N> variations** of <the part of the
product>, so the user can pick one. Each variation must <what it must feel like: for example belong
to the page's story, calm, product-native>. Include today's version as the baseline `?v=0`.

## Where you work (hard rules)

- Worktree `<path>`, branch `<lab branch>`, made from `<integration branch>` at `<commit>`. Commit
  only on this branch, early and often: right after the page first loads, then after every
  variation. Never push.
- Never touch any other worktree, branch or repository; they belong to other agents running right
  now. Reading them is fine.
- The lab lives in `<lab folder>`. Do not change the integration's shared files unless a variation
  truly needs a hook; say so in the README. Scope every style under the lab's own class.
- Server: `<serve command>` on port <port>, already running detached. If it stops answering, start
  it again detached with the same command. Never start a second one.
- Never kill processes you didn't start; never `pkill` or `killall`. Headless browsers only
  (Playwright from `<an existing install>`, the system Chrome channel); never open visible windows.
- Scratch files go in `<lab folder>/work/` (git-ignored) and are deleted when you finish.
- <Labs across dev boxes:> This session has no workspace folder; work in the absolute paths above.
  If the sandbox denies a write, rerun the command asking to run outside the sandbox, and never stop
  at the first denial.

## This machine (labs across dev boxes)

You are on {HOST}. Every box has the same paths and ports; what differs is here:

PASTE: host-notes

## The page and its rules

- Where the part lives today: <files and functions>. What surrounds it: <the sections above and
  below>, shown in the lab as on the real page.
- Real content only: <the real sources: posts, data, assets, with where they live>. Never invent
  posts, people, data or copy. A variation may show less, never something made up.
- Visual and copy rules: <page color>; <product UI look>; one accent, <accent>; <case, for example
  sentence case everywhere>; <punctuation, for example never em or en dashes>; <names to keep out of
  copy, for example model or unreleased product names>.
- Type: <the page's scale, step by step>. No new sizes unless an idea needs one; say so in the
  README.
- Taste notes from earlier rounds: <for example scroll moves things in one axis only; minimal and
  embedded beats overlays; no on-screen text explaining an interaction; mimic the real product UI>.
- Owned elsewhere: <neighbouring decisions other labs or chats own>. Keep those parts as today.

## The <N> variations

Genuinely different directions, not parameter tweaks, each with a short name and a one-line idea.
<Ideas to consider, if any.> <Families or order, if the user named them.> Every variation must look
finished at 1440x900, 1280x800, 820x1180 and 390x844.

## Lab conventions

- `?v=<id>` picks a variation (`?v=0` is today); `[` and `]` step and keep the place; a small
  switcher pill with the id and name, and a menu of every variation with its idea.
- `?motion=off` and `prefers-reduced-motion: reduce` give the reduced-motion version: no travel, no
  loops, end states. Mark it on `<html>` as well.
- `?embed=1` hides all lab chrome; `v`, `motion` and every other parameter still work with it.
- Phones and tablets are real layouts: touch friendly, 44px targets, nothing that needs hover.
- `README.md`: the question, how to open it, the variations table (id, name, idea), what they share,
  porting, checks with their last results, assumptions, and your top picks with a reason each.

## Review page contract

1. `<lab folder>/manifest.json`: `lab`, `title`, `question` (one sentence: the decision the user is
   making), `section`, `port`, `path`, `baseline`, `picked` (`null`), `commit`, `updated`, and
   `variations` (each with `id`, `title`, `summary` of one or two plain sentences, and
   `still.desktop` and `still.phone`).
2. `stills/<id>-desktop.png` (1440x900) and `stills/<id>-phone.png` (390x844) for every id including
   0, taken with `?embed=1` at the variation's most representative moment, by a script that fails on
   any page error.
3. Commit the code first, then take the stills (the manifest records that commit), then commit the
   stills.

## Verify before you finish

- Zero page errors, console errors and failed requests for every variation at 1440x900, 1280x800,
  820x1180 and 390x844, motion on and off.
- No text overlapping text or images, nothing cropped badly, no horizontal scroll on phones, frames
  under about 25 ms.
- Look at your own contact sheets (open the images) and fix what looks off. Iterate on quality; you
  have time.
- `node <skills dir>/autonomous-variations/scripts/check-manifest.mjs <lab folder> --live` prints
  `ok` with no warnings.

## Moving files: the drop (labs across dev boxes)

Nothing is pushed and no other channel is used: no OneDrive, gist or push. Files move through the
lab's drop on the hub with `node <lab home>/drop.mjs` (Node 22). The `drop.json` beside it holds the
drop's URL and key: never print, copy or message it.

- **Deliver your work** at the first look and at the end: `drop.mjs send {KIND} <your branch>
  <your worktree>` bundles it on top of the base and sends it with `{KIND}-latest.txt`.
- **Report** at every phase boundary: write `<lab home>/{KIND}-report.md` (state, commit, page URL,
  what's next or blocked, the time) and `drop.mjs put` it. It replaces the last one and tells the hub
  you're alive. Your final answer is not forwarded to anyone.
- **Ask for kit changes** with `drop.mjs put <file> {KIND}-request-<n>.md`: what, why, and the
  smallest change that would do. Meanwhile, work around it inside your folder.
- **Read the hub's files at every phase boundary:** `drop.mjs recv kit <repo>` (merge `refs/lab/kit`
  when it moved) and `drop.mjs get orders.md`, which lands in `<lab home>/in/` (act on new items for
  you or for everyone; no file means no orders).
- **Exit code 3 means queued, not failed:** the box's flush loop delivers it when the hub answers.
  Keep working.
- If the client says the tunnel asked for a sign-in or the key was refused, say so in your report and
  keep working. Don't work around it.

## Done when

<N> variations plus the baseline are built, verified and committed on `<lab branch>`, with the
README, manifest, stills and check script, and the server answers. Reply with the commit hash, the
lab URL, one line per variation, your top picks with a reason each, and anything you could not do.
<Labs across dev boxes: send the final bundle, then put that report as `{KIND}-report.md`; leave
your lab server running and your worktree in place.>

---

## Start prompt (labs across dev boxes)

Save it as `prompt.template.md` beside the brief template; `make-briefs.py` writes one per session.
Keep it near 1 KB: everything else is in the brief on the drop.

```text
You are session {KIND} of the <lab> variation lab, on {HOST}. Work autonomously and never ask
questions. Load the autonomous-variations and autonomous-long-runs skills if you have them.
Your full brief is on the lab drop. Fetch it, read all of it, and follow it from the top:
  node <lab home>/drop.mjs get brief-{KIND}.md <lab home>/brief-{KIND}.md
This session has no workspace: use the absolute paths in the brief. If the sandbox denies a write,
rerun the command asking to run outside the sandbox. Report through the drop as the brief says;
your final answer is not forwarded.
```

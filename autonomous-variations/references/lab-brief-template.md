# Lab brief template

Copy this into the run folder as `brief-<lab>.md`, fill in every `<placeholder>`, delete what does
not apply, and start the lab from the file. Keep it on disk: a background agent dies with its
session, and its replacement restarts from the brief. Paste rules in full; never write "the usual
rules".

---

You are building a variation lab for the user, <who they are and what they are working on>. <The
user is away: work autonomously for as long as it takes, never ask questions, decide, and record
assumptions in the lab's README.> The user reviews visually, so the quality of the result on screen
matters more than anything.

## Continue, don't restart (only for a lab that was interrupted)

A previous agent started this lab and was cut off. Its work is uncommitted in `<lab folder>`:
<files>. Read all of it first, commit it as found, keep what is good, and finish the job.

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

## Done when

<N> variations plus the baseline are built, verified and committed on `<lab branch>`, with the
README, manifest, stills and check script, and the server answers. Reply with the commit hash, the
lab URL, one line per variation, your top picks with a reason each, and anything you could not do.

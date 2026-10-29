---
name: autonomous-variations
description: "Autonomous: Variations. Run variation labs unsupervised for one part of a product: exactly the count asked for, genuinely different ideas plus today's version as a baseline, in real context with real content, one lab per decision with its own worktree, branch and port. Covers the shared lab conventions (?v=, [ and ], a switcher pill, ?motion=off, ?embed=1, manifest.json, stills), every variation finished at desktop, tablet, phone and reduced motion, headless checks and contact sheets before reporting, briefs that carry the user's visual and copy rules, rounds built on named winners, porting the pick verbatim from its commit, coordinating many labs, labs across dev boxes that run on their own, and one review page that ends in a prompt naming each pick. Use for 'make N variations', 'explore options', 'a lab for X', 'more of these two', 'pick one and port it', 'run the lab on dev boxes', or 'one page to review all the labs'. Pairs with autonomous-prototypes and autonomous-long-runs."
---

# Autonomous: Variations

Turn "show me N ways to do X" into a set the user can judge in minutes, and a pick that ships
without rework. Each decision gets a lab: one part of the product, shown in its real context, with N
genuinely different variations and today's version, built to shared conventions so one page can
review every lab and the pick ports verbatim. The bar: the user steps through the lab with `[` and
`]` at any size, with motion on or off, and decides without hitting anything broken, cramped or
invented.

Building inside the real product follows
[`autonomous-prototypes`](../autonomous-prototypes/SKILL.md) (in Code OSS a lab is a set of
Component Explorer fixtures or a setting enum; the rules here still apply). Videos of the variations
use the variant matrix profile in [`autonomous-demos`](../autonomous-demos/SKILL.md). Overnight runs
with many labs also follow [`autonomous-long-runs`](../autonomous-long-runs/SKILL.md). Web gotchas
(CSS leaking between pieces, syncing from a working tree, local servers without CORS) are in the
[`glossary`](../autonomous-skill-glossary/SKILL.md), section "Variation labs and integrated pages".

## Standing rules

1. **One lab per decision, in real context.** Scope the lab to the part being decided (a hero
   animation, a homepage section, how a panel's details open), never a rebuild. Show it with the
   real surrounding UI, content and assets, and hold everything else at today's version, so only the
   decision changes.
2. **Exactly the count asked for, genuinely different.** Different ideas, not parameter tweaks of
   one idea. Each gets an id, a short name and a one-line idea, and today's version is the baseline
   (`?v=0`) whenever there is one.
3. **The same conventions in every lab.** `?v=<id>`, `[` and `]`, a switcher pill, `?motion=off`,
   `?embed=1`, a README with the variations table, `manifest.json` and stills. Then one review page
   can frame any lab.
4. **Finished everywhere.** Every variation works at desktop (1440x900, 1280x800), tablet
   (820x1180), phone (390x844, touch, 44px targets, nothing hover-only) and with reduced motion. No
   variation is desktop-only by accident.
5. **Real content only.** Never invent posts, people, quotes, data or product UI. Use the real thing
   or leave it out, and say so.
6. **Verify headlessly before reporting.** Zero errors, nothing overlapping or cropped, no sideways
   scroll on phones, smooth frames, and contact sheets you actually looked at and iterated on. This
   is the full check; it never holds back the review link (rule 11).
7. **Every brief carries the rules.** Paste the user's standing visual and copy rules (palette,
   accent, case, punctuation, real content only) and the hard rules (worktree, branch, port, never
   push, never touch other agents' work or processes, headless only) into each lab brief, and save
   the brief to a file before starting the lab.
8. **Rounds build on named winners.** A new round carries the user's notes; earlier rounds stay
   reachable.
9. **The pick ports verbatim.** The lab documents the port; the integration copies files from the
   named commit with a sync script and never edits the copies.
10. **Ambiguity gets a decision, not a question.** When the framing is ambiguous (the order of the
    sections, how the families split), pick a reading, say so in the README, and fix it fast when
    the user corrects it.
11. **The link comes first.** Seeing the UI matters more to the user than tests. Send the review
    link as soon as the lab loads without errors, then run the full checks, fix, and send the
    updated link. Every report lists every lab's link; when some labs are not ready, send the
    ready ones now instead of waiting for all of them.

## 1. Scope the lab

- Write the question in one sentence (it becomes the manifest's `question`) and keep the user's
  words verbatim (the README opens with them).
- Show the part where it lives: the real header, the sections just above and below, the real assets
  and type. Load the integration's own files, or generate the lab page from them, rather than
  redrawing them.
- Name what is out of scope. When a neighbouring decision belongs to another lab, keep that part as
  today and say so. When one lab's variation sits inside another lab's section, note the dependency
  in both READMEs.
- **Count.** When the user names a number, make exactly that many. When they don't, make as many as
  are meaningfully different; spikes from research findings follow the one to three rule in
  [`autonomous-research-synthesis`](../autonomous-research-synthesis/SKILL.md).
- **Families.** When the ask has two directions (two orders, two winners), split it into families
  with prefixed ids (`A1` to `A6`, `B1` to `B6`). Align them so the same number makes the same
  choice in each family; then every row compares exactly one thing.

## 2. Set up the worktree

```bash
git -C <repo> worktree add -b lab-<slug> <repo>.worktrees/lab-<slug> <integration branch>
cd <repo>.worktrees/lab-<slug> && mkdir -p labs/<slug>/work && echo '*' > labs/<slug>/work/.gitignore
```

- One worktree, branch and local port per lab, made from the integration branch. Record lab, branch,
  worktree, port, owner (chat or agent) and scope in the run ledger and the integration's handoff.
- Serve the worktree root on the lab's port, started detached so it survives turns and restarts.
  Never start a second server for the same lab, and never stop a server you did not start.
- Keep the lab in its own folder (`labs/<slug>/`) and change nothing the integration owns. If a
  variation truly needs a hook in a shared file, add the smallest hook and say so in the README.
- Scratch screenshots and tools go in the git-ignored `work/` folder, deleted at the end.
- Commit as soon as the page loads, then after every variation, so a restart never costs more than
  minutes. Commit only on the lab's branch, and never push unless the user asks.

## 3. Design the set

- **Write the list first.** N names and one-line ideas before building anything. Each should change
  how the thing works or reads, not a duration, a color or an offset. If two lines read alike,
  replace one.
- **Order it on purpose**, for example from subtle to expressive, or in the order the user listed
  directions, and say which.
- **One interface, one kit.** Define the small contract every variation implements before building
  any: a spec with layout and frame hooks, a `mount(section, data, options)` that returns
  `{ destroy() }`, or a pure function of scroll progress. Shared behavior lives in one kit. Then any
  pick ports the same way: the kit plus one variation file.
- **Isolate the variable.** Everything except the decision is identical across variations: the same
  content, neighbours and timing. The baseline replays today faithfully, pixel for pixel at rest
  where possible.
- **Second axes are toggles, not more variations.** When a choice is orthogonal (a text style, an
  arrangement, a light or dark widget), give it its own key and parameter (`T` and `&text=`, `A` and
  `&arr=`) that persists while stepping.

## 4. Build to the lab conventions

| Convention | What it does |
|------------|--------------|
| `?v=<id>` | Picks the variation. Ids are short and stable (`1`, `01`, `A3`, `x2`); `?v=0` is today's version |
| `[` and `]` | Step through the variations and keep the place (scroll position, open item, toggles), so variations compare at the same moment |
| Switcher pill | Small and clear of content: the id and name, and a menu of every variation with its one-line idea; 44px targets on touch |
| `?motion=off` | The reduced-motion version, identical to the system's `prefers-reduced-motion`; also mark it on `<html>` (`data-motion="off"`) |
| `?embed=1` | Hides all lab chrome (pill, menus, notes, key shortcuts) so another page can frame it; every other parameter still works with it |
| `?at=<moment>` | Optional: opens a scroll story at a named beat or a fraction, for review and stills |

- **Real layouts on every device.** Phones and tablets get their own staging, not a squeezed
  desktop; follow the product's own small-screen rules when it has them. Say in the README what each
  variation does differently on phones.
- **Reduced motion** shows end states with no travel and no loops, the same content and the same
  clicks. Pinned or sticky stages unpin and show their final state.
- **Motion defaults** (unless the user asks otherwise): animate transform, opacity and clip only;
  read layout once and again on resize or font load, never per frame; scroll-driven motion is a pure
  function of scroll position, so it reverses exactly; springs are critically damped and any state
  can be interrupted.
- **Scope the CSS.** Every variation's rules live under its own root class (`.lab-v3`), so nothing
  leaks into the page or another variation, and the pick moves into the integration with a rename.
- **Accessibility.** Real buttons and links with names, visible focus, Esc closes and returns focus,
  alt text, one heading per section, keyboard paths to everything the pointer can do.
- **Real content.** Snapshot live data (posts, pull requests, people) into a committed file with a
  refresh script, so the lab works offline and a failed source keeps its previous value. Compute
  copy that depends on the data, read relative times against the snapshot time, leave out bot
  accounts, and quote people's own words instead of writing new ones. Read copy the integration
  already has from its source at runtime, so the lab never drifts from it.

## 5. Verify before reporting

Write a check script per lab: headless Chrome through an existing Playwright install, never visible
windows. Load every variation at every size, with motion on, `?motion=off` and the system setting
(`reducedMotion: 'reduce'`), embedded and not; phones with `isMobile` and `hasTouch`. Exit non-zero
on:

- any page error, console error or failed request;
- text overlapping text or images (compare the client rects of visible text runs and images), or
  content past the screen's sides;
- a page wider than the viewport (`scrollWidth > innerWidth`), on phones above all;
- anything cropped or resized that the design keeps whole;
- touch targets under 44px on touch devices;
- with motion off, a running animation or a frame that changes at rest.

Then check what the variations promise:

- **Frames** while scrolling and interacting: under about 25 ms, no long animation frames. Headless
  numbers only compare with each other; record when and where they were taken.
- **Behavior:** the keyboard flow, Esc returning focus, clicks only where the variation says the
  page is live, reversibility (the same styles at a scroll position reached going down or up),
  movement in one axis when that is the rule, and `]` then `[` returning to the identical frame.
- **Contact sheets:** one labeled row per variation, a column per state or moment, plus phone and
  reduced-motion sheets. Open them and look. Fix what is cramped, misaligned, clipped or noisy, and
  iterate: the user reviews visually, so the quality on screen matters more than anything.
- **Earlier rounds** get rechecked whenever the shared kit changes.
- Record the last results in the README with the date, the machine and the counts ("all 12 at four
  sizes, motion on and off, zero errors").

## 6. The README, manifest and stills

The README is what the user and the integration read. In order:

1. The question and the user's words, then the status once there is one (picked, ported at which
   commit).
2. How to open it: the serve command, the URL, the parameters and keys.
3. The variations table: id, name, the idea in one line (a table per family).
4. What every variation shares, the interface, and the content sources.
5. Porting, the checks with their last results, and the files.
6. Assumptions and notes: each reading of an ambiguous ask, what was left out and why, dependencies
   on other labs, and earlier rounds by commit.
7. Your picks: the top two or three with a reason each, and a line on why not the others. The user
   decides.

`manifest.json` lets one review page frame every lab:

```json
{
  "lab": "blog", "title": "Blog lab", "section": "blog",
  "question": "Which way should the blog section sit on the page so it belongs to the story around it?",
  "port": 4390, "path": "/labs/blog/", "baseline": "0", "picked": null,
  "commit": "a1b2c3d", "updated": "2026-10-12T07:56:34Z",
  "params": { "v": "The variation, 0 (today) to 6.", "motion": "off shows reduced motion.", "embed": "1 hides the lab chrome." },
  "variations": [
    { "id": "0", "title": "Today", "summary": "One or two plain sentences.",
      "still": { "desktop": "stills/0-desktop.png", "phone": "stills/0-phone.png" } }
  ]
}
```

- Ids are strings. `baseline` and `picked` are a variation id or `null`. Families add
  `"families": [{ "id": "A", "title": "..." }]` and a `"family"` on each variation. `params` is
  optional.
- Stills: `stills/<id>-desktop.png` (1440x900) and `stills/<id>-phone.png` (390x844, 1x or 2x) for
  every id, the baseline included, taken with `?embed=1` at the variation's most representative
  moment (not the top of a scroll story, not mid-glide), by a script that writes nothing if any page
  error occurs or the moment is not showing.
- Order: commit the code, take the stills (the manifest's `commit` is that commit), then commit the
  stills and the manifest.
- Check it: `node <this skill>/scripts/check-manifest.mjs labs/<slug>` validates the fields, ids,
  still sizes and commit, and warns when lab files changed after the commit the stills show.

## 7. Rounds

- When the user names winners ("these two are the winners"), make the next round: N variations of
  each winner, a family per winner, that carry their notes. Put the notes verbatim at the top of the
  README and say how each is answered.
- Read vague notes explicitly and record the reading ("a bit longer" means longer than round one,
  shorter than today).
- Keep earlier rounds reachable: by id on the same page, on a sub-page (`v2/`), or by a commit
  listed in the README.
- When one lab's pick sets a look (the details' type, a hover style), other labs showing related UI
  adopt it token for token, so the page stays one piece.
- When shared content changes upstream (the user rejects an example), every lab that shows it merges
  the integration branch and retakes its stills.

## 8. Port the pick

The lab side:

1. Write a porting section: the files to copy, the interface, numbered wiring steps against the
   integration's real functions, load order and dependencies, gotchas (state the integration sets
   differently today), what not to port (lab chrome, `?embed=1`, the manifest, review-only
   shortcuts), and the checks to run afterwards.
2. Add a port reference page: the pick on its own, with only the files it needs, mounted exactly as
   the integration will mount it.
3. Prove the steps on a scratch copy of the integration's file, never the real one. Commit, then
   send the integration side a self-contained message: the commit, the file list, where it goes and
   what changed.

The integration side:

1. Copy the files verbatim from the named commit with a sync script that records the source:
   `<this skill>/scripts/sync-pick.sh lab-<slug> labs/<slug> <dst> <files...>` reads from the commit
   (never a working tree) and writes `SOURCE.md` with the ref, commit and file list. Never hand-edit
   the copies: change the lab, commit, sync.
2. Wire it per the README. Verify at every size and motion setting, and that the rest of the page
   did not move (compare its layout against the previous commit).
3. Commit, deploy the preview if that is the flow, reply to the lab with the integration commit, and
   record the pick in the lab's README and manifest (`picked`).
4. A link the team already has stays frozen (a tag or its own environment); republish it only when
   the user asks.

Stay current: labs merge the integration branch to pick up shared changes. A lab generated from
integration files anchors each hook on text that appears exactly once, so the build stops by name
when the integration moves it; edit the lab's template, never the generated page.

## 9. Many labs at once

- One lab per decision, each started from a brief built on
  [`references/lab-brief-template.md`](references/lab-brief-template.md) and saved to the run
  folder.
- New chats or agents use the model and reasoning level the user prefers; check after creating them.
  Detached servers, briefs on disk, early commits, message delivery and turn endings are in
  [`autonomous-long-runs`](../autonomous-long-runs/SKILL.md).
- One owner per asset (a lab, a shared component, a set of illustrations). Send requests to the
  owner, never a duplicate to someone else, and relay through the owner. Every message is
  self-contained: hashes, paths, placement, what changed.
- Give the user one review page that walks every lab in product order, one at a time or side by
  side, switches device and motion, lets them pick, like and note, and ends with a prompt naming
  each pick precisely (lab, id, title, branch, commit, link). Keep every lab's own link. Spec:
  [`references/review-page.md`](references/review-page.md).

### Across dev boxes

When the sessions run on dev boxes (remote agent hosts) so the user can close the laptop, follow
[`references/distributed-labs.md`](references/distributed-labs.md). What matters most:

- **The lab runs on its own.** The hub is a dev box: the orchestrator session, the file drop and its tunnel, the
  review worktree and the ledger live there, and the laptop only starts the run and reviews it. Prefer one big box;
  then the kit is a local branch and the drop a folder.
- **Started on a dev box, that session is the hub.** It updates the skills, launches everything while the user is
  there, and never needs the laptop again. Every box needs the skills installed (the repo's INSTALL.md, "Dev
  boxes").
- **Settings first, proven by a pilot.** "Allow sandboxing" off and allow-all (Autopilot) on every host before the
  fan-out, one pilot session per host to prove it, sessions without a workspace, and the user told which settings
  `create_remote_session` cannot set.
- **Files, not messages.** Briefs live on the drop and each session starts from a short prompt that fetches its
  own. Kit readiness, later orders, reports and kit requests are files, and a phase ends in a wait on a file.
  Creates and messages share a budget of about 50 per window.
- **Phase 0 fan-out.** Every variation starts at once to study and plan while the kit is built; nobody writes lab
  code before `kit-latest.txt` exists.
- **Deliveries never block.** Bundles are based on a commit every box has and checked before they are fetched. They
  go through an outbox that a flush loop on each box delivers whenever the hub answers. Never state an exact commit
  as a requirement: "this kit or a newer one that contains it".

## Taste notes worth carrying

The user's recurring visual, motion and layout taste lives in
[`autonomous-prototypes/references/design-taste.md`](../autonomous-prototypes/references/design-taste.md).
Paste the notes that apply into every lab brief as examples of the user's taste, not as universal
law; the user's latest word wins.

## Scripts

| Script | Purpose |
|--------|---------|
| `sync-pick.sh` | copy a pick's files verbatim from a lab commit into the integration and write `SOURCE.md` |
| `check-manifest.mjs` | check a lab's `manifest.json` and stills against the contract; `--live` checks its server |
| `make-briefs.py` | one brief and one short start prompt per variation, from a template, the variations table and per-host notes |
| `drop-server.mjs` | the hub's file drop for labs across dev boxes: key-gated, write-once bundles, text and review media, published through a dev tunnel |
| `drop.mjs` | the drop's client: send and receive bundles, put and get files, wait on files, mirror, and an outbox with a flush loop |
| `drop-sync.sh` | merge the kit and every delivered variation from the drop into a review worktree, then run the manifest tool |
| `drop-watch.sh` | keep that review worktree synced and its server up, detached, with nobody watching |

`sync-pick.sh` needs only bash and git; `check-manifest.mjs`, `drop-server.mjs` and `drop.mjs` need Node 22 or
newer; `drop-sync.sh` and `drop-watch.sh` need bash (3.2 is fine, and Git Bash on Windows), git and curl;
`make-briefs.py` needs Python 3. Each one documents its options at the top of the file.

## Maintaining this skill

Add reusable lessons here or in the glossary, fix wrong steps in place, keep the description under
1024 characters, and never use em or en dashes.

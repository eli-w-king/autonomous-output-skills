# The review page

When several labs run at once (an overnight run, a round across one page), the user should not have
to remember ports, ids and branches. Build one page that walks every lab in product order, frames
each variation live, lets the user pick, like and note, and ends with a prompt that names each pick
precisely. Every lab's own link stays one click away.

## Data, built offline

- **Registry**, owned by the integration side: the product's sections in order, and for each lab its
  id, title, the sections it touches, port, path, worktree, branch, owner (chat or agent), status
  (open or decided), pick and the user's ask. The review page only reads it.
- **Each lab's `manifest.json` and stills** (the contract is in the skill).
- **Local servers send no CORS headers**, so the page cannot read labs across ports. A catalog
  script gathers everything ahead of time into one `catalog.js`:
  - reads each lab's manifest from its worktree on disk, and records the worktree's head and whether
    it has uncommitted changes (with optional git locks off, since the worktrees belong to other
    agents);
  - copies each still at review sizes (desktop about 1200 wide, phone 390 wide, a card thumbnail) as
    JPEG of about 80 quality, each under about 200 KB, skipping unchanged ones by a hash of the
    source;
  - with no manifest, reads the README's variations table, then the lab's own `?v=` values; with
    none of these, the lab shows as not published yet. It never invents variation content;
  - with no still for a variation and the lab's server up, captures one headlessly
    (`?v=<id>&embed=1`) and marks it automatic. Automatic stills of scroll stories show the top of
    the page and look alike, so labs should ship their own at the representative moment;
  - runs in seconds when nothing changed, exits non-zero only on a crash (a missing lab is not an
    error), and prints a table: source, variations, stills, head, the manifest's commit, the server.

## Screens

Each screen has its own hash route, so back, forward and reload work.

- **Start:** what this is, the link to share first, what was decided, what is open, how it works, a
  big Start, and a story map: the product's sections top to bottom with the labs that touch each and
  their status.
- **Walk:** one lab at a time in product order. The question, the sections, the links (lab, owner,
  branch, commit), a filmstrip of the variations, the selected one live in a frame, and pick, like
  and note controls.
- **Compare:** two to four variations side by side, same device and motion.
- **Devices:** one variation at desktop, tablet and phone at the same height.
- **Overview:** every lab and variation as stills, with pick and like on each, for quick decisions.
- **Prompt:** the user's choices as an editable message with Copy, Export and Import.

## Frames

- Render each frame at the device's real CSS size (1440x900 or 1280x800, 820x1180, 390x844) and
  scale it down with a transform, so the lab lays itself out as on the device and scrolling inside
  still works.
- The URL is `http://127.0.0.1:<port><path>?v=<id>&embed=1`, plus `&motion=off` when motion is off.
  "Open in a new tab" opens it without `embed=1`, so the lab's own controls show.
- At most four live frames at once, and frames load only when visible. Keep frames out of the Tab
  order, and take focus back if a lab grabs it while loading (unless the pointer is over the frame).
- Health: check each lab's server on load, every minute and when the tab comes back, with
  `fetch(url, { mode: 'no-cors' })` and a 2.5 second timeout. A lab that does not answer shows its
  stills and the command to start it. When the page is hosted, without the lab servers, it shows
  stills only; picks and the prompt still work.

## Picking and the prompt

- Per lab: one pick, or "Keep today's" when the lab has a baseline, or undecided; any number of
  likes; a note per variation, per lab, and one overall. Persist everything in `localStorage` with
  Export and Import as JSON, and show progress ("3 of 7 open labs picked").
- The prompt lists, in product order, each lab decided: the pick's id and title, the lab's branch
  and commit (the manifest's commit, else the worktree's head, noting uncommitted changes), the
  variation's URL and the owner's link, then what else the user liked and their notes. "Keep
  today's" is one line. Undecided labs and labs decided earlier are listed too, and general notes
  come last. The user can edit it; when choices change after an edit, offer the new text.

```text
From my review of the labs (<date and time>). Please port these into <integration branch>:

1. <Lab> (<section>): pick <id>, "<title>". <branch> at <commit>, <url>, <owner link>. Also liked: <id>, "<title>". Note: "<note>"
2. <Lab> (<section>): keep today's.

Undecided: <labs>.
Already decided: <lab> (<pick>).
General notes: <notes>
```

## Keyboard

Left and right step variations, up and down (or `[` and `]`) step labs, `P` picks, `L` likes, `K`
keeps today's, `N` writes a note, `1` `2` `3` set the device, `M` toggles motion, `C` compares, `O`
opens the overview, `?` lists the keys. Keys pause while the user types and while a frame has focus.

## Quality bar

- The review chrome uses the user's own theme for tools when they have one; the framed variations
  keep their own look. Calm, editorial and roomy: a design review tool, not a dashboard.
- Plain HTML, CSS and JavaScript, relative paths, nothing from the network, so it works from any
  worktree and when hosted.
- Accessible chrome: real buttons and links, labels, visible focus, reduced motion respected,
  contrast in light and dark. Under about 900px wide the walk becomes a list of stills with pick,
  like and note.

## Checks

- Every screen at two desktop sizes, light and dark, with zero console errors from the page.
- A pick, like and note flow across several labs that survives a reload, and an Export and Import
  round trip.
- The prompt compared word for word with one written independently from the registry and the
  catalog.
- Every shortcut, typing in a note that is not hijacked, and the Tab order.
- Offline: a copy of the registry with one lab on a port nothing answers (never edit the real
  registry) shows stills and the start command while the other labs stay live; as if hosted, no
  frames and no errors.
- Screenshots of every screen, opened and looked at, with fixes for anything cramped, misaligned,
  clipped or noisy.

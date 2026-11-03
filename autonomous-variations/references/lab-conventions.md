# Lab conventions: building, the README, the manifest, and stills

Sections 4 and 6 of [`autonomous-variations`](../SKILL.md). The standing rules there apply to all of it.

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

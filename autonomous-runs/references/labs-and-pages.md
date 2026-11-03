# Variation labs and integrated pages

Read before building or integrating a page from pieces built by different labs, chats, or repos.

---

## Variation labs and integrated pages

**Pieces built apart meet on one page:** labs, components synced from other repositories, sections
embedded from other chats. These gotchas cost real time; the procedure is in
[`autonomous-variations`](../../autonomous-variations/SKILL.md).

- **CSS leaks between pieces built apart.** Two pieces that each look right alone can collide on one
  page: one component's global `.card` rule (absolutely positioned and offset, with a border and an
  endless animation) restyled another piece's `.card` as soon as both loaded. Scope every piece's
  rules under its own root class, and give the rules a picked piece depends on a specificity that a
  lone global class cannot beat. Test it: inject a hostile global rule for the same class after all
  the page's CSS, and check that computed styles and layout do not change.
- **Sync from a commit, never a working tree.** Another chat's working tree can be mid-edit, so
  copying it ships half-finished files under a commit that does not contain them. Read files from
  the named commit (`git cat-file blob <commit>:<path>`, or a detached `git worktree add` of it),
  record the commit next to the copies, and never hand-edit them.
  `autonomous-variations/scripts/sync-pick.sh` does all three.
- **Reading another agent's worktree can still write to it.** `git status` refreshes the index and
  can take its lock while that agent commits. Set `GIT_OPTIONAL_LOCKS=0` for git commands in
  worktrees you do not own.
- **Local servers send no CORS headers.** A page on one port cannot read another port's JSON or
  pages. Build review data offline from the files on disk; iframes still show other ports, and a
  `no-cors` fetch with a timeout tells whether a server is up without reading it.
- **An in-page reduced-motion switch cannot change the media query.** Everything keyed on
  `@media (prefers-reduced-motion: reduce)` must also key on the page's own flag (for example
  `html[data-motion="off"]`). Check that `?motion=off` and the system setting give identical pages.
- **Stills show a commit.** Commit the code, take the stills, then commit them; the manifest names
  the code commit. Stills taken from uncommitted work point the integration at a commit that does not
  contain what they show.
- **Headless frame times only compare with each other.** Other agents' load on a shared Mac can cap
  a run at 30 fps partway through. Compare variations within one run, record when and where, and check
  the pick on a real display.
- **A touch scroll that starts on a clickable tile ends in `pointercancel`**, which some engines
  treat as a tap. Ignore clicks within about 60 ms of a `pointercancel`.
- **Class toggles in bulk drop frames.** Toggling classes that restyle large subtrees (sleep or
  visibility classes on illustrations) during a transition costs frames; hold them while things move,
  then apply a few per frame.
- **Pinned stages need room.** A sticky or pinned scroll stage that does not fit the viewport (a
  phone on its side, a short window) falls back to its final state in normal flow, rechecked on
  resize and after late font loads.

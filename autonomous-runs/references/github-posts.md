# Demo media and copy on GitHub

Read before putting media or research findings in a GitHub issue, PR, or comment.

---

## Publishing demo media to GitHub issues and PRs

**PRs and issues on github.com: prefer GitHub user-attachments.** The built-in `github-pr-media`
skill uploads an image or video to GitHub's user-attachments and embeds it in a PR description or
comment (`https://github.com/user-attachments/assets/<id>`). Put before/after images and the demo
in the PR description. Attachment URLs on private repos return 404 without a signed-in session;
that is access control, not a failed upload. Never embed expiring signed URLs (S3 or Azure SAS) in
anything that must keep working: a study's video stimulus broke because it pointed at a 5-minute
GitHub asset URL of an MP4 that was also truncated. Fully decode-check media before linking it.

**Native inline `<video>` players come ONLY from a signed-in GitHub web drag-drop** into the
issue composer; the REST API / `gh` / any PAT cannot produce them, and that drag-drop is not
automatable headless.

**Unreleased prototype media in a public repo is a public post.** Ask before uploading it there; prefer
PR attachments or a private repository, and check the repository's visibility first.

**Practical fallback when the user approves public hosting:** host the GIF + MP4 in a public repo you control
(e.g. a dedicated `ux-research-media` repo), embed the GIF with a raw URL, and link the MP4 to
its blob page (which has a player):

```markdown
![Variant A](https://raw.githubusercontent.com/<you>/ux-research-media/main/<dir>/demo.gif)
[Watch the demo (MP4)](https://github.com/<you>/ux-research-media/blob/main/<dir>/demo.mp4)
```

**A dedicated media BRANCH in the same repo as the issue also works, and keeps everything in one
place.** When the issue lives in a repo the user owns (e.g. their fork), push the binaries to a
`*-demo-media` branch of that same repo and reference
`raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` for the inline GIF and the `blob` URL for
the MP4 player. Do the media work on a throwaway branch so the user's working branch and uncommitted
code stay untouched: record current branch, `git switch -c media-branch`, add only the media, commit,
push with the repository's normal hooks, then switch back and remove only the run-owned local media
copy. If the repository's normal validation rejects binary media, use a dedicated media repository
instead of bypassing hooks. **Always verify the raw URLs return HTTP 200 before/after editing the
issue** (`curl -s -o /dev/null -w "%{http_code}"`); a 404 renders as a broken image.

**When you replace a clip, delete the old file and update every reference.** This session left a
comment section pointing at a deleted clip after a re-record. Grep the issue body AND every comment
for the old filename, and prefer a NEW filename over overwriting (GitHub caches raw hard, next point).

**GitHub caches raw images hard.** When you update a demo, push it under a **new filename**
(e.g. `…-v2.gif`) and point the issue at the new name, otherwise the old frame keeps showing.

**Binary push:** use normal `git push`, not a text-oriented file API. If a git-lfs hook requires a
missing tool, install/configure it or choose a media repository whose normal validation accepts the
file; do not bypass verification.

**Public-repo posts are irreversible**, so confirm before posting to a flagship repo; when the
user is unavailable, hosting media in your own repo + creating the issue via `gh issue create`
(assignees included) is the pragmatic path. Assignees can be set with
`--assignee a,b`; verify with `gh issue view <n> --json assignees`.

**So are pushed commits.** A force-push does not take a leaked commit off GitHub: it keeps serving
it by SHA until GitHub Support purges it. Scan content (names, paths, secrets) before the first push
instead of counting on a history rewrite.

---

## Writing / editing a public research issue (copy + CLI)

**On a PUBLIC issue, use approximations for telemetry, never exact numbers.** When the user says
the issue is public, phrase every metric qualitatively: "about", "around", "roughly", "more than",
"less than", "a large share", rounded percentages, orders of magnitude, or ranges. Ask the Data
agent to return already-rounded/qualitative figures so nothing exact leaks. Also flag prototype
telemetry honestly as *adjacent shipping behavior* (proxies), since an unshipped feature has no
telemetry of its own.

**No em/en dashes anywhere** in issue bodies or comments (same rule as study text). Grep the body
for U+2014 and U+2013 before posting (`rg -n '[\x{2013}\x{2014}]' body.md`).

**Editing via CLI (no browser needed for text):**
- Body: `gh issue edit <n> --repo o/r --body-file body.md` (and `--title` to rename).
- A comment: `gh api -X PATCH repos/o/r/issues/comments/<comment_id> -f body="$(cat c.md)"`; get the
  id with `gh api repos/o/r/issues/<n>/comments --jq '.[].id'`.
- Splicing a section into an existing body: fetch it (`gh issue view <n> --json body -q .body`),
  edit the array of lines in python by locating a stable `## Heading` line, and write it back. This
  is more reliable than trying to string-replace multi-line markdown.

**A "draft" comparison comment the user pastes elsewhere:** structure it as numbered sections with a
one-line `_[video below]_` placeholder or the actual GIF/MP4 per section, and offer to fill the
placeholders from the media branch. Keep the recommendation and the "what users liked / disliked"
framing tight; the user reuses this verbatim.

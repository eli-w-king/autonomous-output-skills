---
name: autonomous-skill-glossary
description: "Autonomous: Skill Glossary. Shared, hard-won gotchas for all autonomous work on this Mac: sharing the machine with other agents (ownership receipts, off-screen windows, input guards), durable run ledgers, evidence chains, stimulus and media validation, publishing demo media to GitHub issues and PRs, public issue copy, and optional Windows validation. Topic references: references/code-oss.md (building, launching, and changing Code OSS, components, Component Explorer), references/recording.md (clean recordings, screenshots, storyboard frames, Compare Models runs), and references/studies.md (Outset and browser drivers for study platforms). Read the relevant reference before driving Code OSS, recording, building a study, or publishing. Used by autonomous-demos, autonomous-prototypes, autonomous-long-runs, autonomous-user-studies, and autonomous-research-synthesis. Update it whenever a run surfaces a reusable gotcha."
---

# Autonomous: Skill Glossary

Hard-won, non-obvious facts that otherwise get rediscovered from scratch each run. The procedural
skills own the *procedure*:
[`autonomous-demos`](../autonomous-demos/SKILL.md),
[`autonomous-prototypes`](../autonomous-prototypes/SKILL.md),
[`autonomous-long-runs`](../autonomous-long-runs/SKILL.md),
[`autonomous-user-studies`](../autonomous-user-studies/SKILL.md), and
[`autonomous-research-synthesis`](../autonomous-research-synthesis/SKILL.md). Platform plumbing for
Outset, Marvin, and User Interviews is in [`research-platforms`](../research-platforms/SKILL.md), and
Windows execution is [`automation-windows-os`](../automation-windows-os/SKILL.md).

This file holds the cross-cutting entries. Topic references hold the rest:

| Reference | Read before |
|-----------|-------------|
| [`references/code-oss.md`](references/code-oss.md) | building, launching, or changing Code OSS; finding the real component; simulating states; Component Explorer; Agents window PR flow |
| [`references/recording.md`](references/recording.md) | any screenshot, recording, or storyboard capture of Code OSS; Compare Models runs |
| [`references/studies.md`](references/studies.md) | authoring an Outset study or driving UserTesting, User Interviews, or Outset in a browser |

When you hit a new gotcha, add it to the right file and, if it is phase-specific, cross-link it from
the relevant skill.

---

## Match the artifact to the real research surface

**"Never build a browser mockup" applies to desktop-app research, not to websites.** Use the real
surface named by the study:

- VS Code app feature: Code OSS built from the source commit under test.
- Deployed website: the actual deployed URL, with redirects and final URL recorded.
- Website prototype: the actual hosted/local prototype artifact, pinned to a commit/deployment and
  tested at the same viewport participants will see.

The invalid substitution is a facsimile that changes the product category, such as HTML standing in
for the Agents window or a static design image standing in for a functioning website. Capture a
source/version receipt before the first participant and never overwrite a stimulus between rounds.

---

## Persist a run ledger outside chat history

**Chat/session history is not a durable artifact store.** A later session may retain media and git
changes while the original transcript is unavailable. At project creation, write:

- `run.json` for ids, source versions, URLs, owned processes/targets, and phase status;
- `decisions.md` for assumptions, approvals, revisions, and rejected paths;
- `artifacts.json` for each stimulus/output path, role, source version, and checksum;
- `resume.md` for the last completed phase and next safe action.

Update the ledger before handoffs and after irreversible or expensive steps. Keep participant PII,
credentials, and private transcript text out of it. This makes recovery evidence-based instead of
guessing from filenames or stale browser tabs.

---

## Sharing the Mac with other agents: off-screen windows, input guards, shared state

- **Install an invisible-instance guard at the actual Electron main entry, not Node's first
  bootstrap pause.** With `--inspect-brk`, an early `require('electron')` can fail during bootstrap.
  Set `Debugger.setBreakpointByUrl` on `Resources/app/out/main.js`, resume bootstrap, then patch
  `BrowserWindow.show` to `showInactive`, opacity 0, non-focusable and ignored mouse events before
  any window opens. Also no-op `focus`, hide only that process's dock icon, and disable background
  throttling. Separate profile, extensions and inspector/CDP ports are mandatory; verify the
  inspector's `process.pid` before exiting an owned instance. Renderer CDP captures remain real.
- **Preserve quick-input provider prefixes.** Filling a command-palette field with a command name
  alone removes `> ` and silently becomes file search. Debug launch pickers similarly need
  `debug `. Match the exact observed `.label-name` row rather than pressing Enter on a fuzzy
  recent-command match. Multi-root Quick Open often needs the path relative to a root, without
  the `repo/src/` prefix. Monaco search controls may be `.native-edit-context`, not HTML inputs.
- **A "spare display" is not safe.** Another agent later opened its own Code OSS window in the same spot, and
  both of our windows were closed (a stray Cmd+W or click landed on them). Keep demo windows past the right
  edge of the last display: from the main inspector, hook `app.on('browser-window-created')` and
  `setBounds()` each new window off-screen. macOS keeps about 40 px visible, and `screencapture -l` still
  returns the full 3104x2024 frame.
- **Attach before the first window shows.** Parse `--inspect=<port>` from `launch.sh` stderr, install the hooks
  (about 1.5 s after launch), and for the first 45 s give focus straight back to the previously front app
  whenever the new instance activates itself.
- **Guard keys in the main process.** `webContents.on('before-input-event')` plus `preventDefault()` blocks page
  keys and menu shortcuts. Always swallow Cmd+Q/W/M/H unless the driver sets an allow flag, and swallow
  everything while briefly holding focus for a capture. Activate only after 3 s of HID idle
  (`ioreg -c IOHIDSystem`, `HIDIdleTime`).
- **Some state escapes `--user-data-dir`.** Agent plugins install into `~/.vscode-oss-dev/agent-plugins`
  (shared by every Code OSS dev instance), Copilot CLI plugins in `~/.copilot/installed-plugins` are listed
  too, and agent-host sessions land in the real `~/.copilot/session-state` unless `COPILOT_HOME` is set at
  launch. Uninstall demo plugins right after capture and delete only folders you created.

---

## Build an evidence chain, not just a findings document

**Every recommendation should be traceable backward and forward.** Link:

`study round + stimulus version -> participant/source -> quote/response/observed behavior ->
finding -> recommendation -> implementation version -> rerun result`

Transcripts are necessary but not sufficient. Preserve structured answers, task context, timestamped
behavior/video observations, contradictions, and completion state when they affect interpretation.
Give each finding a confidence level with a reason. Quantitative evidence may support, weaken, or be
unable to test a finding; all three outcomes are useful if stated honestly.

Keep product-specific conclusions in the project report. Only promote the reusable method or gotcha
to this glossary.

---

## Version and fully validate stimuli and media

**A successful upload is not proof that media works.** Before publishing an MP4, run `ffprobe` to
inspect duration/codec/dimensions and decode the full file with `ffmpeg -v error -i <file> -f null -`.
Inspect opening, midpoint, and ending frames, then verify playback from a fresh browser session after
upload.

Use a new filename for every replacement (`prototype-a-v2.mp4`) because GitHub/raw/CDN caches can
serve the old bytes. Update every issue/comment/study reference plus `artifacts.json`; verify the
old filename is no longer referenced. For comparative or rerun studies, keep prior stimuli immutable
and record checksums so results cannot be attributed to the wrong version.

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

---

## Writing / editing a public research issue (copy + CLI)

**On a PUBLIC issue, use approximations for telemetry, never exact numbers.** When the user says
the issue is public, phrase every metric qualitatively: "about", "around", "roughly", "more than",
"less than", "a large share", rounded percentages, orders of magnitude, or ranges. Ask the Data
agent to return already-rounded/qualitative figures so nothing exact leaks. Also flag prototype
telemetry honestly as *adjacent shipping behavior* (proxies), since an unshipped feature has no
telemetry of its own.

**No em/en dashes anywhere** in issue bodies or comments (same rule as study text). Grep the body
for `—` / `–` before posting.

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

---

## Optional Windows / UTM validation

**Windows is an optional validation target, not a tax on every autonomous run.** At any point where
native Windows behavior would strengthen the result, hand the built scenario to
[`automation-windows-os`](../automation-windows-os/SKILL.md). Common triggers are native caption
controls, active/inactive windows, high contrast, DPI scaling, keyboard/accessibility behavior,
Windows-only regressions, or a reviewer who needs real Windows media.

The calling autonomous skill keeps ownership of the design or research decision. The Windows skill
owns the transport, including UTM guest execution, interactive-session bridging, native UI
automation, evidence, and restoration. Its strongest reusable lessons:

- never race the user for the host's single macOS pointer when a guest-local path exists;
- prove that the Windows build contains the change before interpreting screenshots;
- dry-run the full state matrix before recording;
- compare surfaces side-by-side when the bug is a visual inconsistency;
- verify screenshot labels and fully decode the final video;
- restore modified binaries, settings, and state with hash evidence.

Use the returned Windows screenshots or video directly in the study or issue artifact contract.
Do not recapture the same flow locally unless a cross-platform comparison is itself the goal.

---

## Maintaining this glossary

Add a new entry the moment a run costs you time on something reusable. Keep entries concise and
grouped by the problem being solved. If a fact is phase-specific to one skill, keep the deep
detail there and leave a one-line pointer here (or vice-versa). Never use em/en dashes. Keep the
frontmatter `description` under ~1024 characters so the skill registry does not silently skip it.

Keep each topic reference focused; move an entry when it clearly belongs to another topic rather than
duplicating it. Use headings, not section numbers, in cross-references.

---
name: autonomous-skill-glossary
description: "Autonomous: Skill Glossary. Shared, hard-won gotchas for all autonomous work on this Mac: sharing the machine with other agents (ownership receipts, off-screen windows, input guards), background Computer Use, durable run ledgers, evidence chains, stimulus and media validation, publishing demo media to GitHub issues and PRs, public issue copy, pages assembled from separately built pieces (CSS leaks, syncing from commits, local servers without CORS), remote agent hosts and dev boxes (session tools, sandbox defaults, dev tunnels, git bundles, Windows hosts), and optional Windows validation. Topic references cover Code OSS, Computer Use, recording, and study platforms. Read the relevant reference before driving apps, recording, building a study, or publishing. Used by every autonomous skill. Update it whenever a run surfaces a reusable gotcha."
---

# Autonomous: Skill Glossary

Hard-won, non-obvious facts that otherwise get rediscovered from scratch each run. The procedural
skills own the *procedure*:
[`autonomous-demos`](../autonomous-demos/SKILL.md),
[`autonomous-prototypes`](../autonomous-prototypes/SKILL.md),
[`autonomous-variations`](../autonomous-variations/SKILL.md),
[`autonomous-long-runs`](../autonomous-long-runs/SKILL.md),
[`autonomous-computer-use`](../autonomous-computer-use/SKILL.md),
[`autonomous-user-studies`](../autonomous-user-studies/SKILL.md), and
[`autonomous-research-synthesis`](../autonomous-research-synthesis/SKILL.md). Platform plumbing for
Outset, Marvin, and User Interviews is in [`research-platforms`](../research-platforms/SKILL.md), and
Windows execution is [`automation-windows-os`](../automation-windows-os/SKILL.md).

This file holds the cross-cutting entries. Topic references hold the rest:

| Reference | Read before |
|-----------|-------------|
| [`references/code-oss.md`](references/code-oss.md) | building, launching, or changing Code OSS; finding the real component; simulating states; Component Explorer; Agents window PR flow |
| [`references/computer-use.md`](references/computer-use.md) | driving macOS apps in the background; permissions; native and Electron text editing; consequential actions; duplicate-send prevention |
| [`references/recording.md`](references/recording.md) | any screenshot, recording, or storyboard capture of Code OSS; Compare Models runs |
| [`references/studies.md`](references/studies.md) | authoring an Outset study or driving UserTesting, User Interviews, or Outset in a browser |

When you hit a new gotcha, add it to the right file and, if it is phase-specific, cross-link it from
the relevant skill.

**Private local context.** This repository is public, so lessons that involve internal names,
teammates, unreleased products, or internal links live outside it in `~/.copilot/skill-miner/private/`
(`notes.md` for private lessons, `voice-samples.md` for `my-voice`). Read `notes.md` when it exists
and the task touches that context. Never copy anything from that folder into a skill, a commit, an
issue, or a public post.

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

## Variation labs and integrated pages

**Pieces built apart meet on one page:** labs, components synced from other repositories, sections
embedded from other chats. These gotchas cost real time; the procedure is in
[`autonomous-variations`](../autonomous-variations/SKILL.md).

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

---

## Remote agent hosts and dev boxes

Facts about sessions on dev boxes (remote agent hosts reached over dev tunnels) that cost a whole lab to learn.
The procedure, starting with the rule that such a lab runs on its own with its hub on a dev box, is in
[`autonomous-variations/references/distributed-labs.md`](../autonomous-variations/references/distributed-labs.md).

**The session tools.**
- `create_remote_session`, `send_remote_message` and `get_remote_session` are client tools: they work only while an
  Agents window shows the calling chat. When that window crashed mid-launch, every call failed with "No client is
  connected", and a locked screen blocks Computer Use, so nobody could click Reopen.
- `create_session` starts a session on the same host, and it works from a session on a dev box with no laptop
  involved. Use it to let each box start its own sessions: as child chats of the caller (the default) or as
  independent sessions. It defaults to the caller's model; on a box with the settings below, the new sessions ran
  at max reasoning with the long (1M) context tier.
- `create_remote_session` starts a session on another host, chosen by `hostId` (from `list_agent_hosts`, which also
  shows each host's cores, memory and load) or picked automatically. `requirements` can ask for CPUs, memory or a
  platform. It returns once the prompt is accepted. Never retry an uncertain creation: check first, or there will be
  two sessions.
- `create_remote_session` starts a session with the host's default permissions, not the creating chat's. Its model
  is only `{provider, id}`: no context tier and no reasoning effort. A workspace has to be trusted first ("The
  workspace is not trusted. Trust it before starting an unattended session."); sessions without a workspace work,
  with absolute paths in the brief.
- `send_remote_message` only queues, first in first out. The target reads it when its turn ends, so a long turn
  sees nothing new. `send_message` can steer a running turn, but only between sessions on the same host.
- A remote session's final answer is not forwarded. It reports with `send_remote_message` to session `"origin"`,
  the chat that created it. That fails while the origin chat waits in `ask_user` (in Autopilot, `ask_user` returns
  "not available"), and a laptop chat that is asleep cannot receive at all.
- `create_remote_session` and `send_remote_message` share a limit of 50 requests per window; one lab hit it at
  about 45.
- `get_remote_session` returns one snapshot: the status (`running`, `needsInput`, `completed`), `queuedMessages`
  and the latest turn's text. Use it to confirm that a message arrived, not to poll.
- A host's sessions see only the skills installed on that host, in its own `~/.copilot/skills`. Install and update
  them with `tools/install-devbox.mjs` from the skills repo (its INSTALL.md, "Dev boxes").

**Sandbox and approvals.**
- Hosts differ. On one, a filesystem sandbox denied writes outside the allowed paths with no prompt ("Access
  denied", curl exit 23), and the sessions reported the error and stopped. On another, approval prompts parked the
  sessions in `needsInput` until someone approved them by hand.
- Turn "allow sandboxing" off and set allow-all (Autopilot) before the fan-out, in the user settings of the VS Code
  that hosts the box's agent host (`%APPDATA%\Code - Insiders\User\settings.json`): `chat.agent.sandbox.enabled`
  (recent builds have no separate Windows key), `chat.permissions.default`, `chat.defaultConfiguration`, and
  `chat.agentHost.copilot.modelCapabilityOverrides` with `reasoningEffort` per model. The box's VS Code forwards them
  to its own agent host; the laptop's settings do not reach it.
- Prove it with one pilot session per host that writes outside any workspace and starts a detached process.
- Briefs still say: when the sandbox denies a write, rerun the command asking to run outside the sandbox, and never
  stop at the first denial.

**Channels between boxes.**
- OneDrive is not a channel: a 365-byte file showed as uploading for more than 10 minutes on the Mac, and its folder
  never appeared on either dev box within 15 minutes.
- GitHub is not one when nothing may be pushed, and a box may not be signed in: one had an invalid injected
  `GH_TOKEN` and no gh login. Never ask an agent to sign in interactively; send the base as a bundle. Where gh does
  work, run `Remove-Item Env:GH_TOKEN` first so its stored login is used.
- Tunnel connect tokens are masked in an agent's tool output, so one session cannot pass them to another. Give the
  drop's port anonymous access and gate the server with an app key instead: a 192-bit key in an `X-Lab-Key` header,
  compared in constant time, and a lockout per client address. Set the lockout high (50 bad keys in 15 minutes):
  boxes share egress addresses, and a limit of 10 locked out the orchestrator's own test.
- Clients send `X-Tunnel-Skip-AntiPhishing-Page: true`. A 302 from the tunnel is its sign-in page: the port lost its
  anonymous access.
- `autonomous-variations/scripts/drop-server.mjs` and `drop.mjs` do all of this.

**The dev tunnel recipe.** Run these where the `devtunnel` CLI is signed in (`devtunnel user login`, usually the
laptop):

1. `devtunnel create <id> -e 3d -d "<lab> drop"`
2. `devtunnel port create <id> -p 4650 --protocol http`
3. `devtunnel access create <id> -p 4650 --anonymous`, for the drop's port only. A review port stays private, so the
   user signs in to open it.
4. `devtunnel host <id>`, started detached. Its log prints the URL, `https://<id-part>-4650.<region>.devtunnels.ms`.
5. Teardown: `devtunnel delete <id> -f`. The tunnel also expires on its own (`-e`).

**Hosting it on a box that is not signed in.** Mint a host token where you are signed in, straight into a file
(`devtunnel token <id> --scopes host --json`; it lasts 24 hours), and hand the file to the hub over a short-lived
boot drop (a second tunnel and `drop-server.mjs` on the laptop, deleted once the hub has pulled). The hub hosts with
the token on stdin, never on the command line: `devtunnel host <id>.<region> --access-token -` with the token file as
standard input. The URL stays the same, so it can go in prompts before the hub is up.

**Git bundles.**
- `git bundle create` needs a ref, not a bare commit ("Refusing to create empty bundle"): run
  `git update-ref refs/drop/<kind> <sha>` first. `drop.mjs send` does.
- Base every bundle on a commit every box has. Otherwise `git bundle verify` fails where it lands ("Repository lacks
  these prerequisite commits").
- Check the SHA-256 and run `git bundle verify` before fetching, and fetch into a ref of your own
  (`refs/lab/<kind>`): git refuses to fetch into a branch checked out in any worktree.
- Bundles are small: a whole homepage redesign on top of an older main was 2.6 MB.

**Windows hosts.**
- Node: the default may not be the repo's version (one box ran 24 by default, with 22 under fnm). Put that version's
  fnm installation folder first on PATH; `fnm exec npm` failed.
- `npm install` rewrote `package-lock.json`: restore it, and don't run it in lab worktrees.
- Use `curl.exe`: in PowerShell, `curl` is an alias for `Invoke-WebRequest`.
- Start detached processes with `Start-Process node -ArgumentList '<args>' -WorkingDirectory <dir> -WindowStyle
  Hidden -RedirectStandardOutput <log> -RedirectStandardError <errlog> -PassThru`, and keep `.Id` to stop that PID.
- Run `git config --global core.longpaths true` before deep worktrees.
- With no Chrome, headless Playwright runs with `channel: 'msedge'`.
- The drop's bash scripts run in Git Bash (`C:\Program Files\Git\bin\bash.exe`). They avoid `lsof` and fall back
  from `sha256sum` to `shasum`, but so far they have been tested on macOS only.

**Shell traps.**
- macOS `/bin/bash` is 3.2: under `set -u`, `"${arr[@]}"` on an empty array is an "unbound variable" error. Write
  `${arr[@]+"${arr[@]}"}`, and test with `/bin/bash`, not whichever bash comes first on PATH.
- A cleanup glob can match a template: `rm -f brief-v*.md` also deleted `brief-variation.template.md`. Write
  generated files into a folder of their own, and never glob-delete next to sources.
- Test a sync script with fake bundles in a scratch clone and scratch refs before the real run.

---

## Maintaining this glossary

Add a new entry the moment a run costs you time on something reusable. Keep entries concise and
grouped by the problem being solved. If a fact is phase-specific to one skill, keep the deep
detail there and leave a one-line pointer here (or vice-versa). Never use em/en dashes. Keep the
frontmatter `description` under ~1024 characters so the skill registry does not silently skip it.

Keep each topic reference focused; move an entry when it clearly belongs to another topic rather than
duplicating it. Use headings, not section numbers, in cross-references.

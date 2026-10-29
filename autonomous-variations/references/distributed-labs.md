# Labs across dev boxes

How to spread one variation lab over dev boxes (remote agent hosts) so it keeps going after the user closes the
laptop. [`SKILL.md`](../SKILL.md) still applies to every lab; this adds the topology, the launch, the file channel,
the review and the teardown. The facts behind these rules (the session tools, sandbox defaults, tunnels, bundles,
Windows hosts) are in the [`glossary`](../../autonomous-skill-glossary/SKILL.md), section "Remote agent hosts and dev
boxes". The scripts are in [`../scripts/`](../scripts/).

## 1. The lab runs on its own

The point of running on dev boxes is that the user can close the laptop and the work goes on in the background.

- **The hub is a dev box, never the laptop.** The orchestrator is a session on the hub. It owns the briefs, the
  ledger, kit relays and kit requests, the review merge and the status. The file channel lives there too: a drop
  server and its tunnel, or a plain folder when the whole lab is on that box.
- **The laptop starts the run and reviews it, nothing else.** After the launch, no session, file or message may
  depend on it. In the first distributed lab the orchestrator and the drop were on the laptop: with the lid closed,
  sessions kept building, but kit handoffs, deliveries and kit requests stalled.
- **Files, not messages, after the launch.** Session messages are budgeted, only queue, and cannot reach a laptop
  chat that is asleep. Every instruction after the launch is a file on the hub that sessions read at phase
  boundaries (section 6).

## 2. Topology

- **One big box first.** When one dev box can hold the whole lab (check its cores and memory against one session and
  one headless browser per variation), use only that box. The kit is a local branch, the drop is a folder
  (`{ "dir": ... }` in `drop.json`), and nothing crosses machines.
- **More boxes: one hub, the rest spokes.** The hub runs the orchestrator, the kit author, the drop server and its
  tunnel, the review watcher, and its share of variations. Each spoke runs one base session, which builds the same
  base (repo, dependencies, running site), and its share of variations. Spokes talk only to the hub, through the
  drop. Split the variations evenly.
- **Identical paths and ports everywhere,** so one brief fits every box: the repo path, branch names, worktree
  layout, ports (the site, the base lab server, variation NN on the base port plus NN, the review server) and the
  lab home. What differs (the Node path, the browser channel, how to start a detached process) goes in
  `host-notes-<host>.md`, pasted into that box's briefs.
- **The lab home** is `~/.lab/<lab>/` on every box (`$env:USERPROFILE\.lab\<lab>\` on Windows), outside every repo:
  `drop.mjs`, `drop.json`, `outbox/`, `sent/`, `in/`, `study/`, `plans/` and `logs/` with pid files. The hub adds
  `drop/` (the drop folder), `run/` (templates, briefs, `RUN.md`) and `watch/`.

## 3. Before the fan-out (the user is present)

- **Settings on every box, set by its first session.** Sessions take the box's defaults, not those of the chat that
  creates them. The hub and each base set them in the user settings of the VS Code that hosts the box's agent host
  (`%APPDATA%\Code - Insiders\User\settings.json`), keeping everything else, and record what changed:
  `"chat.agent.sandbox.enabled": "off"`, `"chat.permissions.default": "autopilot"`,
  `"chat.defaultConfiguration": { "mode": "autopilot", "approvals": "allowAll" }`, and for the model the user wants
  at max, `"chat.agentHost.copilot.modelCapabilityOverrides": { "<model>": { "reasoningEffort": "max" } }`.
  Sandboxed sessions were once denied writes outside their workspace with no prompt, and on another box sessions
  parked in `needsInput` until someone approved them by hand.
- **A pilot proves it.** The first step of the hub session, and of each spoke's base session: write a file in the lab
  home, start a detached process and stop it, run git and node, with no prompt and no denial. Fan out only after
  every pilot passes.
- **Model, effort and context.** `create_remote_session` sets the model only. Sessions created on a box with
  `create_session` (section 4) after the settings above ran on the requested model at max reasoning with the long
  (1M) context tier. Check every session from its own `events.jsonl` (section 4), never from its reply.
- **No workspace.** Create sessions without one and give absolute paths in the briefs. A home-folder workspace
  fails as untrusted unless the user trusts it first.
- **Count the remote requests.** `create_remote_session` and `send_remote_message` share a budget of about 50 per
  window. With the boxes creating their own sessions, the launch needs only one per box.
- **Repo access.** A box that cannot fetch the repo (no sign-in, or an invalid injected `GH_TOKEN`) gets the base as
  a bundle: `drop.mjs send base <branch> --full` from a box that has it. Never ask an agent to sign in interactively.
- **Skills on every box.** A box's sessions see only the skills installed on that box. Each box has them from
  INSTALL.md, "Dev boxes" (once, with `--schedule`), and the hub and every base session run
  `node ~/.copilot/autonomous-output-skills/tools/install-devbox.mjs` as their first step. Every start prompt names
  the skills to load.
- **The tunnel** (labs on more than one box): create it where `devtunnel` is signed in, and let the hub host it with
  a host token, so no box ever signs in. The recipe is in the glossary.

## 4. Launch: one session per box, and each box starts its own sessions

**The launcher creates one session per box: the hub, and a base on each spoke. Each of those creates its own box's
variation sessions with `create_session`, from the prompt files on the drop.** That needs nothing from the laptop.
`create_remote_session` and `send_remote_message` only work while an Agents window on the laptop shows the launching
chat; in the first lab that used this, that window crashed mid-launch and the screen was locked, and the boxes still
started all 20 sessions within ten minutes.

- **Started on the laptop,** the launcher creates the hub on the biggest box and a base on each spoke with
  `create_remote_session` (a `hostId` from `list_agent_hosts`, which also shows cores, memory and load), then hands
  over.
- **Started on a dev box,** that session is the hub. It needs `create_remote_session` only for the bases on other
  boxes, while the user is present.
- **Never put a secret in a prompt from memory.** Read a key from its file when you write the prompt; a key typed
  from memory cost the first launch a round trip.
- **Corrections after the launch go on the drop:** a numbered item in `orders.md`, and for the hub a file it will
  notice in a listing (`00-origin-read-me-first.md`). A session never fetches its brief twice, so every brief tells
  the hub and the bases to read `orders.md` from their first minutes, not only in the night loop.

1. **The hub.** Its first steps are the skills update, the settings and the pilot. It gets the scripts from the
   installed skills (`~/.copilot/skills/autonomous-variations/scripts/`). It makes the lab home, gets the lab key
   (written by the launcher, or a new one:
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`), starts `drop-server.mjs`
   detached and, for more boxes, hosts the tunnel. Then it writes `drop.json` as
   `{ "dir": "<lab home>/drop", "base": "<commit>" }`, starts the box's flush loop, and puts `drop.mjs`, the briefs
   and the start prompts on the drop (`make-briefs.py --out <lab home>/drop`). A keepalive restarts the server, the
   tunnel host and the flush loop if they die.
2. **The bases.** One session per spoke. Its short start prompt carries the URL and the key, once, and nothing else
   ever repeats them:

   ```powershell
   $L = "$env:USERPROFILE\.lab\<lab>"; New-Item -ItemType Directory -Force $L | Out-Null
   # install the skills (INSTALL.md, "Dev boxes"), then copy drop.mjs from the installed skills into $L
   Set-Content "$L\drop.json" '{ "url": "<url>", "key": "<key>", "base": "<commit>" }'
   node "$L\drop.mjs" get brief-base-<host>.md "$L\brief-base.md"   # retry each minute until the hub's drop answers
   ```

   It sets the box's settings, runs the pilot, starts the box's flush loop detached
   (`node <lab home>/drop.mjs flush --loop 60`), creates the box's variation sessions (step 4), builds the base, and
   delivers `base-<host>.md`: the URLs, ports, browser channel and gotchas.
3. **The kit author,** when the lab has a shared kit: a second session on the hub. It builds the kit on the base
   branch and sends it with `drop.mjs send kit <branch>`; the `kit-latest.txt` that appears is "kit ready" for every
   box. A lab whose variations only add their own files (Component Explorer fixtures, for example) needs no kit.
4. **Every variation at once, in Phase 0, created on its own box.** The hub and each base call `create_session` once
   per variation, with the exact text of `prompt-<kind>.md` from the drop and the model. As child chats of the hub or
   as independent sessions, both worked. Create one, check that it fetched its brief, then create the rest, and
   record every link in `status.md`. Phase 0 is study and plan only: read the rules and the code, study today's UI
   once the box's base serves it, write a plan in the lab home and deliver it as `<kind>-plan.md`. No worktree and no
   lab code yet. This uses the hour the base (or kit) takes and still pins the base before anyone builds.
5. **Audit the settings.** About ten minutes later, the hub and each base read every new session's `events.jsonl`
   on their box (`session.start`, `session.model_change`, `session.permissions_changed`) and put a table on the
   drop (`audit-<box>.md`): model, reasoning effort, context tier and allow-all, one row per session.
6. **Phase 0 ends in a wait on a file, not a message:** for example `drop.mjs wait kit-latest.txt --timeout 14400`,
   or a loop that checks for the box's `base-ready.txt` in one command of up to nine minutes, repeated. No session
   waits to be told.
7. **Hand over.** The hub keeps `status.md` with every session's link and state, starts its loop (section 9), and
   the launcher tells the user the lab runs on its own now, so the laptop can close.

Repo-specific build steps (a docs clone before the install, a production install for the built server) belong in
the base brief. When the repo is the same as last time, start from the last lab's base brief.

## 5. Briefs on disk, short prompts

- Generate the briefs with `scripts/make-briefs.py` from one template, the variations table, the rules and the
  per-host notes. Host them on the drop and start each session with a short prompt that fetches its own brief.
  Pasting long briefs into `create_remote_session` fills the launcher's context and dies with the session.
- Keep generated files in their own folder, apart from the templates: a cleanup glob for `brief-v*.md` once deleted
  `brief-variation.template.md`.
- [`lab-brief-template.md`](lab-brief-template.md) has the optional Phase 0, drop and per-host blocks and the start
  prompt.

## 6. The drop: one channel, files only

OneDrive is not a channel: files took over 10 minutes to leave the laptop and never reached the boxes. GitHub is not
one either when nothing may be pushed, and boxes may not be signed in. So files move through the hub's drop
(`drop-server.mjs` behind a dev tunnel, or a folder on one box) with `drop.mjs`: bundles, text, small scripts and
review media (stills, videos, zips). These are the files that carry the lab:

| File | Written by | Read by | Meaning |
|------|------------|---------|---------|
| `drop.mjs`, `brief-<kind>.md` | the hub | each session, at its start | the client and the brief |
| `base-<host>.md` | each base session | the hub, the sessions on that box | the box's base is up: site, ports, browser |
| `kit-latest.txt` and `kit-<sha7>.bundle` | the kit author (`send kit`) | everyone | the newest kit; its arrival is "kit ready" |
| `<kind>-plan.md` | each variation, in Phase 0 | the hub | the plan |
| `<kind>-latest.txt` and its bundle | each variation (`send`) | the hub's watcher | the first look, then the final |
| `<kind>-report.md` | each session, replaced each time | the hub | state, commit, URL, blockers, the time; the heartbeat |
| `<kind>-request-<n>.md` | a variation | the kit author | a kit request: what, why, the smallest change |
| `orders.md` | the hub | every session, at each phase boundary | later instructions, numbered, each for a kind or for everyone |

- **Deliveries go through the outbox.** `send` and `put` queue first; exit code 3 means queued, not failed. One
  detached `drop.mjs flush --loop 60` per box delivers whatever waits whenever the hub answers, so an unreachable hub
  or reviewer never blocks or loses work.
- **Sessions read the hub's files at every phase boundary:** `drop.mjs recv kit <repo>` (merge `refs/lab/kit` when
  it moved) and `drop.mjs get orders.md`, which lands in the lab home's `in/` (no file means no orders).
- **The key** lives in `drop.json` and the hub's key file only. Never print, commit, log or message it; it dies with
  the tunnel at teardown.

## 7. Git bundles

- `drop.mjs send` bundles a branch on top of the lab's base, a commit every box has (`base` in `drop.json`), as
  write-once `<kind>-<sha7>.bundle`, then moves `<kind>-latest.txt` (commit, bundle name, SHA-256) to it.
- Receivers check before they fetch (the SHA-256, then `git bundle verify`) and fetch into `refs/lab/<kind>`, never
  into a checked-out branch. `drop.mjs recv` and `drop-sync.sh` do both.
- Never state an exact commit as a requirement. The kit moves on (tools come in a later kit commit), so write "the
  kit at `<sha7>` or a newer one that contains it" (`git merge-base --is-ancestor <sha> refs/lab/kit`).

## 8. Messages: few, queued, never load-bearing

- `send_remote_message` only queues, first in first out; the target reads it when its current turn ends. Steering
  works only between sessions on the same host. So everything a session needs is in its brief, and its phases end
  in waits on files.
- Final answers are not forwarded: sessions report through the drop.
- A chat waiting in `ask_user` receives nothing, so the launcher never asks while sessions report.
- `get_remote_session` returns a snapshot (status, queued messages, the latest turn text): use it to confirm that
  something arrived, not to poll.
- Creates and messages share the budget, so batch whatever must go out, and send nothing a file can carry.

## 9. The hub's loop and the review

- **The hub loops on files.** It runs `drop.mjs wait --change --state <run>/seen.json --match
  "latest|report|plan|request" --timeout 3600`, handles what changed, and starts the next wait. When the shell tool
  moves the wait to the background, the hub ends its turn, which also lets queued messages in, and the wait's
  completion notice wakes it. If a wake-up is ever missed, nothing breaks: sessions depend only on files, and the
  next message or ping resumes the hub. Keep each round's output short.
- **Each round:** pass kit requests to the kit author (it is on the same box), look at each new first look on the
  review server (headless, at 1440x900 and 390x844), write follow-ups into `orders.md`, update `RUN.md` and the
  status, and flag sessions whose report is older than their phase allows, with the start prompt that restarts them.
- **The review watcher:** `drop-watch.sh`, detached on the hub, merges every delivered bundle into the review
  worktree (`drop-sync.sh`) and keeps the review server up. The user opens it through the tunnel's review port, which
  stays private so they sign in, or on the box itself. A laptop may run its own `drop-watch.sh` with `LAB_PULL` as a
  mirror, but nothing may depend on it.
- The review page from `SKILL.md` section 9 works unchanged on the review worktree.

## 10. The ledger

- `RUN.md` in the hub's `run/`: the boxes and their roles, session links, paths and ports, the drop's URL (never the
  key), the files of section 6, every process started with its PID, the next steps and the teardown.
- The launcher's session table (`lab_sessions`: id, role, host, link, kind, port, status) keeps the links the user
  needs to reopen any session.

## 11. Teardown (only when the user says the lab is done)

- **The hub:** `devtunnel delete <id> -f`, then stop the drop server, the tunnel host, the watcher, the flush loop and
  the lab servers by their recorded PIDs.
- **Every other box** (the user is present: message its base session, or start a short teardown session): stop the
  PIDs it started, delete `~/.lab/<lab>/` (its `drop.json` holds the key), and delete the `refs/drop/*` and
  `refs/lab/*` refs.
- Keep the variation worktrees and the review worktree until the pick is ported.

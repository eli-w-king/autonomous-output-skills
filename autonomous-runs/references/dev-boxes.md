# Dev boxes, remote agent hosts, and Windows

Read before starting sessions on other hosts, moving work between machines, or validating on Windows.

---

## Optional Windows validation

**Windows is an optional validation target, not a tax on every autonomous run.** When native Windows
behavior would strengthen the result (Windows-only regressions, focus, hover, keyboard and
accessibility behavior, or a reviewer who needs real Windows media), run the same scenario on a
Windows dev box or Cloud PC. The `autonomous-demos` toolkit works there natively; see "Recording Code
OSS on Windows" in [`references/recording.md`](recording.md). The calling skill keeps
ownership of the design or research decision.

- Prove that the Windows build contains the change before interpreting screenshots.
- Dry-run the full state matrix before recording, and verify each still shows the state its name says.
- Compare surfaces side by side when the bug is a visual inconsistency.
- A CDP capture shows only the page. Native caption buttons, real DPI scaling, and OS high contrast need
  the real window and a person to look at it; say so in the notes rather than simulating them.

---

## Remote agent hosts and dev boxes

Facts about sessions on dev boxes (remote agent hosts reached over dev tunnels) that cost a whole lab to learn.
The procedure, starting with the rule that such a lab runs on its own with its hub on a dev box, is in
[`autonomous-variations/references/distributed-labs.md`](../../autonomous-variations/references/distributed-labs.md).

**The session tools.**
- `create_remote_session`, `send_remote_message` and `get_remote_session` are client tools: they work only while an
  Agents window shows the calling chat. When that window crashed mid-launch, every call failed with "No client is
  connected", and a locked screen blocks Computer Use, so nobody could click Reopen.
- `create_session` starts a session on the same host, and it works from a session on a dev box with no laptop
  involved. Use it to let each box start its own sessions: as child chats of the caller (the default) or as
  independent sessions. Called without `model`, the new session sometimes inherits the caller's model, reasoning
  effort and context tier, and sometimes does not: of four chats one caller started in a row, the fourth came up on
  Sonnet with no effort or context set, and a later one came up on the caller's model at medium effort. Called with a
  model id, it started at medium effort. Verify every new session (rule 7 in [`SKILL.md`](../SKILL.md)).
- `create_remote_session` starts a session on another host, chosen by `hostId` (from `list_agent_hosts`, which also
  shows each host's cores, memory and load) or picked automatically. `requirements` can ask for CPUs, memory or a
  platform. It returns once the prompt is accepted. Never retry an uncertain creation: check first, or there will be
  two sessions.
- `create_remote_session` starts a session with the host's default permissions, not the creating chat's. Its model
  is only `{provider, id}`, with no context tier or reasoning effort. Without a model, one started on Sonnet; with
  the second approved model, one started at medium effort and the default 272k context; in one lab the sessions it created still
  ran at the launching chat's max effort and 1M context. There is no per-session way to set effort or context
  remotely, so audit every one and give work only to the sessions that pass. A workspace has to be trusted first ("The
  workspace is not trusted. Trust it before starting an unattended session."); sessions without a workspace work,
  with absolute paths in the brief.
- Sub-agents started with the task tool keep an explicit `model`, `reasoning_effort` and `context_tier` (the agent
  type's own default is a small model at low effort), but a new user turn in the parent cancels them. Keep long
  work in sessions, not sub-agents.

**Checking and setting model, effort and context.**
- The settings a session really runs at are in its `events.jsonl`: every `user.message` carries
  `data.responsesReasoning` with the `model` and `effort` of that turn, and a sub-agent's `subagent.configured`
  event has its `model`, `reasoningEffort` and `contextTier`. `session.start` can show no effort at all for a
  session that runs at medium, so read the turn, not just the start.
- Copilot CLI's user defaults (`~/.copilot/settings.json`: `model` `claude-opus-5.5`, `effortLevel` `max`,
  `contextTier` `long_context`, and `subagents.agents.<name>` with all three set to `inherit` for each built-in
  sub-agent) make a `copilot` run started with no flags, and every sub-agent it starts, use the top settings
  (tested). The skills sync sets them once on each machine and keeps the old values (`sync-skills.py cli-defaults
  --undo`). The VS Code agent host did not pick them up while it was running: a `create_session` child without a
  model ran at medium, and a task sub-agent without arguments ran a small model at low effort. In agent-host
  chats, keep passing the model, effort and context on every task call.
- With the same `create_remote_session` call and model, sessions on one host started at max and on another at
  medium. The first thing to compare is `chat.agentHost.copilot.modelCapabilityOverrides` (for example
  `{"claude-opus-5.5": {"reasoningEffort": "max"}}`) in each machine's VS Code user settings; the host reads it
  from the VS Code window that runs it.
- `send_remote_message` only queues, first in first out. The target reads it when its turn ends, so a long turn
  sees nothing new. `send_message` can steer a running turn, but only between sessions on the same host.
- A steered `send_message` can vanish without an error: of six sent to one chat during a turn that ran for hours,
  three never arrived, and a queued one waited for the turn to end. Ask the receiver to acknowledge (or check its
  log with `get_session_context`), and send again when nothing comes back.
- A remote session's final answer is not forwarded. It reports with `send_remote_message` to session `"origin"`,
  the chat that created it. That fails while the origin chat waits in `ask_user` (in Autopilot, `ask_user` returns
  "not available"), and a laptop chat that is asleep cannot receive at all.
- `create_remote_session` and `send_remote_message` share a limit of 50 requests per window; one lab hit it at
  about 45.
- `get_remote_session` returns one snapshot: the status (`running`, `needsInput`, `completed`), `queuedMessages`
  and the latest turn's text. Use it to confirm that a message arrived, not to poll.
- A host's sessions see the skills installed on that host, in its own `~/.copilot/skills`. While a VS Code window
  is connected to the box, it also forwards the laptop's personal skills (`~/.copilot/skills`, `~/.agents/skills`,
  `~/.claude/skills`) and its extension and plugin skills as "VS Code Synced Data" (VS Code `includeUserStorage`
  for remote agent hosts, Insiders 1.140). Sessions started without that window (automations on the box,
  `create_remote_session`, anything after the laptop closes) cannot count on it, and MCP servers in the laptop's
  `~/.copilot/mcp-config.json` are not forwarded. So keep each host's own install current: the skills sync
  (`tools/sync-skills.py` from the skills repo, INSTALL.md "Add the machine") installs and updates them once a day
  and at logon, so a skill change made on one host reaches another at that host's next daily run. Run
  `sync-skills.py sync` on the other host to get it sooner.

**Sandbox and approvals.**
- Hosts differ. On one, a filesystem sandbox denied writes outside the allowed paths with no prompt ("Access
  denied", curl exit 23), and the sessions reported the error and stopped. On another, approval prompts parked the
  sessions in `needsInput` until someone approved them by hand.
- Turn "allow sandboxing" off and set allow-all (Autopilot) before the fan-out, in the user settings of the VS Code
  that hosts the box's agent host (`%APPDATA%\Code - Insiders\User\settings.json`): `chat.agent.sandbox.enabled`
  (recent builds have no separate Windows key), `chat.permissions.default`, `chat.defaultConfiguration`, and
  `chat.agentHost.copilot.modelCapabilityOverrides` with `reasoningEffort` per model. The agent host takes its root
  config from a connected VS Code window, so a box's `settings.json` alone did not change the effort of new sessions
  there; the laptop's settings do not reach a box either.
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
- But never from a script whose output a caller reads through a pipe: with `-Redirect*`, Start-Process creates the
  process with handle inheritance, so the server inherits the caller's pipe and `pwsh -File sync.ps1 | Select-Object`
  never returns. Start servers from such scripts through ShellExecute (Start-Process with no `-Redirect*`, for
  example `cmd.exe /c "node serve.mjs ... > log 2>&1"` hidden) and read the server's PID from its listener
  (`Get-NetTCPConnection -State Listen -LocalPort <port>`).
- Node reads a lab server's script once. When a kit merge changes `serve.mjs`, restart your own server; keep the
  script's SHA-256 next to the PID to notice.
- Run `git config --global core.longpaths true` before deep worktrees.
- Read a scheduled task's next run time from `schtasks /query /tn <name> /fo LIST /v`. Two days after the
  clocks changed, `Get-ScheduledTaskInfo` showed a daily 11:00 trigger's next run as 12:00 while
  `schtasks` showed 11:00; the trigger itself was right.
- With no Chrome, headless Playwright runs with `channel: 'msedge'`.
- The drop's bash scripts run in Git Bash (`C:\Program Files\Git\bin\bash.exe`). They avoid `lsof` and fall back
  from `sha256sum` to `shasum`, but so far they have been tested on macOS only.

**Sign-ins on each machine.**
- Conditional Access blocks the Azure CLI's device-code sign-in on these managed machines. Run `az login` in the
  box's own desktop session (a visible PowerShell window on the box, not an agent shell), after
  `az config set core.login_experience_v2=off`. The Windows sign-in window closes without any message when it
  succeeds; check with `az account show`. Then `azd config set auth.useAzCliAuth true`, so azd reuses that sign-in.
  An agent cannot finish this alone: hand it to the user when they are at the box.
- Ask before creating Azure resources (storage accounts, apps, identities) in a shared team subscription, even with
  the rights to: they bring compliance follow-ups for the subscription's owners and upkeep for the user. Prefer
  something that already exists, or something local.
- Verify the official WorkIQ plugin and a minimal read on each host before unattended work
  ([INSTALL.md](../../INSTALL.md), "Check prerequisites"). Authentication is host-managed; do not assume it
  carries across machines. If sign-in or tenant consent is requested, complete it through that host/admin
  while the user is available. Missing tools alone do not establish an authentication error.
- Outset's sign-in and the research keys are per machine too: see "Credentials" in
  [`autonomous-research`](../../autonomous-research/references/platforms.md).

**Shell traps.**
- macOS `/bin/bash` is 3.2: under `set -u`, `"${arr[@]}"` on an empty array is an "unbound variable" error. Write
  `${arr[@]+"${arr[@]}"}`, and test with `/bin/bash`, not whichever bash comes first on PATH.
- A cleanup glob can match a template: `rm -f brief-v*.md` also deleted `brief-variation.template.md`. Write
  generated files into a folder of their own, and never glob-delete next to sources.
- Test a sync script with fake bundles in a scratch clone and scratch refs before the real run.

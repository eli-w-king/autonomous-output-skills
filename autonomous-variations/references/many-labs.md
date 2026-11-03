# Many labs at once

Section 9 of [`autonomous-variations`](../SKILL.md): running several labs together. The standing rules there apply.

## 9. Many labs at once

- One lab per decision, each started from a brief built on
  [`references/lab-brief-template.md`](lab-brief-template.md) and saved to the run
  folder.
- New chats follow "Every new session runs on the top model" in
  [`autonomous-runs`](../../autonomous-runs/SKILL.md) (max effort, largest context, verified
  before they work). Detached servers, briefs on disk, early commits, message delivery and turn
  endings are there too.
- One owner per asset (a lab, a shared component, a set of illustrations). Send requests to the
  owner, never a duplicate to someone else, and relay through the owner. Every message is
  self-contained: hashes, paths, placement, what changed.
- Give the user one review page that walks every lab in product order, one at a time or side by
  side, switches device and motion, lets them pick, like and note, and ends with a prompt naming
  each pick precisely (lab, id, title, branch, commit, link). Keep every lab's own link. Spec:
  [`references/review-page.md`](review-page.md).

### Across dev boxes

When the sessions run on dev boxes (remote agent hosts) so the user can close the laptop, follow
[`references/distributed-labs.md`](distributed-labs.md). What matters most:

- **The lab runs on its own.** The hub is a dev box: the orchestrator session, the file drop and its tunnel, the
  review worktree and the ledger live there, and the laptop only starts the run and reviews it. Prefer one big box;
  then the kit is a local branch and the drop a folder.
- **Started on a dev box, that session is the hub.** It updates the skills, launches everything while the user is
  there, and never needs the laptop again. Every box needs the skills installed (the repo's INSTALL.md, "Dev
  boxes").
- **Settings first, proven by a pilot.** Each box's first session sets sandboxing off, Autopilot with allow-all, and
  max reasoning for the requested model in that box's settings, then proves them with a pilot. Sessions run without a
  workspace.
- **Each box starts its own sessions.** The launcher creates only the hub and one base per spoke; they create their
  box's variation sessions with `create_session` from prompt files on the drop, so a closed, locked or crashed laptop
  cannot stop the launch. An audit of each session's `events.jsonl` confirms the model, effort and context.
- **Files, not messages.** Briefs live on the drop and each session starts from a short prompt that fetches its
  own. Kit readiness, later orders, reports and kit requests are files, and a phase ends in a wait on a file.
  Creates and messages share a budget of about 50 per window.
- **Phase 0 fan-out.** Every variation starts at once to study and plan while the kit is built; nobody writes lab
  code before `kit-latest.txt` exists.
- **Deliveries never block.** Bundles are based on a commit every box has and checked before they are fetched. They
  go through an outbox that a flush loop on each box delivers whenever the hub answers. Never state an exact commit
  as a requirement: "this kit or a newer one that contains it".

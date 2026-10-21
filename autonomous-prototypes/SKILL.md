---
name: autonomous-prototypes
description: "Autonomous: Prototypes and PRs. Build, iterate, and ship UI changes autonomously in real code: VS Code (Code OSS from microsoft/vscode, Agents and editor windows, Component Explorer fixtures), the VS Code website, and codicons. Covers a worktree from the latest upstream main, confirming the real component, putting new concepts behind experimental settings with v1/v2 or Design A/B variants, keeping changes surgical, polish passes, opening ONE Code OSS window so the user can try or live-demo it, then shipping: branch, draft PR with before/after and demo media, reviewers and assignee, failing checks, Copilot review comments, merge conflicts, and marking ready. Use for 'make a branch off main and build X', 'revise the UI', 'open OSS so I can try it', 'put it behind a setting', 'push to my branch', 'open a draft PR', or 'fix the checks and Copilot comments'. Pairs with autonomous-variations (options to pick from), autonomous-demos (recordings), and autonomous-long-runs (overnight work)."
---

# Autonomous: Prototypes and PRs

Turn a design ask into working UI in the real product, let the user try it, iterate, and ship it as
a clean PR, without the user having to babysit. Demos of the result follow
[`autonomous-demos`](../autonomous-demos/SKILL.md); sets of variations to pick from follow
[`autonomous-variations`](../autonomous-variations/SKILL.md); unattended multi-hour work also follows
[`autonomous-long-runs`](../autonomous-long-runs/SKILL.md). Code OSS build, run, and component
gotchas are in the glossary reference [`code-oss.md`](../autonomous-skill-glossary/references/code-oss.md).

## Standing rules

1. **Real code in the real component.** Never mock VS Code UI in HTML. Prototype inside Code OSS
   (or a Component Explorer fixture of the real component). Confirm the exact component before
   building (grep a string from the user's screenshot, name the file and class).
2. **Start from the latest upstream.** New work branches from current `microsoft/main` in its own
   worktree. Continuing work rebases on upstream main when the user asks or the base is stale.
3. **Surgical by default.** Change only what was asked. "Replace the icon and text" means the
   animation, pulse, spacing, and behavior stay exactly as they were. Keep the parts the user
   liked when they reject the rest, remove something completely when they say it should be gone,
   and never add UI the brief leaves out. "Start over" means rebuild from the original ask, not
   patch the rejected version. Before calling it done, diff the branch and confirm nothing else
   moved.
4. **New concepts go behind an opt-in experimental setting.** Variants are an enum on that setting
   (`v1`, `v2`, or `designA`, `designB`) so the user can switch live; building v2 never changes v1.
5. **The user's notes and transcripts are the source of truth** for names and terminology. When they
   misspeak, the transcript wins; when names are pending, use the names the latest notes specify.
6. **Make it look native and premium.** Product tokens, codicons, theme variables, real spacing and
   radii. Every round ends with a polish pass: alignment, spacing, separators, text weight, density,
   hover and focus states, both themes. The user's recurring taste (motion, alignment, footprint)
   is in [`references/design-taste.md`](references/design-taste.md).
7. **Let the user try it.** When a round is ready, open ONE Code OSS window with the right settings
   on, and leave it open. Stop your own stale instances first. Never open and close windows
   repeatedly, and never touch the user's own VS Code windows.
8. **Ship cleanly, and only when asked.** Commit locally as you go, but push, open or update PRs,
   upload media, or post issues only when the user asks for it (or the brief says so); "don't push"
   always wins. Draft PRs are scoped to the change, with before/after images and the demo, reviewers
   and assignee as asked, checks green, review comments addressed and resolved.

## 1. Understand the ask

- Read everything the user attached: screenshots, meeting transcripts, notes, earlier sessions.
  List the decisions (names, states, levels, copy, availability rules) before writing code.
- Settle the interaction contract up front (entry points, what clicking an item opens, what may be a
  modal); see the glossary's IA contract section. Ask only if the user is present and it truly
  blocks; otherwise decide, and record assumptions to confirm.
- When the user asks to review a plan first, write a short plan (not a long one) to
  `~/Desktop/<Feature> Plan.txt`, `open` it, and wait for approval.

## 2. Set up the worktree

```bash
cd ~/Code/microsoft-vscode
git fetch microsoft main
git worktree add -b eli/<area>/<slug> ../microsoft-vscode.worktrees/<slug> microsoft/main
cd ../microsoft-vscode.worktrees/<slug>
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use "$(cat .nvmrc)"
npm install && npm run compile
```

- Branch names: `eli/<area>/<slug>` (for example `eli/agents/session-list-polish`) unless the user
  names one. Remotes in the main checkout: `microsoft` is microsoft/vscode, `origin` is the user's
  fork. Push to `microsoft` for PRs to microsoft/vscode unless told otherwise.
- To continue someone's PR: `gh pr view <n> --repo microsoft/vscode --json headRefName,body` (the body's
  how-to-test lists flags), then a worktree tracking that branch.
- Seeding `node_modules` from a sibling checkout and other build traps (foundry native download, stale
  `monaco.d.ts`, rate-limited built-in extension sync) are in the glossary `code-oss.md`.
- Load the vscode repo skills the change needs before editing: `accessibility` for interactive UI,
  `ux-css-layout` for CSS and layout, `ux-theming` for colors and tokens, `sessions` for
  `src/vs/sessions/**`, `component-fixtures` for Component Explorer, and read the checkout's
  path-specific instructions.

## 3. Build

- Implement in the real component. For explorations ("brainstorm a few options", "5 options"),
  build them as Component Explorer fixtures next to the component and hand the user the group URL
  (`http://localhost:<port>/___explorer?fixture=<group>`), served from your worktree with
  `npm run serve-out-rspack` (never the shared server task, which kills other agents' servers).
  The count, the baseline, the checks, rounds, and porting the pick follow
  [`autonomous-variations`](../autonomous-variations/SKILL.md).
- Settings: `chat.<area>.<feature>` style ids, default off, `tags: ['experimental']`. Variants as an
  enum. Document the ids in the round's notes and the PR.
- Prototype-only behavior (scripted responses, a SKU or plan switcher, simulated states) lives behind
  the same setting or a dev command, never in default code paths, and is labeled as prototype in
  every deliverable.
- Validate before showing anyone: `npm run typecheck-client`, `npm run valid-layers-check`, hygiene
  and stylelint, focused unit tests (`npm run transpile-client` first, then `./scripts/test.sh
  --grep <area>`), fixtures render. Skip heavy suites while the user is live-demoing.

## 4. Let the user try it

- "Open OSS" means: stop the Code OSS instances you own (`autonomous-demos/scripts/stop-demo-oss.mjs`;
  never the user's own VS Code), compile, then launch one visible window
  with the feature settings on (the repo `launch` skill, or
  `autonomous-demos/scripts/launch-demo-oss.mjs --mode visible` for a scripted prototype), signed in
  when the flow needs real models. Leave it open and say which settings are on.
- If the user is demoing live, do nothing that steals focus or CPU (no test runs, no rebuilds) until
  they say so.
- When asked "what branch is this" or "how do I open it", write `~/Desktop/<Feature> - how to open.txt`
  with the worktree path, branch, commit, settings, launch command, and Component Explorer URL, then
  `open` it.

## 5. Iterate

- Each feedback round: update the decisions list, change the code, polish, validate, then show the
  result the way the user asked (open OSS, screenshots for approval first, or a demo per
  `autonomous-demos`). Keep earlier variants intact unless told to replace them.
- Write round notes when asked: an engineering list of concrete call-outs ("removed Copilot from the
  tab title", "added a lock next to plan-locked levels"), and, separately when asked, a short
  PM-level summary of decisions. Plain bullets, respect the requested count, no marketing tone, and
  no process narration ("we recorded a demo").
- When the user asks to commit or save the work ("save this on a branch so others can try it"),
  commit with a clear message; when asked to make a final config its own component, extract it.

## 6. Ship the PR (when the user asks)

```bash
git push -u microsoft eli/<area>/<slug>
gh pr create --repo microsoft/vscode --draft --base main --head eli/<area>/<slug> \
  --title "<Imperative summary>" --body-file pr-body.md --reviewer <login> --assignee @me
```

- Scope check first: `git diff --stat microsoft/main...HEAD` must show only the intended files (no
  screenshots, recordings, scratch scripts, or session artifacts). Split unrelated work into its own
  PR ("open a separate PR for making the codicon consumable").
- PR body: what and why in a few lines, before/after images per state, the demo (GIF or MP4) when
  asked, how to test (settings and steps), and any prototype-only parts. Upload media with the
  `github-pr-media` skill (GitHub user-attachments) when available; otherwise follow the glossary's
  GitHub publishing section. If the user says a GIF is enough, remove the extra video.
- Checks: `gh pr checks <n> --repo microsoft/vscode`; read failures with
  `gh run view <run-id> --repo microsoft/vscode --log-failed` and fix the real cause (the repo
  `fix-ci-failures` skill helps). Distinguish failures caused by the change from flaky or
  pre-existing ones, and say which is which.
- Copilot and human review comments: fix what is right, push, then resolve those threads; reply
  briefly on any you decline. List unresolved threads and resolve one by id:

```bash
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved path comments(first:1){nodes{author{login} body}}}}}}}' -f o=microsoft -f r=vscode -F n=<number>
gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<threadId>
```

- Merge conflicts: rebase on `microsoft/main`, redo the change if the surrounding code moved (keep it
  as simple as the ask), rerun validation, `git push --force-with-lease`.
- Mark ready (`gh pr ready <n> --repo microsoft/vscode`) only when the user asks ("move it from draft
  to a real PR", "mark ready for review").
- Report: PR link, branch, what changed in a few bullets, check status, anything left open.

## Websites

- Work in a worktree of the site repo (for example `~/Code/microsoft-vscode-website.worktrees/<slug>`)
  on the branch the user names. Respect constraints like "keep the header unchanged" and "don't push".
- Variants: follow the site's mechanism (for example a query parameter such as
  `?variant=homepageVersion:v2`) and give the user the exact local URL; open it in Safari when asked.
- Several takes on one section or interaction to pick from ("six ways the blog section could sit"):
  one variation lab per decision, in its own worktree, per
  [`autonomous-variations`](../autonomous-variations/SKILL.md).
- The site should feel like VS Code: VS Code fonts, colors, corner radii, shadows, blur, and real
  VS Code UI (embedded or captured), never imitations.
- Wireframe requests ("draw it out as simple boxes") get a separate branch from the current work.

## Codicons

1. Design the SVG first (16x16, `currentColor`, matching the Fluent-style family it extends) and save
   it to the Desktop for review; iterate on spacing and glyph placement until approved.
2. PR to `microsoft/vscode-codicons` following its `.github/skills/build-new-icons/SKILL.md` (icon in
   `src/icons`, mapping, and build). Same name and an updated SVG when revising.
3. After it merges and publishes, consume it in vscode with a separate PR that bumps the
   `@vscode/codicons` version in `package.json` and switches the usage (for example `report` to
   `report-question` for sessions that need attention).

## Gotchas (details in the glossary `code-oss.md`)

- Relaunch, do not reload, after TS changes; reloads degrade dev instances.
- `TMPDIR=/tmp` when launching; kill only numeric pids you own; never `pkill`.
- `export const enum` imported across files breaks the dev ESM build (blank workbench).
- The Agents window disables non-built-in extensions unless allowed in product configuration.
- `npm run transpile-client` before unit tests, or they run the previous build.
- Component Explorer popup fixtures render in one theme tile at a time; capture in embedded mode.

## Maintaining this skill

Fix wrong steps in place, add reusable gotchas to the glossary, keep the description under 1024
characters, and never use em or en dashes.

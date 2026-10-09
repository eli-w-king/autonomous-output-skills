# Glossary: study platforms and browser drivers

Reusable facts for authoring studies and driving research web apps from a dedicated browser. Part of the
[`autonomous-skill-glossary`](../SKILL.md); used by `autonomous-user-studies` and
`autonomous-research-synthesis`. Platform API details (Outset, Marvin, User Interviews) are in
[`research-platforms`](../../research-platforms/SKILL.md).

---

## Outset study authoring

**Outset authoring is API calls, not browser driving.** Use the Outset MCP through
[`research-platforms`](../../research-platforms/SKILL.md). UserTesting studies are still built in
the UserTesting web builder (next section), and recruiting for Outset studies often runs in the
User Interviews web app; both procedures live in the
[`autonomous-user-studies`](../../autonomous-user-studies/SKILL.md) skill.

Auth, the client, and the platform gotchas live in
`research-platforms`. Read that before calling Outset. The three
facts that cost the most time when they were unknown:

- Outset **REST** auth is `Authorization: Api-Key <key>`, not `Bearer`.
- Outset **REST** paths require a **trailing slash**: `/v1/studies/` works, `/v1/studies` 404s.
- Outset **MCP** is a separate surface with separate OAuth auth; the REST API key is rejected there.
  The ~129 real authoring and analysis tools are on MCP.

**The agent cannot launch a study, by construction.** The stored token is minted without the
`studies:launch` scope, so `launch_recruitment` and `publish_study` are absent from the tool list.
Do not try to obtain a broader token, and do not drive the Outset UI in a browser to click Launch.
Both defeat a deliberate safety property. A human launches.

**Synthetic participants are guide QA, never findings.** `generate_synthetic_responses` runs
LLM-simulated participants to smoke-test a guide. Their answers are a model's prior about a persona,
not evidence. Never cite one; always filter harvests to `interview_types: ['USER']`.

**No em/en dashes** in any study text; write "1 to 7", never with a long dash.

---

## Driving the UserTesting.com builder (shadow-DOM SPA)

**It is a shadow-DOM / custom-element app; DOM scraping finds nothing.** `document.querySelectorAll`
returns empty for the editable fields and most controls. Use Playwright role/text locators which
pierce shadow DOM.

**The Add-panel item is a `menuitem` role (this is the key selector fact).**
`getByRole('menuitem', {name:'Image'})` matches **exactly one** (the panel item), whereas
`getByText('Image', {exact:true})` matches several (panel item + rendered step cards + type
labels). Use the role for panel items: `getByRole('menuitem', {name:'Image'|'Verbal response'|'Instructions'})`.

**Every Image "Question page" needs at least one question element or launch validation fails.**
The Review tab shows *"To launch, please resolve … Logic skips participants forward. Include
another question or task to add logic."* Fix: add a question to each image page. A **Rating
scale** ("how clear is X? 1..5") both satisfies validation and yields quantitative data. The
in-page **Add question** menu offers Rating scale (Verbal response is NOT available there, only
in the left Add panel).

**Rating scale defaults to 1-5, not 1-7.** Word the prompt as "1 is …, 5 is …". If you need
1-7, either change the scale or move it to a spoken prompt on a Verbal step.

**Editable fields have no stable placeholder in the tree; identify by current value.** Image
pages seed the instruction textbox with the literal value `Image`; a fresh Verbal seeds an empty
`Add your question`. Select the target box by `inputValue()` (e.g. the one equal to `"Image"`),
not by index. After filling, re-list all `getByRole('textbox')` values to confirm nothing got
clobbered, and scan for a stray appended fragment (fast typing sometimes appends junk like
`"…?didn"`).

**Verify the step-count delta.** Adding a panel item can silently no-op; then your "fill the
new field" code overwrites the PREVIOUS step. Read *"Tasks & questions: N"* before and after
each add and confirm it incremented.

**Swapping an Image page's image:** there are as many `Delete image` buttons as image pages;
target by index. Click `getByRole('button',{name:'Delete image'}).nth(i)`; if the overlay
intercepts, fall back to a deep shadow-DOM JS click on the element whose `aria-label` is
`delete image`, press `Enter` to confirm, then the `Upload image` control reappears for a fresh
`filechooser` upload. The instruction seed reverts to `Image`, so refill it.

**Create-from-scratch flow:** Create test > **hover** (do not click) "Think-out-loud test" so the
right flyout opens > "New experience" > intro modal "Create a test" > name dialog "Create". Do
it in one script; use `.click()` on modal buttons; poll `page.url()` for `/test/`.

**Reordering steps is unreliable to automate.** Add steps in their final order from the start;
do not build then try to drag/move (I left a terminology question after the wrap-up because the
move never registered).

**Preview link works even before validation is fully clean.** The deliverable is the Preview
link (`participant.*.usertesting.com/px/#/preview/pre-study?participantId=…`) + the Review link.
Launch stays human-gated regardless.

**No em/en dashes** in any study text; write "1 to 7", never with a long dash.

---

## Persistent driver + dedicated Chrome (survives shell churn)

**`/tmp` is wiped between bash shells in this runtime.** A driver dir with `node_modules`
installed in `/tmp` can vanish, forcing a 2-4 min `npm i playwright-core` reinstall. Keep the
driver in the **session `files/` folder** (persists across shells and checkpoints), e.g.
`~/.copilot/session-state/<id>/files/ut-driver/`.

**A Chrome launched inline dies when its parent bash shell ends.** Launch the dedicated
debug Chrome **detached** (the bash tool's `detach: true` async mode) so it persists. Give each run
its own profile and debug port; a shared browser is a legacy fallback, not the default:

```bash
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9333 --user-data-dir="/tmp/ut-chrome-profile" \
  --no-first-run --no-default-browser-check --hide-crash-restore-bubble "<url>" \
  >/tmp/chrome-ut.log 2>&1 &
```

Login persists in `--user-data-dir`, so relaunching to the same profile keeps you signed in.

**Pin YOUR tab by its CDP target id, not URL/title.** Prefer one Chrome per run. If a shared
Chrome is unavoidable, other agents use it too, and SPAs (UserTesting, Outset, User Interviews)
rewrite URL/title as you navigate, so URL/title markers are unreliable. Capture the tab
once and match it by `Target.getTargetInfo`:

```js
// find my tab among all pages
for (const p of ctx.pages()) {
  const s = await ctx.newCDPSession(p);
  const { targetInfo } = await s.send('Target.getTargetInfo');
  await s.detach().catch(()=>{});
  if (targetInfo.targetId.toUpperCase() === savedId) return p;
}
```

Re-save the id after any relaunch (it changes). Assert you are on your own study id before any
write, and when cleaning up close only tabs whose URL contains your study id / your preview
`participantId`, never the whole browser.

**Keep an ownership receipt.** In the project `run.json`, record every process this run starts:
purpose, numeric PID, CDP port, target id, profile path, URL, and cleanup state. Before any navigation,
focus, close, or kill, match the live target back to that receipt. Never use name-based process kills,
repurpose an existing tab, or "clean up" a window merely because it looks related. If ownership is
unclear, leave it alone and start a new isolated target.

**Node on PATH:** fresh shells do not have node; source nvm each time
(`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use <.nvmrc>`).

**Keep a reusable CDP driver kit in `files/`, do not rewrite it each run.** Every run needs the
same small helpers: connect over CDP, find the workbench page (`ctx.pages().find(p =>
/workbench.*\.html/.test(p.url()))`, falling back off DevTools pages), snapshot state
(`page.evaluate` reading a few selectors), click by selector, run a command palette command
(open palette, type, Enter), and escape overlays. Writing these from scratch every session is
pure tax. Park them once in the session `files/` driver dir next to the recorder
(`caploop.js`) and reuse. A one-call state probe (see Building / running Code OSS in [`code-oss.md`](code-oss.md)) that returns
`{ hasHeaderActions, hasSidebarSection, bodyText }` is the most valuable helper.

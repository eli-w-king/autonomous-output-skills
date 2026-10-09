# Storyboards and marketing demos

How to build a demo storyboard (annotated PDF plus recordings) for a website or marketing story.
Distilled from the VS Code website v21 storyboard, v3 through v11 (September 30 to October 7, 2026),
where the narrative changed many times and the capture approach did not.

## Narrative rules (what the reviewers converged on)

1. **Tell one developer's workflow, not a feature tour.** Organize by the user's goal, never by
   product surfaces (model picker, MCP, skills, plugins, customizations). A storyline that worked:
   start from a design, delegate implementation, run work in parallel, pull information from
   external tools, resolve issues, deliver working results.
2. **One idea per frame.** If a frame still says the same thing after removing half its text, remove
   it. A first-time visitor should understand the story in under 30 seconds.
3. **Show outcomes, not configuration.** Bad: "Open MCP settings." Good: "Agent pulls the design from
   Figma." Do not show the Customizations modal, model configuration, or setup screens at all.
4. **At most two things on screen.** Chat and editor, session list and one session, one session and
   its diff, or session and PR. Proportions: chat 1/3 and editor 2/3, session list 1/3 and session
   2/3, session and PR 50/50.
5. **Orchestration through states, not panes.** Show parallel work as a session list with sessions at
   different phases (Working, Needs input, Complete, PR) across about four repos while one session
   stays open. One session flips to Needs input; click it to replace the open session (not side by
   side); answer a single question with four options; let it continue.
6. **Lead with the everyday editor** when the message is "VS Code is for everyone": ordinary editing,
   a refactor, a debugging session (breakpoint, variables, call stack, a fix, passing tests), then the
   Agents window.
7. **Realistic scenarios outside AI/chat code.** For example a TypeScript extension, a debugging
   scenario, an Azure DevOps pipeline session. Public demos must imply the product works.
8. **No highlight or dimming overlays.** The only dimming allowed is the product's own modal backdrop.
   The only post-production overlay is the subtle blue cursor with a click ripple.
9. **Hover states only, never tooltip text.**
10. **Rejected directions, do not repeat:** an invented sample app with stand-in UI (v5 "Planventure"),
    four simultaneous panels, a tour of customization modals, vertically stacked sessions when the
    default is side by side.

## Capture

- Real Code OSS from a current upstream build, Dark 2026 (or the one requested theme), Modern UI,
  compact, `sessions.chat.experimental.newSessionComposerLayout`, file explorer hidden, Agents side
  panel closed (the final PR overview is the only exception), Customizations collapsed, Aquarium off.
- Square recordings for storyboard video (1000 x 1000 CSS pixels at 2x). Record a square viewport;
  do not crop a wide one.
- Continuous takes per pillar. Waiting and off-camera setup are compressed with in-place speed ramps,
  and every speed change or cut is documented in the PDF appendix.
- Real data where it matters: real refactors, debugger sessions, agent turns, worktrees, commits, and
  a real GitHub PR. An external system that cannot be contacted (for example Azure DevOps) may be an
  illustrative local mock MCP server with realistic data, documented as such, so the real integration
  can be dropped in later.
- Demo repos live in a neutral location (for example `/Users/Shared/demo`) with neutral terminal
  prompts, so no personal paths or names appear.
- Native window stills (title bar, traffic lights, shadow) come from `screencapture -x -l <CGWindowID>`
  of your own off-screen window (see the glossary recording reference); CDP screenshots have no window
  chrome. Captures never include the OS pointer; composite the demo pointer or describe it per beat.

## The PDF

- **No cover page.** Start with one thumbnail overview page per pillar or scene.
- **One page per beat** with the real frame and five fields: Action, On screen, Focus, Pointer,
  Timing.
- **Appendices:** setup (build, commit, OS, window size, theme, settings, demo repos), speed changes
  and cuts, and anything illustrative or mocked.
- **One theme everywhere,** including the PDF chrome.
- A structured `storyboard.json` (pillars, beats, the five fields, frame paths, timings) is the
  source of truth, and the HTML/PDF is generated from it (headless Chrome print), so copy or timing
  changes regenerate instead of being rebuilt by hand. Keep full-resolution frames in a
  `screenshots vN/` folder next to the PDF.
- QA every page: no overflow or clipping, every image identical to its source frame, page count as
  expected, overview thumbnails in order.

## Versioning

- Each feedback round is a new version (`v6`, `v7`, ...) in its own folder. Replace the previous PDF
  only when asked ("you can replace the v3 pdf"), and keep a page map so "remove 28 to 31" is applied
  to the right beats.
- When the user says "start over", start from the brief, not from the last version's assets.
- Write the rules you are following into a `.txt` next to the PDF when asked, numbered and grouped
  (on screen, story, real data, how it was recorded, the PDF).

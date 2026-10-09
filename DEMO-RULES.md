# Demo rules

Standing rules for every demo an agent makes: videos, screenshot sets, before/after pairs,
storyboards, and PR media. They were compiled from the feedback given across the demo sessions of
September 24 to October 9, 2026 (promotion package, website storyboard v3 to v11, session presets,
compare models, Auto/Ensemble effort picker, needs-attention strings, chat-to-sessions, continuity
issue, Component Explorer captures) plus the two rule files those sessions produced
(`demo-recording-instructions.txt` and `VS Code storyboard - rules I'm following.txt`).

The [`autonomous-demos`](autonomous-demos/SKILL.md) skill enforces these rules and turns them into a
brief, a recording pipeline, and a QA checklist. An explicit instruction in the current request
always wins over a default here; record the override in the demo's brief.

## The short version

1. Real product UI only, never mocked or painted over.
2. Never show an error, warning, toast, or sign-in prompt. Fix the setup and retake.
3. One story told through outcomes, not a feature tour or a tour of settings.
4. The full flow from a clean start: new session, typed prompt, every state to the result.
5. The full relevant window, at most two focal areas, file explorer and side panel closed.
6. Modern UI, compact, new session composer layout, Dark 2026, one theme for every asset.
7. Visible pointer with deliberate clicks and a subtle blue click ring. No random zooms.
8. One continuous take. Fast-forward only idle waits, in place. Hold key moments long enough to read.
9. Watch the whole export before delivering it. Anything that breaks a rule gets redone.
10. Deliver to a Desktop folder with a short `Read me.txt`, open it, delete superseded versions.
11. Never steal focus, never touch other agents' windows, never need the user mid-run.
12. Never cut corners. If something cannot be shown honestly, say so instead of faking it.

## Truth

1. **Real product only.** Every pixel comes from the running build: Code OSS built from
   `microsoft/vscode`, the real website, or the actual prototype. Never recreate, mock, or paint over
   UI. A browser page never stands in for the desktop app.
2. **Never show errors.** No error or warning toasts, failed tool calls, extension-host toasts,
   sign-in prompts, 404s, console overlays, model warning glyphs, or broken states. If one appears,
   fix the setup and retake. Never edit it out in post.
3. **Accurate to the product you claim.** A "how it works today" demo uses a clean upstream build and
   records only what it really does. Missing behavior goes into a gaps list, not into the video.
   Prototype demos may use scripted responses; the `Read me.txt` and PR say so.
4. **Current facts.** Use current, non-deprecated models; built-in themes are preinstalled (never
   show a Marketplace install for them); use the latest agreed terminology. When unsure how something
   behaves, check upstream code instead of guessing.

## Story

5. **One story, told by outcomes.** Organize around a user's goal, not product surfaces. Show tools
   being used ("the agent pulls the design from Figma"), not settings, modals, or configuration.
6. **The full flow from a clean start.** Start a new session from scratch, type the prompt, send it,
   and show every state through to the result. No skipped states, no stale sessions, no jumping to a
   different session partway through.
7. **Realistic and compelling.** A believable task with real content: mid-session states, resized
   layouts, and parallel sessions where they matter. Public demos show a product that works and is
   improving, not one fixing its own bugs.
8. **Comprehensive when asked to cover a feature.** Show every state (for sessions: working, needs
   attention, queued, completed, cloud and remote, and so on) in every surface that has it, for
   example both the editor window and the Agents window.
9. **One idea per beat.** A newcomer should always know where to look. Cut text and UI that do not
   serve the beat; a marketing storyboard should read in under 30 seconds.

## Composition

10. **Frame the full relevant window.** Do not crop it into something that looks like a mockup. Tight
    crops are only secondary detail shots.
11. **At most two focal areas.** Chat and editor (about 1/3 and 2/3), session list and one session
    (1/3 and 2/3), session and PR (50/50). Switch between sessions instead of tiling many of them.
12. **Clean chrome.** File explorer hidden, Agents window side panel closed, Customizations
    collapsed, Aquarium off, menus closed unless they are the subject, no notifications.
13. **Standard look.** Modern UI and compact density,
    `sessions.chat.experimental.newSessionComposerLayout` enabled, Dark 2026 unless another theme is
    requested, and one theme across every asset in a set (video, stills, PDF).
14. **A living sidebar.** When the session list is visible, fill it with sessions at different
    phases across several repos (about four).

## Motion and pacing

15. **Visible, deliberate pointer.** Eased glides and clear clicks with a subtle blue click ring.
    Use controls the way a person would: click the model in the list instead of searching for it.
16. **No random zooms.** Prefer no zoom at all. Zoom only when legibility truly requires it.
17. **Hover states without tooltip text**, unless the hover content is the feature being shown.
18. **Let it breathe.** A calm 2 to 3 second lead-in and lead-out, holds long enough to read every key
    moment, and prompts typed at a human pace.
19. **One continuous take.** Fast-forward only idle waiting, in place, with speed ramps instead of
    cuts. Never splice different sessions or takes into something that looks continuous.

## Delivery and QA

20. **Masters.** H.264 MP4, about 1920 x 1200 (or the requested size, such as square), 30 fps, plus
    full-resolution stills. GIFs only for PR previews and short loops.
21. **Watch it before you ship it.** Review the entire export, a contact sheet, and the frames around
    every hover and menu; `ffprobe` it and decode it fully. Redo anything that breaks a rule.
22. **Screenshots.** Full window plus a tight crop (whitespace trimmed) for details. Before/after
    pairs cover every relevant layout and setting, and no menu covers what is being compared.
23. **Iterations.** For revision rounds, share screenshots for approval first, then record videos.
    Label variants and phases clearly (title cards or file names, for example per plan or Design A/B).
24. **Desktop delivery.** One folder per project with `Round N - <what changed>` subfolders, the
    videos, `Stills/`, and a short `Read me.txt` (what changed, what is real versus scripted, branch
    and commit). Open the result. Delete superseded versions unless asked to keep them.
25. **Plain notes.** Straightforward bullets within any limit given, no marketing tone, and no
    narration of the process ("we recorded a demo").
26. **Never cut corners.** Take the time the work needs. If something cannot be shown honestly, say so
    in the `Read me.txt` instead of faking it or skipping it silently.

## Working on a shared Mac

27. **Never steal focus or interfere.** Record invisible or off-screen windows driven over CDP, keep
    one persistent demo window, and never touch other agents' windows, ports, or sessions.
28. **Never need the user mid-run.** Use the mock keychain for scripted demos and never trigger OS
    prompts. When the user is away, skip and log blockers. When the user is present and a sign-in is
    truly required, open a `.txt` with the exact steps.
29. **Ready for a live demo when asked.** Stop stale Code OSS instances you own and leave one window
    open on the starting state.

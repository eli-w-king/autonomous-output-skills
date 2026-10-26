# Demo video capture, encode, and pacing

Detail for Phase 5 of [`autonomous-research-synthesis`](../SKILL.md). Moved here to keep the
skill lean; the rules are unchanged. General demo rules live in
[`autonomous-demos`](../../autonomous-demos/SKILL.md).

Use the composited `caploop.js` path only when the integrated browser preview (a native overlay)
must be in frame:
- Use `caploop.js <cdpPort> <outDir> <seconds> [fps=12] [scale=2]` to record the **workbench**
  target. Run with `NODE_PATH="$REPO/node_modules"` so `ws` resolves.
  - **Why not startScreencast:** `Page.startScreencast` only captures the page's own layer, i.e. just
    the embedded browser preview's webContents, NOT the whole window. `Page.captureScreenshot` with
    `fromSurface:true` (what caploop uses) composites the native overlay into every frame. This is the
    single most important gotcha in this phase.
  - `scale=2` on a retina display yields ~4x the CSS resolution (very crisp).
  - **Crop math: caploop frames are `dpr × scale` times the CSS size** (on a retina 2x display with `scale=2` that is 4x). So a panel at CSS `x=520,y=36,w=293,h=570` maps to an ffmpeg `crop=1172:2280:2080:144` (multiply every number by 4). Read the actual frame dimensions with `ffprobe` on one `.jpg` before writing the crop, and get the CSS rect with a `getBoundingClientRect()` eval on the running window. That said, prefer a full-window demo over a cropped one (see Standing rules in the skill); crop only when explicitly asked.
- To animate content INSIDE the preview (e.g. navigate a slide deck), use
  `presskeys.js <cdpPort> <preview-url-substr> ArrowRight <count> <delayMs>`. This targets the
  preview's own CDP target directly, because `@playwright/cli` snaps to the focused tab and cannot
  reliably reach the embedded preview.
- Drive the workbench itself (focus chat, paste a prompt to show the control loop) with the `launch`
  skill's playwright patterns (`monaco-paste.sh`, `Control+Meta+i` to focus chat). Show the full flow
  (prompt typed and sent) per the demo rules; if a live agent run would have side effects, use a
  scripted mock (`autonomous-demos`) instead of stopping short.

Web capture: use the target repo's existing browser recorder when available. Otherwise, drive only
the run-owned page and capture timestamped full-viewport frames with Playwright `page.screenshot()`;
write the timestamps to the same manifest format consumed by `frames-to-mp4.sh`. Record navigation,
scroll, pointer, and keyboard actions through visible Playwright APIs, not DOM mutation.

Encode:
- `frames-to-mp4.sh <outDir> <PROJECT_DIR>/new-ui-demo.mp4 1920` (uses the manifest's real
  timestamps so motion timing is faithful; outputs yuv420p + faststart).
- `frames-to-gif.sh <outDir> <PROJECT_DIR>/new-ui-demo.gif 1000` for the inline fallback.

ffmpeg lives at `/opt/homebrew/bin/ffmpeg`; `export PATH="/opt/homebrew/bin:$PATH"`.

**Pace for humans, do NOT aggressively dedupe.** Reviewers complained that clips felt "rushed" and too fast to follow. Two rules:
- Build the pacing into the **driver**, not the encoder: put deliberate `sleep`s between steps (e.g. ~3s to read the first screen, ~2s after each action, ~2s after typing) and type text at a **human delay** (`keyboard.type(text, {delay: 95})`, roughly 80-110ms/char). A good full flow is ~20-25s, not 3-5s.
- Encode with timestamps (`encode-screencast.py` or `frames-to-mp4.sh`). **Avoid `mpdecimate` or blanket `setpts` to "trim dead air"**: it collapses the natural holds a viewer needs. Fast-forward only marked idle waits, in place, with `speed-ramp.mjs`; if a clip drags anywhere else, re-record with better driver timing.

**Drive with real physical actions, not injected DOM clicks.** When recording (caploop) and driving the same window over CDP, use Playwright's physical APIs on the visible element (`locator(sel).last().click()`, `.selectOption(...)`, `keyboard.type(...)`). Fire-and-forget in-page `el.click()` / setTimeout choreography frequently updates a **hidden** DOM node while the visible UI never changes, so the recording shows nothing happening. Physical clicks/keystrokes always hit the topmost rendered element.

**Overlay/modal apps: relaunch fresh instead of re-triggering.** For flows shown as an overlay (e.g. the sessions/onboarding walkthrough), repeatedly running the dev "reset/show" command **stacks multiple overlays**; a `.last()` locator then targets a stale hidden copy. A fresh Code OSS launch starts with exactly one (or zero) overlay. Verify with `document.querySelectorAll('.<overlay-class>').length === 1` before recording; if a password/secret field won't visibly accept typed characters over CDP, capture that state as a **static screenshot** instead and lean on the video for the rest.

**Clear dev-build toasts/banners before (and during) recording.** A Code OSS dev build pops toasts that would never ship, most often *"Extension host did not start in 10 seconds, that might be a problem."*, plus the *"Run tasks in the background with the Copilot CLI"* banner and update/telemetry prompts. None of these may appear in the demo video. Run `workbench.action.clearNotifications` (F1) and dismiss any inline banner right before caploop starts, and confirm the status-bar notification bell is empty. The ext-host toast can reappear ~10s after launch/reload, so clear it again immediately before the take (or wait for the ext host to finish starting); do not record around it.

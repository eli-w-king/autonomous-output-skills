---
name: autonomous-user-studies
description: "Autonomous: User Studies. Set up unmoderated user studies end to end without supervision and stop at a review-ready draft: UserTesting.com think-out-loud tests (browser builder) and Outset.ai AI-moderated interviews (Outset MCP), recruiting through the platform panel or User Interviews. Captures the real target (Code OSS, a website, or a hosted prototype) as stimulus, writes non-leading spoken questions built for quotable answers, builds fraud-resistant screeners (trap answers, attention checks, coherent logic, at most 5 questions), verifies every link and video, and launches only on the user's explicit okay (Outset publishing stays with the human by OAuth scope). Also monitors, diagnoses stalled studies, and pauses to edit. Use for 'run a user test', 'set up a UserTesting study', 'create an Outset study', 'recruit on User Interviews', or 'get user feedback on <feature or website>'. Needs research-platforms for Outset; pairs with autonomous-research-synthesis."
---

# Autonomous: User Studies

Turn a one-line research topic, for example *"how do people react to the redesigned model picker"*
or *"how do developers read the current VS Code homepage"*, into a **review-ready study** with zero
human clicks up to the launch gate:

1. **Plan** the brief: topic, surface, platform, audience, participants, length, success criteria.
2. **Capture** stimulus from the real target (Code OSS, the deployed website, or the actual prototype).
3. **Author** the study in UserTesting (browser builder) or Outset (MCP).
4. **Screen and recruit**: a tight, fraud-resistant screener on the platform or in User Interviews.
5. **Validate and hand back** a draft with preview/review links and the all-in cost. **Do not launch.**
6. **Launch only on the user's explicit okay**, then monitor, fix, and hand results to
   [`autonomous-research-synthesis`](../autonomous-research-synthesis/SKILL.md).

> **HARD RULE, real target surface.** App features are captured from Code OSS launched from
> `microsoft/vscode`, never an HTML recreation. Website studies use the real deployed site (or the
> actual hosted prototype, pinned to a version). A browser is fine for websites and for driving
> UserTesting, Outset, and User Interviews; it never stands in for the desktop app.

> **HARD RULE, launch gate.** Building, validating, and costing are autonomous. Recruiting real paid
> participants is not: launch only after the user explicitly says so ("launch it", "you can launch
> when it's fixed"). "Set it up" or "make a study" means stop at the draft and send the links.

Platform plumbing (Outset and Marvin auth, the client, API gotchas, User Interviews builder facts)
is in [`research-platforms`](../research-platforms/SKILL.md). Browser-driver and builder gotchas are
in the glossary [`studies.md`](../autonomous-skill-glossary/references/studies.md). Capture technique
is [`autonomous-demos`](../autonomous-demos/SKILL.md) (study-stimulus profile).

---

## Choose the platform

| | UserTesting.com | Outset.ai |
|---|---|---|
| Format | think-out-loud, screen + audio recorded | AI-moderated interview with adaptive probing |
| Authoring | web builder (shadow DOM) driven from a dedicated Chrome | Outset MCP tools (API calls) |
| Stimulus | JPEG/PNG/GIF per question page (no MP4) | images or video attached to questions |
| Recruiting | UserTesting audiences | panel providers (`USERINTERVIEWS`, `PROLIFIC`, `RESPONDENT`) or a native User Interviews project that funnels to `outset.ai/start/<id>` |
| Launch | agent clicks Launch only after an explicit okay | withheld from the agent by OAuth scope; a human publishes |
| Best for | think-out-loud tasks on a live site or prototype; reactions to screens | probing reasons; quotable spoken answers |

Use the platform the user names. Otherwise pick by the question (behavior on a page: UserTesting or
Outset `SCREENSHARE`; reactions and reasons: Outset `VOICE`) and say why. Both may run in parallel
(for example prototype reruns on UserTesting and a website baseline on Outset).

## Inputs

| Input | Example | Notes |
|-------|---------|-------|
| `TOPIC` | "reactions to the redesigned model picker" | The research question in plain English. |
| `SURFACE` | `agents`, `editor`, `website`, `prototype` | Infer from the topic. `WINDOW` is an alias for app studies. |
| `TARGET_URL` | deployed site or hosted prototype | Required for web studies; record URL and version. |
| `FEATURE_FLOW` | "open picker, toggle Auto, send a prompt" | Steps to capture; derive from the topic if omitted. |
| `PLATFORM` | `usertesting`, `outset` | See the table above. |
| `PARTICIPANTS` | `5` | As requested; default 1. Never more than 7 unless the user says so. |
| `AUDIENCE` | "mostly engineers who use AI coding tools, some non-developers" | Shapes the screener. |
| `LENGTH` | "about 35 minutes" | Fit the guide to it. |
| `INTERVIEW_METHOD` | `VOICE` | Outset only; see Phase 2B. |
| `STUDY_ID` / `WORKSPACE_URL` / `PROJECT_ID` | existing study | Edit instead of creating new. |
| `ACCOUNT_EMAIL` | UserTesting or User Interviews login email | The agent may type it; never a password. |
| `TRACK_IN_GITHUB` | `true` | Optional project card per study. |

If something required is missing and no reasonable default exists, ask once (only when the user is
present); otherwise state the assumption and continue.

## Plan first, then build

Resolve the brief before capturing anything: arc and end state, the happy path, meaningful states,
the realistic prompt or goal, the one or two things being probed, edge states, preconditions, who
should test it, what success looks like for each question group, and any features to ask about that
are not in the stimulus ("gauge how people respond"). Then flow straight into the build.

When the user wants to see questions first ("let's just see the questions first"), write the guide
and screener to a short `.txt` on the Desktop, `open` it, and wait. The templates in `chatmodes/` add
a native Plan to Agent handoff (`handoffs:` with `send: true` auto-fires under Autopilot); the launch
gate is never behind an auto-send handoff.

## Credentials

- **UserTesting and User Interviews:** the agent may type the account **email** into the sign-in
  form. The human enters the password and any 2FA; never ask for, type, store, or log them. Prefer
  an already signed-in dedicated profile. Do not persist the email anywhere.
- **Outset and Marvin:** secrets live in `~/.copilot/research.env` (mode 600) and are read by the
  `research-platforms` client. Never echo them. On `invalid_grant`, run
  `node ~/.copilot/skills/research-platforms/scripts/outset-auth.mjs`; the human approves the device
  code.

## Prerequisites

- App studies: a built `microsoft/vscode` checkout with the feature, the repo `launch` skill, Node
  from `.nvmrc`.
- Web studies: a reachable `TARGET_URL` and a version receipt (commit, deployment, or date).
- UserTesting or User Interviews: a dedicated Chrome over CDP with `playwright-core` (Phase 2A).
- Outset: `node ~/.copilot/skills/research-platforms/scripts/probe.mjs` reports REST and MCP green
  and `token cannot launch studies`.
- `ffmpeg`, `jq`, `git`, `gh`, `curl`.

---

## Phase 1, Capture the stimulus

Skip this phase when verified real-target media already exists (for example a demo recorded with
`autonomous-demos`); `artifacts.json` must prove where it came from.

### 1.1 Project folder and ledger

```bash
SLUG=$(echo "$TOPIC" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-' | cut -c1-40)
MEDIA="$HOME/Desktop/Automated User Testing/$SLUG"; mkdir -p "$MEDIA/frames"
```

Create `run.json`, `decisions.md`, `artifacts.json`, and `resume.md` there immediately and keep them
current (glossary: run ledger). No credentials, participant PII, or private transcript text in them.

### 1.2 Study-stimulus capture rules (always)

- **Real target, pinned version.** App: Code OSS from the feature build, signed in with the user's
  real profile (verify the avatar; no "Sign in" modal), launched with the `launch` skill. Web: the real
  URL in a dedicated browser profile at one stable viewport; record redirects and the final URL.
- **Look:** Dark 2026, Modern UI, a current model (a Claude model by default), consistent window size
  across frames (about 1280x800 is fine), 2x pixels.
- **Static screenshots are the primary stimulus.** Participants feel rushed by looping GIFs. One
  large, legible screenshot per meaningful state, cropped to the region with about 56 px of
  surrounding UI so it reads as part of the app (tight element crops read as cut-outs; tiny full
  windows are unreadable).
- **No pointer overlay or captions.** Park the mouse away from hover targets before each shot.
- **Clean frames:** no toasts, banners, sign-in prompts, or dev noise (clear notifications right before
  each shot). Wait for async UI to settle. End on an unambiguous success state.
- **Prefer the feature's own simulate or dev command** for voice, camera, backend, or agent states
  (for example `agentsVoice.simulateConnection`).
- **Privacy:** the user's own name is fine; no secrets, other people's data, or unrelated private repos.
- **Video stimulus** (only when motion is the question or the user asks): record per
  `autonomous-demos`, keep it short, validate it with `validate-video.sh`, and host it where it never
  expires (a GitHub Pages player page or a media repo), never a temporary signed URL. Check playback,
  seeking, and fullscreen in a fresh browser before attaching it.
- Verify every screenshot with the image viewer before moving on.

### 1.3 Capture, walkthrough, cleanup

Drive the target over CDP (see `autonomous-demos`), save `00-<state>.png`, `01-<state>.png`, ... into
`$MEDIA`, then:

```bash
D=~/.copilot/skills/autonomous-demos/scripts
"$D/make-walkthrough.sh" "$MEDIA"                                  # walkthrough.mp4 from the stills
"$D/mp4-to-gif.sh" "$MEDIA/walkthrough.mp4" "$MEDIA/walkthrough.gif"  # UserTesting accepts GIF, not MP4
```

Kill the Code OSS pid you started (numeric pid only). Record every stimulus with its checksum in
`artifacts.json`; never overwrite a stimulus between rounds, version it (`prototype-a-v2.mp4`).

---

## Phase 2A, Author in UserTesting

Put **each question on the same screen as its screenshot.**

### Drive UserTesting from a dedicated Chrome over CDP

```bash
MYPROFILE="/tmp/ut-chrome-profile"; mkdir -p "$MYPROFILE"
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9333 --user-data-dir="$MYPROFILE" \
  --no-first-run --no-default-browser-check --hide-crash-restore-bubble \
  --new-window "https://app.usertesting.com/" >/tmp/chrome-ut.log 2>&1 &
```

Use your own port and profile (never the shared chrome-devtools MCP profile other sessions use),
launch it detached so it survives the shell, sign in once (email yes, password no), and connect with
`playwright-core` `chromium.connectOverCDP`. Pin your tab by CDP target id and assert your study id
before every write. Open a new window per study when other agents are using Chrome.

### Builder facts that matter

- **Create from scratch:** Create test, **hover** (do not click) "Think-out-loud test" so the flyout
  opens, "New experience", intro modal "Create a test", name dialog (Device: Computer, Language:
  English), "Create". Do it in one script; poll `page.url()` for `/test/`.
- **Shadow DOM:** `document.querySelectorAll` finds nothing. Use role/text locators
  (`getByRole('textbox')`, `getByRole('menuitem', {name: 'Image'})` for Add-panel items), identify
  fields by current value, and click non-button controls via `getByText(...).boundingBox()`.
- **A Verbal response step cannot hold an image, and image pages cannot add a Verbal response.** Put
  the spoken question into the Image "Question page" instruction text ("tell us out loud: ...");
  keep image-less conceptual questions as Verbal response steps.
- **Every image page needs a question element** for launch validation; a Rating scale (defaults to
  1 to 5) satisfies it and adds structured data.
- **Verify the step-count delta** ("Tasks & questions: N") after every add; a silent no-op makes
  the next fill overwrite the previous step. Re-list all textbox values at the end.
- **Upload:** filechooser plus `setFiles`; JPEG, PNG, or GIF only. Swap images with "Delete image"
  then re-upload, and refill the reset instruction text.
- Add steps in their final order; reordering by drag is unreliable. The study auto-saves.
- Reconnect by calling `connectOverCDP` again; relaunch Chrome with the same profile if it died.

Selector-level details: glossary [`studies.md`](../autonomous-skill-glossary/references/studies.md).

### Live site or prototype tasks (behavioral studies)

Image pages measure reactions and comprehension, not navigation. When the question is how people
use a website or a hosted prototype, add **task** steps (the Tasks group of the Add panel) that send
participants to the pinned URL with one concrete goal per task ("find where you would start a free
trial"), keep the screen recording on, and follow each task with one or two spoken questions. Verify
the URL opens in a fresh browser at the participant viewport and record its version. Label the
evidence accordingly: behavior from tasks, reactions from image pages.

### UserTesting study shape

```
1. Intro (Instructions)              welcome, think-out-loud ask, file-issues pointer
2. Image: first screen + spoken ask  first impressions, what is this, where would you start
3. Verbal: terminology               is the naming clear (no image)
4..N. Image per captured state       2 to 3 spoken asks each
K. Optional GIF                      only when motion is what is being tested
last-1. Image: end state
last. Verbal: wrap-up                ease 1 to 7 with why, biggest confusion, one change
```

---

## Phase 2B, Author in Outset

```js
const { outsetMcp } = await import(`${process.env.HOME}/.copilot/skills/research-platforms/scripts/research-client.mjs`);
const outset = await outsetMcp();   // enumerate tools with outset.listTools(); they change
```

1. `list_projects` or `create_project` (`project_name`, `workspace_id`), then `create_study` with
   `study_name`, `project_id`, `interview_method`, `context`, `goals`, `language_code`,
   `welcome_message`, `end_message`. The study starts inactive (a draft, nothing billable).
2. **Interview method:** `VOICE` for spoken answers (enable fallback to chat so a bad mic does not
   lose a participant); `SCREENSHARE` when participants must walk a live site (set
   `enforce_no_video_for_screenshare: true` unless face video matters); `CHAT` for typed reactions.
   Never `INTERACTIVE` when visuals matter: the voice-to-voice client does not show stimulus.
3. **`context` and `goals` brief the AI moderator** like a human moderator: what the feature is, what
   you want to learn, what a good answer looks like. Do not leave them thin.
4. **Probing:** `deep_probing` has five levels. Use the deepest (ABYSS) on the one question the study
   turns on, Deep on comprehension and story moments, Standard elsewhere. Use the **Neutral**
   interviewer persona; upbeat acknowledgements bias people toward praise.
5. **Questions:** `create_section`, `create_question`; attach stimulus with `request_file_upload` then
   `update_question_stimulus`. Reuse assets via `list_stimuli`. `reorder_*` take the complete order.
   Use `delete_question_preview` before deleting (conditions can break).
6. **Self-correct before anyone sees it:** loop `check_guide_quality` (async; fix what it flags or
   note why you overrode a flag, for example deliberate matched pairs) and `validate_study` until
   `ready_to_publish: true`.
7. **Run Test interview** from the study settings menu to see what participants actually get (the API
   describes intent, not rendering), and record that interview id so it is excluded from analysis.
8. Synthetic responses (`generate_synthetic_responses`) are guide QA only, may bill, need the user's
   okay, and are never findings.

### Outset study shape

```
1. Welcome                         think-out-loud ask, issues pointer
2. Warm-up, real past behavior     "tell me about the last time you..."
3. First stimulus, first impression
4. Terminology check
5..N. One question per screen      stimulus attached, open stem
K. Walkthrough clip + reaction     "watch this, then tell us..."
last-1. Rating + why               1 to 7, always followed by the why
last. The change question
```

For a **live website** study: ask participants to share their **entire screen** (not a tab) before
starting, send them to the actual URL, let them explore while thinking aloud, then ask focused
questions about specific pages (homepage, product pages), comparisons where relevant, and the
change question. Design follow-ups to build on what they said while exploring instead of
re-asking it.

---

## Question rules (both platforms)

1. **Open, never closed.** What, How, Walk me through, Tell me about. Never Do you, Is it, Would you.
2. **Real past behavior beats hypotheticals.** "Tell me about the last time you..."
3. **One idea per question.** Compound questions get half-answered.
4. **Neutral, never leading.** No praise, no embedded answer, no "evidence that X is ahead".
5. **Expectation versus reality.** "What did you expect this to do? What actually happened?"
6. **A why after every rating.** A number without a reason is not a finding.
7. **Chase emotion and friction.** The most confusing, surprising, or frustrating moment, and why.
8. **Anchor to their world, and keep it AI-native.** Compare with the tools they use today (Cursor,
   Claude Code, Codex, GitHub Copilot, Google Antigravity), not legacy IDEs.
9. **Do not make them designers.** Ask about the need, not "how would you design this".
10. **Spoken, not written.** Use verbal responses; no written-response questions.
11. **Built for quotes.** Ask for specific moments and stories, the kind of answer a principal
    researcher would quote.
12. **Two to three asks per screen at most.**
13. **Escape hatches** ("none of these", "something else") on closed options.
14. **Probe instructions are for the moderator,** not a second question to the participant.
15. **End with the change question:** "If you could change one thing, what would it be and why?"
16. **No em or en dashes** anywhere in study text; write "1 to 7".

Canonical intro (adapt the surface name):

> Thanks for helping us explore an early build of the VS Code Agents window. There are no right or
> wrong answers here. We're testing the product, not you. The most useful thing you can do is think
> out loud: narrate what you're seeing, what you expected, and what surprises or confuses you, and
> why. Tell us stories from your own experience whenever they come to mind, and the more you talk,
> the more we learn. Have feedback afterward? File an issue at https://github.com/microsoft/vscode.
> Cheers, VS Code Team

Before handing over, have a background agent rubber-duck the guide: leading wording, repeated asks,
probing settings, and whether each question group maps to a success criterion.

---

## Phase 3, Audience and screener

**Who:** people who build software, including vibe coders, mostly people who use AI coding tools,
plus non-developers when the user asks for them. Match the tools list to the feature.

**Fraud resistance (broad pools plus incentives attract guessers):**
- One or two **fake tools** in every tool list (for example "Quillcode") that reject on selection.
- An attention check or instructed-response item.
- A short free-text "describe the last thing you built" for human spot checks.
- Exclude employees of Microsoft, GitHub, and competing tool makers.
- Narrow the funnel with targeting criteria; it is the stronger control (on User Interviews the
  "AI usage: Coding and software development" criterion is free and should be a key criterion).

**Disqualifiers and requirements:** recent VS Code use (current, lapsed, and never-used cohorts as
the study needs), tools used regularly, model use when relevant, a desktop or laptop that can share
the entire screen, consent to recording, a microphone, and a webcam if the method requires video.

**Coherence (check every cohort):** at most **5** questions; no answer path that contradicts another
(a "never used VS Code" cohort must have non-VS Code options in "which editor did you use in the last
30 days"); verify the participant-facing preview shows every choice; no empty answers.

**Platform mechanics:**
- UserTesting: Audience tab, reuse a fitting shared audience or create a clearly named, shared one;
  set the participant count (this does not recruit).
- Outset: `create_screener`, `add_screener_question`, `set_screener_option_statuses`, disqualification
  conditions, or apply and save templates. `set_recruitment_method`, `configure_recruitment`
  (`third_party_provider`, `max_assignments`), filters, and **`estimate_recruitment_cost`** for the
  all-in number (the `configure_recruitment` total excludes screen-out fees).
- User Interviews (native project funneling to an Outset link): seed from an existing project but
  audit inherited screener logic, use the builder facts in `research-platforms` (react-select,
  `may`/`must`/`reject` qualify logic, rate limits, step gating). Approval mode: automatic (first come,
  first served) when the user does not want to approve manually; quality rejection remains available.

---

## Phase 4, Validate and hand back (the default endpoint)

- **UserTesting:** Review tab shows no flags and Launch is enabled (do not click it); capture the
  **Preview link** and the **Review link**; leave it as a Draft.
- **Outset:** guide quality clean, `validate_study` ready, Test interview run, all-in cost known, study
  URL `https://outset.ai/project/<project>/survey/<study>/guide`. The participant link
  `https://outset.ai/start/<study>` shows "Study closed" until it is published; that is expected.
- **User Interviews:** every step green, Launch enabled, not launched.
- Open every stimulus link and video from a fresh browser; scan all text for em and en dashes.

Hand back: links, platform and method, participant count, cost, the screener summary and who it
targets, quality-check flags you overrode and why, assumptions, and a clear prompt: reply with
comments, or say okay to launch (with a count).

---

## Phase 5, Launch only on an explicit okay

- **UserTesting:** re-validate, set the count, click **Launch test**, confirm "Live 0/N". To edit a
  live study: Pause, edit, Resume from the Review page (safe while 0 completed; warn otherwise).
- **Outset:** the human publishes in the Outset UI (status control beside the title). Never seek a
  broader token or click publish through browser automation. While published, every API write is
  rejected; pausing in the UI makes it editable, and the human republishes.
- **Order matters:** publish the Outset study first, then launch the User Interviews project, so no
  recruit lands on a closed study.
- **User Interviews:** launch on the okay; a 422 about qualify logic means `accept` must be `may`; "remove
  any empty answers" means an empty option exists.
- After launching, record it in the ledger and the optional GitHub card.

---

## Phase 6, Monitor and fix

- Check participation after a few hours, then periodically. Judge completion against sibling studies
  with the same method; an interview stuck at one message is normal setup abandonment.
- Slow screenshare studies: the setup gate requires camera, microphone, and screen; macOS screen
  recording permission needs a browser restart. Prefer `enforce_no_video_for_screenshare: true` and
  screen for the camera explicitly when video is required.
- Your own walkthroughs of the participant flow create real interviews; note their ids and exclude
  them.
- Broken stimulus or screener: pause every affected study, fix (re-encode, re-host, simplify the
  screener), verify in a fresh browser, relaunch, and confirm no completed session saw the broken
  version.
- The results watcher (`research-platforms/scripts/watch-studies.mjs`) only polls and harvests by
  default. Never schedule anything that opens VS Code windows or downloads files on its own; the user
  found that intrusive. `--wake-agent` is opt-in.
- Hand completed studies to `autonomous-research-synthesis`.

---

## Optional GitHub Project tracking (`TRACK_IN_GITHUB`)

One shared "VS Code UX Research" project, one card per study with links, media path, count, audience,
and status (Needs review, Changes requested, Approved, Live, Done). Additive only; never block the
study on it. A labeled tracking issue is an acceptable fallback.

## Deliverables

- Media folder with stills, `walkthrough.mp4`, `walkthrough.gif`, and the ledger files.
- Study links (preview, review, study URL), platform, method, participant count, all-in cost.
- Screener summary, assumptions, overridden quality flags, and the status: **draft, not launched**,
  or after an approved launch, **Live N/M** with monitor links.

## Gotchas

- `TMPDIR=/tmp` when launching Code OSS; omit `--use-mock-keychain` for the signed-in variant.
- UserTesting media accepts JPEG, PNG, and GIF only.
- Outset REST needs `Api-Key` auth and trailing slashes; MCP uses OAuth and holds the real tools;
  some tools take `survey_id`, others `study_id`; `get_survey_state` omits some fields.
- `estimate_recruitment_audience` is capped and cannot compare filter sets; use the cost estimate.
- Kill only numeric pids you started; close only tabs you opened.
- More: glossary `studies.md` and `research-platforms`.

## Maintaining this skill

Fix wrong steps in place, put selector-level facts in the glossary and API facts in
`research-platforms`, keep the description under 1024 characters, and never use em or en dashes.

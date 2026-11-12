# Research platforms: Outset.ai + Hey Marvin

Verified end to end on 2026-07-24 against a live Outset organization.

This is the **plumbing layer** of [`autonomous-research`](../SKILL.md). It does not decide what to research; it makes the
two platforms callable and encodes the facts that cost hours to rediscover. Running a study and synthesis
depend on it.

> **Outset and UserTesting.com are both in use.** Outset authoring and harvesting are plain API
> calls (this reference). UserTesting studies are built in its web builder; that procedure lives in
> [`running-a-study.md`](running-a-study.md) and in `studies.md` in autonomous-runs.

---

## The 60-second orientation

| Need | Use | Auth |
|------|-----|------|
| List/inspect studies, quick checks | Outset **REST** | `Authorization: Api-Key <key>` |
| Author a study, read results, analysis | Outset **MCP** (129 tools) | OAuth Bearer (device flow) |
| Historical research across past studies | Marvin **MCP** (8 tools) | OAuth client_credentials |
| Import new data into Marvin | Marvin REST | **currently unavailable**, see Limits |

```bash
node ~/.copilot/skills/autonomous-research/scripts/probe.mjs        # verify everything works
node ~/.copilot/skills/autonomous-research/scripts/outset-auth.mjs  # (re)authorize Outset
```

```js
const { outsetMcp, outsetRest, marvinMcp } = await import(
  `${process.env.HOME}/.copilot/skills/autonomous-research/scripts/research-client.mjs`);

const outset = await outsetMcp();                       // OAuth handled + auto-refreshed
const studies = await outsetRest('/v1/studies/');        // note the trailing slash
const marvin = await marvinMcp();
```

---

## Safety property: the agent cannot launch a study

Recruiting real paid participants is a human decision. This is enforced **structurally,
not procedurally**: the stored OAuth token is minted **without the `studies:launch` scope**,
so `launch_recruitment` and `publish_study` are **absent from the tool list entirely**.

This is deliberately stronger than an instruction like "never launch". A prompt rule can be
lost to context truncation, overridden by a later edit, or subverted by injected text inside
a participant's free-text response. A withheld scope cannot.

The agent may still do everything up to the gate: author the guide, validate it, configure
recruitment, and compute the exact cost. It hands back a costed, validated draft; **a human
launches in the Outset UI**.

`probe.mjs` asserts this on every run and reports
`token cannot launch studies (studies:launch withheld)`. If it ever reports the opposite,
the token was minted with too much scope: re-run `outset-auth.mjs`.

**One exception: a research loop's launch connection.** When the user pre-approves launching for a
research loop with per-round and total caps ([`research-loop.md`](research-loop.md)), the loop keeps a
second, separate connection with `studies:launch` (`OUTSET_LAUNCH_CLIENT_ID` and
`OUTSET_LAUNCH_REFRESH_TOKEN`, from `outset-auth.mjs --launch`). Only the loop's two guarded scripts use
it: `launch.mjs` for `publish_study` and `launch_recruitment`, only after its budget check passes and is
written to the study's ledger, and `close.mjs` for `unpublish_study`, only to close a round that has
ended, after its guard and a ledger entry, with the result read back. The everyday token stays without the scope, and
`probe.mjs` still checks that. Without such a loop, nothing changes: a human launches.

---

## Credentials

All secrets live in `~/.copilot/research.env` (mode `600`). Never echo them, never paste
them into chat or an issue, never commit them. The clients read the file directly.

| Key | Meaning |
|-----|---------|
| `OUTSET_API_KEY` | Outset REST. From the Outset app. |
| `OUTSET_OAUTH_CLIENT_ID` / `OUTSET_REFRESH_TOKEN` | Written by `outset-auth.mjs`. Do not hand-edit. |
| `MARVIN_CLIENT_ID` / `MARVIN_CLIENT_SECRET` | Marvin Settings -> MCP. Expires 30-180 days. |
| `USERINTERVIEWS_API_KEY` | User Interviews API access enabled by an account admin. |
| `USERINTERVIEWS_ACCOUNT_EMAIL` | The account used for browser tasks; passwords and 2FA stay in the browser. |

If `research.env` is missing, copy `research.env.template` and fill it in.

**User Interviews API setup (checked November 11, 2026).** Its official
[authentication guide](https://api-docs.userinterviews.com/docs/authentication.md) documents the
`user-interviews-apikey` header and `Accept: application/vnd.user-interviews.v2+json`.
`node scripts/probe.mjs userinterviews` uses only
`GET https://www.userinterviews.com/api/recruits?page[size]=1`, refuses redirects, and reports status
without displaying keys or recruit records. This verifies read access, not permission to launch.
The [Recruit API guide](https://api-docs.userinterviews.com/docs/recruit-api-introduction.md) warns
that creating a Recruit can start recruitment, so never use creation as a connection test. The
existing browser workflow remains available for study-building tasks.

**Per machine.** Each machine (the Mac, every dev box) has its own `research.env` and its own Outset
sign-in: run `outset-auth.mjs` on that machine. Never copy `OUTSET_REFRESH_TOKEN` between machines;
it rotates on every use (gotcha 7), so two copies invalidate each other. The API keys are pasted on
each machine and never go in a repo or a synced folder.

---

## Gotchas that make these APIs look broken

These are the exact traps hit during discovery. Each one presents as "the API does not exist".

### 1. Outset REST auth is `Api-Key`, not `Bearer`

```
Authorization: Api-Key <OUTSET_API_KEY>     # correct
Authorization: Bearer <OUTSET_API_KEY>      # 401, misleading
```
The 401 body says *"Authentication credentials were not provided"* even when you sent a
header, because the keyword was not recognized. That message means **wrong scheme**, not
missing credentials.

### 2. Outset REST paths REQUIRE a trailing slash

`GET /v1/studies` -> **404**. `GET /v1/studies/` -> **200**.

The 404 reads like "no such endpoint" and sends you hunting for the real path. There is no
real path; you just dropped the slash. `outsetRest()` throws if you forget.

### 3. Outset REST and Outset MCP are different surfaces with different auth

The REST API key is **rejected** by `api.outset.ai/mcp`. MCP needs an OAuth Bearer token.
REST is a thin CRUD view (studies list/detail); **MCP is where the 129 real tools live**.
If you want to author or analyze, you want MCP.

### 4. Marvin's token needs BOTH `scope` and `resource`

```js
scope: 'mcp:read', resource: 'https://mcp.heymarvin.com'
```
Omit `resource` and the token is issued but rejected by the MCP server. Also: request
`mcp:read` **alone**; bundling it with REST scopes fails the whole exchange with
`invalid_scope` if the key lacks any one of them.

### 5. Both MCP servers reply as SSE, not JSON

Responses arrive as `data: {...}` frames. `await res.json()` throws. Parse the **last**
`data:` frame. `research-client.mjs` handles this; if you hand-roll a call, do not forget it.

### 6. Marvin ids must be STRINGS

`project_id: 12345` -> pydantic validation error. `project_id: '12345'` -> works.
`get_file_summary` needs **both** `project_id` and `file_id`.

### 7. Outset refresh tokens ROTATE on every use

Each refresh returns a **new** refresh token and invalidates the old one. Any process that
refreshes MUST persist the new value, or the next run dies with `invalid_grant`. This
already caused one outage during development: `probe.mjs` refreshed without persisting and
silently invalidated the stored credential.

**Therefore: never write your own refresh logic.** Always go through
`research-client.mjs`, which persists rotations in exactly one place. On `invalid_grant`,
re-run `outset-auth.mjs`. A refresh also revokes the access tokens other processes hold
(gotcha 23), so the client shares one access token per connection instead of refreshing at start.

### 8. The Outset web URL for a study says `survey`, not `study`

The API calls it a study and the MCP tools take `study_id`, but the web app routes it under
`survey`. There is no tool that returns the link, so build it:

```
https://outset.ai/project/<PROJECT_ID>/survey/<STUDY_ID>/guide
```

Valid suffixes are `` (overview), `/guide`, `/results`, `/settings`. Everything else 404s,
including the obvious guesses `/study/<id>`, `/study/<id>/edit`, `/project/<p>/study/<s>` and
`/build`. A wrong route returns a real 404, so you can tell routes apart by status code
without signing in.

Note some MCP tools take `survey_id` and others `study_id` for the SAME uuid
(`create_question` wants `survey_id`, `validate_study` wants `study_id`). Read each tool's
schema rather than assuming.

### 9. Voice-to-voice (`INTERACTIVE`) narrows what a study can contain

Three constraints, only the first two of which the API tells you about:

- **Stimulus is NOT shown to the participant.** The voice-to-voice client is a single
  centred column with a microphone control, with no side panel, so attached images and video
  never appear. The API happily reports the stimulus as attached, `list_stimuli` shows the
  binding, and `check_guide_quality` stops reporting `missing_stimulus`. **None of that is
  evidence that a participant can see it.** Both halves confirmed by running Test interview:
  `INTERACTIVE` reads the question aloud with no image on screen, while `VOICE` shows the
  stimulus normally. If a study depends on reacting to visuals, use `VOICE` (spoken answers,
  stimulus panel intact) or `CHAT`, never `INTERACTIVE`.
- **Only `TEXT` questions are allowed.** `validate_study` returns
  `question_type_not_supported_for_interview_method` for `RATING`, `MULTIPLE_CHOICE`, and the
  rest.
- **`interviewer_voice_engine` is forced to `SIMPLE`.** Setting `ADVANCED` silently reverts.
  Plain `VOICE` keeps `ADVANCED` and the voice catalog, so pick the method first, then the
  voice.

**Always run Test interview (study settings menu) before handing a study over.** It is the
only way to see what the participant actually gets. The API surface describes intent, not
rendering, and the two diverge exactly where it hurts most.

`list_interviewer_voices` requires `survey_id`; calling it without one returns an error
string, which is easy to mistake for "the voice is not in the catalog" if you are pattern
matching on the response.

Screener questions use a different enum from guide questions:
`SELECT_ONE | SELECT_MULTIPLE | TEXT | IMAGE_UPLOAD`, and they are unaffected by the
interview method.

### 10. A published study rejects every write, and you cannot unpublish it

Any edit to a published study returns:

> This study is currently published and cannot be edited. Use unpublish_study to take it
> offline first, make your changes, then publish_study to make them live again.

That advice is not actionable for an agent: `unpublish_study` and `publish_study` are
withheld from the token by the same scope that withholds launching, so they are absent from
the tool list. The error names tools you do not have.

The way through is the Outset UI, where the status control beside the study title offers
**Published / Pause / Close**. **Pause** is reversible and is what you want; **Close** is
terminal and is styled red. After pausing, `active` flips to `false` and every write
succeeds again. Pausing is safe to do autonomously when nothing is in flight; **republishing
is the human's job**, since it is the gated action, and any participant-facing
`outset.ai/start/<id>` link stays dead until they do it.

Note that most of these tools take **`survey_id`**, not `study_id`, even though everything
calls them studies. `validate_study` takes `study_id`. Passing the wrong one returns
`Missing required field(s) for <tool>: ['survey_id']`, which, if your helper swallows
errors into `{}`, looks exactly like a successful no-op. Print the raw response.

### 11. `o.call` returns a string, not an MCP content envelope

`await o.call(name, args)` resolves to the raw text. Do **not** reach for
`r.content[0].text`; that is `undefined`, and a `try { JSON.parse(...) } catch { }` wrapper
around it turns every response (including error responses) into `{}`. This silently
converted "this study is published and cannot be edited" into an apparent success. Parse the
string directly and let a bad parse throw.

### 12. `get_survey_state` omits fields it does not know about (found 2026-08-12)

`get_survey_state` does **not** return `screenshare_url`, `screenshare_enabled`, or
`rating_labels`, even when they are set. It does return neighbouring fields like
`figma_analytics_enabled`, so the omission looks exactly like "the write silently failed" and
will send you re-writing values that were already correct.

**Absence in `get_survey_state` is not evidence a field is unset.** To actually check, write a
*different* value with `edit_question` and read the returned `changes` array, which reports
`{field, old, new}`. The `old` value is the ground truth. Then restore it:

```js
const probe = JSON.parse(await o.call('edit_question', { survey_id, question_id, screenshare_url: 'https://example.com/wrong' }));
// probe.changes -> [{field:'screenshare_url', old:'<the real value>', new:'https://example.com/wrong'}]
```

A no-op edit is also diagnostic: `"No changes needed - Q4 already has the requested values"`
confirms the value matches what you passed.

### 13. Argument names are inconsistent across tools (found 2026-08-12)

Beyond the `survey_id` vs `study_id` split already noted, the *nouns* differ too:

- `create_project` wants `project_name` and `workspace_id`, **not** `name`. Get the workspace
  from `list_workspaces` first; there is no default.
- `save_screener_template` wants `study_id` and `template_name`, **not** `survey_id` and `name`.

The error is a clean `Field required` list, so read it rather than guessing the next permutation.

### 14. `estimate_recruitment_audience` is capped and cannot compare filter sets (found 2026-08-12)

On USERINTERVIEWS it returns 4,000,000 for an empty filter set and a flat **5,000 for every
non-empty filter set**, no matter how broad or narrow. It is a bucketed ceiling, not a count. Do
**not** use it to argue one filter set reaches more people than another, and do not quote it as
an audience size. Use `estimate_recruitment_cost` for the decision instead, which does vary.

Related: `provider_capabilities.charges_for_screenouts` is **false** for USERINTERVIEWS. The
standard "tight filters cost less overall because screen-outs are billed" reasoning is wrong for
this provider, and `screen_out_limit_usd` is silently ignored. B2B filters (Occupation, Skill,
Industry, Seniority, Company size) raise the per-participant reward materially: in one measured
case, adding a single B2B filter raised the all-in total by about a third.

### 15. Question labels renumber on insert (found 2026-08-12)

Outset labels questions by position (`Q4`, `Q10`, ...) and recomputes them on every insert. After
adding a question mid-guide, a tool response may say "Suggesting update to Q11" when you passed
the id of what you called Q10. **Ids are stable, labels are not.** Never key logic or logs off
the label, and do not panic when the echoed label disagrees with your numbering.

### 16. User Interviews native recruiting is priced differently from Outset's integration (found 2026-08-13)

Outset's `configure_recruitment` with `third_party_provider: USERINTERVIEWS` prices panel filters
into the participant reward: adding the B2B Occupation filter raised one study's all-in total by
about a third. **That pricing does not transfer to recruiting natively
in the User Interviews web app**, where the project shows `Recruit rate 0.00` and adding
recruitment criteria costs nothing extra.

So when the recruiting is run in User Interviews directly (screener hosted there, participants
funneled to an `outset.ai/start/<id>` link), **filter generously**. The relevant criterion for
developer studies is under the **Technical** tab: `AI usage` -> `Coding and software development`,
which took one study from "Very Broad, 5,000+ projected applicants" to "Broad, 700" at identical
cost. Mark it a **key criterion** so UI actively recruits against it.

This matters beyond cost. A general-population pool plus a meaningful incentive plus a screener
that telegraphs its right answers produces an applicant pool selected for willingness to guess.
Fraud traps filter the pool they are handed; narrowing the funnel is the stronger control, and
here it is free.

### 17. Driving the User Interviews project builder (found 2026-08-13)

- It **rate limits** aggressive automation with HTTP 429, then serves a shell that hangs on
  "Loading...". Back off for a couple of minutes; it recovers. Do not keep retrying.
- The screener builder is **react-select**, whose real `<input>` is a zero-size dummy that reports
  "outside of the viewport" to Playwright clicks. Dispatch `pointerdown`/`mousedown`/`mouseup`/
  `click` on the enclosing `[class*="Select__control"]` instead, then click the `[role="option"]`.
- Question cards **collapse to a single button** once they lose focus. Re-expand with
  `getByRole('button', { name: /<question text>/ })` before editing options.
- Option qualify logic is three-state: `Accept`, `May Select`, `Reject`.
- **Seed from an existing project** via "Start from an existing project" rather than authoring
  from scratch, but **audit what you inherit**: one inherited screener rejected anyone answering
  "I did not know you could change the model", which would have silently excluded the beginner
  segment the new study was specifically recruiting for.
- Project steps gate each other: incentives stays locked until the recruitment step is saved.
- **The app's own JSON API is more reliable than clicking** (found 2026-11-02). From the signed-in
  page, a same-origin `fetch` with the page's cookies and its `csrf-token` meta tag works:
  `GET`/`PATCH /api/projects/<id>` (task link, device requirements, copy, `surveyDraft.surveyJson`),
  `PATCH /api/projects/<id>/task-setting` (`completionInterval` in seconds, `timeLimitEnabled`),
  `/summary`, `/expected-cost-details`, `/workspace-participants?tableName=workspace_started` (or
  `workspace_submitted`), and `POST /api/projects/<id>/duplicate`. Read every setting back after
  writing it. `scripts/research-loop/lib/ui-browser.mjs` (`uiFetch`) does this with a 429 backoff.
- **A coordinator reviews every new launch** (found 2026-11-02 in the account's mail): soon after a project launches, a User Interviews project coordinator may email `Edit Needed for "<project>" (<id>)`. One flagged a screener shown all on one page as leading, and asked for one question per page. Edits after launch are allowed. Put one question per page before launching, and check the account's mail after each launch.
- **Tracked Outset link** (found 2026-11-02): task provider `custom_link_with_redirect` with
  `https://outset.ai/start/<study>?iid=TRACKINGID`, and the Outset study's completion URL
  `https://www.userinterviews.com/project-task-events/custom_link_with_redirect/complete?iid={iid}`,
  so a finished interview comes back with its tracking id and marks the participant Submitted.
  Incentives are paid when the project marks a participant complete, not on submission.

### 18. "Study closed" on a participant link means UNPUBLISHED, not broken (found 2026-08-13)

An unpublished study's `outset.ai/start/<id>` link renders:

> Study closed. This study is no longer accepting responses. You can safely close this tab.

This reads like the study was closed or the link is wrong, and it will be reported to you as a bug.
It is neither: it is simply how the draft state is presented to participants, and it flips to the
welcome message on publish. The study id never changes, so the link never needs updating.

Distinguish a genuinely bad link by rendering: an id the backend cannot resolve shows
**"Something went wrong / An error occurred while starting the survey"** instead. Closed page means
the study exists; error page means it does not.

Corroborate with `GET /v1/studies/`, whose record carries `start_url` verbatim plus `active`. Note
the REST list returns `{status, body}` from `outsetRest`, so the array is at `r.body.results`, not
`r.results`. Also note `get_survey_state` exposes no `status`, `published_at` or `closed_at`
fields at all; `active` is the only state signal, so do not infer "was closed" from a missing
timestamp.

### 19. The first watcher run backfills every past study, not just yours (found 2026-08-13)

`watch-studies.mjs` polls **all active studies in the workspace**, so the first run on a machine
harvests the entire backlog of completed interviews across unrelated projects, not only the study
you just launched. One run created 49 transcript JSONs across three unrelated studies. This is
correct behaviour, but it is surprising and it litters the shared artifact root.

If you only want the new study, run `--dry-run` once immediately after installing so the backlog is
absorbed into the seen-state, then delete the unrelated folders. Deletion is stable: an interview
is marked seen in `~/.copilot/research-state/watch.db` **after** its transcript is written, so
removing files from disk does not trigger re-download. Verified by re-running `--dry-run` and
getting 0 new and 0 files recreated. `--reset` clears seen-state and re-harvests everything.

### 20. An interview stuck at exactly 1 message is NORMAL, not a defect (found 2026-08-13)

When someone opens a study link and abandons during setup, Outset still creates a **USER** interview
containing only the welcome message. These accumulate in every study. Measured on one workspace:

| Study | Method | Completed | Never past msg 1 |
|---|---|---|---|
| Study A | SCREENSHARE | 12/23 (52%) | 9 |
| Study B | VOICE | 3/7 (43%) | 4 |
| Study C | SCREENSHARE | 7/50 (14%) | 42 |

So `msgs == 1 && completed_at == null` means "clicked and bailed at setup", which is background
noise in a healthy study. **Do not diagnose a funnel bug from it alone.** Judge the **completion
rate against sibling studies** on the same workspace instead, and give a study hours to days rather
than minutes: completions accumulate slowly and 5 starts in 2 hours is healthy recruiting.

A cheap sanity check before touching anything: find another active study with the **same
`interview_method`, `enforce_no_video_for_screenshare` and `allow_fallback_to_chat`**. If it
completes fine, the configuration is not the problem and the young study just needs time. Acting
early is expensive: pausing a published study kills the participant link for anyone mid flow.

Useful context on what SCREENSHARE actually demands, worth designing for up front even though it is
not usually the cause of a slow start: the final setup screen requires **camera, microphone and
screen share all connected** before "Start interview" enables, and on macOS granting Chrome screen
recording needs a System Settings trip plus a browser restart. Set
`enforce_no_video_for_screenshare: true` when face video is not a research requirement, and screen
for a webcam explicitly, since a screener covering mic and screen share still misses the camera.

**Beware self-pollution:** walking the participant flow yourself to reproduce a problem creates a
real **USER** interview (not TEST) that never completes and drags the apparent completion rate
down. Note its id and exclude it.

### 21. User Interviews screener "Accept" serializes as `may`, not `accept` (found 2026-08-18)

The User Interviews screener UI labels a qualifying answer **Accept** for pick-one questions and
**May Select** for pick-any questions, but both labels use the internal value `may`. The complete
allowed set in `surveyDraft.surveyJson` is `may`, `must`, and `reject`.

Writing `qualifyLogic: "accept"` can look correct in the screener preview, but project launch fails
with HTTP 422:

> Sections questions answers qualify logic is not included in the list

Before launching a project whose screener was written through the project API, scan every answer
and replace `accept` with `may`. Re-fetch the draft and verify that every `qualifyLogic` is one of
`may`, `must`, or `reject` before retrying launch.


### 22. Authoring knobs that change answer quality (found 2026-08-11)

- `deep_probing` has **five** levels, not three. Use the deepest (ABYSS) only on the one question
  the study turns on, Deep on comprehension and story moments, Standard elsewhere.
- Prefer the **Neutral** interviewer persona over the default: upbeat acknowledgements ("That's
  great!") bias participants toward praise when you want critique.
- With `VOICE`, enable `allow_fallback_to_chat` so a bad microphone does not cost a participant, and
  say in the recruitment copy that a microphone and a quiet place are required.
- Stimulus images cropped exactly to a widget read as cut-outs; recapture page regions with about
  56 px of surrounding UI.

### 23. A refresh revokes the access tokens other processes hold (found 2026-11-02)

Symptom: HTTP 401 "Invalid or expired token" in one process right after another process refreshed
successfully. Two processes that each refresh when they start keep invalidating each other, so the
failure looks random. `research-client.mjs` and the research loop share one access token per
connection through a user-only cache in `~/.copilot/research-state/`, refreshed under one lock
(`outset-token.lock`); a process that gets a 401 passes the rejected token and receives the newer one
instead of refreshing again.

### 24. Publishing can need an organization admin's approval (found 2026-11-02)

Symptom: `publish_study` refuses even on a connection with `studies:launch`:

> Publishing this study requires approval from an organization admin. Reasons: ROLE_CONFIGURATION.
> Request review from the web app.

`validate_study` shows it as `approval_required` once everything else is ready. An organization can
require approval for roles meant for people who do research outside a research team. No API requests
the review: someone signs in to the web app, clicks Submit for review on each study, and an admin
approves. A refused `publish_study` does not queue a review, and nothing in `validate_study`, `get_survey_state` or the REST record shows whether a study is in the review queue. The `status` they do return (`survey_languages` in `get_survey_state`, and `list_study_languages`: `PENDING`, `GENERATING`, `GENERATED` or `REVIEWED`) is each language's translation review, not this one, so never read `REVIEWED` as "submitted". Record the click from whoever made it. The approval arrives as an Outset email ("has been approved by your admin and is now published"), and the REST record turns `active`. Check `validate_study` on a draft a day before any launch night and ask while people are
awake. Until then the participant link shows "Study closed" (gotcha 18), so a test interview waits too.

### 25. Small tool quirks (found 2026-11-02)

- `estimate_recruitment_cost` errors when the study recruits its own participants (no panel draft).
  Outset charges nothing for self-recruitment; record that with its evidence (recruit mode `self`, no
  automated recruitment, no incentive) instead of an estimate.
- `recruit_mode` stays null until `set_recruitment_method` is called with `self`.
- `get_survey_state` does not show attached stimulus (gotcha 12); `list_stimuli` with `used_by` does,
  per question.
- `list_custom_interviewer_personas` needs a `survey_id` (gotcha 13).
- `check_guide_quality` prefers probing targets to scripted follow-ups, because its AI moderator works
  from targets. Keep a hint ladder verbatim on purpose when it defines what counts as help.

### 26. Ending a study: Outset's statuses, and what the API can do (found 2026-11-03)

A study is Draft, Published, Paused or Closed (Outset's help article "Understanding Different Stages of
a Study"). Paused stops new participants without interrupting interviews under way and can be
published again; Closed is permanent (no edits, no republishing, recruitment finalized, refunds
processed) and exists only in the web app, which asks for an acknowledgement. A study left open closes
by itself after 30 days. From the API, the launch connection's `unpublish_study` is the stop: it takes
the study offline for new participants (REST `active: false`, and the participant link shows "Study
closed"), and it does not cancel a recruitment launched on a panel. A self-recruited study (participants
sent by a native recruiting project) has nothing to mark per participant: `get_recruitment_status`
shows `automated_recruitment: false` and no incentive, and an interview completes on its own. When a
study completes, Outset's info address sends "Outset - <study name> has completed"; those arrive at
16:00 UTC. Unpublishing sends no email; REST `active: false` is the confirmation.

### 27. User Interviews: closing is a request, and its own check comes first (found 2026-11-03)

"Close project" (the project's options menu) is a close request, not a switch. The web app first calls
`GET /api/projects/<id>/status_updates/new.json?statusTypeId=9`, which only reads: `200 {}` when it may
close, `422` with `unmarkedParticipation` ("1 unmarked participation"), `unmarkedAttendance` or
`scheduledSession` otherwise. A participant still Submitted or Started counts as unmarked. Then it
posts `POST /api/projects/<id>/close_requests.json` with `{"data": {"attributes":
{"projectConsideredSuccessfulId": 1, "issueIds": [...], "details": "..."}}}`: the success answer is
required (1 Yes, 2 No, 3 N/A cancelled, 4 N/A test), the rest optional. The modal says "When you send a
request to close a project, recruiting will not continue." The project then reads status 9, "Pending
Close Request", until the platform's team finishes it (5 to 8 are the completed states; 1 is Launched,
2 Currently recruiting, 4 Done recruiting). A GET on `close_requests` returns a 500: it is post only.
The team finished the closes within a day: `GET /api/projects/<id>` then read `latestStatusTypeId` 6
and `currentStatus` "Project Complete - Charged". `GET /api/projects/<id>/summary` has
`paidParticipantCount`, which counts the participants paid through "Confirm & pay". No email arrived
for payouts or for closes, so confirm them with these two reads (and Outset's `active`), not by email.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/research-client.mjs` | The client. `outsetMcp()`, `outsetRest()`, `marvinMcp()`. Run directly for a smoke test. |
| `scripts/outset-auth.mjs` | OAuth device flow. Opens the default browser, prints the code, persists the token and the MCP URL. Run on `invalid_grant`, and once on each new machine. `--launch` authorizes the research loop's separate launch connection instead (see the safety property). |
| `scripts/probe.mjs` | Verifies auth, endpoints, and the no-launch property. Run first when anything misbehaves. |
| `scripts/watch-studies.mjs` | Polls for newly completed interviews and harvests transcripts. |
| `scripts/research-loop/` | The unattended research loop: a run per schedule, the budget-guarded launcher, Outset and User Interviews setup, reports. See [`research-loop.md`](research-loop.md). |

### The results watcher

Real human interviews trickle in over hours or days. Run the watcher manually to poll and
harvest transcripts to the shared artifact root. It does not start an agent unless the
explicit `--wake-agent` option is supplied.

```bash
node scripts/watch-studies.mjs             # poll + harvest, never wake an agent
node scripts/watch-studies.mjs --status    # what is being watched
node scripts/watch-studies.mjs --reset     # forget seen interviews, re-harvest
node scripts/watch-studies.mjs --wake-agent # explicit opt-in to open an agent window
```

Guarantees it is built on, all verified:

- **Idempotent.** A second run finds 0 new, so interviews are never re-harvested.
- **Crash-safe.** An interview is marked seen only AFTER its transcript is on disk, so a
  failed harvest retries on the next poll instead of being lost.
- **Humans only.** Filters `interview_types: ['USER']`; SYNTH interviews are excluded.
- **Quality flags surfaced.** `is_low_quality` and `fraud_score` are reported so a junk
  participant is visible rather than silently analyzed.

Transcripts land in `~/Desktop/Automated User Testing/<study-slug>/transcripts/` (on Windows, the
Desktop that `[Environment]::GetFolderPath('Desktop')` names), the same
root both research skills already use. State lives in
`~/.copilot/research-state/watch.db`, deliberately separate from the session DB because it
must outlive any single agent session.

Automatic scheduling is intentionally disabled. Run the watcher manually only when explicitly
requested; it must not install a background service or open VS Code windows on a timer.

---

## Synthetic participants: guide QA only, NEVER findings

`generate_synthetic_responses` runs 1-50 **LLM-simulated** participants through a guide.

Legitimate use: smoke-testing the guide before spending money. Does the skip logic fire?
Is question 4 double-barreled? Does this run 12 minutes or 40?

**They are not research data and must never enter a findings pipeline.** Their answers are a
model's prior about a described persona, not evidence, and nothing they say is falsifiable.
A finding sourced from a synthetic participant is worse than no finding, because it looks
like evidence.

Rules:
- Never cite a SYNTH interview in an issue, analysis, or quote.
- Always filter results to `interview_types: ['USER']` when harvesting.
- If you run a synthetic pass, say so plainly and label it guide QA.

Also note: synthetic runs may bill against the workspace budget. Check
`estimate_recruitment_cost` and confirm with the user before generating any.

---

## Limits, stated plainly

- **Marvin is read-only right now.** The key carries `mcp:read` only; every REST write scope
  (`file:write`, `survey:write`, `insight:write`, `project:write`) is rejected. So the agent
  can **read** the historical repository but **cannot push new Outset transcripts into it**.
  Until a broader key is minted in Marvin Settings -> MCP, Outset is the system of record for
  new studies and Marvin is historical context. Do not describe the loop as if it round-trips.
- **Outset publishes no public API docs.** Everything here is empirical. If a call starts
  failing, re-run `probe.mjs` before assuming the docs changed; there are no docs.
- **User Interviews works two ways.** As a recruitment provider *inside* Outset
  (`configure_recruitment.third_party_provider` accepts `PROLIFIC`, `USERINTERVIEWS`,
  `RESPONDENT`), with no browser automation; or as a **native User Interviews project** whose
  screener lives in User Interviews and funnels qualified people to the `outset.ai/start/<id>`
  link. The user preferred the native project for the website study (stricter screener, free
  criteria); it is browser-driven, see gotchas 16, 17, and 21. Publish the Outset study before
  launching the native project so no recruit lands on a closed study.

---

## Tool discovery

Outset MCP has 129 tools and they change. Do not hardcode a list from memory; enumerate:

```js
const tools = await (await outsetMcp()).listTools();
console.log(tools.filter(t => /recruit/i.test(t.name)).map(t => t.name));
```

Useful clusters: `create_study` / `create_section` / `create_question` / `edit_question`
(authoring), `add_skip_condition` / `add_display_condition` (logic), `create_screener` /
`add_screener_question` (screening), `request_file_upload` / `update_question_stimulus`
(stimulus), `check_guide_quality` / `validate_study` (self-correction),
`configure_recruitment` / `estimate_recruitment_cost` (pre-launch),
`list_interviews` / `get_interview_transcript` (results),
`search_vision_observations` / `get_emotion_crosstab` (analysis).

Marvin's 8: `list_projects`, `list_project_files`, `get_file_summary`, `get_file_content`,
`search`, `ask`, `get_ask_status`, `link_context`.

---

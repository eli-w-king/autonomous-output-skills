# Harvest results: steps by source

Detail for Phase 1 of [`autonomous-research-synthesis`](../SKILL.md). Moved here to keep the
skill lean; the rules are unchanged.

### 1A Outset

```js
const { outsetMcp } = await import(`${process.env.HOME}/.copilot/skills/research-platforms/scripts/research-client.mjs`);
const outset = await outsetMcp();
```

#### 1.0 Prefer the watcher: the transcripts may already be on disk

The results watcher polls for completed interviews and harvests them automatically, so a study that
finished overnight is usually already staged:

```bash
node ~/.copilot/skills/research-platforms/scripts/watch-studies.mjs --status
node ~/.copilot/skills/research-platforms/scripts/watch-studies.mjs --dry-run   # harvest now
```

Transcripts land in `PROJECT_DIR/transcripts/` as one JSON per interview. **Check there before
calling the API**; re-harvesting wastes time and quota.

#### 1.1 Harvest directly (when the watcher has not run)

```js
const ivs = await outset.callJson('list_interviews', {
  study_id: STUDY_ID,
  completed_only: true,
  interview_types: ['USER'],   // REQUIRED, see below
  limit: 50,
});
for (const iv of ivs.interviews) {
  const t = await outset.callJson('get_interview_transcript', { interview_id: iv.id });
  // write to PROJECT_DIR/transcripts/
}
```
Pagination is cursor-based: pass back `next_cursor` until it is null.

> **Always filter `interview_types: ['USER']`.** SYNTH interviews are LLM-simulated participants used
> for guide QA. They are **not research data**: their answers are a model's prior about a persona, not
> evidence, and nothing they say is falsifiable. A synthetic quote in an issue is worse than no quote,
> because it looks like evidence. Never cite one, never let one into the finding set.

#### 1.2 Screen for participant quality BEFORE analyzing

Every interview carries `is_low_quality`, `fraud_score`, `screened_out`, and
`total_engagement_time_seconds`. Check them first:

- Exclude `is_fraud` / high `fraud_score` outright.
- Treat `is_low_quality` as suspect: read it, but do not build a finding on it alone.
- A very short `total_engagement_time_seconds` relative to the others usually means a skimmer.

**Say in the write-up how many interviews you harvested and how many you excluded, and why.** A
finding drawn from 3 of 7 participants is a different claim than one drawn from 7 of 7.

#### 1.3 Pull the analysis Outset already did

Outset runs its own analysis passes. Use them as **leads to verify against transcripts**, never as
findings to copy:

- `peek_report` / `list_reports` / `get_topline_insights`, the AI executive summary.
- `search_report_answers` -> `list_answer_messages`, an answer plus its source quotes.
- `search_vision_observations` / `list_vision_aggregated_insights`, observed UX behavior for
  screenshare studies (where the participant struggled, what they missed).
- `search_vision_task_results`, per-question task-completion verdicts.
- `search_emotion_observations` / `get_emotion_crosstab`, emotion signal.
- `search_project_highlight_clips`, quotable moments with timestamps.

These have no UserTesting equivalent and are the biggest analysis upgrade in the new pipeline. Treat
every AI-generated claim as a hypothesis and confirm it in the transcript before it becomes a finding.

#### 1.4 Historical context from Marvin (read-only)

Marvin holds prior studies. Before writing findings, check whether this is already known:

```js
const { marvinMcp } = await import(`${process.env.HOME}/.copilot/skills/research-platforms/scripts/research-client.mjs`);
const marvin = await marvinMcp();
await marvin.call('ask', { question: 'What have we learned about <topic>?' });
```
`ask` is async: if it returns `in_progress`, poll `get_ask_status`. Also useful: `search`,
`list_projects`, `get_file_summary`.

A finding that **replicates** an earlier study is stronger, and worth saying so explicitly.

> **Marvin is read-only right now.** The key carries `mcp:read` only, so new Outset transcripts
> **cannot be pushed into Marvin** until a broader key is minted (Settings -> MCP, add `file:write` +
> `project:write`). Outset remains the system of record for new studies. Do not describe the loop as
> if it round-trips, and do not silently skip this step: if cross-study context would have mattered,
> say that it was unavailable.

### 1B UserTesting

Drive a dedicated Chrome signed into UserTesting with `playwright-core` over CDP (see
`autonomous-user-studies`; do not depend on the chrome-devtools MCP). Then, per study, on the
**Results** tab:

1. Record the study id, title, status, field dates, audience, exact question/task text, and stimulus
   checksums/URLs in `PROJECT_DIR/run.json` and `PROJECT_DIR/artifacts.json`.
2. Click **Export data** to download the XLSX (sheet name `Data`).
   - Row 0/1 are section + question headers; row 2 has sub-labels; rows 3+ are participants.
   - The "Participant ID" column looks like `P## - handle`; `Complete` appears in col 0/1.
3. Save the XLSX into `PROJECT_DIR/downloads/`.
4. Extract structured task/question answers plus completion metadata into `_responses.json`.
5. Extract the **transcripts** (speech-to-text, per participant) into
   `PROJECT_DIR/transcripts/<variant>-transcripts.md` and a machine-readable
   `_extracted.json`; extract **audience/screener** answers into `_audience.json`.
6. When a claim depends on what a participant did rather than what they said, record a timestamped
   observation linked to the participant, task, stimulus version, and source recording. Do not infer
   behavior from transcript text alone.

Store study metadata in SQLite (`ut_study`, `ut_participant`, `ut_transcript`, `ut_response`,
`ut_stimulus`, `ut_observation`) so later phases and future runs can query it. Use stable synthetic
participant ids in exported reports; do not persist names or handles unless access to the source
requires them.

Playwright download gotcha: attach `page.waitForEvent('download')` and `saveAs(exactPath)`; the
default download UI cannot be driven blind.

### 1C Local exports (DOCX or ZIP folders the user downloaded)

- Copy the folders into `PROJECT_DIR/downloads/` first; never edit the originals.
- Extract DOCX text losslessly from the `w:t` runs of `word/document.xml` into one JSON and one TXT
  per interview, numbering paragraphs (`P0001`, `P0002`, ...) with the speaker role, so every quote
  cites `<interview id>, P###` (for example `D-0002, P0041`).
- Interview ids encode the study variant (for example `C-` default and `D-` experimental in a
  monadic pair); keep that mapping in `run.json`.
- In-progress studies grow: when the user adds new completed interviews, add them and say what
  changed in the readout. Exports carry no screenshots or video, so do not describe what
  participants saw beyond what the transcript states.

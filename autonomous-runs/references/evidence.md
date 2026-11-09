# Evidence, run ledgers, and stimuli

Read before research or demo work that others will rely on: what counts as the real surface, the ledger that survives a lost chat, the evidence chain, who said what in meeting transcripts, and media that must be checked before it is shared.

---

## Match the artifact to the real research surface

**"Never build a browser mockup" applies to desktop-app research, not to websites.** Use the real
surface named by the study:

- VS Code app feature: Code OSS built from the source commit under test.
- Deployed website: the actual deployed URL, with redirects and final URL recorded.
- Website prototype: the actual hosted/local prototype artifact, pinned to a commit/deployment and
  tested at the same viewport participants will see.

The invalid substitution is a facsimile that changes the product category, such as HTML standing in
for the Agents window or a static design image standing in for a functioning website. Capture a
source/version receipt before the first participant and never overwrite a stimulus between rounds.

---

## Persist a run ledger outside chat history

**Chat/session history is not a durable artifact store.** A later session may retain media and git
changes while the original transcript is unavailable. At project creation, write:

- `run.json` for ids, source versions, URLs, owned processes/targets, and phase status;
- `decisions.md` for assumptions, approvals, revisions, and rejected paths;
- `artifacts.json` for each stimulus/output path, role, source version, and checksum;
- `resume.md` for the last completed phase and next safe action.

Update the ledger before handoffs and after irreversible or expensive steps. Keep participant PII,
credentials, and private transcript text out of it. This makes recovery evidence-based instead of
guessing from filenames or stale browser tabs.

---

## Build an evidence chain, not just a findings document

**Every recommendation should be traceable backward and forward.** Link:

`study round + stimulus version -> participant/source -> quote/response/observed behavior ->
finding -> recommendation -> implementation version -> rerun result`

Transcripts are necessary but not sufficient. Preserve structured answers, task context, timestamped
behavior/video observations, contradictions, and completion state when they affect interpretation.
Give each finding a confidence level with a reason. Quantitative evidence may support, weaken, or be
unable to test a finding; all three outcomes are useful if stated honestly.

Keep product-specific conclusions in the project report. Only promote the reusable method or gotcha
to these references.

---

## Meeting transcripts are weak on who said what

Feedback often arrives as a meeting transcript (a crit, a standup, a planning call). Its speaker
labels are unreliable: VTT files carry empty or bare voice tags and timed text with no tag at all, a
whole two-person call can sit under one name, and a room label can cover several people. A parser
that required a named speaker once dropped dozens of cues without a word. Keep unlabeled speech as
unlabeled, check that every timed cue is accounted for, and never attribute a quote or a preference
to a person from a label alone; say who said it only when the context establishes it.

---

## Version and fully validate stimuli and media

**A successful upload is not proof that media works.** Before publishing an MP4, run `ffprobe` to
inspect duration/codec/dimensions and decode the full file with `ffmpeg -v error -i <file> -f null -`.
Inspect opening, midpoint, and ending frames, then verify playback from a fresh browser session after
upload.

Use a new filename for every replacement (`prototype-a-v2.mp4`) because GitHub/raw/CDN caches can
serve the old bytes. Update every issue/comment/study reference plus `artifacts.json`; verify the
old filename is no longer referenced. For comparative or rerun studies, keep prior stimuli immutable
and record checksums so results cannot be attributed to the wrong version.

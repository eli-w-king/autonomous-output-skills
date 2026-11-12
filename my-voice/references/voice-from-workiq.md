# Build your voice from your own work

`my-voice` writes like you when it has your own rules and examples of your own writing. This builds both from what
you sent at work (Teams messages and email, through the official Work IQ plugin) and from your chats with agents on
this machine. It only reads. Your messages stay on your machine; the skill keeps only the rules, in general words.

Taste works the same way: [taste from Work IQ](../../my-taste/references/taste-from-workiq.md). When you build both,
collect for both first, then write both.

## Before you start

- The official `workiq` plugin, installed and signed in on this machine (INSTALL.md, "Check prerequisites"). Load the
  `workiq` skill and follow its own mail and Teams read routes for every call; never guess tool names or queries.
- Only for the person asking, only their own messages, and only after they said yes to reading them.
- Read only: search and read. Never draft, send, reply, react, or change anything in Microsoft 365.
- Check where things stand: `python3 ~/.copilot/autonomous-output-skills/tools/personal-skills.py status` (on
  Windows, `python "$HOME\.copilot\autonomous-output-skills\tools\personal-skills.py" status`). It says whether
  `my-voice` is still the shared starting voice or already yours. On the maintainer setup it says so: there, do
  steps 1 to 3 only and leave the rules to the weekly skill miner.
- [Signs of AI writing](ai-tells.md) is the base for everyone. Your own rules sit on top of it and decide what it
  leaves open.

## 1. Collect your own words

- **Sent email**, the last 60 days: list your Sent Items by `sentDateTime` (the `mail-read` route), then read the
  bodies of the ones you keep. Skip meeting requests and responses (event messages), automatic replies, and
  anything you only forwarded.
- **Teams**, the same window: find chats and channel threads where you wrote something with substance (grounding
  retrieval of Teams messages), then read those threads (the `teams-read` route) and keep only the messages you
  sent.
- **Your chats with agents**, the last 90 days: `personal-skills.py collect` copies what you typed in this machine's
  sessions into your private folder (only what you typed: never agent briefs, automations, or autopilot). There,
  look for drafts you approved, edits you made to drafts, and copy feedback ("shorter", "too formal", "sounds like
  AI"). Your quick prompts to agents are casual and often dictated, so their typos and lowercase are not your voice.
- Keep only text you wrote. Drop quoted replies ("On ... wrote:", "From:", "Original Message"), forwarded text,
  signatures, disclaimers, and anything someone else wrote.
- Skip anything you wouldn't want imitated or kept: HR, legal, health, customer details, and anything labeled
  confidential.
- Prefer writing meant for other people: posts, announcements, feedback, replies with substance, email to partners
  or leaders. One-word replies teach nothing.

## 2. Pick about 40

- Mix the channels you write in: Teams chat replies, channel posts, email to your team, email outside it.
- Keep each one verbatim, with its date, its channel, and one line on what it was ("reply in a design review thread").
- Replace other people's names with their role ("my teammate", "my manager"), and take out customer names and links.
  Keep the rhythm: openings, sign-offs, sentence length, punctuation.
- Add every name you replaced, and any internal product name or codename you met, to
  `~/.copilot/skill-miner/private-terms.txt`, one per line, so the checks block them from your skills from then on.

## 3. Write the samples file on this machine

- macOS: `~/.copilot/skill-miner/private/voice-samples.md`, in a folder only you can read (`chmod 700` the folder,
  `chmod 600` the file). `personal-skills.py collect` makes the folder that way.
- Windows: `%USERPROFILE%\.copilot\skill-miner\private\voice-samples.md`, with an owner-only ACL (`icacls <file>
  /inheritance:r /grant:r "%USERNAME%:F"`).
- One heading per channel, then each sample under a dated heading:

```markdown
## Teams chat

### 2026-10-14, reply in a design review thread

<the text, verbatim>
```

- Never put this file in a repo, a post, an issue, or a message. From then on the weekly skill update refreshes it,
  with only your own words and drafts you approved.

## 4. Turn them into rules

- A rule needs a pattern in at least 3 samples from 2 different days, or a standing preference you stated yourself
  in a chat with an agent ("always", "never", "every time"). One-off edits to a single draft aren't rules. Newer
  beats older: when your recent writing differs, follow the recent writing.
- Look for what makes your writing yours: how you open and close, how long you go, how you ask for things, how you
  give feedback, how formal you get and with whom, your punctuation (dashes, exclamation points, emoji), lists versus
  paragraphs, and words you use or avoid.
- Write each rule in general words. No quotes from messages (a stock phrase of your own, up to four words, is fine:
  how you open or sign off), no names (use roles), no links, no product or customer names, and nothing from HR,
  legal, or health. A lesson that only works with private details stays in your private notes, not in the skill.
- Record each rule in the weekly update's ledger (`~/.copilot/skill-miner/ledger.json`, the format in
  `automations/weekly-skill-miner.md`, step 3) with skill `my-voice`, status `active`, and its evidence: for each
  sighting, its `source` (one of the source kinds below), `date`, `message_id` (the item's id, or the session
  message's), and a few words of `quote`. The ledger stays on this machine, so the weekly update can keep counting.

## 5. Write them into your my-voice

- If `personal-skills.py status` says `my-voice` is still the shared starting voice, run `personal-skills.py start
  --skill voice` first. It turns your copy into your own starting template (the same structure and shared parts,
  with nobody else's rules), saves your old copy in your private folder, and says if it held edits of your own. If it
  did, read them and carry the ones that are still true into your rules.
- Edit `~/.copilot/autonomous-output-skills/my-voice/SKILL.md` (your clone, not the installed copy). Replace the
  placeholder under "Core voice" with 5 to 12 numbered rules, and the one under "Patterns by channel" with a pattern
  for each kind of message you have at least 3 samples of. Leave the other sections and the `personal skill`
  comment line as they are.
- End every rule and pattern with where it came from, how many times it showed up, and the last time:

```markdown
1. **Lead with the ask.** Put the request in the first sentence, then the context, in a sentence or two. (from: sent
   email, sent Teams messages; 14 sightings; latest 2026-11-04)

**Quick Teams reply.** One or two sentences, a thank-you up front, no sign-off. (from: sent Teams messages; 9
sightings; latest 2026-11-06)
```

That's the format, not rules to copy.

- Source kinds: `sent Teams messages`, `sent email`, `agent chats`.

## 6. Check a draft

- Write a short reply in your voice to something real (the last Teams message you got, say), with the new rules
  and samples.
- Run the final pass in [ai-tells.md](ai-tells.md). It sums up Wikipedia's
  [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) in our own words; read the source
  for the long version, and never copy its text into a skill.
- Run `personal-skills.py check`. It flags rules without a source or date, quotes, names from your private terms,
  links, and email addresses. Fix what it finds.
- Show the draft and the rules, and stop there. Nothing gets sent.

## 7. Save

`personal-skills.py save` checks again, commits your `my-voice` to your review branch (`skill-updates`), and installs
it, so your next session writes like you. Your messages and samples never leave this machine; the rules go to your
private copy on GitHub with your next daily sync, and wait in your weekly review pull request like any other skill
edit (`automations/ATTENDEES.md`).

## Later

- Every week, the skill update reads what you typed to your agents and updates the rules (`automations/ATTENDEES.md`,
  "The weekly run in attendee mode"). It never rewrites the whole file.
- To read newer sent messages too, say "refresh my voice and taste": the same steps, for what you sent since the last
  build. A shared update never replaces your `my-voice`.

# Build your taste from your own work

`my-taste` reviews and designs like you when it has your own rules. This builds them from the design feedback you
gave and got at work (Teams and Outlook through the official Work IQ plugin, including Figma comment emails), your
pull request reviews if you use GitHub, and your chats with agents on this machine. It only reads. The evidence stays
on your machine; the skill keeps only short rules, in general words.

It works the same way as [voice from Work IQ](../../my-voice/references/voice-from-workiq.md). When you build both,
collect for both first, then write both.

## Before you start

- The official `workiq` plugin, installed and signed in on this machine (INSTALL.md, "Check prerequisites"). Load the
  `workiq` skill and follow its own mail, Teams, and retrieval routes for every call; never guess tool names or
  queries.
- Only for the person asking, and only after they said yes to reading their mail, Teams, pull requests, and chats
  with agents. Their own messages and the feedback sent to them; never browse other people's mail or chats.
- Read only: search and read. Never draft, send, reply, react, comment, or change anything in Microsoft 365, Figma, or
  GitHub.
- Check where things stand: `python3 ~/.copilot/autonomous-output-skills/tools/personal-skills.py status` (on
  Windows, `python "$HOME\.copilot\autonomous-output-skills\tools\personal-skills.py" status`). It says whether you
  have a `my-taste` yet and whether it's yours. On the maintainer setup it says so: there, `my-taste` has its own
  update, so stop.

## 1. Collect design feedback

The last 60 days, from each source you have. Design feedback is anything about how something looks, reads, moves, or
works: layout, spacing, type, color and contrast, icons, states, motion, copy and labels, flows, accessibility, and
how a design was reviewed or decided.

- **Teams.** Find design reviews, critiques, and feedback threads in chats, channels, and meeting chats (grounding
  retrieval of Teams messages, a few focused queries: feedback on mockups and prototypes, Figma links, layout and
  spacing, copy and labels, color and contrast, motion). Then read the threads that matter (the `teams-read` route).
  Keep what you said, and what others said about your work.
- **Outlook.** The same kind of feedback in email threads (grounding retrieval of email, then the `mail-read` route
  for the bodies), including your own replies in Sent Items.
- **Figma comment emails.** Figma sends comments, mentions, and replies by email. Search your mail for
  `from:email.figma.com` (the `mail-read` route's `$search`). Keep the messages whose sender address starts with
  `comments-` (the sender name reads "<person> via Figma"); skip Figma's announcements and product mail, which come
  from other addresses. Read the bodies: the comment text and the file name are in them.
- **Pull request reviews**, if you use GitHub and GitHub CLI is signed in (`gh auth status`). Reviews you gave:
  `gh search prs --reviewed-by=@me --sort updated --limit 50 --json url,updatedAt`. Reviews you got:
  `gh search prs --author=@me --sort updated --limit 50 --json url,updatedAt,commentsCount`. For each one in the
  window, `gh api repos/<owner>/<repo>/pulls/<number>/reviews` and `.../pulls/<number>/comments` give the review text
  and the inline comments. Keep design comments (UI, copy, accessibility, behavior), not code style. Signed in to more
  than one account (a personal one and a Microsoft-managed one, say)? Run them for each:
  `GH_TOKEN="$(gh auth token --user <account>)" gh search prs ...`, and never print the token.
- **Your chats with agents**, the last 90 days: `personal-skills.py collect` copies what you typed in this machine's
  sessions into your private folder. Look for design corrections ("too much chrome", "check it at phone width"),
  approvals ("perfect, ship that one"), and rejections of an option, with what made the difference.
- Skip anything about HR, legal, health, customers, or anything labeled confidential, and anything that isn't about
  design.

## 2. Write the evidence file on this machine

- `~/.copilot/skill-miner/private/taste-evidence.md` (Windows: `%USERPROFILE%\.copilot\skill-miner\private\
  taste-evidence.md`), in the private folder `personal-skills.py collect` made (only you can read it).
- One short note per piece of feedback, in your own words: what was liked or disliked, about what kind of thing,
  whose it was, the source kind, and the date. Not whole threads. Keep a short quote only when the exact words
  matter, and only in this file.

```markdown
## 2026-10-14, Figma comments, received (a teammate), agreed

Asked to show the error next to the field instead of in a banner at the top. I changed it.
```

- Write people as roles ("a teammate", "my manager", "a PM", "an engineer"), never names. Add every name you met,
  and any internal product name or codename, to `~/.copilot/skill-miner/private-terms.txt`, one per line, so the
  checks block them from your skills from then on.
- Never put this file in a repo, a post, an issue, or a message.

## 3. Turn the evidence into rules

- A rule needs the same point in at least 3 notes from 2 different days, or one standing preference you stated
  yourself ("always", "never", "every time"). Feedback someone gave you counts when you agreed with it or acted on it.
  One-off fixes to a single design aren't rules. Newer beats older: when your recent feedback differs, follow it.
- Write each rule as one short sentence in general words, about the kind of thing, not one design ("Show errors
  next to the field they're about", not "move the sign-up error"). No quotes, no names (use roles), no links, no product codenames or customer
  names, and nothing that only makes sense with private details.
- Give it an area: `everywhere`, or a plain description of a surface (`app/settings`, `website/home`, `mobile`).
- Put it in the right section: **Design** (how things work and read), **Product feel** (fitting the product's own
  components, tokens, icons, states, and platforms), **Taste** (the look and motion), or **How I review** (what you
  check before you call something done, and how you like options shown).
- Record each rule in the weekly update's ledger (`~/.copilot/skill-miner/ledger.json`, the format in
  `automations/weekly-skill-miner.md`, step 3) with skill `my-taste`, status `active`, and its evidence: for each
  sighting, its `source` (one of the source kinds below), `date`, `message_id` (the item's id, the pull request URL,
  or the session message's), and a few words of `quote`. The ledger stays on this machine.

## 4. Write them into your my-taste

- If `personal-skills.py status` says you have no `my-taste` yet (or a shared one), run `personal-skills.py start
  --skill taste` first. It adds your own starting `my-taste` (the same structure as the shared one, with nobody
  else's rules).
- Edit `~/.copilot/autonomous-output-skills/my-taste/SKILL.md` (your clone, not the installed copy). Replace the
  placeholder under each section with that section's rules, strongest first, numbered by section (D01, P01, T01,
  R01). Leave a section's placeholder when it has no rules yet. Leave "How to use", "How this stays accurate", and the
  `personal skill` comment line as they are.
- End every rule with its area, then where it came from, how many times it showed up, the last time, and whose it
  was:

```markdown
- **D01.** Show errors next to the field they're about, in words that say how to fix them. [`everywhere`] (from: Figma
  comments, Teams feedback, PR reviews; 7 sightings; latest 2026-11-05; mixed)
```

That's the format, not a rule to copy.

- Source kinds: `Teams feedback`, `email feedback`, `Figma comments`, `PR reviews`, `agent chats`. Whose: `own` (you
  said it), `received` (someone said it to you, and you agreed or acted on it), or `mixed`.

## 5. Check

- Run `personal-skills.py check`. It flags rules without an area, a source, a count, or a date, quotes, names from
  your private terms, links, and email addresses. Fix what it finds.
- Show the five strongest rules, each with what it came from in a few words, and stop there. Nothing gets sent.

## 6. Save

`personal-skills.py save` checks again, commits your `my-taste` to your review branch (`skill-updates`), and installs
it, so your next design review uses it. The evidence never leaves this machine; the rules go to your private copy on
GitHub with your next daily sync, and wait in your weekly review pull request like any other skill edit
(`automations/ATTENDEES.md`).

## Later

- Every week, the skill update reads what you typed to your agents and adds or updates rules
  (`automations/ATTENDEES.md`, "The weekly run in attendee mode"). It never rewrites the whole file.
- To read newer feedback too, say "refresh my voice and taste": the same steps, for what came in since the last
  build. A shared update never replaces your `my-taste`.

<!-- The starting my-voice for anyone's own copy. tools/personal-skills.py start copies it to SKILL.md in a private
copy, without this comment, and setup fills in the rules from that person's own work. Keep everyone's personal rules
out of this file. -->
---
name: my-voice
description: "My voice: write anything the user will send, post, or say as themselves so it sounds like them. Use when the user says 'write it like how I would say it', 'in my voice', 'make it sound like me', 'how I'd say it', 'draft a message/reply/post for me', 'rewrite this as me', 'less like AI', or asks for an email, a Slack or Teams message, a LinkedIn post or comment reply, an event invite or description, a bio, a team update, feedback request, announcement, reply, PR or issue description, notes for engineers, a PM summary, a design rationale, UI copy, or a script they will read out loud. Covers the user's own core voice and channel patterns, built from their sent messages and their chats with agents, copyediting their drafts without changing their wording, length rules, and a last pass against the signs of AI writing. Reads local private writing samples when present. Kept current by the weekly skill update from the user's own edits, approvals, and corrections."
---
<!-- personal skill: my-voice, built from this person's own work (tools/personal-skills.py). Keep this line. -->

# My voice

Write the way the user writes when they send something to their team, not the way an assistant
writes. When this skill applies, every sentence should pass the test "would they have typed this?".

**Before drafting, read the samples if they exist:**
`~/.copilot/skill-miner/private/voice-samples.md` holds verbatim examples of the user's own writing
and of drafts they approved. It stays on this machine and never goes in a repo, a post, or a
message. Imitate its rhythm and structure; never copy its facts into something else. No samples
yet? Build them from the user's own sent Teams messages and email, read only:
[voice from Work IQ](references/voice-from-workiq.md).

**Then read examples of the same kind** when there are any: the other items in the plan, the docs
the text will sit next to, or recent posts that landed well. Match their tone, vocabulary, length,
and format.

## Core voice

The user's own rules, from their own writing. Each one ends with the kinds of messages it came from,
how many times it showed up, and the last time it did.

_No rules yet: setup builds them from the user's own sent messages and agent chats._

## Patterns by channel

How the user writes the kinds of messages they send most, from the same evidence.

_No patterns yet._

## How to deliver

- **Keep their wording.** When editing the user's draft, fix typos, punctuation, capitalization,
  spacing, and duplicated words, but keep their phrasing and order unless they ask for a rewrite.
- **Respect the requested length.** "Shorter" means cut it roughly in half, and "one paragraph"
  means one paragraph. When unsure, go shorter and simpler.
- **No process narration.** Don't mention how the text was made ("an agent drafted this", "I used
  X to ...") unless the user asks for that credit.
- Before handing it over, run the final pass at the end of
  [Signs of AI writing](references/ai-tells.md). It's the same for everyone. Where it leaves a
  choice open (dashes, emoji, how formal to be), the user's own rules above decide.
- Put the full text in the chat as a ready-to-paste code block, one block per channel (email,
  Teams, Slack), every time, even when you also saved it as a draft. Save it to a file only when
  asked.
- Offer at most one alternative, and only when the choice is real (for example shorter versus with
  examples).
- "Start over" means a new draft with a different structure and format, not a reword of the
  rejected one.
- Never send or post as the user unless they explicitly asked you to in this conversation; when you
  do, follow `autonomous-computer-use` for exactly-once sends.

## How this stays accurate

Setup builds the rules above from the user's own work, read only: the Teams messages and email they
sent (through Work IQ), and the drafts they approved or corrected in their chats with agents. The
steps are in [voice from Work IQ](references/voice-from-workiq.md). Their messages stay on this
machine, in `~/.copilot/skill-miner/private/`. This file keeps only the rules, in general words,
with no quotes from messages, no names, and no links.

Each week, the skill update reads what the user typed to their agents (copy feedback, edits to
drafts, drafts they approved) and adds or updates rules here, one at a time. Only text written for
other people counts as voice: quick prompts to agents are casual and often dictated, so their typos
and lowercase are not the voice. To read newer sent messages too, the user can say "refresh my
voice and taste". If the user corrects a draft, follow the correction now; the weekly update picks
it up.

Updates to the shared skills never replace this file. Once it's the user's, it stays theirs.

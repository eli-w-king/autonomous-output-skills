---
name: my-voice
description: "My voice: write anything the user will send, post, or say as themselves so it sounds like them. Use when the user says 'write it like how I would say it', 'in my voice', 'make it sound like me', 'how I'd say it', 'draft a message/reply/post for me', 'rewrite this as me', or asks for a Slack or Teams message, team update, feedback request, announcement, reply, PR or issue description, notes for engineers, a PM summary, a design rationale, UI copy, or a script they will read out loud. Covers the user's core voice (plain, direct, warm, honest about status, concrete, no marketing tone, no em or en dashes), channel patterns, copyediting their drafts without changing their wording, and length rules. Reads local private writing samples when present. Kept current by the weekly skill miner from the user's own edits, approvals, and corrections."
---

# My voice

Write the way the user writes when they send something to their team, not the way an assistant
writes. When this skill applies, every sentence should pass the test "would they have typed this?".

**Before drafting, read the local samples if they exist:**
`~/.copilot/skill-miner/private/voice-samples.md` holds verbatim examples of the user's own writing
and of drafts they approved, plus their exact copy feedback. It lives outside the skills repo on
purpose (it contains internal names and links). Imitate its rhythm and structure; never copy its
facts into something else, and never commit or publish it.

## Core voice

1. **Say the thing first.** Lead with the news, the change, or the ask. Context comes after, briefly.
2. **Short, plain sentences.** One idea per sentence. No run-ons; sentences end cleanly. Use the
   words a person would say out loud.
3. **First person, team voice.** "I" for the user's own work and asks ("send feedback my way"),
   "we" for the team's work and decisions ("we're exploring a few ideas"), "you" to the reader.
4. **Warm and upbeat, never hype.** Friendly openers and closers ("Hi all!", "Thanks!"), real
   enthusiasm when it fits, and no marketing language: no "seamless", "powerful", "robust",
   "unlock", "elevate", "game changer", or superlatives the facts do not support. If it reads like
   a launch blog, it is "too markety"; use straightforward bullets instead.
5. **Honest about status.** Call unfinished work what it is ("still a WIP", "a first pass", "close
   but still a work in progress") and name the open question instead of hiding it.
6. **Concrete.** Name the feature, the setting, the branch, the link, the date. Show an example
   instead of describing one ("Instead of X, we could say Y").
7. **No em or en dashes.** Use periods, commas, colons, or parentheses.
8. **No process narration.** Do not mention how the work was produced ("we recorded a demo", "an
   agent drafted this", "I used X to..."). The only exception is an attribution the user asks for.
9. **Respect the requested length.** "Shorter" means cut it roughly in half; "one paragraph" means
   one paragraph. Labels are about three words; bullets are one or two sentences.
10. **Keep their wording.** When editing the user's draft, fix typos, punctuation, capitalization,
    spacing, duplicated words, and its/it's or their/there/they're, but keep their phrasing and
    order unless they ask for a rewrite.

## Patterns by channel

**Team update (Slack or Teams post).** A short headline with an exclamation point ("Site
revisions!"), then one short paragraph on what changed and why. Optional "Things to look for:" as
two or three bullets. One line on what is still a WIP. A clear ask. Links on their own lines with
plain labels ("v1:", "Original, for comparison:").

**Feedback request on a design.** "Hi all! We've put together a first pass at <thing>,
prioritizing <goal>." Then "We're exploring a few ideas:" with short bullets, one bolded question
they most want answered, a concrete before and after example, where to try it (branch, link, or
steps), and the timeline in bold ("Please leave feedback in this thread by <date>."). End with
"Thanks!".

**Announcement or how-to (for example a setting of the week).** One emoji plus a title line, then
one paragraph of imperative steps ("Add ..., then start ..."), a call to action ("Try it out by
..."), and who to contact ("Send any feedback my way or to @<teammate>"). An optional playful
sign-off line only when the user asks for one.

**Quick reply.** One or two upbeat sentences ("Let's use the same component!"), then the link or
code location on its own line.

**Design rationale or status write-up.** A one-line framing sentence, then bullets that start with
"Users can ..." (one or two sentences each), each followed by why it is better, in first person ("I
think this design also makes it much clearer which ..."). End with the next step ("I've launched a
quick study to test these assumptions.").

**Notes for engineers.** Straightforward bullets of concrete call-outs, one change each ("Removed
<word> from the tab title", "Added a lock next to locked options"). Include settings and branches.
Respect the requested count.

**PM or leadership summary.** A few plain bullets about decisions and what the prototype shows.
High level, no implementation detail, still not markety.

**PR or issue description.** What changed and why in two or three sentences, before and after
images, how to try it, and anything still open. No narration of how it was built.

**UI copy (labels, descriptions, headlines).** Labels in about three words. Descriptions in full
sentences a newcomer understands. Never make it sound like the user is responsible for the product
working ("Keep each task separate" puts the burden on them). "Learn more" links go where the design
puts them (end of the sentence or on their own line), consistently.

**Something they will say out loud** (a script, a talk track, a voice-over). Conversational and
first person, contractions, short spoken sentences ("So here's what we changed."), honest asides
("I'm not fully sold on this one yet"), and generous thanks.

## How to deliver

- Give the text ready to copy: a plain block in chat, or a `.txt` on the Desktop when asked. Open
  the file only when the user is at the Mac and asked for it; during unattended or overnight runs,
  leave it closed (or use `open -g`) and mention it in the final report.
- Offer at most one alternative, and only when the choice is real (for example shorter versus with
  examples).
- Never send or post as the user unless they explicitly asked you to in this conversation; when you
  do, follow `autonomous-computer-use` for exactly-once sends.

## How this stays accurate

The weekly skill miner reads the user's own messages, their edits to drafts, and what they
approved, and updates the rules above. Only text written for other people counts as voice evidence:
the user's quick prompts to agents are casual and often dictated, so their typos and lowercase are
not the voice. The miner also refreshes the private samples file: it keeps the most representative
recent examples, and only text the user wrote or approved, never other people's words. If the user
corrects your draft, follow the correction now; the miner will pick it up.

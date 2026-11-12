<!-- The starting my-taste for anyone's own copy. tools/personal-skills.py start copies it to SKILL.md in a private
copy, without this comment, and setup fills in the rules from that person's own work. Keep everyone's personal rules
out of this file. -->
---
name: my-taste
description: "My taste: apply the user's own design taste when asked about my taste, design feedback, does this look right, a polish pass, or a design review. Use scoped rules for layout, type, color, motion, states, copy, native patterns, accessibility and reviewing alternatives. Built from the design feedback the user gave and got (Teams, Outlook, Figma comments, pull request reviews) and their chats with agents, and kept current by the weekly skill update. Pair with my-voice for writing style."
---
<!-- personal skill: my-taste, built from this person's own work (tools/personal-skills.py). Keep this line. -->

# My taste

## How to use

Apply the `everywhere` rules plus the ones for the area you're working on. Rules for other areas
are hints only. Areas are plain descriptions of a surface (`app/settings`, `website/home`), never
codenames.

Rules are weighted evidence, not laws. The current request wins, and the user's latest word beats
anything here. Each rule ends with the kinds of sources it came from, how many times it showed up,
the last time it did, and whose it was: `own` (the user said it), `received` (someone said it to
the user, and they agreed or acted on it), or `mixed`.

Shared design defaults in other skills (for example
[design taste](../autonomous-prototypes/references/design-taste.md)) apply only where these rules
are silent. Pair with [my-voice](../my-voice/SKILL.md) for copy.

## Design

How things should work and read: labels and states that match behavior, hierarchy, grouping,
choices, and flow.

_No rules yet: setup builds them from the user's own design feedback._

## Product feel

Fitting the product: its own components, tokens, icons, states, platforms, and accessibility.

_No rules yet._

## Taste

The look: chrome, density, color, emphasis, motion, realism, and detail.

_No rules yet._

## How I review

How the user reviews work and decides: what they check, what evidence they want, and how they like
options shown.

_No rules yet._

## How this stays accurate

Setup builds these rules from the user's own work, read only: the design feedback they gave and got
in Teams and Outlook (including Figma comment emails), their pull request reviews on GitHub, and
the corrections, approvals, and rejections in their chats with agents. The steps are in
[taste from Work IQ](references/taste-from-workiq.md). The evidence stays on this machine, in
`~/.copilot/skill-miner/private/`. This file keeps only short rules in general words, with no quotes
from messages, no names, no links, and no product codenames.

Each week, the skill update reads what the user typed to their agents and adds or updates rules
here, one at a time. To read newer feedback too, the user can say "refresh my voice and taste".
Updates to the shared skills never replace this file. Once it's the user's, it stays theirs.

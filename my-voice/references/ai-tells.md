# Signs of AI writing

Run this as the last pass on anything written as the user. It boils down Wikipedia's field guide,
[Signs of AI writing](https://en.wikipedia.org/w/index.php?title=Wikipedia:Signs_of_AI_writing&oldid=1384793302)
(October 2026 revision, CC BY-SA), to what applies to the user's channels: Slack and Teams posts,
email, LinkedIn, PR and issue text, commit messages, UI copy, and scripts. It's the same for
everyone's `my-voice`: the user's own rules in SKILL.md sit on top of it and decide what it leaves
open.

## The real problem

Models drift toward the average. They trade a specific fact for a generic claim that sounds
important, so "added a lock next to locked options" turns into "significantly enhances clarity and
user confidence". The sentence ends up saying less while sounding bigger.

So don't just delete the words below and swap in synonyms. That hides the symptom and keeps the
vague sentence. Go back to the fact: what changed, for whom, where, and by when. If there's no fact
behind a sentence, cut it.

One word from these lists isn't a problem. A cluster of them is.

## Content patterns

- **Puffed-up importance.** "Serves as a testament to", "plays a pivotal role", "marks a turning
  point", "underscores the importance of", "reflects a broader shift", "in an evolving landscape",
  "sets the stage for", "leaves a lasting mark", "this distinction matters because". Also calling
  something minor and then explaining why it's important anyway. Say what it does.
- **A trailing verdict.** A sentence that ends in ", highlighting...", ", underscoring...",
  ", ensuring...", ", reflecting...", ", fostering..." or ", contributing to..." tacks on an opinion
  where a fact should be. End the sentence at the fact.
- **Vague links between things.** "Associated with", "connected to", "in connection with". Name the
  relationship instead: "owns", "is blocked by", "ships in".
- **Vague sources.** "Users have said", "experts argue", "observers note", "several studies" when
  there is one, or "the docs identify X as" when you could just state X and link the doc. Say who and
  how many ("4 of 6 participants").
- **Promotional words.** Boasts, vibrant, rich, profound, groundbreaking, renowned, nestled, in the
  heart of, commitment to, a diverse array of. They read as marketing copy, not as a person.
- **Formula sections.** "Despite these challenges...", "Challenges and future outlook", "Looking
  ahead", "Awards and recognition". If there's a next step, say it plainly.
- **Hedges about what you know.** "Based on available information", "while details are limited",
  "it's important to note", "should be treated as X rather than Y", "does not by itself establish".
  State what's known, or name the open question.

## Word patterns

- **Tell words.** Watch for them in clusters: additionally (to start a sentence), crucial, delve,
  enhance, foster, garner, intricate, interplay, key (as an adjective), landscape (when nothing is a
  landscape), leverage, meticulous, multifaceted, pivotal, showcase, tapestry, testament,
  underscore, valuable, vibrant. Models from 2026 on also lean on align with, prioritize,
  dependable, practical, steady, quietly, clearer, matters, echoed, universally, and deep dive.
- **Dodging "is" and "has".** "Serves as", "stands as", "functions as", "represents", "boasts",
  "features", "offers". Write "is" and "has".
- **"Not just X, it's Y".** Also "not only... but also", "it's not X, it's Y", "no X, no Y, just Z",
  and "rather than simply X". Just say Y.
- **Reflexive threes.** "Fast, simple, and reliable." Use as many items as there really are; two is
  fine, and so is one. The channel patterns that ask for two or three bullets are about length, not
  a rhythm to hit.
- **Synonym cycling.** Calling the same thing "the setting", then "the option", then "the toggle" to
  avoid repeating a word. Use the same word every time. It's clearer, and it's what people do.

## Rhythm and punctuation

Heavy em dash use was the best-known tell for years (Wikipedia now lists it as a historical sign),
and many readers still take it as one: use dashes no more than the user does, and not at all if
their rules say so. Models trained to skip dashes fall back on nothing but periods and commas, with
every sentence between 8 and 20 words. That flat, even beat is now a tell of its own.

Keep the user's own sentence rhythm, but don't make every sentence the same length. A colon
before an example, parentheses for an aside, a question, or one longer sentence when the idea needs
room all break the pattern. Read it out loud, and if every sentence lands on the same beat, rewrite
one.

## Formatting

- Sentence case headings, not Title Case.
- Bold the one thing the reader must not miss (the question, the date), not every other phrase.
- No "**Label:** sentence" bullets unless the channel pattern asks for them.
- No emoji at the start of every heading or bullet. Use emoji only the way the user does (their
  channel patterns say how); more than that is a tell.
- Straight quotes and apostrophes, not curly ones carried over from a chat window.
- No Markdown where it won't render (a plain text box, some forms, a `.txt`).

## Chatbot leftovers

Before handing text over, take out anything that talks to the user instead of the reader:

- "Here's a draft...", "Certainly!", "Great question", "I hope this helps", "Let me know if you'd
  like me to adjust the tone", "Would you like a shorter version?"
- Notes and placeholders: "verify before posting", "[add link]", "[Name]", "2026-XX-XX",
  "INSERT_URL", "example.com".
- Tracking junk in links: `utm_source=chatgpt.com`, `utm_source=copilot.com`, `referrer=grok.com`,
  `contentReference[oaicite`. Strip the query string back to the real link.

The user's own closers (the ones in their channel patterns and samples) are fine. They're asks to
teammates, not offers from an assistant.

## Customer-service tone

A reply to a person should read like a person wrote it. Leave out "I hope this message finds you
well", "Dear team, I am writing to...", "I apologize for any inconvenience", "I understand your
concerns", and "I have carefully reviewed". A warm line that's actually about the reader is
different and fine. And don't split a short reply into titled sections.

## Commit messages, PR text, and changelogs

These are the user's edit summaries, and AI ones are easy to spot:

- Canned claims: "improved clarity and flow", "enhanced", "refined", "streamlined", "ensured
  consistency", "adheres to guidelines", "in compliance with standards".
- Listing what wasn't changed: "preserved existing behavior", "retained the original structure",
  "avoided unrelated changes".
- Saying the obvious: "addressed review feedback", "updated files".
- Lists of every parameter or file name touched.
- A rigid label like "Summary of changes:" on a one-line change.

Say what changed in terms of the thing itself: "Lock icon next to locked options", "Move Learn more
to the end of the description".

## What human writing looks like

- "There is", "it has", "it is".
- Plain verbs: used (not utilized), wrote (not authored), moved (not relocated), tried (not
  attempted), started (not commenced).
- A definite claim when it's true: "the first", "the only", "the fastest we've tested".
- Ordinary qualifiers: "very", "probably", "tends to", "I think".
- A little ordinary wordiness ("in order to", "the fact that") is fine, so don't sand every sentence
  down to the minimum.

## Don't over-correct

None of these are tells on their own: clean grammar, a mix of casual and formal, a transition word
like "however", or a formal register when the channel calls for one. Don't add typos or slang to
sound human.

When copyediting the user's own draft, their wording stays ("Keep their wording" in SKILL.md). If
something in it matches this list, mention it rather than rewriting it.

## Final pass

1. Does every sentence carry a fact (a name, a number, a link, a date, a change)? Cut the ones that
   don't.
2. Is there a cluster of tell words, a "serves as", a "not just X but Y", a trailing verdict, or a
   reflexive three?
3. Did a chatbot line, a placeholder, or a tracking parameter get left in?
4. Do sentence length and punctuation vary, with no dashes?
5. Would the user have typed it?

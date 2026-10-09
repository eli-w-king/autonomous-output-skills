# Demo brief template

Copy this into the demo folder as `brief.md` and fill it in before touching the product. It is the
source of truth for the take: every instruction from the conversation lands here (later
instructions override earlier ones), and every round of feedback updates it before anything is
re-recorded. The structure follows the compare-models executive demo instructions that produced a
"nearly perfect" first take.

```markdown
# <Feature> demo brief (round N, <date>)

## Purpose and audience
- Who watches this, and what should they understand or feel afterward (one sentence)?
- Profile: feature video | executive | comprehensive state tour | variant matrix | storyboard |
  screenshot set | before/after | PR media | study stimulus

## Product under test
- Surface: editor window | Agents window | website | prototype
- Build: upstream main at <commit> | branch <name> at <commit> in <worktree> | site URL + variant
- Auth: real account (launch skill) | scripted (mock LLM, scenario <id>)
- Settings beyond the preset (exact ids and values):
- Theme: Dark 2026 (default) | other: ____ (one theme for every asset)
- Viewport: 1440x900 at 2x -> 1920x1200 master | square 1000x1000 | other

## Starting state (verify with /preflight and a still before recording)
- Window layout and proportions (for example chat 1/3, editor 2/3):
- Sessions list contents (clean, or N real sessions across ~4 repos at different phases):
- Open files, panels closed (file explorer, side panel, Customizations collapsed):
- Toggles and selections at first open (for example Auto OFF, model <current model>):
- Nothing visible: toasts, banners, hovers, menus, dialogs, sign-in prompts

## Scenario
- The user goal in one sentence:
- Exact prompt(s), typed on camera:
- Models (current, not retiring; picked by clicking, not search):

## Beats (one idea each)
| # | Action | On screen | Focus | Pointer | Hold / speed |
|---|--------|-----------|-------|---------|--------------|
| 1 | Lead-in | starting state | whole window | parked in empty space | 2.5 s |
| 2 | ... | ... | ... | glide + click | 1.5 s |
| n | Lead-out | final result | result | parked | 2.5 s |

Idle waits to fast-forward in place (mark names): wait_x_start -> wait_x_end @ 10x

## Must show
- 

## Never show
- Errors, warnings, failed tool calls, toasts, sign-in prompts, tooltips (unless the subject)
- Deprecated or retiring models, search used to find something clickable
- Old or unrelated sessions, random zooms, cuts that look like one take
- 

## Deliverables
- Folder: ~/Desktop/<Project> Demos/Round N - <what changed>/
- Files: <Feature> - <variant>.mp4 (master), Stills/, Read me.txt
- Also: GIF for the PR | storyboard PDF | before/after set | open the video when done
- Length target after speed ramps:

## Demo-specific QA
- 
```

## Read me.txt template

Keep it short, factual, and free of marketing tone. Do not narrate the process.

```text
ROUND N: <WHAT CHANGED, IN CAPS>
<Month D, YYYY>. <Theme>. Real Code OSS UI<, with scripted responses>.
<This replaces Round N-1.>

WATCH
- "<Feature> - <variant>.mp4": <one line on what it covers>
- Stills/ has a full-window PNG of every state (plus zoomed crops of <x>).

WHAT CHANGED
01  <change>
02  <change>

ASSUMPTIONS TO CONFIRM
- <anything decided without the user>

NOTES
- <what is scripted or simulated, if anything; what could not be shown honestly and why>

Code: <worktree path>
Branch <branch>, commit <short sha>
Settings: "<setting.id>": <value>
```

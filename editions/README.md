# Editions

Lighter copies of some skills for one audience, with the same names as the full skills.

| Edition | For | Skills |
|---------|-----|--------|
| [`ai-first/`](ai-first/) | The public AI-First Design Workshop: personal Mac and Windows laptops, cheap by default, nothing employer-specific | required: autonomous-variations, autonomous-prototypes, autonomous-demos, autonomous-computer-use; optional: autonomous-runs, autonomous-research, my-taste |

- **Installing.** An edition is installed only when someone picks it: the workshop setup copies
  `ai-first/<name>/` to `~/.copilot/skills/<name>` (`$COPILOT_HOME/skills`) and backs up what was there. The
  daily sync (`tools/sync-skills.py`) and the repo's other installers manage top-level skill folders only, so
  they never install an edition.
- **The list.** Each edition's `editions.json` names its skills, required or optional, with one line on each, and
  the skills it must never have (`my-voice` for ai-first).
- **Checks.** `tools/validate-skills.py` checks edition skills like full ones (front matter, links, no em or en
  dashes, the private terms), checks that each shares its name with a full skill and matches `editions.json`, and
  warns when a `SKILL.md` grows past a third of the full one. `tools/publish-public.py` publishes `editions/` with
  everything else. `tools/test-editions.py` tests all of this.
- **Editing.** Keep them short and cheap, with nothing employer-specific. Scripts are Node, since the workshop
  setup installs Node and Git but not Python. When a full skill learns something an edition's audience needs,
  bring it over by hand, in the edition's own words.

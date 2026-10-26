# Skill vs custom agent (how to package this)

Packaging note for [`autonomous-research-synthesis`](../SKILL.md).

This is a **skill** on purpose: it is procedural knowledge plus scripts that any agent loads on demand,
it stays out of the mode picker, and it is user-global across sessions with one source of truth. Keep it
that way.

Wrap it in a **custom agent / chat mode** only for what a skill cannot do:
- You want the native **plan then auto-handoff** UX (only `*.chatmode.md` files can declare `handoffs:`).
- You want a **discoverable, user-selectable** entry in the mode picker rather than relying on the model
  to pick the skill.
- You want a **scoped tool set, pinned model, or gating** for a phase.

The right shape is a **thin** chat mode that defers to this skill (its body is essentially "follow the
`autonomous-research-synthesis` skill"), never a copy of the procedure. Ready-to-use templates live in
`chatmodes/` next to this file; activate by copying them into a workspace `.github/chatmodes/` or your
user prompt-files location. **Guardrail:** never put an irreversible step behind an auto-send handoff.
Recruiting real participants and posting to a public repo stay explicitly human-gated; only plan to
build should auto-advance.

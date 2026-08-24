# Project rules

> Project-specific rules for THIS project. Always loaded alongside the global baseline
> (`.codeforge/WORKFLOW.md` golden rules + `.codeforge/rules/*`). These **add and refine** — they
> **should not** override the global safety rules (branch safety, ship-gate) — advisory;
> nothing enforces it. See `.codeforge/rules/project-rules.md`.
> Copy this file to `PROJECT.md` and fill it in.

## Persona

<How the agent should behave here: tone, stance, what to optimize for. One short paragraph.>

## Project info

<What this project is, its stack, layout, and anything an agent needs to orient. A few lines.>

## Variables

<Stable facts the agent should reuse: repo URL, service URLs/ports, key names, entry points.>

- `<KEY>`: `<value>`

## Special rules

<Project-specific dos/don'ts that go beyond the global baseline. Bullet list.>

- <rule>

## Review policy

<!-- Managed by the codeforge setup wizard — and the SOURCE OF TRUTH for these three values.
     PROJECT.md is project-owned, so it survives `--upgrade`; `.codeforge/rules/models.md` and
     `.codeforge/state.template.md` are MANAGED (refreshed by name on every install), so a value
     written only there is silently reset. The installers re-render both FROM this section on
     every run. Reviewer/advisor engine lists are authoritative allowlists: an engine omitted
     here must never be used as a fallback. Edit here, or re-run the wizard. See
     `.codeforge/rules/project-rules.md`. -->

Default reviewer(s): Codex (`gpt-5.6-sol`, xhigh), Claude (`opus`, high)
Council advisors: Codex (`gpt-5.6-sol`, xhigh), Claude (`opus`, high), OpenCode (`opencode-go/glm-5.2`, default)
Gate profile: standard

## Execution

<How the driver runs a multi-task plan. Managed by the codeforge setup wizard — see
`.codeforge/rules/execution.md`. Default: inline. `subagent-driven` uses the native generated
implementer on Claude Code and Codex; unsupported harnesses fall back to inline.>

Execution: inline

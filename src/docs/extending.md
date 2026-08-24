# Extending codeforge

How to add capability while keeping the project simple and interoperable across
**Claude Code, Codex, and OpenCode**.

## The rule of thumb

> A **skill** can express anything the agent *should do* (an instruction). A
> **script/hook** is needed only when something must *happen regardless* — block an
> action, run outside the agent's turn, or compute deterministically without relying on
> the model to comply.

Prefer the lowest tier that does the job. Higher tiers add power but cost simplicity and
portability.

---

## Tier A — Skills only (advisory, fully portable)

Anything that is a *procedure or criterion*. Add these freely — no config changes; after
running `.codeforge/sync.sh` all three engines pick them up automatically.

Examples:

- New workflow skills (any command/flow).
- A research step before designing ("investigate and write the brief").
- Cross-engine review ("have the other engine review this plan/diff").
- Severity rubric, TDD sequence, approach comparison, PR-description format.
- "Verify by exercising it."
- A lightweight multi-engine council (a skill that orchestrates calling several engines
  and synthesizing).
- Checklists and keeping `.codeforge/workflow/state.md` updated.

**Cost:** the agent does it *because instructed*. Nothing prevents non-compliance.

Native implementation delegation follows the same source-first rule: edit the bounded-task
contract in `.codeforge/agents/codeforge-implementer.md`, then sync to regenerate the Claude Code
Markdown and Codex TOML definitions. Keep engine-specific model pins out of the neutral contract;
add a deliberate engine override only when the project truly needs it.

### How to add a skill

1. `mkdir .codeforge/skills/<name>` — the directory name must be lowercase, hyphen-separated.
2. Create `.codeforge/skills/<name>/SKILL.md` (uppercase filename) with frontmatter:
   ```
   ---
   name: <name>          # must equal the directory name
   description: <1–1024 chars; when to use it>
   ---
   ```
   then the steps, referencing `.codeforge/rules/*` and `.codeforge/workflow/state.md`.
3. Run `.codeforge/sync.sh` (or `pwsh .codeforge/sync.ps1` on Windows).
   It regenerates `.claude/skills` (Claude Code + OpenCode) and `.agents/skills` (Codex +
   OpenCode) from `.codeforge/skills/` — a full mirror, so every engine discovers the skill.

**Upgrade note:** framework skills are refreshed by name. Custom skills and rule files with
distinct names under `.codeforge/skills/` and `.codeforge/rules/` are preserved automatically;
a name collision intentionally selects the framework version.

---

## Tier B — Skills + agent-invoked scripts (deterministic, still advisory)

No hooks. A skill tells the agent to run a helper script (e.g.
`.codeforge/scripts/check-gates.sh`).
You gain determinism and reuse; a single POSIX script serves all three engines. But it
runs **only when the agent chooses to call it**.

Good fits:

- A `.codeforge/workflow/state.md` validator (are the required boxes checked?).
- A reproducible git/drift check.
- An artifact checker that *reports* (not blocks) whether a brief/evidence file exists.

**Cost:** deterministic, but still skippable — the agent may not invoke it.

Convention: keep such scripts in `.codeforge/scripts/`, POSIX `sh`, no engine-specific assumptions,
and have the relevant skill name the exact command to run.

---

## Hooks (automatic, blocking, or out-of-turn) — NOT portable

Needed only when something must be *guaranteed* — it cannot be expressed as an
instruction. This is where interoperability breaks: each engine has a different mechanism,
so it means maintaining up to three implementations.

Capabilities that require this tier:

- **Conditional blocking** of commit/push/PR based on `.codeforge/workflow/state.md` (the native
  `permission` gates only do "always ask", not "block *if* gates are unmet").
- **Unbypassable evidence gate** / per-iteration clean evidence / a convergence breaker.
- **A mandatory research gate** (cannot start design until the brief exists).
- **Out-of-turn events:** per-turn phase reminder, dynamic session-start injection,
  pre-compaction save, post-edit auto-format, auto-approve of local writes.

Per-engine mechanism (all can block):

| Engine | Mechanism | Block signal |
| --- | --- | --- |
| Claude Code | hooks in `.claude/settings.json` | `PreToolUse` exit code 2 |
| Codex | `hooks.json` (`$CODEX_HOME` or `<repo>/.codex/hooks.json`) | `PreToolUse` exit code 2 |
| OpenCode | plugin with `tool.execute.before` | throw to abort |

**Trade:** three separate implementations to keep in sync, plus per-engine trust/merge
concerns. Reach for it only when a real guarantee is worth that cost — and start with a single
engine. **codeforge doesn't ship per-engine runtime hooks.** Instead, the real example of this
tier is **the CI Verified template** (`docs/ci-templates/`): a workflow where CI independently
re-runs the project's declared test command on the PR's merge result, outside any agent's
turn — no per-engine adapter needed, because it runs in CI, not in an agent's session. Once
wired up as a required status check under branch protection, it blocks the merge outside any
engine's turn; it becomes bad-faith-**resistant** (never "proof") — rather than just a check
that can be quietly weakened — only once the repo is also fully configured per
`docs/ci-templates/README.md` (CODEOWNERS on the workflow and test-defining files,
dismiss-stale-approvals, strict/up-to-date checks or a merge queue), and even then it still
depends on a human actually reading those diffs. Repo/org admins can still bypass branch
protection unless you've configured otherwise. See `.codeforge/rules/ship-gates.md` for the
Verified/Attested/Advisory ladder.

---

## verify-e2e roadmap (v2)

Shipped: the **UI interface adapter** — `verify-e2e` now drives browser-based use cases
alongside API/CLI, and the workflow skills (`new-feature`, `fix-bug`) route UI-facing
changes through it instead of recording `N/A`.

Planned extensions to the `verify-e2e` skill — each is a skill/config change, no hooks
needed:

- **Playwright `.spec.ts` regression bridge:** graduate passing use cases into
  deterministic, replayable spec files for CI, alongside the markdown use cases.
- **Automatic multi-surface coverage audit:** flag when a feature exposes UI/API/CLI
  surfaces but use cases only cover a subset.

---

## Decision checklist

Before adding something, ask in order:

1. Is it a procedure the agent should follow? → **Tier A** (a skill).
2. Does it need deterministic, repeatable computation, but only when asked? → **Tier B**
   (a skill that invokes a `scripts/` helper).
3. Must it be enforced/automatic even if the agent doesn't cooperate, or run outside a
   turn? → **hooks** (per engine) — accept the portability cost, or scope to one engine; for
   ship-gate enforcement specifically, prefer the CI Verified template (`docs/ci-templates/`)
   over a per-engine hook.

Default to the lowest tier that works. Most new functionality is Tier A.

# Execution mode

How the driver executes a multi-task plan (the implementation phase of `new-feature` /
`fix-bug`). The active mode is the `Execution:` line in `PROJECT.md`, set by the codeforge
setup wizard. Default: **inline**. Delegation is native to the active harness; it is separate
from the cross-engine reviewer and council roles in `models.md`.

## Modes

- **inline** — the driver implements each task itself, in its own turn (red → green →
  refactor per `tdd.md`). This is the default on every harness.
- **subagent-driven** — on Claude Code or Codex, the driver dispatches a **fresh native
  subagent per task** to the generated `codeforge-implementer` definition. Each subagent
  implements one task TDD, runs the covering tests, leaves its changes unstaged under the
  parent-owned git policy, and reports back. OpenCode remains inline until codeforge ships
  a tested native adapter for it.

The canonical implementer contract lives at
`.codeforge/agents/codeforge-implementer.md`. `.codeforge/sync.sh` / `sync.ps1` render it to:

- Claude Code: `.claude/agents/codeforge-implementer.md`
- Codex: `.codex/agents/codeforge-implementer.toml`

Both inherit the active session's model defaults. This avoids pinning a project to a model id
that can become stale; engine-level config may override the model when a project genuinely
needs that distinction.

## How to apply it

1. Read the `Execution:` line in `PROJECT.md`. If it is absent, use **inline**.
2. In **inline**, keep implementation in the driver.
3. In **subagent-driven** on Claude Code or Codex, dispatch `codeforge-implementer` with one
   bounded task brief. Do not implement that same task concurrently in the driver.
4. Dispatch write-capable implementation tasks **sequentially** in the shared project. Parallel
   subagents are for read-only exploration, triage, summarization, or tests proven not to create
   snapshots, coverage, build output, caches, lockfile changes, or in-repo temporary files.
   Parallel write tasks require explicit isolation in separate git worktrees and parent-controlled
   integration. Never exceed the harness's configured concurrency.
5. Wait for every dispatched task, inspect its report and diff, run integration verification,
   then continue. A subagent report is evidence, not automatic acceptance.
6. On a harness without the generated adapter or native subagent support, say so and fall back
   to **inline**. Never substitute an unconfigured engine.

Reviewer/council roles remain cross-engine per `models.md`; an implementation subagent is not
a reviewer and a failed review is not a reason to dispatch more implementers.

## Orchestration: `owner` and `commit_policy`

**`owner`** — a skill runs either standalone (`owner=self`, the default) or as a subordinate of an
orchestrator (`owner=goal`; only `goal` orchestrates today).

- `owner=self`: follow the skill's **existing standalone contract** unchanged.
- `owner=goal`: the orchestrator OWNS state init, all phase transitions, both review loops and the
  breaker, `simplify`-once, the human gates, the single ship commit (made BEFORE GATE 2 — see
  `ship-gates.md` / the `goal` skill), and the terminal transition. A subordinate skill under
  `owner=goal` MUST NOT: copy the state template / re-init state; run its own review loop to
  convergence or write review-log lines; invoke `simplify`; advance phases; or run
  `git commit` / push / `gh pr create`. It returns only the requested phase output; `/goal` records
  review-log lines and advances the breaker.

**`commit_policy`** — the only supported value is `defer`. Every implementer runs TDD, verifies
its bounded task, and leaves its changes **unstaged and uncommitted**. It reports
`status (DONE/BLOCKED) + task id + changed files + one-line test summary`. The parent driver owns
the git index, certification digest, integration checks, and the single ship commit after all
gates are green.

The dispatching driver states `commit_policy=defer` (and `owner`) in every task brief. On
`BLOCKED`: report the blocker and leave the git index untouched.
The implementer must also avoid every worktree/history-mutating Git command listed in the
canonical implementer contract; sequential execution is not recoverable if a child runs
`stash`, `restore`, `reset`, `clean`, or changes branches.

# /goal Plan B (rev2) — composition plumbing (execution.md + generated agent + owner=goal overrides)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Make the composed skills safe to drive under `/goal` — (1) teach `execution.md` the
`owner` + `commit_policy` contract *and reconcile the existing Modes text*, (2) make the generated
`codeforge-implementer` agent honor `commit_policy` (stage-only under `defer`) and be upgrade-safe,
(3) add `owner=goal` **override** notes that explicitly DISABLE the standalone loop/ship/logging
steps of `plan` / `review` / `new-feature` / `finish-branch` (not merely describe ownership).

**Architecture:** Engine-neutral prose/config in `src/` + one JS generator change with tests. No
non-`/goal` behavior change: `commit_policy` defaults to `per-task` (today), `owner` defaults to
`self` (= each skill's existing standalone contract).

**Tech Stack:** Markdown, Node (`cli/lib/apply.mjs`), `node:test`.

## Global Constraints (design spec §3, §6, §7, §8)

- `owner=self` = follow the skill's **existing standalone contract** (some skills init+ship, e.g.
  new-feature; utilities like `plan`/`review` do neither). `owner=goal` = the orchestrator owns
  state init, all phase transitions, both review loops + the breaker, `simplify`-once, the two human
  gates, the single ship commit (BEFORE GATE 2, §8), and the terminal transition.
- Under `owner=goal`, subordinate skills DISABLE: their own review-loop control, iteration logging,
  `simplify` invocation, phase transitions, state init, and commit/push/PR. They return only the
  requested phase output; **`/goal` alone writes review-log lines and advances the breaker.**
- `commit_policy`: `per-task` (default, standalone — legacy incremental behavior, unchanged) =
  commit + report the sha. `defer` (used by `/goal`) = **stage only, do NOT commit**; report
  `status (DONE/BLOCKED) + task id + one-line test summary` (per §7 — **no digest**; `/goal` computes
  the §6.1 certification digest itself at pass start with `base_sha`). The orchestrator makes the
  single commit at ship, so ship-gates' "no commit before green" holds.
- The generated agent must be commit_policy-aware AND **upgrade-safe**: a pre-Plan-B install must
  not silently keep an agent that commits unconditionally (see Task 2b + the Plan C preflight note).
- No linter regressions: `npm run check` stays green after each task.

---

## File Structure
- `src/shared/rules/execution.md` — edit Modes bullet + add owner/commit_policy contract (Task 1).
- `cli/lib/apply.mjs` — commit_policy-aware agent (Task 2); upgrade migration (Task 2b).
- `tools/test/apply.test.mjs` — body-specific + upgrade assertions (Tasks 2, 2b).
- `src/skills/{plan,review,new-feature,finish-branch}/SKILL.md` — owner=goal overrides (Task 3).

---

### Task 1: `execution.md` — reconcile Modes + add the owner/commit_policy contract

**Files:** Modify `src/shared/rules/execution.md`.

- [ ] **Step 1: Edit the existing subagent-driven Modes bullet** (`execution.md:11`, currently ends
  "…runs the covering tests, **commits**, and reports back"). Replace "commits, and reports back"
  with:

  `commits or stages per its commit_policy (see "Orchestration" below), and reports back`

- [ ] **Step 2: Append the Orchestration section**

```markdown
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

**`commit_policy`** — how a plan task's implementer treats commits:
- `per-task` (default, standalone): implement TDD, run the covering tests, **commit**, and report
  status + the commit sha + a one-line test summary. (Legacy incremental behavior; unchanged.)
- `defer` (used by `owner=goal`): implement TDD, run the covering tests, **stage the task's files
  only — do NOT commit**, and report `status (DONE/BLOCKED) + task id + one-line test summary`. Do
  **not** compute a digest — `/goal` owns the §6.1 certification digest (it has `base_sha`). The
  orchestrator makes the single commit at ship once the gates are green, so `ship-gates.md`'s "no
  commit before all gates green" holds even in subagent-driven mode.

The dispatching driver states `commit_policy` (and `owner`) in each task brief; the subordinate
honors it. On `BLOCKED`: report the blocker, do not commit, and do not stage a half-done task.
```

- [ ] **Step 3: Verify + commit.** `npm run check` (PASS) →
  `git add src/shared/rules/execution.md` →
  `git commit -m "docs(rules): execution.md owner + commit_policy contract (Modes reconciled)"`

---

### Task 2: `cli/lib/apply.mjs` — commit_policy-aware generated agent (conditional body)

**Files:** Modify `cli/lib/apply.mjs` (`applyClaudeAgents`); Test `tools/test/apply.test.mjs`.

- [ ] **Step 1: Write the failing test** (append to `tools/test/apply.test.mjs`)

```js
test('generated implementer agent is commit_policy-aware in its BODY (not just description)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-agents-cp-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  applyClaudeAgents(dir, { claude: { subagents: true, model: { model: 'sonnet', effort: 'high' } } });
  const f = readFileSync(join(dir, '.claude', 'agents', 'codeforge-implementer.md'), 'utf8');
  const body = f.split('\n---\n').slice(1).join('\n---\n');   // everything after frontmatter
  assert.match(body, /commit_policy/);
  assert.match(body, /per-task[^\n]*commit[^\n]*sha/i);       // per-task branch: commit + sha (body)
  assert.match(body, /defer[\s\S]*(do NOT commit|stage[^\n]*only)/i); // defer branch: stage only (body)
  assert.doesNotMatch(body, /make it pass with the minimal change, run the covering tests, commit,/); // no unconditional commit
  assert.match(f, /^model: sonnet$/m);                        // still parameterized
  assert.match(f, /name: codeforge-implementer/);
});
```

- [ ] **Step 2: Run — verify failure.** `node --test tools/test/apply.test.mjs` → FAIL (current
  body has the unconditional commit, no `commit_policy`).

- [ ] **Step 3: Replace the template** in `applyClaudeAgents` (`cli/lib/apply.mjs:88-98`):

```js
  const file = `---
name: codeforge-implementer
description: Implements exactly one task from the active codeforge plan (TDD: red → green → refactor), runs the covering tests, and reports back. Honors the dispatch brief's commit_policy (per-task = commit + report sha; defer = stage only, no commit). Dispatch one per task when running subagent-driven.
model: ${c.model.model}
---

You implement ONE task from the active codeforge plan. Read the task, write the failing
test first, make it pass with the minimal change, and run the covering tests. Then honor the
**commit_policy** the dispatching driver gave you (see shared/rules/execution.md):

- commit_policy=per-task (the default): commit, then report status (DONE / BLOCKED), the
  commit sha, and a one-line test summary.
- commit_policy=defer (used by /goal): do NOT commit — stage this task's files only, then
  report status (DONE / BLOCKED), the task id, and a one-line test summary. Do not compute a
  digest; the orchestrator owns it and makes the single commit at ship.

On BLOCKED: report the blocker; do not commit and do not stage a half-done task. Do not start
other tasks. Follow the repo's TDD and ship-gate rules.
`;
```

- [ ] **Step 4: Run — verify pass.** `node --test tools/test/apply.test.mjs` → PASS (new body test +
  the two existing `applyClaudeAgents` tests: `model: sonnet` / `name:` preserved).

- [ ] **Step 5: Commit.**
  `git add cli/lib/apply.mjs tools/test/apply.test.mjs` →
  `git commit -m "feat(cli): commit_policy-aware codeforge-implementer agent (conditional body)"`

---

### Task 2b: upgrade-safety — refresh a stale generated agent

**Files:** Modify `cli/lib/apply.mjs`; Test `tools/test/apply.test.mjs`.
**Why:** `applyClaudeAgents` runs only via the interactive wizard; `--upgrade`/`sync` do not refresh
`.claude/agents`. A pre-Plan-B subagent-driven install would keep the old unconditional-commit
agent even after upgrading to a `/goal`-capable codeforge (Codex finding). Minimal, honest fix:
regenerate the agent whenever `applyClaudeAgents` runs over an existing stale file, and have Plan C's
`/goal` capability-preflight (§6.4) HALT on a stale agent (documented here as a Plan C dependency).

- [ ] **Step 1: Write the failing test** (append to `tools/test/apply.test.mjs`)

```js
test('applyClaudeAgents overwrites a stale (pre-commit_policy) agent file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-agents-stale-'));
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  const p = join(dir, '.claude', 'agents', 'codeforge-implementer.md');
  writeFileSync(p, '---\nname: codeforge-implementer\nmodel: old\n---\n…runs the covering tests, commit, then report the commit sha.\n');
  applyClaudeAgents(dir, { claude: { subagents: true, model: { model: 'sonnet' } } });
  const f = readFileSync(p, 'utf8');
  assert.match(f, /commit_policy/);            // refreshed
  assert.match(f, /^model: sonnet$/m);         // and re-parameterized
});
```

- [ ] **Step 2: Run — verify.** It likely already PASSES (`writeFileSync` overwrites) — if so, this
  test is a **regression guard** that the generator always overwrites rather than skipping when the
  file exists. If it FAILS (a skip-if-exists guard was added), remove that guard so the managed
  agent is always regenerated. Then add the Plan C dependency note (Step 3).

- [ ] **Step 3: Document the Plan C preflight dependency.** Add a comment above `applyClaudeAgents`
  in `cli/lib/apply.mjs`:

```js
// NOTE: the generated agent is refreshed only when the wizard (applyClaudeAgents) runs. `sync`
// and `--upgrade` do NOT touch .claude/agents, so /goal's capability-preflight (design §6.4) MUST
// verify this file contains `commit_policy` and HALT if it doesn't (stale pre-Plan-B agent),
// telling the user to re-run codeforge setup. Owned by Plan C; noted here so it isn't lost.
```

- [ ] **Step 4: Run + commit.** `node --test tools/test/apply.test.mjs` → PASS →
  `git add cli/lib/apply.mjs tools/test/apply.test.mjs` →
  `git commit -m "test(cli): guard that codeforge-implementer is regenerated (upgrade-safety) + Plan C preflight note"`

---

### Task 3: `owner=goal` OVERRIDE notes (explicitly disable standalone loop/ship/logging)

**Files:** Modify the four `SKILL.md` files. Each note is an explicit override, not a description.
The linter (`tools/lint-skills.mjs`) checks frontmatter + anatomy + index parity + shared refs;
these additive sections touch none, so `npm run check` stays green.

- [ ] **Step 1: `plan/SKILL.md`** — after "## 5. Hand off to implementation", add:

```markdown
## Under `/goal` (owner=goal)

`/goal` invokes `review` directly and owns the plan-review loop and its `.workflow/state.md` logging
(`shared/rules/execution.md`). Under `owner=goal` this skill **produces the plan only** — it does
**NOT** run its own step 3 reviewer dispatch, does not loop to convergence, and does not write
review-log lines. `/goal` runs review, counts rounds, and enforces the breaker.
```

- [ ] **Step 2: `review/SKILL.md`** — after "## 4. Act and record", add:

```markdown
## Under `/goal` (owner=goal)

Under `owner=goal`, perform **exactly one** read-only reviewer pass and return the severity-tagged
findings. Do **NOT** do step 4's "resolve, re-run, record each iteration" — `/goal` owns the loop:
it decides iterations, writes the review-log lines, and enforces the breaker
(`shared/rules/execution.md`). No looping, no state writes from this skill.
```

- [ ] **Step 3: `new-feature/SKILL.md`** — after "## 7. Ship", add:

```markdown
## Under `/goal` (owner=goal)

`/goal` drives the phase sequence itself; it does not run `new-feature` as a standalone unit. If a
phase's guidance here is used under `owner=goal`, the following belong to `/goal`, not this skill:
state init (§0), design-review and code-review **loop control** (§3/§5), `simplify`, verify (§6),
ship (§7), review-log lines, and phase transitions. Implementers run with `commit_policy=defer`
(stage-only; `/goal` commits once at ship). This skill contributes only the requested phase's work.
```

- [ ] **Step 4: `finish-branch/SKILL.md`** — after "## 6. Update transient state", add:

```markdown
## Under `/goal` (owner=goal)

Under `owner=goal`, `/goal` owns the ship — this skill does **NOT** independently run steps 4–6.
`/goal` performs them in its §8 order: **single commit FIRST**, then it proves the committed-tree
digest equals the certification digest, then **GATE 2** authorizes the already-committed head, then
push → PR. Step 3 (durable docs) may add **only** the CHANGELOG at ship time (it is digest-neutral);
any ADR/solution doc must be written **before** final certification, because a post-certification
change to a digest-covered path forces code-review re-entry (`goal` skill §6.5).
```

- [ ] **Step 5: Verify + commit.** `npm run check` (PASS) →
  `git add src/skills/plan/SKILL.md src/skills/review/SKILL.md src/skills/new-feature/SKILL.md src/skills/finish-branch/SKILL.md` →
  `git commit -m "docs(skills): owner=goal override notes (disable standalone loop/ship/logging)"`

---

## Self-Review (rev2)

**Plan-review findings (Opus + Codex) — disposition (all fixed):**
- P1 `## Modes` "commits" unconditional → Task 1 Step 1 **edits** the bullet to "commits or stages
  per its commit_policy".
- P1 defer report named a `goal-digest.sh` before/after digest the tool can't yield (needs
  `base_sha`, pass-level, before-value unrecoverable) → **dropped**; defer report = `status + task
  id + test summary` (§7); `/goal` owns the digest. Global Constraints + Task 1 + Task 2 aligned.
- P1 Task-2 test false-green on the description → asserts the **body** per policy AND the absence of
  the unconditional-commit sentence.
- P1 owner=goal notes didn't disable loops → rewritten as explicit **overrides**: `plan` skips its
  reviewer dispatch; `review` = one pass, no rerun/logging; `new-feature` = no loop control /
  simplify / verify / ship / transitions; all logging + breaker belong to `/goal`.
- P1 finish-branch ordering → note now states commit FIRST → committed-tree==cert → GATE 2 →
  push/PR, and restricts step-3 docs at ship to CHANGELOG only (ADR/solution before cert).
- P1 upgrade-safety → Task 2b (regenerate stale agent + regression guard) + a documented Plan C
  preflight dependency (HALT on a stale non-`commit_policy` agent).
- `owner=self` redefined as "existing standalone contract" (not "init+ship"), since `plan`/`review`
  do neither.

**Placeholder scan:** clean. **Consistency:** `per-task`/`defer` and the defer report shape
(`status + task id + test summary`, no digest) are identical across execution.md, the agent, and
the constraints; the owner=goal overrides are mutually consistent and match spec §3/§6/§8.
**Regression:** Tasks 1/2b/3 additive or overwrite-guarded, validated by `npm run check`; Task 2
preserves the existing agent tests; no non-`/goal` behavior change.

**Deferred to Plan C:** the `/goal` skill, index, evals, template `## Blockers`/`## Attempts`,
smoke, and the §6.4 capability-preflight that consumes Task 2b's stale-agent HALT requirement.

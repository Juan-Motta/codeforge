# /goal Plan C (rev2) — the `/goal` orchestrator skill + shipped rules + wiring

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Ship the `/goal` skill — the engine-neutral orchestrator that drives one feature objective
`prd → research → plan → tdd → review → simplify → verify → ship` mostly autonomously (two human
gates), consuming Plan A's helpers + Plan B's `owner=goal`/`commit_policy` contract. rev2 fixes the
plan-review finding that the skill referenced design-doc "§10" schemas that **don't ship to
targets**, by shipping two real rules the skill references: `shared/rules/goal-state.md` (the state/
log line schemas the shipped `goal-state.sh` parses) and `shared/rules/goal-autonomy-setup.md` (the
per-engine allow-entries the preflight needs).

**Architecture:** `/goal` is a `SKILL.md` the driver follows; it references only **shipped** rules
and scripts (never the design doc). Validated by `npm run check` (lint + evals) + `tests/smoke.sh`.

**Tech Stack:** Markdown skill/rules, JSON eval fixture, `sh` smoke.

## Global Constraints
- The skill ships to targets; the design doc does NOT. So every schema/rule the skill relies on
  must live in a **shipped `shared/rules/*.md`** (or inline in the skill) — never a "§N" pointer to
  the design doc. (This is the core rev2 fix.)
- Skill lint (`tools/lint-skills.mjs`): `goal/SKILL.md` needs valid frontmatter (`name: goal`,
  `description:` with trigger, in length), name==dir, a `src/CLAUDE.md` index entry (parity),
  anatomy (`## Common rationalizations`/`## Red flags`/`## Verification`), no model-ids, and all
  `shared/rules/*.md` refs resolve — so `goal-state.md` + `goal-autonomy-setup.md` must exist before
  the skill references them (land in earlier tasks).
- Evals: a `goal` case is required (coverage); the proposed description is empirically clean
  (`goal ~ new-feature` cosine 0.213, 91% rank-1 — measured by both reviewers), so no collision
  remediation is expected.
- The skill must faithfully carry rev5's rules: init-before-preflight, capability preflight (incl.
  stale-agent HALT + the permissions HALT pointing to `goal-autonomy-setup.md`), persist the
  REVIEWERS manifest, the two explicit gates, phase-by-phase ship-gate-checklist ticking,
  commit-before-GATE-2, bounded loops + simplify-once + cross-phase re-entry, ship-red/GATE-2-decline
  /head-drift transitions, halted-is-terminal-for-automation, and the exact `goal-digest.sh`
  invocation (`<base_sha> [repo] [--from-head]`, sh+ps1). No `nonce` (design cut it for v1).
- `npm run check` + `sh tests/smoke.sh` green after the relevant tasks.

---

## File Structure
- `src/shared/state.template.md` — `## Blockers` + `## Attempts` + goal-format `## Review log` seed (Task 1).
- `src/shared/rules/goal-state.md` — the §10 state/log line schemas (Task 2).
- `src/shared/rules/goal-autonomy-setup.md` — per-engine allow-entries for autonomous mode (Task 3).
- `src/skills/goal/SKILL.md` + `src/CLAUDE.md` (index + 2 rule entries) + `tools/evals/routing-cases.json` + `src/shared/rules/workflow.md` (Task 4).
- `tests/smoke.sh` — assert helpers + skill ship to BOTH mirrors (Task 5).

---

### Task 1: state template — `## Blockers`, `## Attempts`, goal-format `## Review log` seed

**Files:** Modify `src/shared/state.template.md`.

- [ ] **Step 1:** Replace the `## Review log` example block (currently
  `- Design review iteration 1 — <engine> — findings: …`) with a goal-format-aware comment so a
  driver mimics the parseable shape:

```markdown
## Review log

<!-- Standalone workflows: free-form "Design/Code review iteration N — <engine> — findings: …".
     Under /goal (owner=goal): fixed-schema lines that goal-state.sh parses — see
     shared/rules/goal-state.md, e.g.
     - loop=code — round=1 — kind=round — reviewer=codex — result=P1=2 — digest=<sha> — ts=<ISO> -->
```

- [ ] **Step 2:** Append after `## Notes`:

```markdown

## Blockers

<!-- HALT records (/goal, see shared/rules/goal-state.md). Empty when nothing is halted.
     - [ ] BLOCKER — <phase> — <reason> — ts=<ISO>
     HALT is terminal for automation; a human dispositions/resets before a new /goal run. -->

## Attempts

<!-- Durable retry counters (/goal, see shared/rules/goal-state.md). Empty by default.
     - ATTEMPT ship-red — n=<k> — ts=<ISO>   (n>=2 → /goal HALTs) -->
```

- [ ] **Step 3:** `npm run check` (PASS) → `git add src/shared/state.template.md` →
  `git commit -m "feat(goal): state template — Blockers/Attempts + goal-format Review log seed"`

---

### Task 2: ship `src/shared/rules/goal-state.md` (the §10 schemas the skill + goal-state.sh share)

**Files:** Create `src/shared/rules/goal-state.md`; modify `src/CLAUDE.md` (rules list).

- [ ] **Step 1: Create `src/shared/rules/goal-state.md`**

```markdown
# /goal state & log schemas

Fixed-order, single-line records `/goal` writes to `.workflow/state.md` and the shipped
`shared/scripts/goal-state.sh` / `goal-digest.sh` parse. Single active loop (v1) — **no `nonce`**.

## `## /goal loop` (one key/value row per field)

| Field     | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| goal      | one-line feature objective                                         |
| status    | active | awaiting-gate1 | awaiting-gate2 | halted | done           |
| phase     | preflight|prd|research|plan-review|tdd|code-review|verify|ship     |
| step      | `<phase>:<N>/<M>` task cursor (e.g. tdd:16/20)                     |
| reentries | code-review re-entry count (for the global cap)                    |
| base_sha  | merge-base SHA at loop start (the digest base)                     |
| gate1     | `approved ts=<ISO> prd=<path>` (empty until approved)              |

Read fields with `sh shared/scripts/goal-state.sh field <name>`.

## `## Review log` line

`- loop=plan|code — round=<N> — kind=round|recert|cert — reviewer=<engine|self> — result=clean|P0=a/P1=b/P2=c — digest=<sha> — ts=<ISO>`

The breaker counts `kind=round` lines per loop: `sh shared/scripts/goal-state.sh round-count <plan|code>`.
Certification digest = the `digest=` on the latest `kind=cert` line for the loop.

## `## /goal loop` marker + gate2 lines

- Reviewer manifest (written at preflight): `- REVIEWERS set=<engine,…,self> — ts=<ISO>` — a round
  certifies only when exactly this set is clean at one digest.
- SIMPLIFY once: `- [x] SIMPLIFY done — digest=<sha> — ts=<ISO>`.
- GATE 2 authorization: `- [x] GATE2 authorized — action=push+pr — head=<committed sha> — branch=<b> — remote=<r> — ts=<ISO>`.

## `## Blockers` / `## Attempts`

- Blocker (HALT): `- [ ] BLOCKER — <phase> — <reason> — ts=<ISO>`. HALT is terminal for automation.
- Ship-red counter: `- ATTEMPT ship-red — n=<k> — ts=<ISO>`; bump with
  `sh shared/scripts/goal-state.sh ship-red-bump` before each ship-side `check-gates` red; `n>=2` → HALT.
```

- [ ] **Step 2:** Add to `src/CLAUDE.md` "## Discipline reference (`shared/rules/`)" list:
  `` - `goal-state.md` — /goal's `.workflow/state.md` line schemas (shared with goal-state.sh) ``

- [ ] **Step 3:** `npm run check` (PASS) →
  `git add src/shared/rules/goal-state.md src/CLAUDE.md` →
  `git commit -m "feat(goal): ship goal-state.md — the /goal state/log schemas (was design-only §10)"`

---

### Task 3: ship `src/shared/rules/goal-autonomy-setup.md` (per-engine allow-entries)

**Files:** Create `src/shared/rules/goal-autonomy-setup.md`; modify `src/CLAUDE.md` (rules list).
**Why:** stock configs make `git push` / `gh pr create` ask-tier, so `/goal`'s preflight HALTs on a
fresh install with no path forward. This rule is the path the HALT points to.

- [ ] **Step 1: Create `src/shared/rules/goal-autonomy-setup.md`**

```markdown
# Enabling /goal autonomous mode (per-engine permissions)

`/goal`'s capability preflight requires the loop's own actions — spawning the cross-engine
reviewer/council CLI, and the **post-GATE-2** `git push` / `gh pr create` — to be **prompt-free**,
because an autonomous loop cannot answer a native permission prompt (it would silently stall). The
human pause is the **explicit GATE 1 / GATE 2 approvals `/goal` issues itself**, not the native
prompt — so allow-listing these commands does NOT remove human control. **Force-push stays denied.**

Apply the entries for your engine, then re-run `/goal`.

## Claude Code — `.claude/settings.json`
Move push/PR from `ask` to `allow` and allow reviewer/council spawns (keep the force-push deny):
```json
{
  "permissions": {
    "allow": ["Bash(git push:*)", "Bash(gh pr create:*)", "Bash(codex exec:*)", "Bash(claude -p:*)", "Bash(opencode run:*)"],
    "deny": ["Bash(git push --force:*)", "Bash(git push -f:*)"]
  }
}
```

## OpenCode — `opencode.json`
Change `git push*` / `gh pr create*` from `ask` to `allow` (reviewer spawns are already covered by
the `"*": "allow"` default; keep the force-push deny):
```json
{ "permission": { "bash": { "git push*": "allow", "gh pr create*": "allow" } } }
```

## Codex — `.codex/config.toml`
`approval_policy = "on-request"` prompts when a command crosses the sandbox boundary (push/PR do).
For an unattended `/goal` run, set `approval_policy = "never"` (GATE 2 remains the human control),
or add an execpolicy `.rules` file that allows exactly `git push` / `gh pr create`. Do NOT relax
`sandbox_mode` beyond `workspace-write`.

If you do not want to grant these, do not use `/goal` — run the interactive workflows
(`new-feature` / `finish-branch`) where the native prompt is appropriate.
```

- [ ] **Step 2:** Add to `src/CLAUDE.md` "## Discipline reference" list:
  `` - `goal-autonomy-setup.md` — per-engine allow-entries to enable /goal's unattended mode ``

- [ ] **Step 3:** `npm run check` (PASS) →
  `git add src/shared/rules/goal-autonomy-setup.md src/CLAUDE.md` →
  `git commit -m "feat(goal): ship goal-autonomy-setup.md — per-engine allow-entries for /goal"`

---

### Task 4: the `/goal` skill + index + eval case + workflow row (land together)

**Files:** Create `src/skills/goal/SKILL.md`; modify `src/CLAUDE.md` (index), `tools/evals/routing-cases.json`, `src/shared/rules/workflow.md`.

- [ ] **Step 1: Add the eval case** to `tools/evals/routing-cases.json` under `"skills"` (empirically
  clean per both reviewers):

```json
    "goal": {
      "positive": [
        "drive this feature from idea to a PR on your own, only check with me to approve the plan and the PR",
        "run the whole workflow autonomously and hand me a PR-ready branch — don't wait on me between steps",
        "take this objective and do prd, plan, tests, review, and verify hands-off until it's ready to ship"
      ],
      "negative": [
        { "prompt": "build the CSV export feature end to end with tests and review", "owner": "new-feature" },
        { "prompt": "the invoice totals are wrong, reproduce and fix the defect", "owner": "fix-bug" },
        { "prompt": "compare two designs and write the plan", "owner": "plan" }
      ]
    }
```

- [ ] **Step 2: Write `src/skills/goal/SKILL.md`**

````markdown
---
name: goal
description: Drive one feature objective autonomously from idea to a PR-ready branch — prd → plan → TDD → cross-engine review → verify → ship — pausing for a human only to approve the PRD and to create the PR. Use when you want the whole workflow run hands-off/unattended under Claude Code, Codex, or OpenCode; everything between the two gates the agent decides itself.
---

# goal

Orchestrate one **feature** objective end to end with only two planned human pauses (approve the
PRD; create the PR). Between them it runs autonomously: ambiguous forks go to `council`, not the
human; non-convergence and unrecoverable failure HALT for a human. It composes the existing skills
under `owner=goal` (`shared/rules/execution.md`) — it never re-implements them — advancing the state
machine in `.workflow/state.md`. All line/state schemas are in `shared/rules/goal-state.md`.

**Honesty:** this autonomy is discipline plus a terminal Attested checkpoint (`check-gates` at
ship), not a runtime hard gate. Intermediate progress is Advisory. On all three engines the only
bad-faith-resistant gate is the fully-activated Fase 1 CI template. `/goal` cannot block a bad ship
locally — it only automates the discipline.

## 0. Classify → clean slot → initialize → preflight

1. **Classify.** If the objective is a **bug**, STOP and route the human to `/fix-bug` — v1 `/goal`
   is feature-only.
2. **Clean slot** (`shared/rules/execution.md`): if `.workflow/state.md` has a non-`done`
   `## /goal loop` OR any other unfinished workflow, STOP and ask the human to disposition it. A
   `halted` loop is **never** auto-resumed (see §4).
3. **Initialize FIRST** (so a preflight failure has a loop to mark halted): REPLACE `## Active
   workflow` + `## /goal loop` (`goal`, `status=active`, `phase=preflight`, `base_sha`=merge-base,
   `reentries=0`), reset the standard `## Ship-gate checklist` to unchecked, and clear goal-owned
   `## Review log` / `## Blockers` / `## Attempts` (schemas: `shared/rules/goal-state.md`).
4. **Capability preflight** — prove on the driver engine:
   - a non-driver reviewer engine is available (`shared/rules/models.md`); **persist the REVIEWERS
     manifest** (`shared/rules/goal-state.md`);
   - spawning the reviewer/council CLI **and** the post-GATE-2 `git push` / `gh pr create` are
     prompt-free — if not, HALT and point the human to `shared/rules/goal-autonomy-setup.md`;
   - reviewer/council output goes to stdout or under `.workflow/`;
   - **(Claude subagent-driven)** `.claude/agents/codeforge-implementer.md` exists and contains
     `commit_policy` — else HALT (stale agent; re-run codeforge setup);
   - the digest is stable across one test-suite run (`goal-digest.sh` before/after; if it moves,
     HALT naming the unignored generated paths).
   Any failure → write a `## Blockers` line, `status=halted`, and stop. Never degrade to per-round
   prompting or driver self-review.

## 1. PRD → GATE 1 (human, explicit)

Run `prd`. Set `status=awaiting-gate1`, ask the human to approve **explicitly** (`AskUserQuestion`
on Claude; a plain prompt elsewhere). On approval write `gate1` (`goal-state.md`) and
`status=active`. Do not enter the middle without a `gate1` record. Tick the "Plan written and
design-reviewed" box only after the plan-review loop certifies (below).

## 2. Autonomous middle (no human pauses; council for forks)

Advance `phase`, ticking each ship-gate box as its phase completes:

- **research** (only if external tech).
- **plan-review loop** — run `plan` for the plan doc, then orchestrate `review` over it (reviewer ≠
  driver). `/goal` owns the loop + logging: append a `## Review log` line per round
  (`goal-state.md`); certification = the REVIEWERS set clean at one digest; HALT if the `kind=round`
  count reaches `N` (4) — `sh shared/scripts/goal-state.sh round-count plan`.
- **tdd** — `commit_policy=defer` (implementers stage only, never commit; write the `step` cursor).
- **code-review loop** — review rounds (reviewer + self-pass) → first clean pass → `simplify`
  **once** (record the SIMPLIFY marker) → one re-cert pass → certify. Breaker: HALT at `round-count
  code` == `N`. Global cap: HALT if `reentries >= 3` or code rounds `>= 3·N`.
- **verify** — `verify-e2e` (or honest `N/A`); write the report path into the E2E box. **Any
  post-cert change to a digest-covered path** → `reentries++`, re-enter code-review (simplify does
  not re-run).
- **Ambiguity** → `council`; **non-convergence / unrecoverable / unavoidable ask-tier** → HALT.

## 3. Ship → GATE 2 (human, explicit) — commit BEFORE the gate

With every ship-gate box already ticked from its phase, and the E2E report bound:

1. `base=$(sh shared/scripts/goal-state.sh field base_sha)`; confirm `sh shared/scripts/goal-digest.sh "$base" . ` == the certification digest, AND `sh shared/scripts/check-gates.sh` is green. (PowerShell: `pwsh shared/scripts/goal-digest.ps1 "$base" .`.)
2. Write the CHANGELOG (digest-neutral).
3. **Single commit** (stage the digest-covered set ∪ CHANGELOG + the E2E report).
4. Assert `sh shared/scripts/goal-digest.sh "$base" . --from-head` == the certification digest AND
   the report + CHANGELOG are in HEAD — mismatch → HALT (never GATE 2 over an unproven commit).
5. `status=awaiting-gate2` → ask the human to approve the PR **explicitly** → write the GATE 2
   authorization line (`goal-state.md`; action/head/branch/remote/ts — **no nonce**) → re-verify the
   committed head → push → open the PR → `status=done`.

**Recovery:** on a ship-side `check-gates` red, `sh shared/scripts/goal-state.sh ship-red-bump`;
`n>=2` → HALT. A red-path fix that touches a digest-covered path → re-enter code-review
(`reentries++`). GATE 2 **declined / changes requested** → soft-reset the unpushed commit, return to
`<owning-phase>` with `status=active`. Committed-head **drift** after authorization → invalidate the
GATE 2 line and revalidate (re-check committed digest + gates) before a fresh GATE 2.

## 4. State + resume

`## /goal loop` is the source of truth (`shared/rules/goal-state.md`). On a mid-session compaction,
re-orient from the summary + a Read of `## /goal loop` and continue from `phase`/`step` — never
restart a completed phase, never enter the middle without a valid `gate1`. **`status=halted` is
terminal for automation**: `/goal` does not resume it; a human takes over interactively and must
disposition/reset the run before a new `/goal` invocation. This is best-effort in-session
continuity, not durable cross-session resume (a v2 follow-up).

## Common rationalizations

| Rationalization | Reality |
| --- | --- |
| "It's basically a feature — let /goal handle a bug too." | v1 is feature-only: a bug has no PRD gate and a different phase map. Route to `/fix-bug`. |
| "Preflight is ceremony — start and approve prompts as they come." | An autonomous loop can't answer a native prompt; it stalls. If reviewer/push aren't prompt-free, HALT and point to `goal-autonomy-setup.md`. |
| "The review looked fine; skip counting rounds." | The breaker is the only bound on a non-converging loop. Count `kind=round` (goal-state.sh) and HALT at N. |
| "Commit per task so progress is saved." | Under `/goal`, implementers use `commit_policy=defer`; a mid-loop commit breaks ship-gates. `/goal` makes the single commit at ship. |
| "Push after the gates — the native prompt is the approval." | GATE 2 is an explicit driver-issued approval; the native prompt is bypassable. Commit first, then explicit approval, then push. |
| "It halted; I resolved the blocker, so resume it." | `halted` is terminal for automation. A human dispositions/resets and starts fresh — `/goal` never self-releases a halt. |

## Red flags

- A bug objective driven through the feature machine.
- Preflight run before state init, or the middle entered without a `gate1` record.
- Review-log lines that `goal-state.sh round-count` can't parse (breaker silently no-ops).
- An implementer committing during `tdd`.
- GATE 2 authorized before the single commit, or a push with no explicit human approval.
- `goal-digest.sh` invoked without `<base_sha>`, or `--from-head` passed as the base.

## Verification

- [ ] Objective classified; a bug was routed to `/fix-bug`.
- [ ] State initialized before preflight; preflight passed or HALTed honestly (pointing to
      `goal-autonomy-setup.md` on the permissions case).
- [ ] Exactly two explicit human gates (PRD approval; PR creation); everything else autonomous or a
      council call.
- [ ] Review loops bounded via `goal-state.sh round-count` (certification or HALT at N/MAX);
      `simplify` ran at most once.
- [ ] Single commit BEFORE GATE 2; `goal-digest.sh --from-head` == certification digest.
- [ ] `## /goal loop` reflects the real phase; no completed phase restarted; a halt was left for a
      human, not self-resumed.
````

- [ ] **Step 3: Index entry** — add to `src/CLAUDE.md` "## Workflow skills" list:
  `` - `goal` — drive one feature objective autonomously (prd → plan → TDD → review → verify → ship) with only two human gates (approve PRD, create PR); orchestrates the other skills under owner=goal, doesn't replace them ``

- [ ] **Step 4: `workflow.md`** — add the row `| Drive a whole feature hands-off (idea → PR-ready) | `goal` |` and, after the table:

```markdown
`goal` is an **orchestrator**: it runs the skills above under `owner=goal` (`execution.md`), pausing
for a human only to approve the PRD and to create the PR (see `goal-autonomy-setup.md` to enable the
unattended permissions). Feature-only in v1 (a bug routes to `fix-bug`). Its autonomy is discipline,
not a runtime gate — see the honesty note in the `goal` skill.
```

- [ ] **Step 5:** `npm run check` — PASS (skill lint + evals: `goal` covered, ranks top-3, no
  collision ≥0.75, rank-1 ≥ 70%; both reviewers measured 91% / 0.213). →
  `git add src/skills/goal/SKILL.md src/CLAUDE.md tools/evals/routing-cases.json src/shared/rules/workflow.md` →
  `git commit -m "feat(goal): the /goal orchestrator skill + index + eval case + workflow row"`

---

### Task 5: smoke — assert helpers + skill ship to BOTH mirrors

**Files:** Modify `tests/smoke.sh`.

- [ ] **Step 1:** In the bash-install runtime-file loop (`tests/smoke.sh:33-37`) add:

```
         shared/scripts/goal-digest.sh shared/scripts/goal-state.sh \
         shared/scripts/goal-digest.ps1 shared/scripts/goal-state.ps1 \
         shared/rules/goal-state.md shared/rules/goal-autonomy-setup.md \
         .claude/skills/goal/SKILL.md .agents/skills/goal/SKILL.md \
```

- [ ] **Step 2:** `sh tests/smoke.sh` (PASS — installer copies `shared/scripts/*`, `shared/rules/*`,
  and mirrors `skills/*` into `.claude/skills` + `.agents/skills`, like `new-feature`).

- [ ] **Step 3:** `npm run check` (green) + `sh tests/smoke.sh` (green) →
  `git add tests/smoke.sh` →
  `git commit -m "test(goal): smoke-verify goal helpers + rules + skill ship to both mirrors"`

---

## Self-Review (rev2)

**Plan-review findings (Opus + Codex) — disposition (all fixed):**
- P1 §10 schemas referenced the non-shipped design doc → **ship `shared/rules/goal-state.md`**
  (Task 2); the skill + template reference it; template `## Review log` seeded with the goal format.
- P1 state init after preflight → §0 initializes FIRST (phase=preflight), then preflight; complete
  REPLACE of Active workflow + goal-owned logs + checklist reset.
- P1 preflight dead-on-arrival + no remediation → **ship `shared/rules/goal-autonomy-setup.md`**
  (Task 3) with per-engine allow-entries; the preflight HALT points to it.
- P1 ship checklist deadlock → tick each box as its phase completes; verify writes the E2E report
  path; at ship all boxes already checked → digest → check-gates → CHANGELOG → commit.
- P1 ship-red / GATE-2-decline / head-drift transitions absent → §3 "Recovery" carries them
  (ship-red-bump + n>=2 HALT; decline → owning-phase/active; drift → revalidate).
- P1 halted wording contradicted rev5 → §4 states halted is terminal for automation; human
  dispositions/resets; `/goal` never self-releases (rationalization + red flag added).
- P1 `goal-digest.sh --from-head` invalid → §3 shows exact `<base_sha> . [--from-head]` sh + ps1.
- P2 reintroduced `nonce` → dropped from the GATE 2 line (matches goal-state.md).
- P2 smoke only `.claude` mirror → Task 5 asserts both `.claude` + `.agents`.
- Eval collision (the plan's feared risk) → empirically clean (0.213, 91%); no action.

**Placeholder scan:** complete. **Consistency:** all skill refs resolve to shipped files
(`execution.md`, `models.md`, `ship-gates.md`, `goal-state.md`, `goal-autonomy-setup.md`,
`goal-digest.sh`, `goal-state.sh`); schemas match `goal-state.sh`'s parsers exactly; `commit_policy`
/`owner=goal` match Plan B; digest invocation matches Plan A. **Lint safety:** `goal-state.md` +
`goal-autonomy-setup.md` exist before the skill references them (Tasks 2–3 precede Task 4).

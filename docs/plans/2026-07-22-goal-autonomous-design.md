# codeforge `/goal` — autonomous mode (Fase 2) — design spec

**Written:** 2026-07-22. **Branch:** `feat/goal-autonomous` (off `dev`, v0.6.0).
**Status:** design approved; **revised 5× after cross-engine review** (Opus + Codex `gpt-5.6-sol`
+ OpenCode `kimi-k3`) — see §14. Revision 4 **cut durable cross-session resume from v1** (the
source of most crash-safety findings across iters 3–4) → single-session best-effort loop; revision
5 closed the iter-5 cut-verification findings (all narrow/local — both engines confirmed the cut is
coherent). Next: human spec-review gate → writing-plans.

Repo: `~/Desktop/personal/projects/forge-ai` (GitHub `Juan-Motta/codeforge`, npm
`@jualopezmo/codeforge`). Cross-engine (Claude Code / Codex / OpenCode) workflow-discipline
framework. `/goal` is the top capability gap vs the origin `claude-codex-forge`; a cross-engine
`/goal` is **unique**.

---

## 1. Goal

A mostly-autonomous driver taking a **single feature objective** from idea to a PR-ready branch —
`prd → research → plan → review → TDD → review → simplify → verify → PR` — pausing for the human at
**exactly two** planned points (entry + PR) plus any unplanned HALT. Between the gates it runs
autonomously; ambiguous forks → `council`; non-convergence and unrecoverable failure → **HALT for a
human** (who then takes over interactively — v1 has no autonomous release mechanism).

It runs **identically on Claude Code, Codex, OpenCode**, which requires a **capability preflight**
(§6.4) at loop start proving the loop's own autonomous actions (cross-engine reviewer/council
spawns, and the post-GATE-2 push/PR) are prompt-free. If not provable, `/goal` HALTs honestly
rather than stalling on a per-round prompt.

Honesty: the two-pause guarantee is an **explicit driver-issued approval on all three engines**
(§5), never a bypassable native prompt. The autonomy is discipline; the only bad-faith-resistant
hard gate is the fully-activated Fase 1 CI template (§8).

### Scope (locked)
- **Feature-only in v1.** Bug objectives are rejected at classification → `/fix-bug`.
- **Single-session, best-effort (v1).** The loop keeps a **lightweight in-session progress marker**
  (`## /goal loop`: phase + cursors) so that after a *within-session* harness compaction the driver
  can re-orient from the summary + a state read and continue. It does **NOT** promise durable
  crash-safe cross-session resume: if the session ends or the process dies, the human restarts
  `/goal` clean (partial staged work is theirs to keep or discard). **Durable cross-session resume
  is an explicit v2 follow-up** (it was the source of the epoch/budget/crash-recovery complexity
  that four review rounds kept surfacing — cut per brutal-simplicity/YAGNI).

### Non-goals (YAGNI)
No new hook/enforcement; no re-implementation of composed skills' phase logic; no crash-safe ship
recovery / atomic git-side-effect reconciliation (v2); no autonomous HALT-release/adjudication/
budget machinery (HALT hands to the human); no auto-approval of `ask`-tier prompts; no bug path.

---

## 2. Decisions locked

| # | Fork | Decision |
| - | ---- | -------- |
| 1 | Enforcement | Discipline + `check-gates` at the SHIP transition only (Attested); intermediate progress Advisory. No new hooks. |
| 2 | Progress marker | Lightweight `## /goal loop` + `## Review log` + `## Blockers` in `.workflow/state.md`, for in-session orientation + the convergence breaker's round count. A **mandatory tested** state helper owns the writes; not an enforcement hook. |
| 3 | Human pauses | Entry (PRD) + PR only, explicit on all engines. Ambiguous → `council`; non-convergence / unrecoverable → **human HALT** (human takes over; no autonomous release). |
| 4 | v1 scope | Feature-only; bugs → `/fix-bug`. |
| 5 | Autonomy precondition | Capability preflight (§6.4) at loop start: reviewer/council spawns AND post-GATE-2 push/PR prove prompt-free, and the digest is stable across a test run (§6.1). Else HALT. |
| 6 | Cross-session resume | **OUT of v1** (v2 follow-up). v1 is single-session best-effort; interruption → clean restart. |

Approach **A** — thin orchestrator composing existing skills under a phase-ownership contract (§3),
advancing a state machine (§4, §11).

---

## 3. Architecture + composition contract

`/goal <objetivo>` → new `src/skills/goal/SKILL.md`, engine-neutral.

```
/goal <objetivo>
  → classify: feature | bug → bug: STOP, route to /fix-bug (v1)
  → CAPABILITY PREFLIGHT (§6.4): reviewer/council spawn + push/PR prompt-free; non-driver reviewer
        exists; digest stable across a test run. Persist the reviewer manifest. Fail → HALT.
  → prd            → GATE 1 (human, explicit, all engines): approve PRD ─────────────────────┐
  → research       (only if external tech)                                                   │
  → plan-review LOOP: /goal orchestrates `review` over the plan doc (bounded — §6.2)          │ autonomous
  → tdd            (execution.md; implementers commit_policy=defer, stage-only — §7)          │  ambiguous → council
  → code-review LOOP (bounded, re-entrant — §6.2/§6.3):                                        │  non-convergence → HALT
        rounds → first clean → simplify ONCE → re-cert at post-simplify digest → cert         │  unrecoverable → HALT
  → verify-e2e     (or N/A); if it changes a digest-covered path → re-enter code-review (§6.5) │
  → ship:  check-gates green + committed-tree digest == cert digest → single commit → GATE 2 ─┘
        GATE 2 (human, explicit) authorizes the COMMITTED head → push → PR → done
```

`simplify` is a **sub-step inside the code-review loop**, never a phase that flows to `verify`.

### Phase-ownership contract (mandatory in the skill body)

Composed skills run standalone: `new-feature §0` initializes `.workflow/state.md`; `new-feature §7`
/ `finish-branch` own shipping (verified `new-feature/SKILL.md:14,56-60`); `plan §3` delegates its
review to `review §4`, which loops "until clean" with no numeric budget (verified). Contract:

- **`/goal` OWNS:** one-time state init (`## /goal loop`, and the standard `## Ship-gate checklist`
  reset to unchecked — §8), all phase transitions, the cursors, both review loops (§6), retries,
  the two gates, the single ship commit, ticking the ship-gate boxes, and the terminal transition.
  Subordinate skills run in **`owner=goal` mode**: contribute only their phase's work + named
  sections; MUST NOT re-init state, commit/push/PR, or self-cap a loop.
- **Plan-review + code-review loops:** `/goal` orchestrates the `review` skill directly and owns the
  §6.2 breaker + §10 logging. `plan`/`review` contribute one pass + findings, never self-loop.
- **`new-feature` / `finish-branch`** contribute phase content only; their standalone init (`§0`)
  and ship (`§7`) steps are disabled under `owner=goal`. §9 lists the exact skill + generator edits.
- On Claude, implementers run via `codeforge-implementer` with `commit_policy=defer` (§7).

---

## 4. State — `## /goal loop` (lightweight, in-session)

Progress marker for orientation + the breaker count. **Single active loop at a time.** No
cross-session resume guarantee, so no nonce-scoping / epoch-generation / crash-safe atomicity.

```
## /goal loop
| Field      | Value                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| goal       | <one-line feature objective>                                             |
| status     | active | awaiting-gate1 | awaiting-gate2 | halted | done                 |
| phase      | preflight|prd|research|plan-review|tdd|code-review|verify|ship           |
| step       | <phase>:<N>/<M>   (task cursor for tdd)                                  |
| reentries  | <r>               (code-review re-entry count, for the global cap — §6.2)|
| base_sha   | <merge-base SHA at loop start; digest base — §6.1>                       |
| gate1       | approved ts=<ts> prd=<path>    (empty until approved)                    |
```

### 4.1 Loop start, stale-loop, and workflow-collision handling
`/goal <feature>` requires a **clean workflow slot**. Before initializing, it inspects
`.workflow/state.md`:
- If a **non-`done` `## /goal loop`** exists (an interrupted prior run) **OR** `## Active workflow`
  shows any **other unfinished workflow** (`new-feature`/`fix-bug`/`quick-fix`), `/goal` **stops and
  asks the human to disposition it** (discard/reset, and disposition any staged work). It does
  **NOT** offer cross-session resume (fix P1-A/P1-3: that would re-import the crash/preflight-stale
  vector the cut removed) and does **NOT** reset the shared `## Ship-gate checklist` over a live
  workflow (fix — that would clobber a `new-feature`/`fix-bug` run). A `halted` loop is **never**
  resumable by a fresh `/goal`.
- Only on a clean slot does `/goal` initialize by **REPLACE** (not append): the `## Active workflow`
  fields, `## /goal loop`, any goal-format `## Review log` / `## Blockers` / markers, and the
  canonical 6-box `## Ship-gate checklist` reset to unchecked (§8).

"Inactive" = the **absence** of a `## /goal loop` section (or `status=done`) — there is no
`INACTIVE` status value. In-session continuity after a harness compaction is handled **only** by
§4.2 (same run), never by a fresh `/goal` invocation.

### 4.2 In-session continuity (best-effort, not crash-safe)
If a harness compaction occurs mid-run, the driver re-orients from the conversation summary + a
Read of `## /goal loop` and continues from `phase`/`step`, never restarting a completed phase.
This is best-effort orientation, **not** a durable-resume guarantee: torn multi-field writes, dead
processes, and cross-session gaps are out of scope (v2). On `status=halted`, the driver stops and
the human takes over (there is no autonomous release). On `status=done`, the loop is complete.

### 4.3 Terminal
On PR creation: `status=done`.

---

## 5. Human gates (portable + content-bound)

**GATE 1** — after `prd`, `status=awaiting-gate1`, explicit approval (`AskUserQuestion` on Claude;
plain prompt elsewhere). On approval write `gate1` (`ts + prd path`), `status=active`. The
autonomous run does not begin without a `gate1` record.

**GATE 2** — ordered **after the single ship commit** (fix P0-δ), per the §8 ship sequence which
proves `digest(committed tree) == cert` (the commit *contains* the certified content — fix P0-2)
before `status=awaiting-gate2`. Then: explicit approval on all engines → write the gate2 record
(`action + committed head + branch + remote + ts`) → push → PR → `done`.
- **Human declines / requests changes** → soft-reset the unauthorized, unpushed commit and return
  to `<owning-phase>/active` (**status reset to `active`** — fix: it must not stay `awaiting-gate2`,
  or no phase row matches); a code change re-enters code-review (§6.5).
- **Committed head/tree drifts after authorization** (rare) → **invalidate** the authorization and
  return to `ship/active` **revalidation** (recheck committed-tree==cert + gates): digest-covered
  drift re-enters code-review; digest-neutral drift proceeds to a **freshly bound** GATE 2. A
  mismatch never merely re-issues GATE 2 over unverified content (fix P0-2 recovery).

The native `ask`-tier prompt is defense-in-depth only; the post-GATE-2 push/PR are proven
prompt-free at preflight (§6.4), so the explicit gate is the only planned pause. Council routing /
NON-triggers unchanged (ambiguous → council; non-convergence → HALT; `council` fails → HALT).

---

## 6. Cross-engine review loops + bounded convergence

Two loops, both **/goal-orchestrated over `review`** (reviewer ≠ driver, `models.md`): **plan-review**
(over the plan doc) and **code-review** (post-TDD, reviewer(s) + self-pass over the code). The
expected-reviewer set (incl. the self-pass role) is fixed at preflight and persisted (§10); a round
certifies only when exactly that set is clean at one digest.

### 6.1 The certification digest (membership normative; byte algorithm → §11 open items)
Binds a pass to content, not HEAD (implementers stage-only; an uncommitted plan/diff shares one
HEAD). **Membership:** the digest covers **every non-git-ignored path** — the tracked
`git diff <base_sha>` (staged+unstaged) **and every untracked non-ignored file** (plan doc, PRD,
migrations, configs, **`package.json`/lockfiles**, tests — all count) — minus a **closed exclusion
set** applied to **both** the diff pathspecs and the untracked scan:

> EXCLUDE only pure state/evidence: `.workflow/**`, `docs/e2e/reports/**`, `CONTINUITY.md`,
> `docs/CHANGELOG.md`, and one named reviewer/council scratch prefix (§6.4 pins reviewer output
> there or to stdout). **`package.json`/lockfiles are NOT excluded** — they are feature content
> (dependency manifest); a post-cert dep change must re-trigger review (fix P1-4). `VERSION` is
> excluded (release churn, content-free; v1 does no bump anyway).

Each entry is **framed** (path + mode + length + content) so a rename/empty-add/repartition moves
the digest. Computed **at pass start, before** the round's review-log append. The exact byte-level
algorithm + determinism (`LC_ALL=C`, `--no-renames`, `git add -N` normalization, untracked
ordering) is a **plan task** (§11) with enumerated tests (rename, empty-file, plan-doc, config,
split, staged↔untracked).

**Digest-stability probe (fix P1-5):** because membership depends on the *target repo* ignoring its
generated outputs (coverage, build artifacts), preflight (§6.4) computes the digest, runs the
project's test/e2e suite once, and recomputes. If it moved, **HALT before GATE 1** naming the
offending paths and asking the human to **git-ignore them**. (v1 has no per-project mutable
digest-exclude list — fix P1-6: a mutable list has no closed schema and could broaden exclusions
after certification, hiding changed content; the exclusion set is exactly the fixed one above plus
`.gitignore`.)

### 6.2 Bounded termination (no autonomous release — HALT hands to human)
- **Certification = the single exit condition:** first pass where the expected-reviewer set is all
  clean at one digest. Each round appends a §10 review-log line (`kind=round|recert|cert`, `loop`,
  `digest`).
- **Per-loop breaker (boundary explicit — fix P1-4 off-by-one):** count `kind=round` lines for the
  current loop. **Resulting count `< N` → continue; `>= N` → HALT** (default `N=4`, named constant).
  (The earlier "within N" vs "N exceeded" wording left `count == N` matching no transition.) Applies
  to plan-review AND code-review.
- **Global re-entry cap (fix P0-β, P1-2):** the verify↔code-review cycle is bounded by **both**
  `reentries >= MAX_REENTRIES` (default 3) **and** total code-review `kind=round` lines `>=
  MAX_CODE_ROUNDS` (default 3·N) → HALT. Capping `reentries` directly bounds even a 0-round
  clean-cert ping-pong (where verify keeps changing code and each re-review is instantly clean) —
  the round count alone did not.
- **Ship-red counter is durable (fix P1-4):** repeated `check-gates`-red at ship is tracked by a
  persisted §10 `ATTEMPT ship-red` line, so the "same transition twice → HALT" rule survives a
  mid-run compaction (the driver cannot forget a prior red).
- **No release/adjudication/budget machinery.** A HALT is terminal for the autonomous loop; the
  human takes over interactively (fixes P0-1 by deletion — the release lever that four rounds could
  not make sound is simply not in v1).

### 6.3 `simplify` (fix N3, dirty-exit, re-entry)
`simplify` runs **exactly once per loop lifetime**, immediately after the **first clean pass**;
record a SIMPLIFY marker (§10) so re-entry never re-runs it. Then **one re-cert pass** at the
post-simplify digest:
- re-cert clean AND digest stable → `kind=cert`, exit to `verify`.
- re-cert has findings → return to normal review rounds (`kind=round`, consume N); simplify never
  re-runs; certification = the next clean pass at a stable digest.
- **On code-review re-entry (§6.5) when the SIMPLIFY marker is already present:** skip simplify; a
  clean pass at the new digest goes **directly** to `kind=cert` → verify (§11 row 15b). This is the
  common re-entry exit the earlier table lacked (fix P1-1).

### 6.4 Capability preflight (fixes N7, N8, two-pause/permissions) — at loop start
Prove on the driver engine: (1) a non-driver reviewer is available (pick a different engine if the
default equals the driver); (2) spawning it (`claude -p`/`codex exec`/`opencode run`) **and the
post-GATE-2 `git push` / `gh pr create`** are prompt-free under the current permission config
(fixes the two-pause-vs-shipped-permissions contradiction: the explicit GATE 2 is the pause, and
the actual push/PR must not add native prompts); (3) reviewer/council output goes to stdout or the
named excluded prefix; (4) the digest-stability probe (§6.1) passes. Persist the reviewer manifest.
Any failure → **HALT before GATE 1** with a `## Blockers` line naming the fix. `/goal` never
degrades to per-round prompting and never uses the `ship-gates.md` delayed-self-review waiver in
autonomous mode (interactive-only). Required allow-entries documented for **all three** engines
(shipped `src/configs/claude/settings.json` has no Bash allow-list, so Claude needs them too);
exact syntax → §11.

### 6.5 Cross-phase invalidation (conservative collapse)
Certification is digest-bound. **Any post-cert change to a digest-covered path invalidates it.** If
`verify-e2e`, or a §8 red-path fix, changes a digest-covered path, the driver **increments
`reentries`** and re-enters code-review (simplify does not re-run — §6.3), producing one fresh
certification at the new digest. Between final certification and the ship commit the driver may
touch only excluded files (CHANGELOG). The global cap (§6.2) bounds repeated re-entry.

---

## 7. Per-engine execution + failure handling

- Mode per `execution.md`: subagent-driven on Claude, inline elsewhere.
- **`commit_policy=defer` (fixes P1-E, N4):** `execution.md` + the generated `codeforge-implementer`
  agent gain a `commit_policy=per-task|defer` contract. Under `defer` (`/goal`): implementer stages
  only after its task is green+accepted, does **not** commit, reports `task-id + test evidence`;
  `/goal` writes `step` and makes the single commit at ship, staging the **ship manifest** (§8:
  digest-covered set ∪ required durable docs — the E2E report + CHANGELOG — fix P0-2/P1-7).
  Generator (`cli/lib/apply.mjs`, verified to order a commit today) updated (§9).
- **Failure:** retry once → judgment-call recovery → `council`; else **HALT** (human takes over).
- **Unavoidable `ask`-tier command:** **HALT explicitly** — never launch a command that then
  blocks on a native prompt. Prefer prompt-free alternatives (cache flags, `: >` instead of `rm`).

---

## 8. Enforcement model (honest — ship ordering + checklist)

- `check-gates.sh` is a **terminal, full-profile validator** (verified: whole standard profile by
  identity+count; the E2E box requires a named fresh `VERDICT: PASS` report; can only pass at ship).
  Run **only before shipping**. Intermediate progress is Advisory.
- **`/goal` maintains the `## Ship-gate checklist` that check-gates reads (fix — Codex/Opus):** it
  resets the 6 standard boxes to unchecked at loop start (§4.1) and ticks each as its phase
  completes — in particular the verify phase writes the report path into the E2E box. Without this,
  check-gates would exit 1 at ship and the loop could never leave `ship`.
- **Ship ordering + commit-content proof (P0-δ, P0-2, P1-7) — explicit sequence:**
  1. `check-gates` green AND `digest(worktree) == cert digest`;
  2. write CHANGELOG (excluded / digest-neutral);
  3. stage the **ship manifest** = digest-covered set **∪** required durable excluded artifacts (the
     E2E `VERDICT: PASS` report under `docs/e2e/reports/**` and `docs/CHANGELOG.md`);
  4. **single commit**;
  5. **assert** `digest(committed tree) == cert digest` **AND** the E2E report + CHANGELOG are
     present in `HEAD` **AND** no intended file was left uncommitted;
  6. → `awaiting-gate2`.
  If step 5 fails → **HALT** (`## Blockers`) — never issue GATE 2 over an unproven commit. GATE 2
  then authorizes the committed head → push → PR → `done`.
- **Red path:** `check-gates` red → owning phase. If the fix touches a digest-covered path →
  re-enter code-review (§6.5); non-code fix → re-green then re-ship. A **second** ship-red (per the
  durable §10 `ATTEMPT ship-red` counter) → HALT.
- **CI honesty:** exact conditional wording from `ship-gates.md` — the Fase 1 CI template is inert
  until copied/filled/required, bad-faith-resistant only with full activation. Never "the hard gate"
  unconditionally. Honesty block in the skill body.

---

## 9. Landing checklist (linter / evals / tests / skills / generator)

- `src/skills/goal/SKILL.md` — full anti-rationalization anatomy (HARD-required by the linter); body
  carries §3 contract, §5 gates, §6 convergence + preflight, §7 defer, §8 honesty.
- `src/CLAUDE.md` — add `goal` to the Workflow-skills index (parity is a linter hard error).
- `src/skills/{plan,review,new-feature,finish-branch}/SKILL.md` — add the `owner=goal` mode note
  (loop control + logging belong to `/goal`; init/ship steps disabled under `/goal`).
- `tools/run-evals.mjs` — `/goal` routing/collision cases (rank-1 ≥ floor) + bug → `/fix-bug`
  rejection case.
- `src/shared/state.template.md` — the `## /goal loop` section is **absent by default** (its
  absence = inactive; no `INACTIVE` status value) + add `## Blockers` + `## Attempts`.
- `src/shared/rules/execution.md` — add `owner` + `commit_policy=per-task|defer`.
- `cli/lib/apply.mjs` — generated `codeforge-implementer` becomes `commit_policy`-aware (report
  task-id + evidence under `defer`, not a commit SHA); update its tests.
- `src/shared/rules/workflow.md` — add a `/goal` row + autonomous-run note.
- Tests (`tools/test/*.test.mjs`, `node --test`, zero-dep): the state helper (`## /goal loop`
  read/write, stale-loop prompt, §10 line parsers, review-log breaker count); the digest membership
  + framing tests (rename/empty-file/plan-doc/config/split) + exclusion set + the stability probe;
  the §11 table invariant test — **every reachable nonterminal state/event has ≥1 bounded exit and
  every source reachable** (normalize "owning phase" targets to enumerable states); skill lints +
  routes rank-1 + rejects bugs. Extend `tests/smoke.sh` expected-skills with `goal`.
- `docs/CHANGELOG.md` — under `## Unreleased`; stays on v0.6.0.

---

## 10. Data schemas (normative; byte-level digest algorithm → §11 open items)
Single-line, fixed-order, helper-parseable (single active loop, so no nonce field needed in v1).

- **Task cursor** (`## /goal loop.step`): `<phase>:<N>/<M>`.
- **gate1** (`## /goal loop.gate1`): `approved ts=<ts> prd=<path>`.
- **gate2** (`## /goal loop`): `- [x] GATE2 authorized — action=push+pr — head=<committed sha> —
  branch — remote — ts`.
- **Reviewer manifest** (`## /goal loop`): `- REVIEWERS set=<engine,…,self> — ts` (fixed at
  preflight; certification requires exactly this set clean at one digest).
- **Review-log line** (`## Review log`): `- loop=plan|code — round=<N> — kind=round|recert|cert —
  reviewer=<engine|self> — result=clean|P0=a/P1=b/P2=c — digest — ts`. Certification digest = the
  digest on the latest `kind=cert` line for the current loop. Breaker counts `kind=round` only.
- **SIMPLIFY marker** (`## /goal loop`): `- [x] SIMPLIFY done — digest — ts`.
- **Blocker** (`## Blockers`): `- [ ] BLOCKER — phase — reason — ts` (HALT record; human takes over
  — no adjudication/budget schema in v1).
- **Ship-red attempt** (`## Attempts`): `- ATTEMPT ship-red — n=<k> — ts` (durable; incremented
  before each ship-side `check-gates` red; `n>=2` → HALT — fix P1-4).

---

## 11. State transition table (normative — every source reachable, every nonterminal has an exit)

| # | From (phase/status) | Event | To | Writes |
|---|---|---|---|---|
| 1 | (no loop) | `/goal <feature>` | `preflight`/`active` | init `## /goal loop`, reset ship-gate checklist, `base_sha`, `reentries=0` |
| 2 | (no loop) | `/goal <bug>` | (none) | STOP → `/fix-bug` |
| 3 | (stale non-done loop OR other active workflow) | `/goal …` | (ask human) | STOP → human dispositions/resets; no cross-session resume; `halted` never resumable (§4.1) |
| 4 | `preflight`/`active` | preflight + stability probe OK | `prd`/`active` | REVIEWERS manifest |
| 5 | `preflight`/`active` | spawn/push/PR prompts, no non-driver reviewer, or digest unstable | `halted` | `## Blockers` |
| 6 | `prd`/`active` | PRD written | `prd`/`awaiting-gate1` | — |
| 7 | `prd`/`awaiting-gate1` | human approves | `research`\|`plan-review`/`active` | gate1 record |
| 8 | `prd`/`awaiting-gate1` | human declines | `prd`/`active` | revise PRD (→ row 6 again) |
| 9 | `research`/`active` | done | `plan-review` | — |
| 10 | `plan-review`/`active` | round findings, resulting count `< N` | `plan-review` | `kind=round` |
| 11 | `plan-review`/`active` | clean pass | `tdd` | `kind=cert` |
| 12 | `plan-review`/`active` | resulting count `>= N` | `halted` | `## Blockers` |
| 13 | `tdd`/`active` | task k green+accepted | `tdd` | `step=tdd:k/M` (stage only) |
| 14 | `tdd`/`active` | all tasks done | `code-review` | — |
| 15 | `code-review`/`active` | round findings, resulting count `< N` | `code-review` | `kind=round` |
| 15b | `code-review`/`active` | clean pass, SIMPLIFY marker present (re-entry) | `verify` | `kind=cert` |
| 16 | `code-review`/`active` | first clean pass, no SIMPLIFY marker | `code-review` (simplify) | SIMPLIFY marker |
| 17 | `code-review`/`active` | re-cert clean, digest stable | `verify` | `kind=cert` |
| 18 | `code-review`/`active` | re-cert findings | `code-review` | `kind=round` |
| 19 | `code-review`/`active` | resulting count `>= N` OR `reentries >= MAX_REENTRIES` OR rounds `>= MAX_CODE_ROUNDS` | `halted` | `## Blockers` |
| 20 | `verify`/`active` | changes a digest-covered path | `code-review` | `reentries++` (§6.5) |
| 21 | `verify`/`active` | pass / N/A | `ship`/`active` | evidence, tick E2E box |
| 22 | `ship`/`active` | worktree digest==cert AND check-gates green | `ship`/`active` (staging) | write CHANGELOG, stage ship manifest, single commit |
| 22b | `ship`/`active` | committed-tree digest==cert AND report+CHANGELOG in HEAD, nothing left uncommitted | `ship`/`awaiting-gate2` | — |
| 22c | `ship`/`active` | committed-tree digest≠cert OR a required artifact missing | `halted` | `## Blockers` (never GATE 2) |
| 23 | `ship`/`active` | check-gates red, fix touches digest path | `code-review` | `reentries++`, `ATTEMPT ship-red` |
| 24 | `ship`/`active` | check-gates red, non-code fix, `n<2` | `ship`/`active` (re-green, re-ship) | `ATTEMPT ship-red n++` |
| 25 | `ship`/`active` | ship-red `n>=2` (durable §10 counter) | `halted` | `## Blockers` |
| 26 | `ship`/`awaiting-gate2` | human approves | `ship`/`active` (push→PR) | gate2 line |
| 27 | `ship`/`awaiting-gate2` | human declines / requests changes | `<owning-phase>`/`active` | soft-reset unpushed commit, **status←active** |
| 28 | `ship`/`awaiting-gate2` | committed head/tree drift after auth | `ship`/`active` (revalidate) | invalidate gate2 auth → recheck committed-tree==cert + gates |
| 29 | `ship`/`active` | PR created | `done` | — |
| 30 | any/`active` | unrecoverable / ask-tier unavoidable / council fails | `halted` | `## Blockers` |
| 31 | any/`halted` | (v1) | (terminal for automation) | human takes over interactively |

---

## 12. Open questions for the plan
- **Byte-level digest algorithm** (§6.1): exact `git diff` exclude pathspecs, `git add -N`
  normalization, untracked ordering, `LC_ALL=C`, `--no-renames`, framing (path+mode+length+content).
  Tested cases: rename, empty-file add, plan-doc edit, config edit, split/concat, staged↔untracked.
- Reviewer/council + push/PR pre-allow syntax for `.claude/settings.json` / `.codex/config.toml` /
  `opencode.json` (§6.4) — verify against current schemas in the plan's research step.
- Constants: `N=4`, `MAX_REENTRIES=3`, `MAX_CODE_ROUNDS=3·N` — tune; named constants.
- State-helper home: `shared/scripts/` (ships to targets) with tests in `tools/test/`.

---

## 13. Process
1. Human spec-review gate (this file) → adjust inline.
2. `superpowers:writing-plans` → plan (task list + test stubs; §10 schemas + §11 table + digest
   function with §12 tests as testable units).
3. **Cross-engine plan review** (mandatory).
4. `superpowers:subagent-driven-development` → per-task impl + review; final whole-branch review.
5. PR `feat/goal-autonomous` → `dev`. Stays v0.6.0.

---

## 14. Spec review log
- **Iter 1 (whole spec) — 3 engines.** 2 P0 + 8 P1 + 2 P2; resolved rev1.
- **Iter 2 (§3–§8) — 3 engines.** 11 new P1 (3 P0-class); resolved rev2 (operational contract +
  §10/§11).
- **Iter 3 (§4/§6/§10/§11) — 3 engines.** §4 core sound; 3 P0 + P1s; resolved rev3 (epoch/kind/nonce,
  ship ordering, halted-release gate, digest membership/framing).
- **Iter 4 (whole spec) — 3 engines.** rev3 *structural* fixes CONFIRMED holding (halted-release,
  nonce-strip, ship-ordering, digest-framing). But 2 P0 + ~13 P1 survived, **concentrated in the
  budget/epoch/crash-safety machinery of durable cross-session resume**: P0-1 the release-counting
  rule disarmed the breaker (plan loop unbounded after adjudication); P0-2 GATE 2 authorized a
  commit not proven == certified tree; plus global-cap-misses-0-round-ping-pong, unmaintained
  `## Ship-gate checklist`, `package.json` excluded from digest, `research` in the resume whitelist,
  missing §11 re-entry/decline rows, git-side-effect crash recovery, preflight staleness on resume,
  digest instability from unignored generated outputs.
  **Root cause:** four rounds showed the churn source is durable cross-session resume + crash-safety
  — prose can't prove atomicity/termination. **Decision (user):** cut durable cross-session resume
  from v1 (→ single-session best-effort) per brutal-simplicity/YAGNI. Revision 4 does that, which
  DELETES: P0-1 (no release machinery — HALT hands to human), git crash-recovery, preflight-stale,
  nonce-contamination, torn-write, epoch-generation, most of §4.2. And FIXES the surviving
  non-resume spec decisions in-place: P0-2 committed-tree==cert digest; global cap on `reentries`
  (0-round ping-pong); `package.json` in digest; digest-stability probe; ship-gate checklist
  maintenance; §11 re-entry (15b) + decline (27) + prd/active (6→8) rows; push/PR prompt-free at
  preflight. Cross-session durable resume → v2 follow-up.
- **Iter 5 (verify the cut) — 2/3 engines** (Opus + Codex `gpt-5.6-sol`; kimi-k3 stalled without
  synthesis and was stopped — Codex is the mandatory reviewer and ran clean-to-completion). **Both
  confirmed the cut is coherent** (grep: deleted machinery survives only in negation; every §11
  nonterminal has a bounded exit; `MAX_REENTRIES` bounds the 0-round ping-pong; `package.json`
  covered; stability probe sound; checklist boxes match `check-gates.sh`). Remaining findings all
  narrow/local, resolved in **rev5**:
  - §4.1 still offered "resume-in-this-session" for a stale loop → **removed**: a fresh `/goal`
    finding any non-`done` loop OR other active workflow STOPs for human disposition; `halted` never
    resumable; in-session continuity only via §4.2 (P1-A/P1-3).
  - §8/§11 committed-tree check was circular + had no failure exit → **explicit ship sequence**
    (worktree==cert+gates → stage ship manifest → commit → assert committed-tree==cert + artifacts
    in HEAD → gate2; mismatch → HALT, rows 22/22b/22c) (P0-1/P2-D).
  - §5/§11 GATE 2 recovery left `status` hung / could authorize drift → row 27 → `<owning>/active`
    (status reset); row 28 → `ship/active` revalidation (recheck committed-tree==cert, not a bare
    re-issue) (P0-2).
  - §6.2/§11 breaker off-by-one (`count==N` matched no row) → boundary `< N` continue / `>= N` HALT;
    durable `ATTEMPT ship-red` counter so twice-red HALT survives compaction (P1-4).
  - §4.1/§9 checklist reset could clobber an active `new-feature`/`fix-bug`; `INACTIVE` wasn't a
    status → guard added; inactive = section absent (P2-B/P1-5).
  - §7/§8 ship staging named only the digest-covered set → **ship manifest = digest-covered ∪ {E2E
    report, CHANGELOG}**, asserted present in HEAD (P2-C/P1-7).
  - §6.1 mutable project digest-exclude list had no schema → **removed for v1** (require
    `.gitignore`) (P1-6).
  Raw reviewer outputs archived in the session scratchpad (not committed).

# codeforge — session handoff: Fase 3 COMPLETE → Fase 3.5 next (2026-07-24)

**Read this first in a new session**, then `~/.claude/.../memory/forge-ai.md` (auto-loads). Everything
below is verified as of 2026-07-24. Repo: `~/Desktop/personal/projects/forge-ai` (GitHub
`Juan-Motta/codeforge`, npm `@jualopezmo/codeforge`). Cross-engine (Claude Code / Codex / OpenCode)
workflow-discipline framework. Branch model: feature branch → PR to `dev`; `dev`→`main` for releases.

---

## 1. Where things stand (verified)

| Ref | Value |
| --- | --- |
| `origin/dev` | **`09929d8`, v0.6.0** — carries **Fase 0 + 1 + 2 + 3** |
| `origin/main` | **`00187b3`, v0.5.1** — dev is ~63 commits ahead |
| npm `latest` | **0.5.1** (0.6.0 NOT yet released/published) |
| Local branches | `dev` (synced), `main`, `feat/goal-autonomous` (see §5) — all Fase-3 branches deleted |

**Fase 3 (the verify-e2e UI-journey adapter) is COMPLETE and merged to `dev`** via PR #18 + the P3
cleanup PR #19 (both merged 2026-07-24). Nothing is running. **The `dev→main` release is DEFERRED by
the user — it stays v0.6.0 and happens LATER, after the user runs their own tests/QA. Do NOT open the
release PR or publish to npm until the user explicitly says so.**

---

## 2. What Fase 3 delivered (done)

`verify-e2e` now executes **UI** user-journeys (Playwright), alongside API and CLI. Built as 3 plans
via `superpowers:subagent-driven-development`, each plan cross-engine plan-reviewed to CLEAN before
execution and closed with an Opus whole-branch review (all READY):

- **Plan A** — `tools/e2e-ui-ref/run-journey.mjs`: a tested, **normative** standalone-execution harness
  driving headless Chromium via the **`@playwright/test` library API** (no runner, no config). Proves 7
  guarantees: dependency resolution (`createRequire` from the app root, version floor ≥1.59),
  init-guarded `finally` teardown across all contexts, primary-error preservation + active-context
  capture, independently-injectable assertion/action/watchdog timeouts, a hard watchdog uncancellable by
  hanging cleanup, phase-based `FAIL_INFRA`/`FAIL_BUG` classification, and browserless self-skip. Fixture
  (`tools/fixtures/e2e-ui/index.html`) + acceptance test (`tools/test/e2e-ui-pattern.test.mjs`).
- **Plan B** — the harness is **embedded verbatim** into `src/skills/verify-e2e/SKILL.md` between
  `<!-- e2e-ui-ref:start -->`/`<!-- e2e-ui-ref:end -->` sentinels (byte-for-byte drift-guarded by
  `tools/test/skill-embed-drift.test.mjs`); the UI journey flow / classification / UC-template fields
  (`App root`, `App URL`, `Persistence mechanism`) documented; **all 7 UI→N/A steer sites flipped**
  (new-feature, fix-bug, ship-gates.md, CLAUDE.md, README.md, extending.md, + the skill's own intro) —
  `N/A` now only for purely-internal changes; both installers get an idempotent independent `.workflow/`
  gitignore merge (`tools/test/install-gitignore.test.mjs`).
- **Plan C** — a UI-journey routing eval case (`{prompt, top_k:1}` in `verify-e2e.positive`); smoke
  assertions that the skill ships **byte-identical** to both `.claude`/`.agents` mirrors + no UI-deferral
  wording in any of the 9 shipped surfaces; and the **D6d portability test**
  (`tools/test/skill-embed-portability.test.mjs`) — extracts the sentinel-fenced harness from an
  *installed* skill and runs it, proving zero dependency on unshipped `tools/`.

**Verification:** `npm run check` = 146/146 (skill lint + evals 91% rank-1 + tool tests);
`sh tests/smoke.sh` = ALL PASS; CI green on `dev` (ubuntu runs the browser tests for real via
`E2E_BROWSER_REQUIRED=1`; Windows self-skips). Scope was UI-adapter only.

Design spec: `docs/plans/2026-07-23-fase3-verify-e2e-ui-design.md` (rev6, certified). Plans:
`docs/plans/2026-07-23-fase3-plan-{A,B,C}-*.md`. SDD ledger: `.superpowers/sdd/progress.md`.

---

## 3. What's NEXT — Fase 3.5 (the reason for this handoff)

**Fase 3.5 = the Playwright `.spec.ts` regression bridge** — the deliberately-deferred second half of
UI E2E. It graduates passing UI journeys into **deterministic, committed `.spec.ts` files that CI
re-runs**, i.e. it brings UI up to the **Verified** enforcement tier (today UI is Attested: an agent
ran the harness and wrote a report; CI re-running the tests is what makes it Verified).

Scope to brainstorm/spec (same rhythm as Fase 3 — brainstorm → spec → cross-engine review → plan(s) →
plan-review → SDD):
- A `@playwright/test` **runner** path + a `playwright.config` template (v1 deliberately used only the
  library API, no runner/config — 3.5 is where the runner earns its keep for CI replay).
- A **graduation path**: a passing markdown UI journey → a committed `.spec.ts` under a target's
  `docs/e2e/` (or equivalent) that `playwright test` replays in CI, zero-LLM-cost.
- Wire it into the target's CI template (`src/docs/ci-templates/`) as a Verified-tier check.
- Reconcile with the v1 harness: the confirmed-locator output from a journey run is the reusable asset;
  the single `@playwright/test` dep chosen in v1 means the runner drops in with **zero dependency
  churn** (this was a deliberate Fase 3 decision — do not re-litigate it).
- **Dependency-conflict guardrail (carry forward):** NEVER install both `playwright` and
  `@playwright/test` — it breaks `npx playwright test`. Import browser APIs from `@playwright/test`.

Also queued (lower priority / separate): **v2 `/goal`** — durable cross-session resume (the crash-safe
state machine cut from `/goal` v1). And the deferred **`dev→main` release** of 0.6.0 (§1).

---

## 4. Rules & conventions established this session (KEEP DOING)

- **Cross-engine review is mandatory and iterates to CLEAN.** Spec + every plan + every implementation
  goes through **Opus** (dispatch a subagent, model opus, read-only) **+ Codex `gpt-5.6-sol` `xhigh`,
  read-only sandbox**, until BOTH return CLEAN (no P0/P1/P2) on the same revision. It earned its keep
  massively (caught a removed Playwright API, a routing false-green, a bad `createRequire` anchor, a
  flaky watchdog test, a Windows-only CRLF test bug, and more). Codex invocation:
  `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" --sandbox read-only
  --output-last-message <file> "<prompt>" < /dev/null` — then READ `<file>`.
- **Codex prompts MUST be passed from a FILE, not inline.** Backticks/`()`/`<>` in a double-quoted zsh
  argument get command-substituted and break the call. Write the prompt to a file with a single-quoted
  heredoc, then `codex exec ... "$(cat promptfile)"`.
- **NO `Co-Authored-By: Claude` trailer in commits** (user preference + project convention). Do not add
  it. If a commit message body has backticks, write it to a file and `git commit -F` (inline `-m` with
  backticks gets mangled by zsh).
- **subagent-driven-development** for executing plans: fresh implementer subagent per task (pick the
  cheapest capable model — haiku for transcription/one-liners, sonnet for judgment), then a task-review
  subagent, fix loop on Critical/Important, whole-branch review (opus) at the end. Track in the SDD
  ledger `.superpowers/sdd/progress.md`.
- **Parent-repo hooks on this machine** (`~/Desktop/personal/.claude/hooks/`): `git commit`/`git push`/
  `gh pr create` are blocked if they share a Bash line with another statement — run each **standalone**
  (`git -C <repo> ...`, no `cd`, no pipe). Never Bash-read `.workflow/state.md` or `~/.claude/settings*`
  (use the Read tool).
- **`gh` has two accounts:** `Juan-Andres-LM` (read-only) and `Juan-Motta` (owner). Run
  `gh auth switch --user Juan-Motta` before any `gh` write (PR create, release). Can revert between
  sessions.
- **Fase 2 lesson (applied twice):** when N rounds of prose review keep surfacing precision holes in one
  runtime subsystem, operationalize it as **tested code** (the harness + its acceptance test), don't
  keep prose-specifying — code + tests are the arbiter. Windows/CRLF and shell parity are caught by
  running the actual tests on the actual platform (CI), not by review.
- **Thin install is sacred:** `tools/` (harness, fixtures, tests) + dev-deps never ship to a target;
  the runtime skill carries the harness only via the verbatim embed. Verify with `npm pack --dry-run`.

---

## 5. Loose ends / decisions parked for the user

- **`feat/goal-autonomous` local branch NOT deleted** — it has 1 commit not in `dev`: the Fase 2
  handoff doc `docs/plans/2026-07-23-goal-fase2-complete-handoff.md`, which apparently did not land on
  `dev` via PR #17. Decide: cherry-pick/PR that doc onto `dev`, or `git branch -D feat/goal-autonomous`
  to drop it.
- **`dev→main` 0.6.0 release** — deferred pending user testing (§1). When ready: dev→main PR at 0.6.0
  fires `release.yml` (tag `v0.6.0` + GitHub Release); then the MANUAL `publish.yml` workflow_dispatch
  publishes to npm via OIDC — **verify the Trusted Publisher is registered on npmjs.com first**. (User
  may choose to bump to 0.7.0 first so the version reflects Fase 2+3 — that's their call.)

---

## 6. First actions for the new session

1. Read this file + `memory/forge-ai.md`.
2. `cd ~/Desktop/personal/projects/forge-ai`; `git switch dev`; `git pull`; confirm `origin/dev` head +
   `npm run check` green if you're about to build on it.
3. To start **Fase 3.5**: run `superpowers:brainstorming` (a `.spec.ts` regression bridge is a real
   feature — brainstorm scope first), then spec → cross-engine review → `writing-plans` → SDD. Study the
   Fase 3 design spec + `src/skills/verify-e2e/SKILL.md` (the current UI adapter) before designing.
4. The release and the `feat/goal-autonomous` decision (§5) are the user's calls — surface them, don't
   act unprompted.

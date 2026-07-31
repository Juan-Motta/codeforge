# codeforge — session handoff + roadmap for Fase 2 & 3

**Written:** 2026-07-22. **Purpose:** give a fresh session all the context to continue the
"get codeforge to the level" roadmap. Read this end-to-end before starting Fase 2 or 3.

Repo: `~/Desktop/personal/projects/forge-ai` (GitHub `Juan-Motta/codeforge`, npm
`@jualopezmo/codeforge`). This is a cross-engine (Claude Code / Codex / OpenCode) workflow-
discipline framework; you work ON it here. Branch model: work on a feature branch → PR to `dev`
→ (separately) PR `dev`→`main` for releases.

---

## 1. Current state (verified 2026-07-22)

| Ref | Version | Commit | Notes |
| --- | --- | --- | --- |
| npm `latest` | **0.5.1** | — | published (Trusted Publishing / manual workflow) |
| `origin/main` | **0.5.1** | `00187b3` | v0.5.1 tagged + GitHub-released |
| `origin/dev` | **0.6.0** | `6c10fca` | **21 commits ahead of main** — Fase 0 + Fase 1 |
| local `main` | 0.5.0 (STALE) | `a6f9b2e` | run `git checkout main && git pull` before touching main |

**Done this session (both on `dev`, NOT yet on main/npm):**
- **Fase 0 — check-gates identity fix** (was PR #16 → dev). `check-gates.{sh,ps1}` now validate
  gate IDENTITY (leading-word anchors), not just box count; E2E evidence extractor aligned in
  leniency. TDD + 4 rounds of Codex review.
- **Fase 1 — CI-only Verified-tier enforcement** (merge commit `6c10fca`, v0.6.0). Shipped a
  Verified-tier CI template (`src/docs/ci-templates/gates.yml` fail-closed + `README.md`
  branch-protection guide), installer copies it (managed + backup), and **retired `--with-hooks`**
  across all surfaces (deprecated no-op; `claude-gate-hook.{sh,ps1}` deleted+pruned; kept
  run-installer WIN_FLAG translation + INSTALL_FLAGS membership + ps1 `[switch]$WithHooks`).
  Docs reframed to an honest Advisory/Attested/Verified ladder. Built via
  subagent-driven-development (7 tasks + 3 final-review fix waves); final review Opus READY +
  Codex CLEAN.

**Loose ends (do when ready — user deferred them):**
- **Release 0.6.0:** open a PR `dev`→`main`. Merging fires `release.yml` (VERSION change on main
  → tag `v0.6.0` + GitHub Release + `sync-dev.yml` ff dev). This ships BOTH Fase 0 and Fase 1.
- **npm publish 0.6.0:** MANUAL — run the "Publish to npm (manual)" GitHub Actions workflow
  (`.github/workflows/publish.yml`, `workflow_dispatch` with tag `v0.6.0`) via OIDC Trusted
  Publishing (no token). One-time Trusted-Publisher registration on npmjs.com may still be
  pending — verify: npmjs.com → package → Settings → Trusted Publisher → GitHub Actions
  (org `Juan-Motta`, repo `codeforge`, workflow `publish.yml`, action `npm publish`).
- **Verify `dev` CI green:** the merge push to dev triggered `.github/workflows/ci.yml`
  (skills + installer smoke + Windows). Confirm green before the dev→main PR.

---

## 2. Why these phases — the comparison verdict

A 3-engine council (Opus + Codex `gpt-5.6-sol` + OpenCode `kimi-k3`, 2026-07-22) compared
codeforge to **claude-codex-forge** (pablomarin, v5.57 — the mature origin project codeforge was
inspired by; Claude+Codex only, hooks-heavy, has `/goal` + UI E2E + 6-agent review). Verdict:
codeforge ~50-60/100 maturity — NOT at the level in capabilities, but better architecture
(3-engine, thin install, npm+wizard, honest enforcement) and a larger addressable market
(single-engine / OpenCode users). Roadmap agreed to close the gap, in priority order:

1. **Fase 0** — fix check-gates bugs ✅
2. **Fase 1** — portable enforcement (council ranked #1) ✅ (as CI-only, see its design doc)
3. **Fase 2** — `/goal` autonomous mode (the top remaining capability gap)
4. **Fase 3** — verify-e2e UI (Playwright) + regression suite
5. Ongoing — deeper multi-agent review; defend the wedge (3-engine, thin, honest)

Design docs: `docs/plans/2026-07-22-portable-enforcement-design.md` (Fase 1, CI-only rev 3) and
`-plan.md` (its implementation plan). Fase 0 is in `docs/CHANGELOG.md` 0.6.0.

---

## 3. FASE 2 — `/goal` autonomous mode (next; the star feature)

**What it is:** a resumable state machine that drives a feature `prd → plan → TDD → review →
verify → PR-ready` with **human gates ONLY at PRD approval and PR creation** — the agent runs
the middle autonomously. This is the single biggest capability claude-codex-forge has that
codeforge lacks. Cross-engine (works on Claude/Codex/OpenCode) would make codeforge's version
**unique** — claude-codex-forge's `/goal` is Claude+Codex only.

**Reference (study before designing):** claude-codex-forge's `/goal` (the parent repo
`~/Desktop/personal` IS derived from it — see its `.claude/commands/goal.md` /
`.claude/rules/workflow.md` "Council During /forge-goal Autonomous Run" section, already loaded
in the parent CLAUDE.md context). Key patterns there: PRD-gated entry; the agent invokes
`/council` instead of asking the user for non-PR decisions during the autonomous run; PR creation
awaits explicit human approval; a convergence-breaker halts (human-only) on non-convergence;
ask-tier commands (`rm -rf`) stall an autonomous run so they must be avoided.

**codeforge-specific design constraints (must hold):**
- **Cross-engine:** must work as a skill under all three engines (no Claude-only mechanism as the
  core). `/goal` is a `SKILL.md` the driver follows, orchestrating the existing skills (prd,
  research, plan, new-feature/fix-bug, review, verify-e2e, finish-branch).
- **State machine = `.workflow/state.md`:** it already holds Profile + Phase + the ship-gate
  checklist. `/goal` advances Phase and checks gates via `check-gates` (Fase 0 made it validate
  identity). Resumability: on resume, read `.workflow/state.md` (and CONTINUITY.md), continue
  from the recorded Phase — do NOT restart completed phases (the SDD progress-ledger lesson).
- **Human gates:** PRD approval (before autonomous run) + PR creation (`gh pr create` / push).
  Everything else the agent decides; use `/council` (cross-engine, exists as a skill) for
  genuinely ambiguous forks instead of pausing for the user.
- **Reviewer discipline:** reuse the cross-engine review loop (reviewer ≠ driver; Codex is the
  mandatory reviewer per this repo's dual-engine model). Exit loops only on no P0/P1/P2 from all
  available reviewers on the same pass.
- **Honesty (the identity):** don't claim more autonomy/safety than delivered. An autonomous loop
  can't self-approve ask-tier prompts; document the human-only halt points plainly.

**Design forks to resolve in brainstorming (open questions):**
- How does the loop record/resume phase progress durably (state.md fields? a dedicated ledger
  like SDD's `.superpowers/sdd/progress.md`)? Must survive context compaction.
- What triggers a `/council` vs a human pause? (claude-codex-forge's rule: PR-authorization →
  human; everything else ambiguous → council. Adapt.)
- Convergence-breaker / max-iteration guard so the loop can't grind unbounded (claude-codex-forge
  has `POST_CERT_REVIEW_ROUND_LIMIT`). Since codeforge is hooks-light, this is skill-level
  discipline, not an enforced hook — be honest about that.
- Per-engine differences: Claude has subagents (execution.md inline vs subagent-driven); Codex/
  OpenCode don't. Does `/goal` use subagents on Claude and inline elsewhere? (execution.md
  already models this — reuse it.)
- Failure handling: retried tool/subagent fails → council or halt? Blocker line in state.md.

**How to start Fase 2 (new session):**
1. Create a feature branch off `dev` (`git checkout dev && git pull && git checkout -b feat/goal-autonomous`).
2. Invoke `superpowers:brainstorming` — resolve the forks above one question at a time.
3. Cross-engine plan review (Opus + Codex `gpt-5.6-sol` + OpenCode `kimi-k3`) — it caught real
   structural problems twice this session; use it.
4. `superpowers:writing-plans` → `superpowers:subagent-driven-development` (per-task impl+review,
   final whole-branch review Opus + Codex).
5. New skill lands as `src/skills/goal/SKILL.md` + index entry in `src/CLAUDE.md` + routing evals
   entry (the linter enforces index parity + anti-rationalization anatomy: Common
   Rationalizations + Red Flags + Verification sections are HARD-required).

---

## 4. FASE 3 — verify-e2e UI (Playwright) + regression suite

**What it is:** extend the existing `verify-e2e` skill (today API/CLI only — it explicitly
records `E2E verified — N/A: UI journey, no v1 adapter` for UI) with a **Playwright UI journey
adapter**, and add a **graduation path** so passing use cases become a committed regression suite
under `docs/e2e/use-cases/` (the scaffolding dirs already exist: installer creates
`docs/e2e/{reports,use-cases}`). Closes the fullstack gap vs claude-codex-forge (which has a
`--with-playwright` bridge).

**Context / constraints:**
- `verify-e2e` is a `SKILL.md` (`src/skills/verify-e2e/SKILL.md`) — read it first; it defines the
  journey shape (Actor→Scenario→Intent→Setup→Steps→Verification→Persistence), the no-cheat
  ARRANGE/VERIFY boundary, and the classification truth table. UI is the deferred v2.
- The E2E evidence is bound to the ship-gate by `check-gates` (report path named in the box, must
  exist + `VERDICT: PASS` + freshness). Fase 0 hardened this. A UI adapter must produce the same
  evidence-report shape.
- Cross-engine: the skill must degrade honestly where Playwright isn't available (it's a Node/
  browser tool; document the dependency and the N/A path when absent).
- The Fase 1 CI template (`docs/ci-templates/gates.yml`) is where a graduated Playwright spec
  suite would actually re-run in CI (the Verified tier) — Fase 3 and the CI template connect here.
- Note the ci-templates README already references test-defining paths + CODEOWNERS; a Playwright
  suite is exactly the kind of "declared test command" the Verified tier reruns.

**How to start:** same flow as Fase 2 (branch off dev → brainstorm → cross-engine plan review →
writing-plans → SDD). Study the existing verify-e2e skill + `src/shared/rules/testing.md` (the
parent repo's testing rules mirror the target's) before designing.

---

## 5. Process notes & operational gotchas (learned this session — save re-discovery cost)

- **Cross-engine review earns its keep.** Twice this session Codex/kimi caught real structural
  problems a single engine (or self-review) missed: Fase 0's check-gates identity/evidence
  desync (4 rounds), and Fase 1's whole premise being wrong (local git hooks can't be portable
  enforcement) + GitHub-platform security gaps (workflow editable-by-PR, token permissions).
  ALWAYS run the cross-engine plan review AND code review. Reviewer ≠ driver.
- **Model invocations** (`src/shared/rules/models.md`): Codex =
  `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" --sandbox read-only
  --output-last-message <file> "<prompt>" < /dev/null` (the `< /dev/null` + `--output-last-message`
  are REQUIRED when an agent runs it — else it hangs on stdin / drops stdout). OpenCode =
  `opencode run -m opencode-go/kimi-k3 "<prompt>"`. Give each parallel advisor its own output file.
- **Parent-repo hook blocks compound git ship commands.** `~/Desktop/personal/.claude/hooks/
  check-workflow-gates.sh` BLOCKS any single Bash command chaining `git commit`/`git push`/
  `gh pr create` with `&&`/`;`/`|` (even `cd x && git commit`). Run each git ship action as its
  OWN standalone Bash call. Put message text in a file and use `git commit -F <file>`.
- **`gh` has two accounts:** `Juan-Andres-LM` (default, READ-only on the repo) and `Juan-Motta`
  (owner, ADMIN). `git push` works via the SSH remote with either, but `gh pr create` / release
  API fail "must be a collaborator" until `gh auth switch --user Juan-Motta`. gh tends to revert
  to the read-only account between calls — re-switch before each gh API action.
- **`.workflow/state.md` must be read with the Read tool, never Bash** (`cat`/`sed`/etc trip a
  sensitive-file prompt). Write/update with Edit/Write.
- **SDD helper scripts** live in the superpowers skill dir
  `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/
  subagent-driven-development/scripts/` (`task-brief PLAN N`, `review-package BASE HEAD`). The SDD
  progress ledger goes at `.superpowers/sdd/progress.md` (gitignored scratch) — check it on resume.
- **Model selection for SDD:** transcription-of-plan tasks → haiku; integration/judgment → sonnet;
  final whole-branch review → opus; cross-engine code review → Codex (mandatory).
- **Version release mechanics:** `release.yml` fires on VERSION change on `main` (auto tag +
  GitHub Release + notes from CHANGELOG); `sync-dev.yml` ff's dev after a main merge; npm publish
  is the MANUAL `publish.yml` workflow (OIDC, no token). CI (`ci.yml`) runs skills+smoke+Windows
  on push to main/dev and PRs.
- **The linter is strict:** `tools/lint-skills.mjs` enforces frontmatter, name==dir, CLAUDE.md
  index parity, model-id quarantine, shared/ reference integrity, and anti-rationalization
  anatomy. `tools/run-evals.mjs` enforces routing (rank-1 ≥ floor). Run `npm run check` before
  any commit that touches skills.

---

## 6. Key files map

- **Skills (source):** `src/skills/<name>/SKILL.md` (14: prd, research, plan, new-feature,
  fix-bug, quick-fix, review, simplify, verify-e2e, council, adr, finish-branch, checkpoint,
  index). New skills go here + `src/CLAUDE.md` index + routing evals.
- **Rules:** `src/shared/rules/*.md` (12: workflow, severity, ship-gates, tdd, execution,
  research, approach-comparison, memory, docs-layout, continuity, models, project-rules).
- **Enforcement:** `src/shared/scripts/check-gates.{sh,ps1}` (Tier-B validator, identity-checked);
  `src/docs/ci-templates/{gates.yml,README.md}` (Verified tier, Fase 1).
- **Installers:** `install.sh` / `install.ps1` (thin install; copy runtime, run `sync.{sh,ps1}`).
- **Wizard/CLI:** `cli/` (Ink TUI), `bin/codeforge.mjs` (npx entry), `cli/lib/{flags,run-installer,
  i18n,models}.mjs`, `cli/components/*.mjs`, `cli/state.mjs`.
- **Tests:** `tools/test/*.test.mjs` (`node --test`, zero-dep for tools; wizard tests use
  ink/react) + `tests/smoke.sh` (installer smoke, has pwsh parity cases).
- **CI:** `.github/workflows/{ci.yml,release.yml,sync-dev.yml,publish.yml}`.
- **Docs:** `docs/CHANGELOG.md` (framework's own), `docs/plans/` (design + plan docs, incl. this
  handoff and the Fase 1 design/plan).

---

## 7. First actions for the new session

1. Read this file + your persistent memory (`forge-ai.md`).
2. `cd ~/Desktop/personal/projects/forge-ai`; `git checkout dev && git pull` (dev = 0.6.0, current).
3. Decide with the user: release 0.6.0 first (dev→main PR + manual npm publish), or start Fase 2
   directly. Verify `dev` CI is green either way.
4. To start Fase 2: branch off dev → `superpowers:brainstorming` for `/goal` (resolve the §3
   forks) → cross-engine plan review → writing-plans → subagent-driven-development.

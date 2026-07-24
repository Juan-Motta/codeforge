# codeforge — session handoff (Fase 2 `/goal` COMPLETE) — 2026-07-23

**Read this first in a new session**, then `~/.claude/.../memory/forge-ai.md`. This supersedes the
2026-07-22 roadmap handoff for the current state (that doc's Fase 2/3 design context is still useful
background). Everything below is verified as of 2026-07-23.

Repo: `~/Desktop/personal/projects/forge-ai` (GitHub `Juan-Motta/codeforge`, npm
`@jualopezmo/codeforge`). Cross-engine (Claude Code / Codex / OpenCode) workflow-discipline
framework. You work ON it here. Branch model: feature branch → PR to `dev` → (separately) `dev`→`main`
for releases.

---

## 1. Where things stand (verified)

| Ref | Value |
| --- | --- |
| npm `latest` | **0.5.1** |
| `origin/main` | **0.5.1** (`00187b3`) |
| `origin/dev` | **0.6.0** (`068ea53`) — has Fase 0 + Fase 1, NOT yet released to main |
| Active branch | **`feat/goal-autonomous`** (HEAD `3d4e752`), pushed to origin, 20 commits ahead of dev |
| **Open PR** | **#17 `feat/goal-autonomous` → `dev`** — https://github.com/Juan-Motta/codeforge/pull/17 — **CI GREEN** (ubuntu lint+tests, bash smoke, Windows/pwsh all pass) |

**Fase 2 `/goal` is implemented, reviewed, green, and in PR #17 to `dev`. It is NOT merged yet
(awaits the user's explicit OK).** Nothing is running.

---

## 2. What Fase 2 `/goal` is + what shipped

`/goal <feature objective>` = an engine-neutral orchestrator skill that drives one **feature**
objective `prd → research → plan → TDD → cross-engine review → simplify → verify → ship` mostly
autonomously, pausing for a human at **exactly two** gates (approve the PRD; create the PR).
Ambiguous forks → `council`; non-convergence / unrecoverable failure → human HALT. It **composes**
the existing skills under `owner=goal` — never re-implements them.

Shipped in 3 sub-plans (each written → cross-engine reviewed → revised → executed → committed):

- **Plan A — helpers** (`src/shared/scripts/goal-digest.{sh,ps1}`, `goal-state.{sh,ps1}` + 4 node
  tests). Digest = ONE normalized `git diff` over a temp index (`GIT_INDEX_FILE` + `git add -N`),
  both engines hash the **raw git-diff bytes** → parity is structural; index-state-invariant
  (untracked == staged == committed via `--from-head`). `goal-state.sh`: `field` / `round-count` /
  `ship-red-count` / `ship-red-bump`, section-scoped + CRLF-tolerant. Commits `36f83e4`, `49dc181`.
- **Plan B — plumbing**. `src/shared/rules/execution.md` gains the `owner` (self|goal) +
  `commit_policy` (per-task|defer) contract; `cli/lib/apply.mjs` generates a commit_policy-aware,
  upgrade-safe `codeforge-implementer` agent (`defer` = stage-only, no commit); `owner=goal`
  **override** notes in `plan`/`review`/`new-feature`/`finish-branch` DISABLE their standalone
  loop/ship/logging. Commits `df9211c`, `1b2836c`.
- **Plan C — the skill**. `src/skills/goal/SKILL.md` (the orchestrator) + two SHIPPED rules it
  references — `src/shared/rules/goal-state.md` (the `.workflow/state.md` line schemas the helpers
  parse) and `src/shared/rules/goal-autonomy-setup.md` (per-engine allow-entries to make reviewer
  spawns + post-GATE-2 push/PR prompt-free) — + `src/CLAUDE.md` index & rules entries + the `goal`
  routing eval case + a `workflow.md` row + `## Blockers`/`## Attempts` in `state.template.md` +
  smoke asserting all of it ships to both `.claude` and `.agents` mirrors. Commits `bbfda2a`,
  `0a29cb9`, then `3d4e752` (Windows test-portability fix).

**Verification (all green):** `npm run check` = 121 tests + skill lint; `node tools/run-evals.mjs`
= 45 prompts, rank-1 **91%**, 0 errors (`goal ~ new-feature` cosine 0.213, no collision);
`sh tests/smoke.sh` = ALL PASS; ps1↔sh digest/state parity verified on macOS pwsh 7.5.4 AND the
Windows CI runner.

**Scope (v1):** feature-only (a bug objective is rejected → `/fix-bug`); single-session best-effort
(interruption → clean restart). **Deliberately deferred to v2 / Fase 3:** durable cross-session
resume (cut during design — it was the dominant complexity source across review rounds), and the
verify-e2e UI (Playwright) adapter.

---

## 3. What's NEXT (in priority order) — all need the user's explicit OK for outward actions

1. **Merge PR #17 → `dev`** (user's call). It's an isolated, green increment. On merge, `sync-dev.yml`
   does nothing special (it ff's dev only on a `main` push); dev just advances.
2. **Release 0.6.0** (`dev` → `main`) — a SEPARATE PR. Merging it fires `release.yml` (tag `v0.6.0`
   + GitHub Release from CHANGELOG) + `sync-dev.yml` (ff dev). This would ship **Fase 0 + 1 + 2**
   together. Then npm publish 0.6.0 = the MANUAL `publish.yml` workflow_dispatch with tag `v0.6.0`
   (OIDC trusted publishing — verify the Trusted Publisher is registered on npmjs.com first). Both
   the dev→main PR and the publish are user-authorized actions.
3. **Fase 3** — extend the `verify-e2e` skill with a Playwright UI-journey adapter + a graduation
   path to a committed regression suite (`docs/e2e/use-cases/`). Same rhythm: brainstorm → spec →
   cross-engine review → plan(s) → plan-review → execute.
4. **v2 `/goal`** — durable cross-session resume (the crash-safe state machine cut from v1): epoch/
   budget generation, nonce-scoped records, idempotent ship-side recovery, preflight re-validation
   on resume. The design spec §14 iter-3/4 logs enumerate exactly what this needs.

---

## 4. Key artifacts (where to look)

- **Design spec:** `docs/plans/2026-07-22-goal-autonomous-design.md` (rev5; §14 logs 5 review
  iterations + the scope-cut rationale). The load-bearing rules live in §3–§11.
- **Plans:** `docs/plans/2026-07-22-goal-plan-A-helper.md` (rev3), `-plan-B-plumbing.md` (rev2),
  `-plan-C-skill.md` (rev2). Each has a Self-Review disposition of its plan-review findings.
- **Shipped skill + rules:** `src/skills/goal/SKILL.md`, `src/shared/rules/goal-state.md`,
  `src/shared/rules/goal-autonomy-setup.md`, `src/shared/rules/execution.md`.
- **Shipped helpers:** `src/shared/scripts/goal-{digest,state}.{sh,ps1}`.
- **Tests:** `tools/test/goal-{digest,state}.{test,ps1.test}.mjs`, `tools/test/apply.test.mjs`
  (agent), `tools/evals/routing-cases.json` (the `goal` case), `tests/smoke.sh`.

---

## 5. Process discipline that worked (keep doing it)

- **Cross-engine review earned its keep massively** — ~11 rounds total (spec 5 + plans 6). *Every*
  round caught real defects self-review would have shipped: dead-code convergence breaker, bypassable
  GATE 2, an agent committing mid-loop, digest not staging-invariant, `§10` schemas that didn't ship
  to targets, an inverted ship-red counter, off-by-one breaker boundary. **Always run spec/plan
  through Opus + Codex (mandatory) before executing.**
- **Model invocations** (`src/shared/rules/models.md`):
  - Codex reviewer: `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" --sandbox read-only
    --output-last-message <file> "<prompt>" < /dev/null` (the `< /dev/null` + `--output-last-message`
    are REQUIRED when an agent drives it, else it hangs on stdin / drops stdout). Read the
    `<file>` for the synthesis.
  - Opus reviewer: dispatch a subagent (Agent tool, model opus), give it the files to READ.
  - **OpenCode `opencode run -m opencode-go/kimi-k3` CHRONICALLY STALLS** (reads files, never
    flushes a synthesis). It worked ~twice with a directive "print the full review now, don't
    explore other files" prompt, but often not. Practical stance: run Opus + Codex (Codex is the
    mandatory reviewer); treat kimi as best-effort — if it stalls in ~3-4 min, `pkill -f "opencode
    run"` and proceed on 2/3.
- **Tests are the arbiter for shell/PS determinism.** Executing (not more prose review) caught real
  bugs: a trailing false test in the sh EXIT trap overriding the exit status; the Windows exec-bit /
  `shasum` test-portability issues. Run the actual tests on the actual platforms.

---

## 6. Operational gotchas on this machine (each cost time once)

- **Parent-repo hook blocks compound git ship commands.** `~/Desktop/personal/.claude/hooks/
  check-workflow-gates.sh` blocks ANY `git commit`/`git push`/`gh pr create` that shares a Bash line
  with another statement — including `cd x && git commit`, a trailing `| tail`, or `;`/`&&` chains.
  Run each ship action **standalone**. For commit messages, write the message to a file and use
  `git -C <repo> commit -F <file>` (no `cd`). For `gh pr create`, use `--repo Juan-Motta/codeforge`
  so no `cd` is needed, and no pipe.
- **`gh` has two accounts.** `Juan-Andres-LM` (default, READ-only on the repo) and `Juan-Motta`
  (owner, ADMIN). `git push` works via the SSH remote either way, but `gh pr create` / release API
  fail "must be a collaborator" until `gh auth switch --user Juan-Motta`. It can revert between
  sessions — re-switch before a gh write action.
- **Never Bash-read `.workflow/state.md` or `~/.claude/settings*`** — use the Read tool (Bash
  read-utilities trip a sensitive-file / safety hook). Write state with Edit/Write.
- **`shasum` is macOS; Linux/Windows differ.** goal-digest.sh already falls back `sha256sum` →
  `shasum -a 256`. In node TESTS, hash with `node:crypto`, never spawn `shasum` (ENOENT on Windows).
- **CI test discovery:** `.github/workflows/ci.yml` runs `node --test` (ubuntu, bare — auto-discovers
  `tools/test/*.test.mjs`) and `node --test tools/test/` (windows). No CI edit needed to add tests.
  The Windows job also has Git-for-Windows `sh` + `pwsh`, so sh-side and ps1 tests both run there —
  guard Windows-invalid assumptions (exec bit, `shasum`) with `process.platform === 'win32'`.

---

## 7. First actions for the new session

1. Read this file + `memory/forge-ai.md`.
2. `cd ~/Desktop/personal/projects/forge-ai`; confirm branch `feat/goal-autonomous`, `git fetch`,
   check PR #17 is still green (`gh pr checks 17 --repo Juan-Motta/codeforge`).
3. Ask the user which of §3's next steps to take (merge PR #17, cut 0.6.0, start Fase 3). Merging /
   releasing / publishing are all **user-authorized** outward actions — do not do them unprompted.

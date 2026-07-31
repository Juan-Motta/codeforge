# Design — Verified-tier enforcement via CI (Fase 1, CI-only)

**Date:** 2026-07-22 (rev 3 — CI-only, after two rounds of 3-engine plan review)
**Status:** design (pending implementation)
**Roadmap:** Fase 1 of "get codeforge to the level". Follows Fase 0 (check-gates identity, PR #16).

## Why CI-only (the short version of two review rounds)

Rev 1 proposed a default-on git `pre-push` hook as *the* portable hard block. Two rounds of
3-engine review (Opus + Codex gpt-5.6-sol + OpenCode kimi-k3) established:

- A **local git hook cannot be portable, mandatory enforcement**: `core.hooksPath` is per-clone
  (`.git/config` never travels), local hooks never fire on server-side merges (GitHub UI,
  `gh pr merge`, Dependabot), and the exec-bit/CRLF/exit-3/`rm .workflow` traps make it silently
  bypassable — the *default* state on a fresh clone is "no gate."
- A **CI job running `check-gates` is vacuous**: `.workflow/` is gitignored, so a PR checkout has
  no `state.md`; the E2E-report binding also lives only in that gitignored state, so no
  committed source names the report — every implementable in-CI E2E check is either
  non-commit-bound or fail-open, and conflicts with the `light` profile / `N/A` allowances.
- The local hook's only real value — fast local feedback — is **already delivered** by
  `finish-branch`, which runs `check-gates` before pushing.

So the local hook is high-complexity, high-bypass, low-marginal-value. **Fase 1 drops it.** The
honest, actually-portable enforcement is **CI + branch protection that recomputes the project's
tests on the PR commit**. That is the only signal that binds for every clone and every merge.

This is also more honest than claude-codex-forge's "baked in by construction" — its local hooks
share the same per-clone limitation; its real gate is CI too.

## Architecture — the honest ladder (final)

| Tier | Mechanism | Binds for | Bypass |
| --- | --- | --- | --- |
| **Advisory** | skills instruct | the honest agent | ignore it |
| **Attested** | `finish-branch` runs `check-gates` locally before shipping | the clone that runs the workflow | skip finish-branch; `rm .workflow` |
| **Verified** | CI reruns the project's tests on the PR merge result + branch protection | **everyone, every merge** | none once bypass is disallowed (repo/org admins bypass by default — the guide covers disabling that) |

No new git hook, no `core.hooksPath`, no new runtime blocking mechanism. codeforge stays
"skills + config first"; the one added artifact is an opt-in CI template.

## Components

### 1. Verified-tier CI template (the real gate)

Ship two files in the codeforge source, installed into the target under `docs/ci-templates/`:

- **`src/docs/ci-templates/gates.yml`** — a GitHub Actions workflow, reference (not
  auto-activated; activated with `cp docs/ci-templates/gates.yml .github/workflows/`). It:
  - triggers on `pull_request`; uses `actions/checkout`'s default, which checks out the **PR
    merge result** (the state that will land on the base branch) — so the recompute binds to the
    exact code being merged, outside any agent turn;
  - runs the project's **real recompute** at a single clearly-marked step whose default body is
    an explicit **failing** command (`echo 'codeforge: replace this with your test command'; exit 1`)
    — so an un-edited required check **fails closed** rather than passing green while running
    nothing. codeforge does not know the project's stack; the README explains the one-line
    replacement (e.g. `npm test` / `uv run pytest`).
  - **No `check-gates` step** (gitignored state is absent in CI) and **no E2E-report step** (no
    committed source names the report; conflicts with light/N/A). The workflow verifies exactly
    what it can honestly recompute: the project's own tests.
- **`src/docs/ci-templates/README.md`** — activation + branch-protection guide: copy the
  workflow, fill the test command, then **make it a required status check**, enable **"Do not
  allow bypassing the above settings"**, and **disallow direct pushes** to the protected branch,
  so UI merges / `gh pr merge` / Dependabot cannot skip it. States plainly: *until the test
  command is filled, the check is required, AND bypass is disabled this is not yet the Verified
  tier — and repo/org admins (and some GitHub Apps) can still bypass unless you configure
  otherwise.*

**Installer support (new, was unspecified):** `install.sh` + `install.ps1` copy
`src/docs/ci-templates/*` into the target `docs/ci-templates/` as a **managed** copy. On first
install, if a non-ours `docs/ci-templates/{gates.yml,README.md}` already exists, back it up to
`*.pre-forge.bak` (like `CLAUDE.md`) and record ownership; on `--upgrade` overwrite only our
managed copy. Add smoke assertions that both files land AND that a pre-existing user file is
backed up, not clobbered.

### 2. Retire `--with-hooks` across ALL surfaces (migration)

The Claude-only opt-in PreToolUse hook is removed (superseded by the CI Verified tier; its local
role is covered by `finish-branch`). The reviews found the flag spans far more than the
installer — every one of these is in scope:

- **`install.sh` / `install.ps1`:** drop the flag's behavior + the `settings.local.json`
  gate-hook block. For safety during migration, **accept `--with-hooks` / `-WithHooks` as a
  deprecated no-op that prints a one-line warning** (so any script/CI still passing it doesn't
  hard-error), rather than an unknown-flag error. On `--upgrade` of a target that previously had
  the hook, print a one-line notice that the Claude gate hook is retired (superseded by the CI
  Verified tier), so existing users aren't silently un-gated.
- **Delete** `src/shared/scripts/claude-gate-hook.sh` + `.ps1`.
- **Target upgrade prune:** add `shared/scripts/claude-gate-hook.{sh,ps1}` to the installer's
  cleanup list so an `--upgrade` over an old target removes them (today the installer copies
  `shared/scripts/*` but only prunes manifest-tracked rules, so the stale hook would linger).
- **`.github/workflows/ci.yml`:** remove the `--with-hooks` smoke case and the
  `claude-gate-hook.ps1` exit-2/0 assertions — otherwise the implementing PR turns codeforge's
  OWN CI red.
- **`tests/smoke.sh`:** remove the existing `--with-hooks` smoke case ("installs the Claude gate;
  blocks a red ship and allows a green one"); replace with an assertion that the hook is **not**
  installed and that `--with-hooks` is accepted as a deprecated no-op.
- **Wizard / CLI surface:** remove the hook question + state everywhere it lives —
  `cli/components/Gates.mjs` (keep the profile question, drop the hook toggle),
  `cli/components/Summary.mjs` (`profileHooks` render), `cli/state.mjs` (`withHooks` default),
  `cli/lib/flags.mjs` (stop **emitting** `--with-hooks` from the wizard; leave install-intent
  detection tolerant of it), `cli/lib/i18n.mjs` (hook strings, en+es), `bin/codeforge.mjs` (drop
  it from help). **Keep** `cli/lib/run-installer.mjs`'s `WIN_FLAG['--with-hooks'] → -WithHooks`
  translation so the deprecated no-op still reaches `install.ps1` correctly on the Windows npx
  path (removing it would make PowerShell reject the GNU-style flag).
- **Tests:** update `tools/test/{wizard-components,flags,run-installer}.test.mjs` — the wizard no
  longer emits the flag, but `run-installer` still translates it (a compatibility test).

### 3. Honest docs update

Rewrite to the final ladder above and stop advertising a hard block that doesn't exist:

- `src/CLAUDE.md` "Enforcement model": Advisory + finish-branch's `check-gates` (Attested,
  local, when invoked) is the local story; **CI + branch protection is the hard gate**. Remove
  the `--with-hooks` Tier-C paragraph.
- `src/shared/rules/ship-gates.md`: reframe the Verified/Attested/Advisory section to point at
  the CI template as the concrete Verified mechanism; remove the "opt-in hard block (Tier C,
  Claude only)" subsection.
- `src/docs/extending.md`: drop/replace the Tier-C `--with-hooks` guidance.
- `README.md`: enforcement + Status reflect "CI-enforced Verified tier via a shipped template;
  local discipline is advisory + finish-branch's check; no per-engine runtime hooks."

### 4. Tests

- **CI template validity (`tools/test/ci-template.test.mjs`):** `gates.yml` parses as YAML,
  triggers on `pull_request`, and its default test step is the **failing sentinel** (`exit 1`) —
  assert the sentinel itself, not merely that a comment/placeholder is present; the README
  references the required-check + "do not allow bypassing" settings.
- **Smoke (`tests/smoke.sh`; note: no `tests/smoke.ps1` exists today — the pwsh parity path is
  exercised inside `smoke.sh`'s pwsh cases):** after install, `docs/ci-templates/gates.yml` +
  `README.md` are present; `claude-gate-hook.{sh,ps1}` are **absent**; `--with-hooks` prints the
  deprecation warning and still installs; an `--upgrade` over a target that has a stale
  `claude-gate-hook.*` prunes it.
- **Wizard/CLI tests:** the hook question/flag no longer appear; the wizard's summary no longer
  renders a Hooks line; `flags`/`run-installer` no longer translate `--with-hooks`.

## Ship

- Minor version bump (v0.6.0). Removing `--with-hooks` behavior is a breaking-ish change,
  softened by the deprecated-no-op; note it in the CHANGELOG.
- Feature branch `feat/portable-enforcement` → PR to `dev`. Cross-engine (Codex) code review
  before ship; TDD throughout.
- **Explicitly out of scope** (deferred, tracked): a git pre-push convenience hook (rejected as
  non-portable), and full HEAD-binding of E2E report content (Fase 0 "Bug 2", stays a documented
  Attested-tier limitation — the CI tier recomputes tests, not the E2E report).

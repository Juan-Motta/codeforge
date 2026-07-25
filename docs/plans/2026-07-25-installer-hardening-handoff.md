# codeforge — session handoff (prior-art research + installer/release hardening) — 2026-07-25

**Read this first in a new session.** This supersedes `2026-07-23-goal-fase2-complete-handoff.md` for
the current state; that doc's Fase 2 `/goal` context is still accurate background. Everything below
is verified as of 2026-07-25 unless marked otherwise.

Repo: `~/Desktop/personal/projects/forge-ai` (GitHub `Juan-Motta/codeforge`, npm
`@jualopezmo/codeforge`). Cross-engine (Claude Code / Codex / OpenCode) workflow-discipline framework.
You work ON it here. Branch model: feature branch → PR to `dev` → (separately) `dev`→`main` for
releases.

---

## 1. Where things stand (verified)

| Ref | Value |
| --- | --- |
| npm `latest` | **0.5.1** |
| `VERSION` / `package.json` | **0.6.0** — still unreleased |
| `origin/dev` | **0.6.0** + this session's work (merged, see §3) |
| Active branch this session | `fix/installer-managed-config` → merged to `dev` |
| Test suite | **164 tests, 0 fail** (was 146 before this session; 18 added in 3 new files) |
| `lint-skills` | 15 entries, 0 errors, 0 warnings |
| `run-evals` | 46 positive prompts, rank-1 **91%** (floor 70%), 0 errors |
| `tests/smoke.sh` | **ALL PASS** (19 scenarios, incl. pwsh parity) |
| npm tarball | **103.4 kB** (was 960.5 kB) |

Nothing is running. No open PR from this session (work went straight to `dev` at the owner's
instruction).

---

## 2. What this session did

Two things, in order:

**(a) Prior-art research** on two competing/adjacent products, at the owner's request, analysed in
parallel by three independent reviewers (Codex CLI at high reasoning + two Claude agents), with claims
cross-checked by hand:

- `docs/research/2026-07-25-prior-art-ccf-vs-gentle-ai.md` — `pablomarin/claude-codex-forge` (a
  direct competitor: Markdown/hooks discipline for Claude Code, 5★, no CI, superb CHANGELOG) vs
  `Gentleman-Programming/gentle-ai` (a Go binary configuring 16 agent harnesses, 5,051★, whose own
  maintainers published an audit scoring it *"Operable: Not for recovery"*).
- `docs/research/2026-07-25-gap-analysis-vs-prior-art.md` — the same analysis **re-aimed at this
  repo**, correcting the first doc (which had read an installed v0.5.1 payload in a different
  directory and therefore claimed "0 tests, no CI" — both false).

**(b) Fixed the defects that analysis surfaced** in the installer and release pipeline. Details in §3.

The headline finding, which reframed the priorities: **the rigor was in the wrong place.** The E2E
gate has product-grade rigor (447-line harness, adversarial Chromium tests, byte-exact pins) while the
installer — which writes into other people's repos and publishes to npm — could destroy downstream
config and had a shell-injection sink in the credentialed publish job.

---

## 3. What was fixed (all on `dev`)

See `docs/CHANGELOG.md` § 0.6.0 for the full write-up with rationale. Summary:

| Defect | Fix |
| --- | --- |
| **`--upgrade` silently ate the wizard's config, no backup.** The wizard wrote review policy into `shared/rules/models.md` and gate profile into `shared/state.template.md` — both MANAGED, both overwritten by a bare `cp`. And `--upgrade` skips the wizard, so nothing reapplied them; the answers were persisted nowhere else. | **`PROJECT.md § Review policy` is now the source of truth** (project-owned → never clobbered); both installers **re-render** the two managed files from it on every run. This extends the pattern `applyExecution` already used for `## Execution` — its comment states the reason — so it is a known-good mechanism, not a new one. |
| **Shell injection in `publish.yml`** — `tag="${{ inputs.tag }}"` inside a `run:` script, in the job holding `id-token: write`. | Tag arrives via `env:`; the test rejects **any** `${{ }}` in **any** `run:` script, so the class can't return via a future step. |
| **The publish credential coexisted with project code.** Adding a test gate to the single job made this *worse*: `id-token: write` would be live during `npm ci` and the suite, so a dependency `preinstall` could mint the token and publish before passing checks. | Split into **two jobs**: `gate` (`contents: read` only) runs the full suite; `publish` (`needs: gate`) holds `id-token: write` and runs **no project code at all**, not even `npm ci`. |
| **A branch could be published as a release.** `ref: v0.6.0` can resolve a branch of that name, and the `case` glob `v[0-9]*.[0-9]*.[0-9]*` also accepts `v1x.2y.3z`. | `ref: refs/tags/<tag>` + anchored `^v[0-9]+\.[0-9]+\.[0-9]+$`. |
| **`npm publish` ran no tests** on the tag being published. | The full suite runs in `gate`, on that tag, first. |
| **847 kB PNG = 90% of the npm tarball**, a dev-only input to `tools/gen-splash.mjs`. | Moved to `tools/assets/` (outside `files[]`). **960.5 kB → 103.4 kB.** |
| **`install.ps1` accepted `Gate profile: LIGHT`, `install.sh` rejected it** — PowerShell compares case-insensitively by default, so ps1 would write a profile `check-gates` exits 3 on. | Case-sensitive operators throughout that block (`-ceq`/`-clike`/`-cmatch`/`-ccontains`/`-creplace`). Both now reject it identically. |
| **Predictable temp files** (`models.md.tmp`) in repos we did not create — a pre-planted symlink there makes the redirection write outside the target; and the "applied" message printed even if the `mv` never ran. | `mktemp` inside the destination dir, fatal on failure. |

New test files: `tools/test/wizard-config-upgrade.test.mjs` (8), `publish-workflow.test.mjs` (7),
`package-payload.test.mjs` (3). Each fix was verified **discriminating** — the RED state was observed,
not assumed: reverting the `env:` tag fails the injection test; reverting `ENVIRON[]` to `awk -v`
corrupts a backslash-bearing value; before the PNG move the payload test reports 1144 kB vs a 400 kB
budget.

---

## 4. Decisions taken — do not re-litigate these

1. **No backwards compatibility / no migrations.** There are no real users yet, so breaking a contract
   is acceptable; the supported recovery is delete-and-reinstall. A harvest-and-seed migration for
   pre-0.6 targets was built and proven working, then **deliberately removed** on this basis (it also
   kept sh/ps1 in parity, since only sh had it). The installer prints a one-line notice when a target
   lacks the section instead.
2. **Scope was cut on purpose.** A cross-engine review returned 15 findings (3 P0, 8 P1, 4 P2), 11 of
   them on code written that same session. Only the ones with real user impact were fixed; four
   validation-hardening items were deferred to the testing effort in §6. The owner's reason: avoid a
   fix-one-break-another spiral.
3. **`severity.md` treats P2 as blocking, so the code-review gate box was left UNCHECKED** rather than
   marked clean over deferred findings, with the waiver written into the (gitignored)
   `.workflow/state.md`. The deferred items are listed in §5.
4. **Two gate boxes were never closed** and shouldn't be claimed: no plan doc / cross-engine *design*
   review preceded implementation (the `N/A` escape only covers a *simple* fix-bug of 1–2 files), and
   no `verify-e2e` report was produced (the CLI journey is covered by `smoke.sh` + a manual
   reproduction, which is not the same thing).

---

## 5. Open items, prioritised

**Deferred validation-hardening (from the review, low user impact):**

1. `tools/test/publish-workflow.test.mjs` — ordering assertions use whole-file `indexOf`; scope them
   to `jobs.publish.steps` and exercise the shape validation with valid/invalid inputs.
2. `tools/test/package-payload.test.mjs` — walking `package.json#files` doesn't reproduce npm's
   packing algorithm; base it on `npm pack --dry-run --json`.
3. `cli/lib/apply.mjs` — `## Review policy` is found with `indexOf`, not a line-anchored CRLF-aware
   heading parser. Pre-existing pattern (`replaceSection`, `applyExecution`).
4. Marker-pair validation exists in the installers but isn't mirrored in `lint-skills`.

**Installer risks found but NOT fixed** (from the gap analysis §2, still open):

5. `shared/rules/` and `shared/scripts/` are written into a foreign repo root **without backup**,
   unlike `CLAUDE.md`/`AGENTS.md`/skills which get `.pre-forge.bak`. A monorepo with its own
   `shared/` gets subdirectories injected silently.
6. `src/sync.sh:54-61` does `rm -rf` + `cp -R` over `.claude/skills` and `.agents/skills`. The
   `.forge-generated` marker protects the **whole directory**, not individual skills — a skill the
   user adds in the natural place vanishes with no backup. Intentional ("deletion propagation"), but
   there's no warning and no alternative location in the target.
7. **No `uninstall`, no dry-run, no rollback.** `--upgrade` is cosmetic — `MODE` is only used in one
   `echo`; the real migration logic is gated on `.forge-manifest`. (This is *safer* than ccf's
   `--upgrade ⇒ FORCE` footgun; the problem is the flag lies about what it does.)
8. **No macOS CI job**, while shipping a POSIX `install.sh`. macOS ships bash 3.2 — exactly the class
   of bug that breaks `gentle-ai` today (`declare: -A: invalid option`).
9. **CRLF is an untreated class, and it turned CI red on the first push of this work.** There is no
   `.gitattributes` in the repo, so a Windows checkout gets CRLF for every text file. Two concrete
   consequences: (a) the `runScripts` extractor in `publish-workflow.test.mjs` found **0** `run:`
   scripts under CRLF instead of 9, silently turning the injection guard into a no-op on the Windows
   job — fixed by normalising inside the test; (b) the pre-existing drift between the sh/ps1 manifest
   writers (`Set-Content` → CRLF) makes `grep -qxF` and `grep -q '^localsettings:managed$'` fail on
   POSIX for a mixed-OS team, which is still unfixed.
   **Recommended root-cause fix (not applied — decide first):** add `.gitattributes` with
   `* text=auto eol=lf` so Windows checkouts get LF. That removes the whole class rather than each
   symptom. `claude-codex-forge` did exactly this after the same failure mode (a CRLF made an
   `^## Workflow$` anchor stop matching, which silently skipped **every** ship gate). Risk is low —
   the repo's sh readers already strip `\r` defensively, and the runtime-generated-file tests that do
   assert CRLF (`install-gitignore.test.mjs`) are about files written by `Add-Content` at install
   time, not checked-in ones — but it does change what Windows developers see on disk, so it is the
   owner's call.

**Doctrine gaps (gap analysis §3, all cheap, all pure markdown):**

10. **`severity.md:16-17` has no bound on the review loop** — *"fix P0/P1/P2, repeat"* — while P2 is
    defined as *"code smell, maintainability, unclear intent"*, i.e. inherently opinable. Opinable
    blocking severity + unbounded loop is exactly how `claude-codex-forge` went from review iteration
    15 to 25 on an already-certified branch. **This session hit the same failure mode**: 11 of 15
    findings were on new code, and the owner had to stop it manually. ~4 lines to fix.
11. No **deterministic/inferential split** for findings ("a command proves this fails" vs "I think
    this races"). The doctrine already exists in the repo for *debugging* (`fix-bug/SKILL.md:26`,
    golden rule `CLAUDE.md:35`) but is not applied to review findings.
12. `/goal`'s convergence breaker **fails open by its own admission** — `goal/SKILL.md:113` lists
    *"Review-log lines that `goal-state.sh round-count` can't parse (breaker silently no-ops)"* as a
    red flag, and `goal-state.sh:16` is a `grep -c` that counts without comparing. `N=4` lives only in
    prose inside the skill it governs.
13. **Gate profile is declared, not computed.** `check-gates.sh:29` `sed`s the profile out of the file
    the agent wrote. `"<3 files, no behavior risk"` is half uncountable. And `quick-fix/SKILL.md:14`
    says state.md is *optional*, while `check-gates.sh:23-27` exits 3 without it — so the `light` path
    can ship with Tier B structurally unable to run.
14. **No written skill token budget.** `verify-e2e` is ~6.7k tokens (447 lines, ~200 of them an
    embedded JS harness); `ship-gates.md` is ~3.3k. The only guard is a 500-**line** warning, which
    `verify-e2e` passes. Measuring lines is measuring luggage by number of suitcases.
15. Missing rules that `claude-codex-forge` has: **"no bugs left behind"** (no rule forbids deferring
    known issues to a follow-up), and a **supply-chain/skill-audit rule** — awkward to lack in a
    product that *is* an npm-distributed skill installer, and which had an injection in its own
    publish pipeline this session.

**Small inconsistencies** (gap analysis §3.7): `finish-branch/SKILL.md:66,70` point at `goal` §8 and
§6.5, which don't exist (content is in §3 and §2); `check-gates.sh:138` tells you to restore boxes
from `state.template.md`, which doesn't contain the `light` list; `execution.md:45-46`'s default
`commit_policy: per-task` contradicts the golden rule against committing before gates are green
(flagged in-file as legacy, but no rule states the exception); `review/SKILL.md:28-30` hardcodes
invocations that `council/SKILL.md:43-45` explicitly forbids hardcoding.

---

## 6. Next session: the testing strategy (the owner's stated next step)

The owner wants **a substantially stronger test strategy designed first**, then the minor findings
attacked. Diagnosis already gathered this session — use it as input:

**The signal:** there are 164 tests and they did not prevent any of the three defects fixed today. The
pattern is that coverage sits on **generated artifacts**, not on the **installer↔target contract**.

Three concrete holes:

1. **No reusable "installed target" fixture.** Every install test builds its own with `git init` +
   `install.sh`, so nothing exercises the full journey *install → wizard → upgrade → check-gates* as
   one traversal. That journey is exactly where today's P1 lived.
2. **The repo's own CI has zero assertions about itself.** `ci-template.test.mjs` (104 tests, byte-exact
   pins) covers the templates **shipped to users**, not `.github/workflows/ci.yml`. Delete
   `E2E_BROWSER_REQUIRED: '1'` from `ci.yml:34` and every browser test silently starts skipping again
   with nothing failing.
3. **No macOS job** (see §5.8), and `smoke.sh` doesn't run in the Windows job, so the CRLF class
   (§5.9) is structurally invisible.

Worth stealing from the prior art (both documented in the research docs):

- `gentle-ai/internal/assets/assets_test.go:94-125` — an **allowlist plus a denylist of
  escape-hatch phrases** asserted against the prompt markdown, with normalised-word comparison to
  catch paraphrase. i.e. they test the prompt against its own tendency to rationalise. forge-ai
  already enforces the *presence* of `## Common rationalizations` / `## Red flags` as a lint ERROR
  (15/15 skills, 62 rows) — the missing half is validating **content**. A concrete 10-entry denylist
  drafted from forge-ai's real text is in the content audit; note the prerequisite: exclude the
  rationalization tables themselves, since they quote the forbidden phrases on purpose.
- `gentle-ai/openspec/config.yaml` — **detected** test capabilities (`strict_tdd` conditioned on a
  real detection, `linter.available: false` recorded honestly) instead of assuming a runner exists.
  Relevant because `tdd.md:3` declares TDD non-negotiable while the `standard` profile's test box has
  no documented `N/A`.

---

## 7. How to resume

```bash
cd ~/Desktop/personal/projects/forge-ai
git checkout dev && git pull
npm ci
node --test && node tools/lint-skills.mjs && node tools/run-evals.mjs && bash tests/smoke.sh
```

`npm run check` does **not** include `tests/smoke.sh` — run it separately (`tools/README.md:57` says
otherwise and is wrong). `pwsh` is installed locally, so the ps1 parity tests really run rather than
skipping; don't assume a green run on a machine without it means parity holds.

---

## 8. Traps hit this session — don't repeat them

- **`awk -v x=VALUE` applies escape processing.** A reviewer label containing `C:\tmp\new` became a
  TAB plus a line break and split `models.md`. Use `ENVIRON[]` for literal values. Separately, passing
  a *key* through `-v` and using it as a dynamic regex turned `Default reviewer\(s\):` into a capture
  group that matched nothing — match keys as literal prefixes with `index()`.
- **`install.sh` runs `set -euo pipefail`.** A `grep` pipeline that legitimately finds nothing returns
  non-zero and aborts the whole installer with no message. The `|| true` in the policy reader is
  load-bearing; the profile reader uses a single `awk … exit` rather than `head -n1` for the same
  reason (SIGPIPE 141 under `pipefail`).
- **`re.sub` in Python processes escapes in the replacement string.** This produced a *false positive*
  where a test fixture appeared to prove corruption that the installer had not caused. Use a function
  replacement when seeding fixtures that contain backslashes.
- **Assertions that grep a whole file will match the file's own prose.** Two tests passed/failed
  spuriously because the header comment mentioned `npm publish` and `id-token: write` while
  *explaining the rule*. Strip comments, or anchor to `run:`.
- **Re-run the suite immediately after every structural edit.** One rewrite of the `install.sh` block
  broke three passing tests; catching it in the same step is what kept it from compounding.
- **A green local run says nothing about Windows.** The first push of this work turned `dev` red on
  the Windows job while every check passed on macOS, twice over: a CRLF checkout made a line-splitting
  extractor return zero matches (§5.9), and `await import(join(REPO, ...))` throws
  `ERR_UNSUPPORTED_ESM_URL_SCHEME` on Windows because `D:\...` is not a valid ESM specifier — use
  `pathToFileURL(...).href`. Both were caught only by CI. When touching a test that splits lines or
  imports by path, verify against a CRLF copy locally (`sed`/python to convert, run, restore) before
  pushing; `pwsh` on macOS does **not** reproduce Windows path or newline semantics.

# Changelog — codeforge (framework)

Notable changes to the codeforge framework itself, newest first. This is the framework's own
development log; it is **not** the seed shipped to installed projects (that lives at
`src/docs/CHANGELOG.md`).

## Unreleased — target 0.8.0

- _No changes yet._

## 0.7.1 — 2026-08-24

This patch makes the 0.7 release portable across the GNU/Linux and Git-for-Windows environments
used by CI while preserving the same installed layout and behavior.

- **Portable project-context adoption on GNU and BSD systems.** `install.sh` now queries GNU
  `stat -c` before the BSD/macOS fallback and validates that the detected file mode is octal before
  passing it to `chmod`. This prevents GNU `stat -f` filesystem reports from being mistaken for a
  permission mode when an existing `CLAUDE.md` or `AGENTS.md` is imported into `PROJECT.md`.
- **CRLF user rules remain byte-stable on Git Bash.** When `.gitignore` has no prior managed block,
  the installer copies the user-owned file byte-for-byte before appending Codeforge rules instead
  of routing it through `awk`, which could normalize CRLF lines on Windows.

## 0.7.0 — 2026-08-24

Codeforge now installs from one canonical `.codeforge/` source, generates clean adapters for
Claude Code and Codex, preserves project context through `PROJECT.md`, and provides deterministic,
bounded cross-engine reviews without silently switching to an unconfigured engine.

- **Installer transactions and setup reporting are safer.** Both platform installers now reject
  malformed managed `.gitignore` blocks before mutating the target. Switching already-versioned
  adapters to ignored mode reports the exact non-destructive untrack command while leaving the Git
  index unchanged. Bash preserves ancestor instruction paths containing literal newlines when it
  generates Claude isolation JSON. The interactive CLI exits non-zero if its post-install config
  application fails, and its reproducible command uses the portable current-directory target
  instead of emitting an unquoted absolute path.
- **Review-policy and installer portability follow-up.** Bash now JSON-escapes ancestor Claude
  instruction paths and recognizes CRLF `.gitignore` markers. PowerShell reads only the first
  `PROJECT.md` review-policy section and applies reviewer/council values independently, matching
  Bash. `--ignore-generated` now ignores exact managed artifacts instead of entire engine
  directories, so unrelated custom agents remain trackable. Fresh defaults select Codex + Claude
  for cross-engine review without implicitly enabling OpenCode as a third reviewer.
- **Reviewer runs now have an enforced cross-platform deadline.** The installed
  `.codeforge/scripts/run-reviewer.mjs` launches only the configured engine, transports prompts
  without shell interpolation, captures stdout/stderr atomically, terminates a stalled process
  tree after 10 minutes, and reports distinct launch/timeout/failure/empty-output exits. This
  replaces prose-only deadlines and the POSIX-only Codex stdin redirection.
- **Managed paths fail closed on symlinks/reparse points.** Both installers and sync
  implementations reject linked canonical, engine, and scaffold directories before mutating the
  target, including links nested inside `.codeforge/`. Generated leaf files are still replaced
  atomically from same-directory temporary files. Regression tests prove external targets remain
  unchanged; PowerShell parity runs in Windows CI.
- **BREAKING (execution policy): the parent now exclusively owns Git integration.**
  `commit_policy=defer` is the only supported
  implementation policy: subagents never stage or commit. Write-capable tasks run sequentially in
  a shared checkout; parallel writes require isolated worktrees. Remove `per-task` from custom
  briefs and run `.codeforge/sync.sh` (or `sync.ps1`) to regenerate native adapters. The setup wizard hides the native
  subagent choice when neither Claude Code nor Codex is installed.
- **Native subagent parity for Claude Code and Codex.** The execution wizard now records one
  engine-neutral `inline|subagent-driven` strategy instead of a Claude-only model choice.
  `.codeforge/agents/codeforge-implementer.md` is the canonical bounded-task contract; sync
  generates both `.claude/agents/codeforge-implementer.md` and
  `.codex/agents/codeforge-implementer.toml`, while Codex's `[agents]` concurrency is configured
  under `.codex/config.toml`. Generated agents inherit the active model to avoid stale project
  model ids. Native task delegation remains separate from cross-engine review/council policy.

## 0.6.0 — 2026-07-22

- **BREAKING (installed layout): all framework machinery moved under a single `.codeforge/` dir.**
  An install used to scatter 13 entries across the host project's root, four of which were pure
  machinery: `shared/rules/`, `shared/scripts/`, `shared/state.template.md`, `.workflow/`,
  `.forge-manifest` and `.forge-version`. A `shared/` directory in someone else's repo is both
  presumptuous and collision-prone. They are now `.codeforge/{rules,scripts,state.template.md,
  workflow/,manifest,version}`; the root is down to **11 entries**, and everything still there is
  either engine-mandated (`.claude/`, `.agents/`, `.codex/`, `opencode.json`, `CLAUDE.md`,
  `AGENTS.md` — each engine discovers these by fixed convention, so they cannot move),
  project-owned (`PROJECT.md`, `CONTINUITY.md`), or `docs/`.
  **`docs/` deliberately stays in the open.** ADRs, PRDs, plans, research and the CHANGELOG are
  project knowledge, not framework state: GitHub renders `docs/`, ADR tooling expects it there, and
  a CHANGELOG inside a dotfolder is wrong. Keeping it also left 79 path references untouched.
  Mechanically this rewrote ~336 references across ~42 files (payload 158, `install.sh` 49,
  `install.ps1` 39, `tests/smoke.sh` 31, `tools/` 138, `cli/` 9). The payload dir is `src/codeforge/`
  **without** the dot — the installer adds it when copying, matching how `src/CLAUDE.md` and
  `src/PROJECT.template.md` are already relocated on install.
  **No migration**, by design (no real users yet): a target still on the old layout has its
  `shared/`, `.workflow/`, `.forge-manifest` and `.forge-version` **removed** on the next install,
  announced on stdout. That is hygiene, not compatibility — two competing copies of the rules with
  no way to tell which one the agent reads is worse than either layout alone.
  Three things this shook out, none of them mechanical:
  1. **`.gitignore` must name `.codeforge/workflow/`, never `.codeforge/`.** A bare entry would
     untrack the rules and scripts that have to ship with the project, leaving a fresh clone with no
     machinery. Now asserted by `tools/test/installed-layout.test.mjs`.
  2. **The linter's reference-integrity check was silently dead.** The new regex began with `\b`,
     and a word boundary cannot exist between a space and the `.` of `.codeforge` — so it matched
     nothing and the "0 errors" it reported meant "0 checks". Caught by a unit test that expected a
     broken reference to fail; replaced with an explicit lookbehind, and verified discriminating by
     breaking a real reference. It also needed a carve-out: `.codeforge/workflow/**` is runtime state
     created from the template at workflow start, legitimately absent from the payload.
  3. **`goal-digest`'s exclusion pathspec** had to move with it; had it kept excluding `.workflow/*`,
     the digest would have started including volatile state and **no `/goal` certification would ever
     match again** — with no error to show for it.
  New `tools/test/installed-layout.test.mjs` (4 tests) pins the root entry set for both installers,
  proves the machinery is committable while the workflow state is ignored, and checks the old-layout
  cleanup. Nothing asserted the installed footprint before, which is precisely how it spread.
- **`--upgrade` no longer eats the setup wizard's configuration (data loss).** The wizard wrote its
  review policy into `shared/rules/models.md` and its gate profile into `shared/state.template.md` —
  both **MANAGED**, i.e. refreshed by name on every install by a bare `cp`. So
  `npx @jualopezmo/codeforge --upgrade` silently reset a team's chosen reviewer and profile to the
  shipped defaults, with no `.pre-codeforge.bak` for either file; and because `--upgrade` skips the
  wizard (`cli/lib/flags.mjs:13-18`), nothing reapplied them. The answers were not persisted
  anywhere else, so they could only be recovered by re-typing them. Reproduced end to end:
  `Profile: light` → `standard` across one upgrade. **Fix:** `PROJECT.md § Review policy` is now the
  source of truth — project-owned, never clobbered — and both installers **re-render** the two
  managed files from it on every run. This is the pattern `applyExecution` already used for
  `## Execution`, whose comment states the reason ("Lives in PROJECT.md because it is project-owned
  and survives `--upgrade`"); review policy and profile simply had not been moved with it, so the
  fix extends a known-good mechanism rather than inventing one. Only value lines are substituted,
  so the section's explanatory comments survive repeated wizard runs. A missing section, a missing
  line, or a gate profile outside `standard|light` is a **no-op** that keeps the shipped default —
  an unknown profile must never reach `state.template.md`, since `check-gates` exits 3 on one.
  Values pass into `awk` through **`ENVIRON[]`, not `-v`**: `-v` applies escape-sequence processing,
  and a hand-edited label containing `C:\tmp\new` became `C:<TAB>mp` plus a line break (proven
  discriminating — reverting to `-v` fails the new test). sh + ps1 parity, byte-identical output on
  a hostile value. New suite `tools/test/wizard-config-upgrade.test.mjs` (9 tests) covers the
  round trip through both installers, idempotence, the no-section path, profile rejection, and the
  metacharacter case. Note: `tests/smoke.sh` already asserted that `--upgrade` preserves
  `PROJECT.md` and a user's own named rule — the managed blocks were the untested gap, which is why
  CI was green over this the whole time.
  **No migration for targets predating the section** — there are no real users yet, so a target
  installed before this change keeps the shipped defaults and prints a one-line notice pointing at
  `src/PROJECT.template.md`; reinstall to adopt it. That is a deliberate scope cut, not an
  oversight: the harvest-and-seed path was built and proven working, then removed as not worth the
  ongoing cost (and it kept sh/ps1 in parity, since only sh had it).
  **Two self-inflicted bugs caught before shipping**, both by the tests in this change: the first
  draft read the section with a `grep` pipeline under `set -euo pipefail`, so any target *without*
  the section aborted the installer with exit 1 and no message (the `|| true` is load-bearing); and
  the key was briefly matched via `awk -v k=...` as a dynamic regex, where escape processing turns
  `Default reviewer\(s\):` into a capture group that never matches — it now matches as a literal
  prefix with `index()`.
  **Writes are atomic and non-clobbering.** Rendering goes through `mktemp` inside the destination
  directory rather than a predictable `"$file.tmp"`: we install into repos we did not create, and a
  pre-planted symlink at that path would make the redirection write through it to a file outside the
  target. Failures are fatal, so nothing prints "applied" after a write that did not happen.
  **`install.ps1` now compares case-sensitively** (`-ceq`/`-clike`/`-cmatch`/`-ccontains`/
  `-creplace`). PowerShell's defaults are case-insensitive, so `Gate profile: LIGHT` was accepted
  there and rejected by the POSIX twin — and the value written through would have been one
  `check-gates` exits 3 on. Both engines now reject it identically.
- **`publish.yml`: shell injection into the job that holds the npm publish credential.**
  `tag="${{ inputs.tag }}"` sat inside a `run:` script, and Actions substitutes expressions
  textually *before* the shell parses them — so a `workflow_dispatch` input could close the quote
  and append commands in a job with `id-token: write`. Requires repo write to dispatch, so it is a
  write→publish escalation rather than remote RCE, but it is the highest-value target in the repo.
  **Fix:** the tag arrives via `env: TAG:`, and `tools/test/publish-workflow.test.mjs` now rejects
  **any** `${{ }}` inside **any** `run:` script, so the class cannot come back through a future
  step. The extractor self-tests against a fixture whose expansion sits in the body rather than on
  the `run:` line, so the guard can't pass vacuously.
- **The publish credential is isolated from every step that runs project code.** Adding a test gate
  to the existing single job would have made this *worse*: `id-token: write` would be live during
  `npm ci` and the whole suite, so a dependency `preinstall` or a tampered test could request the
  OIDC token and publish before passing the checks it was meant to pass. Split into two jobs — `gate`
  (`contents: read` only) runs `npm ci`, skill lint, routing evals, `node --test` with
  `E2E_BROWSER_REQUIRED=1`, and `tests/smoke.sh`; `publish` (`needs: gate`) holds `id-token: write`
  and runs no project code at all, not even `npm ci`. Top-level permissions are `contents: read`, and
  the test asserts exactly one job may hold `id-token: write` — counted after stripping comments,
  since this file's own header explains the rule in prose.
- **`npm publish` is gated on the tag being published, and the tag must actually be a tag.** The
  workflow checked out a ref, compared versions, and published — running no tests. "CI was green on
  `main` at some point" is not evidence that *this* tag passes: tags can be hand-created, and `main`
  can break between push and dispatch. Checkout now uses `ref: refs/tags/<tag>`, so a **branch**
  sharing the tag's name can no longer be published (previously a branch `v0.6.0` whose
  `package.json` said `0.6.0` satisfied every check). Shape validation is an anchored
  `^v[0-9]+\.[0-9]+\.[0-9]+$` — the earlier `case` glob `v[0-9]*.[0-9]*.[0-9]*` also accepted
  `v1x.2y.3z` and `v1.2.3-rc`, and the first version of the test looked only for the substring
  `v[0-9]` and so happily accepted that broken glob. Node stays at **24** in the publish job (npm
  trusted publishing needs a recent Node/npm pair; briefly lowering it to 20 for cosmetic
  consistency risked breaking authentication outright), while the `gate` job runs Node 20 so the
  `engines.node` floor is still exercised. `npm install -g npm@latest` pinned to `npm@11`.
- **The npm tarball shrank 90%: 960.5 kB → 99.0 kB (unpacked 1.2 MB → 289.2 kB).**
  `cli/assets/codeforge-icon.png` (847 kB) was **90% of the package** while being a dev-only input
  to `tools/gen-splash.mjs` — the runtime only ever prints the generated ANSI in
  `cli/assets/anvil.ans.mjs`. It shipped because `files[]` includes `cli/`. Moved to
  `tools/assets/` (outside `files[]`) rather than fought with `.npmignore`-vs-`files` precedence,
  which npm documents ambiguously. `anvil.ans.mjs` regenerated: byte-identical except its
  provenance header, confirming the generator is reproducible. New
  `tools/test/package-payload.test.mjs` fails on any binary/media asset under a shipped path, holds
  the payload to a 400 kB budget, and derives the generator's source path from `gen-splash.mjs` so
  moving the asset again without updating the generator can't make the assertion vacuous.
- **`models.md`'s role table no longer contradicts its own review-policy block.** The block is
  wizard-owned and can say `claude`, while the table row restated `all three (max diversity)` as a
  fact; the row now points at the block and labels that value the default.

- **Enforcement reframed to a Verified-tier CI template (`docs/ci-templates/gates.yml`).** codeforge
  now ships an opt-in GitHub Actions workflow where CI independently re-runs your declared test
  command on the PR merge result, outside any agent's turn; made a required status check with
  "do not allow bypassing" (plus CODEOWNERS on the workflow and test-defining files, dismiss-stale-
  approvals, and strict/up-to-date checks per the template's README), it is the only tier that CAN
  bind for everyone once fully configured. The default test step fails closed until you replace it.
- **Retired `--with-hooks` (the Claude-only PreToolUse gate hook).** Superseded by the CI Verified
  tier; its local fast-feedback role is already covered by `finish-branch` running `check-gates`.
  Removed across the installers, wizard/CLI, and CI; `claude-gate-hook.{sh,ps1}` deleted and pruned
  from targets on `--upgrade`. `--with-hooks` / `-WithHooks` is removed outright and rejected as an
  unknown argument; no compatibility alias is retained because the product has no users yet. Rationale: two rounds of cross-engine plan review showed
  a local git hook cannot be portable, mandatory enforcement (per-clone `core.hooksPath`, server-side
  merges skip it, silent bypasses). Docs reframed to an honest Advisory/Attested/Verified ladder.
- **`check-gates` now validates gate IDENTITY, not just count.** A ship-gate checklist with the
  right *number* of checked boxes but the wrong (renamed or missing) gates used to read green —
  the validator only enforced a required count per profile (standard = 6, light = 3). It now
  also requires each profile's canonical gates to be present. Each gate is matched by a tolerant
  case-insensitive anchor **anchored to the box's leading words**, so free-form trailing text (a
  report path, an `— N/A: <reason>`, a note) can never satisfy a different gate's anchor. The
  E2E evidence extractor was aligned to the same leniency (case-insensitive, optional
  whitespace) so a box that satisfies the E2E identity can't skip report validation. sh + ps1
  parity; no POSIX `\b` and `set -f` around the sh match loop (BSD/GNU + glob safety). Closes an
  enforcement bypass surfaced and hardened over four rounds of cross-engine (Codex) review;
  fully covered by TDD. Anchors mirror `shared/state.template.md` / `shared/rules/ship-gates.md`.

## 0.5.1 — 2026-07-22

- **README rewritten for accuracy + readability.** Restructured so a new user reads
  quick-start → workflow → how-it-works, with the deep architecture moved below. Corrected
  stale content: status is now v0.5.0 (was v0.2.0), skill/rule counts are 14/12 (were 13/11),
  the npm-publish caveat ("pending name confirmation") is removed now that
  `@jualopezmo/codeforge` is published, and the interactive setup wizard, `verify-e2e` skill,
  Claude-only execution mode, and EN/ES support are documented. Docs-only — no code or shipped
  payload changed.
- **Manual npm publish workflow (`publish.yml`).** A `workflow_dispatch`-only job publishes a
  chosen tag to npm via **OIDC trusted publishing** — no stored token, works with account 2FA,
  and (public repo) emits provenance automatically. Fails fast if the input tag doesn't match
  the committed `package.json` version. Requires a one-time Trusted Publisher registration on
  npmjs.com. Repo infra only — not shipped in the package.

## 0.5.0 — 2026-07-21

- **Interactive setup console (Ink TUI).** `npx @jualopezmo/codeforge` with no args on a
  TTY now opens a full-screen wizard: engine detection, default review-policy configuration
  (written to `shared/rules/models.md`), gate profile, and project options. Delegates to
  `install.sh`/`install.ps1` and applies config as idempotent post-install edits. Falls back
  to the non-interactive installer when flags are passed or there is no TTY (CI/pipes). Adds
  `ink`/`react` as runtime deps (the clone `install.sh` path stays dependency-free).
- **Fullscreen wizard + real pixel-art splash.** The wizard now takes over the whole terminal
  via the alternate screen buffer (restored on exit/Ctrl-C) and re-flows on resize, instead of
  rendering inline. The splash renders the codeforge anvil icon as a truecolor half-block image
  (generated from `cli/assets/codeforge-icon.png` by the dev-only `tools/gen-splash.mjs`, which
  uses `jimp` — a `devDependency`, never shipped; the runtime only prints the committed string).
  The printed "equivalent non-interactive install" command installs with **defaults only**:
  it reproduces target + `--yes` + gate/project flags, since `install.sh` has no
  `--profile`/`--reviewer` surface. Review-policy/profile configuration is currently
  wizard-only — full non-interactive parity is a follow-up.
- **Configurable review policy + bilingual wizard.** Curated models × reasoning levels
  (Codex `sol/luna/terra`, Claude `opus/sonnet/haiku/fable`) plus a live OpenCode list and a
  custom-id option; pick **multiple default reviewers** and **council advisors** (written to
  `shared/rules/models.md`). English/Español language picker with every screen translated and
  centered; the engine summary now lives on the splash. New **execution mode** (Claude-only):
  inline vs subagent-driven + subagent model, wired into `new-feature`/`fix-bug` via
  `shared/rules/execution.md`, recorded in `PROJECT.md`, with a generated
  `.claude/agents/codeforge-implementer.md`.

## 0.4.0 — 2026-07-20

**Rebrand — `forge-ai` → `codeforge`.** The framework, npm package, and CLI command are now
`codeforge` (the original `forge-ai` name was blocked on npm by a prior unpublish). Install
is `npx @jualopezmo/codeforge`; the GitHub repo is `Juan-Motta/codeforge`. First npm release under the
new name. The `.forge-version` stamp filename is unchanged (deliberately — it is not part of
the `forge-ai` brand token).

**Fix — `codex exec` hangs when an agent drives the council.** `shared/rules/models.md`'s
Codex invocation lacked `< /dev/null`, so a driver (e.g. Claude Code) running an advisor
through its shell tool left `codex exec` blocked on `Reading additional input from stdin...`
forever. Added `< /dev/null` to the table invocation and a new "Running these from an agent
(non-interactive)" section documenting both the stdin-block fix and the no-TTY stdout-drop
mitigation (`--output-last-message <file>`, one file per parallel advisor). Skills + config
only — no shim. Propagates to targets on the next install/upgrade.

New `verify-e2e` skill (→ 14 total) — journey-based E2E verification whose result is bound to
the ship-gate by a deterministic check, closing the top capability gap from the 3-engine
comparison vs claude-codex-forge (E2E verification was previously an unbound "exercise the
change" instruction). Pure skill + config, no runtime hooks; neutral `src/` source, identical
across Claude Code, Codex, and OpenCode.

- **`verify-e2e` skill.** Executes API/CLI user-journey use cases (Actor → Scenario → Intent →
  Setup → Steps → Verification → Persistence), validates journey shape before running, enforces
  the no-cheat ARRANGE/VERIFY boundary (no raw DB writes / internal endpoints / file-injection),
  applies execution safety (non-prod default, env-var credentials, secret/PII redaction), and
  writes a committed evidence report with a per-UC classification truth table. Passing use cases
  graduate to `docs/e2e/use-cases/` as a portable regression suite. UI is deferred to a v2
  Playwright bridge (recorded in `extending.md`).
- **Evidence-bound ship-gate (Attested).** The `standard` profile's bare "Change verified" box is
  **replaced** by `E2E verified` (count stays 6, so deleting it is still caught). `check-gates.sh`
  + `check-gates.ps1` bind the checked box to the report **PATH named in the box**
  (`(report: docs/e2e/reports/<file>.md)`) — not "any report in the directory". The named path
  must **exist** (resolved against the git toplevel), carry a **top-level `VERDICT: PASS`** (the
  first `VERDICT:` line, exactly `PASS`), and be **fresh on the branch** (git-detected —
  committed/staged/unstaged-edit/untracked since the merge-base, never mtime, which
  clone/checkout resets). A checked box that still names the `<...>` placeholder is rejected.
  **Base is auto-detected** by the closest merge-base among `dev`/`main`/`master`/`origin/…`
  (this framework integrates on `dev`, not `main`). **No silent fail-open:** when no base ref
  resolves, freshness is skipped with a stderr note but existence + top-level `PASS` are always
  enforced. Honest `— N/A:` escape (exact em-dash form) for internal/UI-only changes.
  bash↔pwsh parity verified byte-for-byte (including the em-dash marker), with real subprocess +
  temp-git-repo tests on both. **Cross-engine PR review (Codex gpt-5.6-sol + OpenCode kimi-k3)
  found the P0/P1 hole this closes:** the old check scanned for *any* fresh `PASS` report and
  hardcoded the base to `main`/`master`, so an unrelated or `dev`-inherited `PASS` could satisfy
  the gate with zero E2E run for the actual feature — and a missing `main`/`master` ref skipped
  the whole check (checked box + no report → exit 0).
- **Whole-branch review caught a gate-soundness bug** the per-task passes missed: `VERDICT: PASS`
  was matched on *any* report line, so a `FAIL` report carrying a per-UC `PASS` line satisfied the
  gate. Now anchored to the top-level verdict, with regression test `j`. Also tightened `N/A`
  detection to the `— N/A:` escape form (a mis-copied doc line can no longer silently skip the
  gate) and hardened ps1 native-git error handling for cross-version parity.
- **A second cross-engine adversarial review found and closed 3 more gate-bypass holes** in
  the named-path binding above: (1) a **leaf symlink** at the box-named path — pointing
  outside the repo at a fabricated `VERDICT: PASS` file — satisfied the old `[ -f ]`/`Test-Path
  -PathType Leaf` existence check, which follows symlinks; now rejected as a symlink *before*
  existence is even considered (though a symlinked ancestor directory remains a potential bypass). (2) **Path traversal** (`report: ../evil.md`, or a
  `docs/e2e/reports/../../evil.md` subdir trick) escaped the repo entirely when no base branch
  resolved (freshness skipped) — the box path is now validated against a strict whitelist,
  `^docs/e2e/reports/[A-Za-z0-9._-]+\.md$`, which also rejects any subdirectory and subsumes
  the old placeholder-only check. (3) A **multi-`(report: …)` line** made sh and ps1 disagree —
  sh's greedy `.*(report:` extraction picked the *rightmost* group, ps1's regex `Match` picked
  the *leftmost* — so a line pairing a placeholder group with a real fresh-PASS group could pass
  on one engine and fail on the other; a checked box naming more than one report is now rejected
  outright as ambiguous on both engines. All three closed at exact sh/ps1 parity with new
  regression tests (symlink, traversal, subdir, multi-report). **Honesty correction:** the
  "no silent fail-open" language in `ship-gates.md` was scoped to state precisely what
  `check-gates` proves — the box-named path is a whitelisted, non-symlink, existing, fresh
  `PASS` report — and explicitly that the report's *content* remains self-attested (**Attested**
  tier); only a CI job that re-runs `verify-e2e` itself (**Verified** tier) is bypass-proof.
- **Installers** scaffold `docs/e2e/{reports,use-cases}` into targets (both `install.sh` and
  `install.ps1`), with a smoke assertion. Tests: `npm run check` green — lint 14/0, routing eval
  93% (42 prompts), 38 tool tests.

## 0.3.0 — 2026-07-18

Two new skills (`adr`, `simplify` → 13 total), installer ergonomics (git awareness + `--git-init`,
default-on cross-engine auto-isolation via `claudeMdExcludes`), and a 4-engine council review that
fixed 5 real bugs and added a Windows CI job. Also: version stamping + `npx` from 0.2.0's tail.


- **Council-review fixes (5 real bugs + hardening).** A 4-engine review (Claude Opus 4.8 +
  Codex gpt-5.6-sol + opencode glm-5.2 + kimi-k3), every finding verified against the code:
  - **npx was broken on real platforms.** `bin/codeforge.mjs` ran `sh install.sh`, but the script
    needs bash `pipefail` (dash — the `/bin/sh` on Debian/Ubuntu — aborts) → now runs `bash`.
    On Windows it forwarded POSIX `--flags` to `install.ps1`, which declares `-Switch` params →
    now translates them.
  - **The PowerShell gate hook was a silent no-op** — it read stdin into the reserved automatic
    `$input` (empty in `-File` mode), so `--with-hooks` never blocked on Windows. Fixed by
    reading into a normal variable; verified it now blocks a red ship.
  - **The gate hooks ignored their own fail-open contract** — a missing/unverifiable state
    (`check-gates` exit 3) was mapped to *block*, not *allow*. Both `.sh`/`.ps1` now fail open on
    non-`1` exits and only block on genuinely-unmet gates.
  - **`check-gates` didn't validate the profile's required gates** — a `standard` state with the
    gates deleted (or any 2 checked boxes) read green. It now enforces the required count per
    profile (standard = 6, light = 3) and rejects unknown profiles.
  - **Docs/config that lied**: `configs/codex/config.toml` claimed skills live in `.codex/skills`
    (they're `.agents/skills`); the README opening claimed "no runtime hooks / only scripts are
    installer + generator" (helper scripts ship + run in-turn); `extending.md` claimed sync
    generates `.codex/.opencode` skills. All corrected.
  - **Installer hardening**: the self-heal migration now fires only on a genuine old-install
    signal (its machinery) so a re-install never relocates a project's own top-level `configs/`
    or `skills/`; the manifest rule-prune now validates entries as bare `*.md` names (a committed,
    untrusted manifest can't drive a path-traversal delete).
  - **Closed the root cause — the untested paths.** Added a **Windows CI job** (install.ps1 +
    the npx wrapper's flag translation + the pwsh hook block/fail-open) and POSIX smoke cases for
    the npx entry point and the re-install self-heal guard. bash↔pwsh parity throughout; 16 smoke
    cases, 24 tool tests, all green. (Dropped one glm false positive — a claimed `gh pr create`
    glob bug that the code doesn't have.)
- **Auto-isolation from ancestor CLAUDE.md (default-on).** Codex (git-root scope) and OpenCode
  (first-AGENTS.md-wins) already confine to the project, but Claude Code walks to the filesystem
  root and concatenates *every* ancestor `CLAUDE.md`/`.claude/rules` into the project — so a
  codeforge target nested under a directory with its own instructions silently inherits them
  (verified against Claude Code's memory docs; there is no `stop_traversal` setting yet).
  The installer now detects ancestor `CLAUDE.md`/`CLAUDE.local.md`/`.claude/rules` above the
  target and writes `claudeMdExcludes` into the gitignored `.claude/settings.local.json`, giving
  Claude Code the same project-scoped isolation as the other two engines. `--no-isolate`
  (`-NoIsolate`) keeps inheritance. The global `~/.claude` config is never excluded. Unified with
  `--with-hooks` into one settings-writer that codeforge owns only when it created the file
  (tracked via a `localsettings:managed` manifest marker) — a `settings.local.json` you own is
  never clobbered. bash↔pwsh parity; smoke.sh gains an isolation case (14 total). Surfaced while
  dogfooding: an ancestor project's (outdated) security rule bled into a nested project's council.
- **Installer git awareness.** The workflow (branches/commits) and the ship gates operate on
  git, so the installer now checks whether the target is a repo. If it isn't, it prints an
  **advisory** (never touches VCS on its own — codeforge's no-surprises ethos); pass `--git-init`
  (`-GitInit` / `npx @jualopezmo/codeforge --git-init`) to have it run `git init` + a baseline
  `chore: adopt codeforge` commit (skipped cleanly if git identity isn't configured). An existing
  repo is used as-is with no message. bash↔pwsh parity; smoke.sh gains a git case (13 total).

## 0.2.0 — 2026-07-18

Bundles all of Phase 2 (skill quality machinery, honest enforcement, anti-rationalization
anatomy) plus the first Phase-3 distribution work.

- **Phase 3 — opt-in hard-block gate (`--with-hooks`, Claude Code only).** `install.sh
  --with-hooks` (`-WithHooks` / `npx @jualopezmo/codeforge --with-hooks`) installs a Claude Code `PreToolUse`
  hook into gitignored `.claude/settings.local.json` that runs `shared/scripts/claude-gate-hook.{sh,ps1}`
  — the same `check-gates` behind a hook — and **exits 2 to actually block** `git commit` /
  `git push` / `gh pr create` when the ship-gate boxes are incomplete. This is the one place
  codeforge can hard-block; it's deliberately non-default (per-developer, Claude-specific so the
  cross-engine default stays portable, fails open if it can't verify, still *attested* not
  *verified*). Never clobbers existing local overrides. `ship-gates.md` / README / `extending.md`
  updated; smoke.sh gains a `--with-hooks` case (12 total) asserting it blocks a red ship and
  allows a green one.
- **Phase 3 — two new skills: `adr` and `simplify`** (13 skills total). `adr` records an
  architecture decision as an ADR (`docs/adr/<NNN>-<slug>.md`: context, decision, alternatives
  with why they lost, consequences) — closing the repo-first memory loop (`docs/adr/` was
  scaffolded but no skill wrote to it). `simplify` is a post-green, behavior-preserving cleanup
  pass (dead code, nesting, duplication, names; tests stay green throughout) — the refactor step
  is the first thing skipped under pressure, so it gets its own skill. Both carry the full
  anti-rationalization anatomy; `plan` now points at `adr` and `new-feature` at `simplify`.
  Routing evals updated (rank-1 95%, 0 collisions across 13 skills); strengthening surfaced a
  weak `new-feature` description (missing "implement/build" vocabulary), now fixed.
- **Phase 3 — version stamp + `npx` distribution.** A root `VERSION` file is now the single
  source of truth; the installers stamp it into `.forge-version` in the target and print a
  direction-aware **drift advisory** on `--upgrade` when the target's recorded version differs
  (informational, never blocks). New `npx @jualopezmo/codeforge [target] [--upgrade]` entry point: a
  dependency-free Node wrapper (`bin/codeforge.mjs`) runs the platform installer bundled in the
  npm package, so a project can adopt codeforge with no repo clone (`--version` / `--help`
  supported). `package.json` is now a publishable `codeforge` package (`files` whitelist ships
  the `src/` payload + install scripts, and excludes the dev-only `tools/`); a version-sync test
  binds `VERSION` to `package.json`. smoke.sh gains a `.forge-version` case (now 11). NOTE:
  publishing to npm requires confirming the `codeforge` package name is available (or scoping it).
- **Phase 2 — honest tiered enforcement (priority #2): `check-gates` + Verified/Attested/Advisory.**
  New **Tier-B** validator `shared/scripts/check-gates.{sh,ps1}` (POSIX + PowerShell parity) reads
  `.workflow/state.md`, confirms every ship-gate box for the active profile is checked (or N/A),
  and exits non-zero listing any that aren't — turning "eyeball the file" into "run a command that
  fails loudly." It ships as a runtime payload (installers copy `shared/scripts/`), and
  `finish-branch` step 1 now invokes it. `ship-gates.md` gains the **Verified / Attested / Advisory**
  vocabulary: the check validates the *record*, not the work (a checked box is an attestation, not
  proof); a real *verified* gate means running it in CI with branch protection. The README
  enforcement section is rewritten to stop over-selling the native prompt. smoke.sh gains a
  check-gates case (green passes, unchecked box fails, missing state errors) — now 10 cases.
- **Phase 2 — anti-rationalization anatomy (priority #3): all 11 skills retrofitted.** Each
  skill now carries a skill-specific **Common Rationalizations** table (the excuses an agent
  uses to skip a step, each rebutted), a **Red Flags** section, and an exit-criteria
  **Verification** checklist. In a no-hooks advisory system this anatomy *is* the enforcement —
  it's the layer that holds the process under time/sunk-cost/authority pressure. The linter now
  treats all three sections as hard errors (a new skill ships with the rebuttals or it doesn't
  ship). Lint + evals + 22 tests + smoke all green.
- **Phase 2 — skill quality machinery (priority #1): linter + routing evals + CI.** New
  dependency-free Node tooling under `tools/` (dev-only — never shipped into a target). A
  **structural + codeforge-bespoke skill linter** (`lint-skills.mjs`) enforces frontmatter,
  `name`==dir, description ≤1024 with a "Use when" trigger, CLAUDE.md index parity (both ways),
  **model-id quarantine** (`models.md` is the single source), and `.codeforge/` reference integrity;
  missing `## Verification`/>500 lines are warnings. **Routing/collision evals** (`run-evals.mjs`,
  stemmed TF-IDF over descriptions, engine-name boilerplate stripped) catch missing-vocabulary
  and near-collision trigger bugs — real catalog scores rank-1 91%, 0 collisions. The eval
  surfaced and fixed two defects: a stemmer double-consonant bug (`shipping`→`ship`) and a `prd`
  description missing "spec / what to build / who it's for" vocabulary. New `.github/workflows/ci.yml`
  runs lint → evals → 20 unit tests → installer smoke on every push/PR.

## 0.1.0 — 2026-07-18

First stable release. Verified end-to-end on all three engines — **Claude Code, Codex, and
OpenCode** — driving a real project.

- **Thin installer + default target = cwd.** `install.sh`/`install.ps1` run with no argument
  now install into the current directory, and arg parsing is position-agnostic. The target
  receives only agent-runtime files — all machinery (neutral `skills/`, `configs/`,
  `sync.sh`/`sync.ps1`, seed templates, `docs/extending.md`) stays in the codeforge repo.
  `sync.sh`/`sync.ps1` gain `--out <dir>` to generate straight into the target. Engine configs
  become a generated baseline (per-project Claude overrides in `.claude/settings.local.json`);
  `state.template.md` moves to `shared/`. Upgrading an older, non-thin install self-heals
  (machinery removed; `configs/` and neutral `skills/` backed up to `*.pre-forge.bak`), gated
  on a prior forge install so a first install never touches unrelated dirs. Docs updated;
  `tests/smoke.sh` reworked to 9 cases with bash↔pwsh parity.

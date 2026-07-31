# Verified-tier enforcement (CI-only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Verified-tier CI template as codeforge's real portable enforcement and retire the Claude-only `--with-hooks` PreToolUse gate across every surface, with honest docs.

**Architecture:** No new runtime hook. A committed, opt-in GitHub Actions template (`docs/ci-templates/gates.yml`) reruns the project's tests on the PR merge result and is made a required status check via branch protection — the only signal that binds for every clone and every merge. The local Attested tier stays exactly as-is (`finish-branch` runs `check-gates`). `--with-hooks` and `claude-gate-hook.{sh,ps1}` are removed everywhere, with a deprecated no-op for safe migration.

**Tech Stack:** POSIX `sh` + PowerShell (installers), Node ESM (`cli/`, `tools/test/` via `node --test`), GitHub Actions YAML, Markdown docs.

**Design spec:** `docs/plans/2026-07-22-portable-enforcement-design.md` (rev 3, CI-only, 3-engine plan-review clean).

## Global Constraints

- **No new npm dependencies.** `tools/` tests are zero-dep `node --test`; the wizard already depends on `ink`/`react`. Do not add a YAML parser — assert CI-template structure with string/regex checks.
- **sh ↔ ps1 parity:** every installer behavior change lands in BOTH `install.sh` and `install.ps1`.
- **Thin install:** only runtime files land in the target; machinery stays in the codeforge repo.
- **`--with-hooks` / `-WithHooks` must remain a tolerated no-op** (deprecation warning), never an unknown-flag hard error; the wizard must stop *emitting* it, but `cli/lib/run-installer.mjs`'s `WIN_FLAG` translation must stay so the no-op reaches `install.ps1` on Windows npx.
- **CI template default test step is fail-closed** (`exit 1`) until the user replaces it.
- **Ship:** feature branch `feat/portable-enforcement` → PR to `dev`; version bump to `0.6.0` at the end; cross-engine (Codex) code review before shipping.
- Commit messages: no `Co-Authored-By` trailer (repo convention).

---

### Task 1: Verified-tier CI template (source files + validity test)

**Files:**
- Create: `src/docs/ci-templates/gates.yml`
- Create: `src/docs/ci-templates/README.md`
- Test: `tools/test/ci-template.test.mjs`

**Interfaces:**
- Produces: the two template files under `src/docs/ci-templates/` that Task 2's installer copies into a target's `docs/ci-templates/`.

- [ ] **Step 1: Write the failing test**

Create `tools/test/ci-template.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gates = readFileSync(join(repoRoot, 'src', 'docs', 'ci-templates', 'gates.yml'), 'utf8');
const readme = readFileSync(join(repoRoot, 'src', 'docs', 'ci-templates', 'README.md'), 'utf8');

test('gates.yml triggers on pull_request', () => {
  assert.match(gates, /^on:\s*[\s\S]*pull_request:/m);
});

test('gates.yml checks out the code (merge result) via actions/checkout', () => {
  assert.match(gates, /actions\/checkout@v\d/);
});

test('gates.yml default test step is the fail-closed sentinel (exit 1)', () => {
  // An un-edited required check must FAIL, not pass green while running nothing.
  assert.match(gates, /exit 1/);
});

test('README documents required-check + do-not-allow-bypassing', () => {
  assert.match(readme, /required status check/i);
  assert.match(readme, /do not allow bypassing/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/ci-template.test.mjs`
Expected: FAIL — `ENOENT` (the template files don't exist yet).

- [ ] **Step 3: Create `src/docs/ci-templates/gates.yml`**

```yaml
name: gates (codeforge Verified tier)

# codeforge Verified-tier gate — the enforcement that binds for EVERY clone and EVERY merge.
# This file is a TEMPLATE. To activate (see README.md in this directory):
#   1. cp docs/ci-templates/gates.yml .github/workflows/gates.yml
#   2. replace the "Recompute" step below with your real test command
#   3. make this workflow a REQUIRED status check with "Do not allow bypassing" enabled
# Until you do (1)-(3), this is NOT yet the Verified tier — the default step fails on purpose.

on:
  pull_request:

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      # Default checkout on `pull_request` is the PR MERGE RESULT — the state that will land on
      # the base branch — so the recompute binds to the exact code being merged.
      - uses: actions/checkout@v4
      - name: Recompute — REPLACE with your project's tests
        run: |
          echo "codeforge: replace this step with your project's test command"
          echo "  e.g.  npm test   |   uv run pytest   |   go test ./..."
          echo "This placeholder fails on purpose so an un-edited required check is never green."
          exit 1
```

- [ ] **Step 4: Create `src/docs/ci-templates/README.md`**

```markdown
# codeforge Verified-tier CI template

`gates.yml` is codeforge's **Verified tier**: the only enforcement that binds for every clone and
every merge (local git hooks are per-clone and skip server-side merges; see
`shared/rules/ship-gates.md`). It reruns your project's tests on the PR **merge result**, outside
any agent's turn.

## Activate

1. Copy the workflow into place:
   ```bash
   cp docs/ci-templates/gates.yml .github/workflows/gates.yml
   ```
2. Edit the **Recompute** step — replace the placeholder with your real test command
   (`npm test`, `uv run pytest`, `go test ./...`, …). The placeholder `exit 1` is intentional so
   an un-configured check can never pass green.
3. In your repo settings, protect the base branch and make **`gates`** a **required status check**:
   - Enable **"Require status checks to pass before merging"** and select `gates`.
   - Enable **"Do not allow bypassing the above settings"** and **disallow direct pushes** to the
     protected branch, so UI merges / `gh pr merge` / Dependabot cannot skip the check.

## Honesty

Until the test command is filled, the check is required, **and** bypass is disabled, this is not
yet the Verified tier. Even then, repo/org **admins** (and some GitHub Apps) can bypass branch
protection unless you configure otherwise — decide who that should be.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/test/ci-template.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/docs/ci-templates/gates.yml src/docs/ci-templates/README.md tools/test/ci-template.test.mjs
git commit -m "feat(ci): add Verified-tier CI template (fail-closed) + validity test"
```

---

### Task 2: Installer copies the ci-templates (managed, with first-install backup) — sh + ps1

**Files:**
- Modify: `install.sh` (after the docs scaffolding block, ~line 184)
- Modify: `install.ps1` (mirror location — the docs scaffolding block)
- Test: `tests/smoke.sh` (extend an existing install assertion)

**Interfaces:**
- Consumes: `src/docs/ci-templates/{gates.yml,README.md}` from Task 1.
- Produces: `docs/ci-templates/{gates.yml,README.md}` in the installed target (managed: overwritten on upgrade; a pre-existing non-ours file is backed up to `*.pre-forge.bak`).

- [ ] **Step 1: Add a failing smoke assertion**

In `tests/smoke.sh`, inside the first bash-install block (after line 40, `ls "$TB"/shared/rules/*.md …`), add:

```bash
# ci-templates land as a managed copy
[ -f "$TB/docs/ci-templates/gates.yml" ]  || fail "bash: docs/ci-templates/gates.yml not installed"
[ -f "$TB/docs/ci-templates/README.md" ]  || fail "bash: docs/ci-templates/README.md not installed"
grep -q 'exit 1' "$TB/docs/ci-templates/gates.yml" || fail "bash: ci template lost its fail-closed sentinel"
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `bash tests/smoke.sh`
Expected: FAIL — `FAIL: bash: docs/ci-templates/gates.yml not installed`.

- [ ] **Step 3: Implement the copy in `install.sh`**

Insert immediately after the docs scaffolding loop (after line 184, before the PROJECT-OWNED block):

```bash
# --- MANAGED: CI templates (Verified-tier gate + activation guide) ---
# Copied into the target (overwritten on upgrade). A pre-existing, non-ours file is backed up
# once so first adoption never clobbers a user's own docs/ci-templates content.
if [ -d "$PAYLOAD/docs/ci-templates" ]; then
  mkdir -p "$TARGET/docs/ci-templates"
  for f in "$PAYLOAD"/docs/ci-templates/*; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    dst="$TARGET/docs/ci-templates/$base"
    if [ -f "$dst" ] && ! grep -q 'codeforge' "$dst" 2>/dev/null && [ ! -e "$dst.pre-forge.bak" ]; then
      cp "$dst" "$dst.pre-forge.bak"
      echo "  ! backed up existing docs/ci-templates/$base -> $base.pre-forge.bak"
    fi
    cp "$f" "$dst"
  done
fi
```

- [ ] **Step 4: Mirror in `install.ps1`**

Find the docs-scaffolding block in `install.ps1` (the loop that creates `docs/prds…e2e/use-cases`). Immediately after it, add the PowerShell equivalent:

```powershell
# --- MANAGED: CI templates (Verified-tier gate + activation guide) ---
$ctSrc = Join-Path $Payload 'docs/ci-templates'
if (Test-Path $ctSrc) {
  $ctDst = Join-Path $Target 'docs/ci-templates'
  New-Item -ItemType Directory -Force -Path $ctDst | Out-Null
  foreach ($f in Get-ChildItem -File $ctSrc) {
    $dst = Join-Path $ctDst $f.Name
    if ((Test-Path $dst) -and -not (Select-String -LiteralPath $dst -Pattern 'codeforge' -Quiet) -and -not (Test-Path "$dst.pre-forge.bak")) {
      Copy-Item $dst "$dst.pre-forge.bak"
      Write-Host "  ! backed up existing docs/ci-templates/$($f.Name) -> $($f.Name).pre-forge.bak"
    }
    Copy-Item $f.FullName $dst -Force
  }
}
```

(Use the same variable names `install.ps1` already uses for the payload dir and target — confirm they are `$Payload` and `$Target`; adjust to the file's actual names if they differ.)

- [ ] **Step 5: Run smoke to verify it passes**

Run: `bash tests/smoke.sh`
Expected: PASS (the new assertions + all existing cases).

- [ ] **Step 6: Commit**

```bash
git add install.sh install.ps1 tests/smoke.sh
git commit -m "feat(install): copy the ci-templates managed payload into targets (sh+ps1)"
```

---

### Task 3: Retire `--with-hooks` in the shell installers + delete the hook script

**Files:**
- Modify: `install.sh` (arg parser ~50-60; settings.local.json block 211-267; self-heal block 90-118)
- Modify: `install.ps1` (mirror: param block, settings.local.json block, self-heal)
- Delete: `src/shared/scripts/claude-gate-hook.sh`, `src/shared/scripts/claude-gate-hook.ps1`
- Test: `tests/smoke.sh` (replace the `--with-hooks` case #12)

**Interfaces:**
- Produces: installs no longer write a PreToolUse gate hook; `--with-hooks` is a deprecated no-op; targets are pruned of `claude-gate-hook.*` on upgrade.

- [ ] **Step 1: Rewrite the failing smoke case**

In `tests/smoke.sh`, replace the entire case #12 block (lines ~166-184, `--- 12. --with-hooks …`) with:

```bash
# --- 12. --with-hooks is a retired no-op; the gate hook is never installed ---
TH="$TMP/hooks"; mkdir -p "$TH"
"$ROOT/install.sh" "$TH" --with-hooks >/dev/null 2>&1 || fail "--with-hooks (deprecated no-op) should still install cleanly"
[ ! -e "$TH/shared/scripts/claude-gate-hook.sh" ] || fail "claude-gate-hook.sh must no longer be installed"
[ ! -e "$TH/shared/scripts/claude-gate-hook.ps1" ] || fail "claude-gate-hook.ps1 must no longer be installed"
if [ -f "$TH/.claude/settings.local.json" ]; then
  grep -q 'claude-gate-hook' "$TH/.claude/settings.local.json" && fail "settings.local.json must not reference the retired gate hook"
fi
# upgrade prunes a stale hook left by an older install
mkdir -p "$TH/shared/scripts"; : > "$TH/shared/scripts/claude-gate-hook.sh"
"$ROOT/install.sh" "$TH" --upgrade >/dev/null 2>&1 || fail "upgrade over a stale-hook target should succeed"
[ ! -e "$TH/shared/scripts/claude-gate-hook.sh" ] || fail "upgrade must prune a stale claude-gate-hook.sh"
echo "ok: --with-hooks retired (deprecated no-op, gate hook never installed, stale hook pruned)"
```

Also remove `claude-gate-hook.sh claude-gate-hook.ps1` from the runtime-file existence list at line ~35-36 (they are no longer expected in the target).

- [ ] **Step 2: Run smoke to verify it fails**

Run: `bash tests/smoke.sh`
Expected: FAIL — the old behavior still writes the hook / the files still exist.

- [ ] **Step 3: Delete the hook scripts**

```bash
git rm src/shared/scripts/claude-gate-hook.sh src/shared/scripts/claude-gate-hook.ps1
```

- [ ] **Step 4: Edit `install.sh` — arg parser (deprecated no-op)**

Replace line 53 (`    --with-hooks)  WITH_HOOKS=1 ;;`) with:

```bash
    --with-hooks)  echo "  ! --with-hooks is retired (the Claude gate hook is superseded by the CI Verified tier); ignoring." >&2 ;;
```

Remove line 45 (`WITH_HOOKS=0`). Keep `--with-hooks` in the `usage` string removed (delete it from line 5 and line 49 comments/usage).

- [ ] **Step 5: Edit `install.sh` — settings.local.json block (drop the hook)**

In the block at lines 234-267: change the guard on line 235 from
`if [ "$n_excl" -gt 0 ] || [ "$WITH_HOOKS" = "1" ]; then` to `if [ "$n_excl" -gt 0 ]; then`.
Delete the `hook_block=…` heredoc (lines 248-252), the `[ "$WITH_HOOKS" = "1" ] && printf ','` line (256), the `[ "$WITH_HOOKS" = "1" ] && printf '\n%s' "$hook_block"` line (257), and the hook echo (262). The `claudeMdExcludes` write and the `localsettings:managed` manifest marker stay.

- [ ] **Step 6: Edit `install.sh` — prune stale hooks on any managed install**

In the self-heal block, add `claude-gate-hook.*` removal (it is framework-owned machinery). After line 107's loop, add:

```bash
  # Retired: the opt-in Claude gate hook (superseded by the CI Verified tier).
  for f in shared/scripts/claude-gate-hook.sh shared/scripts/claude-gate-hook.ps1; do
    [ -e "$TARGET/$f" ] && { rm -f "$TARGET/$f"; echo "  - removed retired gate hook: $f"; }
  done
```

Also add an upgrade notice near the top of this block:
```bash
  if [ -e "$TARGET/shared/scripts/claude-gate-hook.sh" ] || [ -e "$TARGET/shared/scripts/claude-gate-hook.ps1" ]; then
    echo "  ~ the Claude gate hook (--with-hooks) is retired — enforcement is now the CI Verified tier (docs/ci-templates/)."
  fi
```
(Place the notice BEFORE the removal loop so it fires once, reading the pre-removal state.)

- [ ] **Step 7: Mirror all of the above in `install.ps1`**

Remove the `[switch]$WithHooks` param (line 30), the `-or $WithHooks` from the settings guard (line 227), the `$WithHooks` hook block (lines 234-247 region: the `$settings['hooks'] = …` and its echo), add a deprecated-no-op warning if `-WithHooks` is passed, delete the `claude-gate-hook.ps1` invocation, and add the same prune + notice for `claude-gate-hook.{sh,ps1}` in the ps1 self-heal block. Keep `claudeMdExcludes`.

- [ ] **Step 8: Run smoke to verify it passes**

Run: `bash tests/smoke.sh`
Expected: PASS. Then, if `pwsh` is available: `node --test tools/test/check-gates.ps1.test.mjs` still green (unaffected).

- [ ] **Step 9: Commit**

```bash
git add install.sh install.ps1 tests/smoke.sh
git rm --cached src/shared/scripts/claude-gate-hook.sh src/shared/scripts/claude-gate-hook.ps1 2>/dev/null || true
git commit -m "feat(install)!: retire --with-hooks gate hook (deprecated no-op; prune on upgrade)"
```

---

### Task 4: Retire `--with-hooks` across the wizard / CLI surface

**Files:**
- Modify: `cli/lib/flags.mjs` (remove `--with-hooks` emission from `installerFlags` + `nonInteractiveCommand`; keep it in `INSTALL_FLAGS` so it stays install-intent-tolerant)
- Modify: `cli/state.mjs` (remove `withHooks` from default answers)
- Modify: `cli/components/Gates.mjs` (remove the hook question; keep the profile question)
- Modify: `cli/components/Summary.mjs` (stop rendering the Hooks line)
- Modify: `cli/lib/i18n.mjs` (remove hook strings; change `profileHooks` → profile-only)
- Modify: `bin/codeforge.mjs` (drop `--with-hooks` from help)
- Keep unchanged: `cli/lib/run-installer.mjs` (`WIN_FLAG['--with-hooks']` translation stays)
- Test: `tools/test/flags.test.mjs`, `tools/test/wizard-components.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: the wizard never emits `--with-hooks`; the summary shows only the profile; `installerFlags(answers)` / `nonInteractiveCommand(answers)` no longer include `--with-hooks`.

- [ ] **Step 1: Write/adjust the failing test**

In `tools/test/flags.test.mjs` add:

```javascript
test('installerFlags never emits --with-hooks (retired)', () => {
  const a = { target: '/x', withHooks: true, gitInit: false, noIsolate: false };
  assert.ok(!installerFlags(a).includes('--with-hooks'));
  assert.ok(!nonInteractiveCommand(a).includes('--with-hooks'));
});

test('--with-hooks is still install-intent (tolerated deprecated no-op)', () => {
  assert.equal(hasInstallIntent(['--with-hooks']), true);
});
```

Ensure the imports at the top of the test include `installerFlags`, `nonInteractiveCommand`, `hasInstallIntent` from `../../cli/lib/flags.mjs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/flags.test.mjs`
Expected: FAIL — `installerFlags` currently pushes `--with-hooks` when `withHooks` is true.

- [ ] **Step 3: Edit `cli/lib/flags.mjs`**

In `installerFlags` remove line 22 (`if (answers.withHooks) out.push('--with-hooks');`).
In `nonInteractiveCommand` remove line 33 (`if (answers.withHooks) parts.push('--with-hooks');`).
Leave `INSTALL_FLAGS` (line 9) unchanged — `--with-hooks` stays a tolerated install-intent token.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/test/flags.test.mjs`
Expected: PASS.

- [ ] **Step 5: Edit `cli/state.mjs`**

Remove line 14 (`withHooks: false,`) from `makeDefaultAnswers`.

- [ ] **Step 6: Simplify `cli/components/Gates.mjs` to a profile-only step**

Replace the whole component body with the profile-only version (no `claudeInstalled` branch, no hook question):

```javascript
import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { t } from '../lib/i18n.mjs';
import { Card, Item, Indicator, moveSelectFooter } from './ui.mjs';

const e = React.createElement;

// Default gate profile. (The opt-in hard-block hook was retired — enforcement is the CI
// Verified tier; see docs/ci-templates/.)
export default function Gates({ answers, setAnswers, onNext, lang }) {
  const { gates: g, ui } = t(lang);
  const items = [
    { key: 'standard', label: g.standard, value: 'standard' },
    { key: 'light', label: g.light, value: 'light' },
  ];
  return e(Card, { title: g.title, subtitle: g.subtitle, footer: moveSelectFooter(ui) },
    e(SelectInput, {
      items,
      itemComponent: Item,
      indicatorComponent: Indicator,
      onSelect: (i) => { setAnswers({ ...answers, profile: i.value }); onNext(); },
    }));
}
```

- [ ] **Step 7: Edit `cli/components/Summary.mjs`**

Change line 21 from
`e(Text, { color: theme.text }, s.profileHooks(answers.profile, answers.withHooks)),`
to
`e(Text, { color: theme.text }, s.profile(answers.profile)),`

- [ ] **Step 8: Edit `cli/lib/i18n.mjs`**

In BOTH the `en` and `es` blocks: delete `hookTitle`, `hookSubtitle`, `hookNo`, `hookYes` (lines ~32-36 and ~93-97). Replace `profileHooks: (p, h) => …` with `profile: (p) => \`Profile: ${p}\`` (en) and `profile: (p) => \`Perfil: ${p}\`` (es).

- [ ] **Step 9: Edit `bin/codeforge.mjs`**

Remove `--with-hooks` from the usage line (36) and delete the `--with-hooks  also install…` description line (40).

- [ ] **Step 10: Update the wizard component test**

In `tools/test/wizard-components.test.mjs`, remove any assertion that the Gates component renders a second (hook) screen or that Summary shows a "Hooks:" line; add/keep an assertion that Summary renders `Profile:` without `Hooks:`. Run: `node --test tools/test/wizard-components.test.mjs` → PASS.

- [ ] **Step 11: Run the full tool suite**

Run: `npm run check`
Expected: all green (lint + evals + tests).

- [ ] **Step 12: Commit**

```bash
git add cli/ bin/codeforge.mjs tools/test/flags.test.mjs tools/test/wizard-components.test.mjs
git commit -m "feat(cli)!: remove --with-hooks from the wizard/CLI (keep Windows no-op translation)"
```

---

### Task 5: Fix `.github/workflows/ci.yml` (stop exercising the retired hook)

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:** none (CI config).

- [ ] **Step 1: Edit the Windows npx step**

In the "npx wrapper translates flags and runs the PowerShell installer" step (lines 58-69), change `node ./bin/codeforge.mjs $t --with-hooks` to `node ./bin/codeforge.mjs $t` and DELETE the two assertions that `settings.local.json` exists and references `claude-gate-hook` (lines 65-67). Keep the `--version` assertion (68-69).

- [ ] **Step 2: Delete the gate-hook job step**

Remove the entire "PowerShell gate hook blocks a red ship and fails open on missing state" step (lines 73-87).

- [ ] **Step 3: Verify YAML still parses locally**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(/claude-gate-hook|--with-hooks/.test(s)) throw new Error('stale hook ref remains'); console.log('ci.yml clean')"`
Expected: `ci.yml clean`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: drop the retired --with-hooks / gate-hook assertions"
```

---

### Task 6: Honest enforcement-ladder docs

**Files:**
- Modify: `src/CLAUDE.md` ("Enforcement model" section)
- Modify: `src/shared/rules/ship-gates.md` (Verified/Attested/Advisory + remove Tier-C subsection)
- Modify: `src/docs/extending.md` (drop/replace the Tier-C `--with-hooks` guidance)
- Modify: `README.md` (enforcement + Status)

**Interfaces:** none (docs). The skill-linter checks CLAUDE.md↔skills index parity and shared/ reference integrity — do not break those references.

- [ ] **Step 1: Rewrite `src/CLAUDE.md` "Enforcement model"**

Replace the section's body so it states the final ladder: Advisory (skills) + `finish-branch` runs `check-gates` (Attested, local, when invoked) is the local story; **CI + branch protection (the shipped `docs/ci-templates/gates.yml`) is the hard gate that binds for everyone**. Remove the paragraph describing `install.sh --with-hooks` / the Tier-C PreToolUse hook. Do not touch the golden-rules list or the skills index.

- [ ] **Step 2: Rewrite the ship-gates.md enforcement section**

In `src/shared/rules/ship-gates.md`, update "How enforcement works here" and the Verified/Attested/Advisory ladder to point at the CI template as the concrete Verified mechanism, and **delete** the "### Opt-in hard block (Tier C, Claude Code only)" subsection entirely.

- [ ] **Step 3: Update `src/docs/extending.md`**

Remove the Tier-C `--with-hooks` guidance; if the three-tier extension model is described, replace the Tier-C example with "the CI Verified template (`docs/ci-templates/`)".

- [ ] **Step 4: Update `README.md`**

In the enforcement section + Status, replace any "opt-in Claude Code hard-block via `--with-hooks`" wording with "a shipped Verified-tier CI template (`docs/ci-templates/`) made a required check via branch protection; local discipline is advisory + `finish-branch`'s `check-gates`; no per-engine runtime hooks."

- [ ] **Step 5: Run the linter (reference integrity)**

Run: `node tools/lint-skills.mjs`
Expected: PASS (no broken `shared/` references, index parity intact).

- [ ] **Step 6: Grep for stale references**

Run: `grep -rn "with-hooks\|claude-gate-hook\|Tier C\|Tier-C" src/ README.md`
Expected: no matches (or only historical CHANGELOG entries, which stay).

- [ ] **Step 7: Commit**

```bash
git add src/CLAUDE.md src/shared/rules/ship-gates.md src/docs/extending.md README.md
git commit -m "docs: reframe enforcement to the honest Advisory/Attested/Verified(CI) ladder"
```

---

### Task 7: Version bump + CHANGELOG

**Files:**
- Modify: `VERSION`, `package.json`
- Modify: `docs/CHANGELOG.md`
- Test: `tools/test/version-sync.test.mjs` (already asserts VERSION == package.json)

- [ ] **Step 1: Bump both version files**

`VERSION` → `0.6.0`. `package.json` `"version"` → `0.6.0`.

- [ ] **Step 2: Run the version-sync test**

Run: `node --test tools/test/version-sync.test.mjs`
Expected: PASS (VERSION matches package.json).

- [ ] **Step 3: Add the CHANGELOG entry**

Add under `## Unreleased` → `## 0.6.0 — <date>` in `docs/CHANGELOG.md`:

```markdown
## 0.6.0 — 2026-07-22

- **Enforcement reframed to a Verified-tier CI template (`docs/ci-templates/gates.yml`).** codeforge
  now ships an opt-in GitHub Actions workflow that reruns your tests on the PR merge result; made a
  required status check with "do not allow bypassing", it is the only gate that binds for every
  clone and every merge. The default test step fails closed until you replace it.
- **Retired `--with-hooks` (the Claude-only PreToolUse gate hook).** Superseded by the CI Verified
  tier; its local fast-feedback role is already covered by `finish-branch` running `check-gates`.
  Removed across the installers, wizard/CLI, and CI; `claude-gate-hook.{sh,ps1}` deleted and pruned
  from targets on `--upgrade`. `--with-hooks` / `-WithHooks` is now a deprecated no-op (warns, still
  installs) so existing scripts don't break. Rationale: two rounds of cross-engine plan review showed
  a local git hook cannot be portable, mandatory enforcement (per-clone `core.hooksPath`, server-side
  merges skip it, silent bypasses). Docs reframed to an honest Advisory/Attested/Verified ladder.
```

- [ ] **Step 4: Run the full suite**

Run: `npm run check`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add VERSION package.json docs/CHANGELOG.md
git commit -m "chore: release prep 0.6.0"
```

---

## Post-implementation (not tasks — do after all tasks pass)

1. **Full verification:** `npm run check` green; `bash tests/smoke.sh` green; on a machine with `pwsh`, `node --test tools/test/` green.
2. **Cross-engine code review:** run Codex (`gpt-5.6-sol`, read-only) over the branch diff; fix P0/P1/P2; re-review until clean (mirror the Fase 0 loop).
3. **Ship:** push `feat/portable-enforcement`; open PR → `dev`; wait for CI green; hand off to the user to merge.

## Self-review notes (author)

- **Spec coverage:** Component 1 → Task 1+2; Component 2 (retire --with-hooks) → Tasks 3+4+5; Component 3 (docs) → Task 6; version/ship → Task 7. All spec components mapped.
- **Type/name consistency:** `profile` i18n key added in Task 4 Step 8 is consumed in Task 4 Step 7 (`s.profile`); `profileHooks` fully removed. `withHooks` removed from state (Task 4 Step 5) and both flags emitters (Task 4 Step 3) and Summary (Step 7) — no dangling references.
- **Deliberately kept:** `cli/lib/run-installer.mjs` `WIN_FLAG['--with-hooks']` (Windows no-op translation) and `INSTALL_FLAGS` membership (install-intent tolerance) — verified against the design's Global Constraints.

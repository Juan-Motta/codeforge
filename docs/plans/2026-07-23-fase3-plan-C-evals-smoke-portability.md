# Fase 3 Plan C — routing evals + smoke assertions + D6d portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **rev2** — Opus + Codex plan-reviewed rev1 (both BLOCKING). Applied: (P1) Task 1 routing case moved to `skills["verify-e2e"].positive` as `{prompt, top_k:1}` (was the wrong `{prompt,owner}` negative shape → would've been a false green at default top_k=3), with a prompt verified to rank verify-e2e #1 (was ranking new-feature #1); (P1) Task 3 `mkdirSync(.workflow/e2e-run, recursive)` UNCONDITIONAL before mkdtempSync (ENOENT on fresh checkout/CI, masked locally by stale dirs) + CRLF-safe fence extraction (`\r?\n`); (P2) Task 2 now asserts the installed skill is BYTE-IDENTICAL to src via `diff -q` (§5.11 byte-for-byte; transitive with the src-vs-reference drift test since sync is pure cp -R) and broadens the no-UI-deferral grep to ALL shipped surfaces (both mirrors' verify-e2e/new-feature/fix-bug skills + shared/rules/ship-gates.md + CLAUDE.md/AGENTS.md), dropping the mislabeled `grep ariaSnapshot` (it lives in prose, outside the fence).
>
> **rev3** — Opus CLEAN on rev2; Codex raised one P2: the smoke surface loop used `[ -f "$f" ] || continue`, treating always-shipped surfaces as optional (a missing fix-bug mirror / ship-gates.md would silently pass). Fixed to `[ -f "$f" ] || fail "expected shipped surface missing: $f"` — all 9 listed surfaces are unconditionally shipped, so absence is a real failure.

**Goal:** Close Fase 3: prove the UI-journey capability routes correctly (routing eval), ships intact through install/sync (smoke assertions), and that the verbatim-embedded harness is genuinely runnable from an INSTALLED skill with no dependency on unshipped `tools/` (the D6d portability test).

**Architecture:** These are the framework's own verification surfaces (`tools/evals/routing-cases.json`, `tests/smoke.sh`, and a new `tools/test/*` portability test) — all dev-scope, never shipped. They validate what Plan A (the harness) and Plan B (the embed + wiring) produced. The D6d test installs codeforge into a throwaway target, extracts the sentinel-fenced block from the INSTALLED skill mirror, and runs it against codeforge's own fixture with `@playwright/test` resolved from codeforge's `node_modules` and `tools/` off the resolution path.

**Tech Stack:** JSON (routing cases), Bash (smoke), Node `node:test` (portability).

## Global Constraints

- `npm run check` (lint:skills + eval:routing + test:tools) and `sh tests/smoke.sh` must be green after every task.
- Routing floor: rank-1 ≥ 70 (`run-evals.mjs` default), collision error threshold 0.75 — a new case must not drop rank-1 below the floor or collide `verify-e2e` with a sibling.
- The portability test is browser-backed: it self-skips when Chromium is absent (`existsSync(chromium.executablePath())`), import failure FAILS (not skip), and the ubuntu CI job's `E2E_BROWSER_REQUIRED=1` (Plan A Task 8) makes a skip a failure there.
- The extracted block must run from OUTSIDE `tools/` (a gitignored scratch dir), resolving `@playwright/test` from codeforge's own `node_modules` — proving the shipped skill carries no hidden `tools/` dependency.
- Sentinel markers: `<!-- e2e-ui-ref:start -->` / `<!-- e2e-ui-ref:end -->` in the skill; the fenced code inside is the runnable harness.

---

### Task 1: UI-journey routing eval case

**Files:**
- Modify: `tools/evals/routing-cases.json`

**Interfaces:**
- Produces: a routing case whose prompt describes a UI end-to-end journey and expects `owner: verify-e2e`, without dropping the rank-1 floor or colliding with a sibling.

- [ ] **Step 1: Read the current verify-e2e case + the eval harness**

Run: `grep -n "verify-e2e" tools/evals/routing-cases.json` and `node tools/run-evals.mjs`
Note the existing verify-e2e case (`"run the end-to-end user journeys and write the evidence report"`) and the current rank-1 % + that evals pass.

- [ ] **Step 2: Add a UI-specific routing case (correct shape + a prompt that genuinely ranks verify-e2e #1)**

**Shape:** positive cases are entries in the OWNING skill's `positive` array — either a bare string or `{ "prompt": ..., "top_k": N }`. Ownership comes from the enclosing skill KEY, NOT an `owner` field (the `{prompt, owner}` form is the NEGATIVE-case shape — do NOT use it here, or the case lands as a self-referential negative and errors). Add the case to `skills["verify-e2e"].positive`, using **`top_k: 1`** so the eval ENFORCES rank-1 (default top_k is 3, which would silently accept a mis-route to rank 2):
```json
{ "prompt": "drive the checkout journey in a real browser and confirm the evidence report passes", "top_k": 1 }
```
**Wording matters:** the router ranks by each skill's `description` (lexical, stemmed). A prompt with "new"/"build"/"end to end" ranks `new-feature` #1 (verified: the naive "click through the new checkout page… end to end" ranks new-feature 0.326 vs verify-e2e 0.227 — a FALSE GREEN at the default top_k). Use verify-e2e's own vocabulary — "evidence report", "journey", "verify… against the running app". The wording above was verified to rank `verify-e2e` #1; if you change it, keep `top_k: 1` and confirm rank-1 empirically (Step 3).

- [ ] **Step 3: Run the evals**

Run: `node tools/run-evals.mjs`
Expected: PASS — with `top_k: 1` the new case ERRORS unless `verify-e2e` ranks #1, so a passing run proves correct routing (not merely ≤3). rank-1 rate stays ≥ 70, no collision at/above 0.75. If it errors (verify-e2e not #1), revise the prompt wording toward verify-e2e's description vocabulary until it ranks first — do NOT lower the floor, do NOT relax `top_k`.

- [ ] **Step 4: Run check + commit**

Run: `npm run check`  → green.
```bash
git add tools/evals/routing-cases.json
git commit -m "test(evals): add UI-journey routing case for verify-e2e"
```

---

### Task 2: smoke assertions — verify-e2e ships + embed survives sync + no UI-deferral wording

**Files:**
- Modify: `tests/smoke.sh`

**Interfaces:**
- Consumes: the existing bash-install target `$TB` that `smoke.sh` already builds (installs codeforge, generates `.claude`/`.agents` mirrors).
- Produces: assertions that the verify-e2e skill ships to BOTH mirrors, the embedded harness sentinels survive sync into the installed skill, and no UI-deferral wording leaks into the shipped skill.

- [ ] **Step 1: Read the existing bash-install assertion block**

Run: `sed -n '30,60p' tests/smoke.sh`
Note the `$TB` (bash target) install + the existing `for f in … .claude/skills/new-feature/SKILL.md .agents/skills/new-feature/SKILL.md …` runtime-file loop. You will add verify-e2e assertions right after that block, reusing `$TB` and the existing `fail()` helper.

- [ ] **Step 2: Add the verify-e2e ship + embed + no-deferral assertions**

After the existing bash-install runtime-file checks (and before the "ok: bash install" echo, or immediately after it as its own labeled block), add:
```bash
# --- verify-e2e UI adapter: ships to both mirrors BYTE-IDENTICAL (embed survives sync, §5.11/D6b),
#     and no UI-deferral wording in ANY shipped surface that had it removed. ---
for m in .claude .agents; do
  se="$TB/$m/skills/verify-e2e/SKILL.md"
  [ -f "$se" ] || fail "verify-e2e skill missing from $m mirror"
  grep -qF '<!-- e2e-ui-ref:start -->' "$se" || fail "$m: verify-e2e embed sentinels missing (embed did not survive sync)"
  # sync (src/sync.sh) copies skills with a pure cp -R (no templating), so the installed skill must
  # be byte-identical to src. Combined with the src-vs-reference drift test (skill-embed-drift),
  # this proves the INSTALLED embedded block === the reference harness byte-for-byte (§5.11).
  diff -q "$se" "$ROOT/src/skills/verify-e2e/SKILL.md" >/dev/null \
    || fail "$m: installed verify-e2e skill differs from src (embed did not survive sync byte-for-byte)"
done
# The UI→N/A carve-out was removed from these surfaces (Plan B); assert it did not leak into ANY of
# their SHIPPED copies (both mirrors + the flipped workflows/gates + generated CLAUDE.md/AGENTS.md).
for f in "$TB"/.claude/skills/verify-e2e/SKILL.md "$TB"/.agents/skills/verify-e2e/SKILL.md \
         "$TB"/.claude/skills/new-feature/SKILL.md "$TB"/.agents/skills/new-feature/SKILL.md \
         "$TB"/.claude/skills/fix-bug/SKILL.md "$TB"/.agents/skills/fix-bug/SKILL.md \
         "$TB"/shared/rules/ship-gates.md "$TB"/CLAUDE.md "$TB"/AGENTS.md; do
  [ -f "$f" ] || fail "expected shipped surface missing: $f"
  if grep -qiE 'no v1 adapter|UI (is |journey,? )?deferred|UI-only changes' "$f"; then
    fail "UI-deferral wording leaked into shipped $f"
  fi
done
echo "ok: verify-e2e UI adapter ships byte-identical to both mirrors; no UI-deferral wording in any shipped surface"
```
Notes: the `if grep -qiE …; then fail …; fi` form is set -e safe (an `if`-condition command is exempt). `$ROOT` is smoke.sh's repo-root var; `$TB` is the bash-install target. `ship-gates.md` ships to the target as `shared/rules/ship-gates.md`. All 9 listed surfaces are ALWAYS shipped (sync mirrors every skill; install copies every shared rule; AGENTS.md is a byte-copy of CLAUDE.md), so a missing one is a real failure — assert `|| fail`, NOT `|| continue`.

- [ ] **Step 3: Run smoke**

Run: `sh tests/smoke.sh`
Expected: ALL PASS, including the new "ok: verify-e2e UI adapter ships…" line. If a sentinel/body assertion fails, the embed didn't survive sync — investigate `src/sync.sh` copying of the skill (do NOT weaken the assertion).

- [ ] **Step 4: Commit**

```bash
git add tests/smoke.sh
git commit -m "test(smoke): assert verify-e2e UI adapter ships to both mirrors + embed survives sync"
```

---

### Task 3: D6d portability test — the installed embed runs with no `tools/` dependency

**Files:**
- Create: `tools/test/skill-embed-portability.test.mjs`

**Interfaces:**
- Consumes: `install.sh` (to produce an installed skill mirror in a temp target), the installed `.claude/skills/verify-e2e/SKILL.md`, codeforge's `tools/fixtures/e2e-ui/index.html` + `node_modules` (for `@playwright/test`), and the `<!-- e2e-ui-ref:start/end -->` sentinels.
- Produces: a browser-backed test proving the sentinel-fenced block, extracted from an INSTALLED skill and run from a scratch dir OUTSIDE `tools/`, resolves + launches + runs against the fixture and exits `CLASSIFICATION: PASS` — with no `tools/` import.

- [ ] **Step 1: Write the failing portability test**

Create `tools/test/skill-embed-portability.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = pathToFileURL(join(REPO, 'tools/fixtures/e2e-ui/index.html')).href;
const { chromium } = await import('@playwright/test');
function browserAbsent() { return !existsSync(chromium.executablePath()); }
function skipReason() {
  if (browserAbsent()) { if (process.env.E2E_BROWSER_REQUIRED) return false; return 'chromium not installed'; }
  return false;
}
function extractFenced(skillText) {
  const s = skillText.indexOf('<!-- e2e-ui-ref:start -->');
  const e = skillText.indexOf('<!-- e2e-ui-ref:end -->', s);
  assert.ok(s !== -1 && e !== -1, 'sentinels not found in installed skill');
  const region = skillText.slice(s + '<!-- e2e-ui-ref:start -->'.length, e);
  // region is `<eol>```js<code>```<eol>` — strip the fence lines (CRLF-safe) to recover the code.
  return region.replace(/^\s*```js\r?\n/, '').replace(/\r?\n```\s*$/, '');
}

test('the embedded harness, extracted from an INSTALLED skill, runs with no tools/ dependency', { skip: skipReason() }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-portab-'));
  // scratch run dir lives INSIDE the repo under the gitignored .workflow/ (the harness's
  // git check-ignore guard requires an ignored artifact dir; running from repo root also lets
  // createRequire resolve @playwright/test from codeforge's own node_modules).
  // .workflow/e2e-run is gitignored and NOT guaranteed to exist in a fresh checkout/CI runner —
  // create the parent UNCONDITIONALLY before mkdtempSync (else ENOENT; masked locally by stale dirs).
  mkdirSync(join(REPO, '.workflow', 'e2e-run'), { recursive: true });
  const scratch = mkdtempSync(join(REPO, '.workflow', 'e2e-run', 'portab-'));
  try {
    execFileSync('bash', [join(REPO, 'install.sh'), target], { cwd: REPO, stdio: 'pipe' });
    const installedSkill = readFileSync(join(target, '.claude/skills/verify-e2e/SKILL.md'), 'utf8');
    const code = extractFenced(installedSkill);
    // sanity: the shipped block must NOT import anything under tools/ (no hidden dev-scope dep).
    assert.doesNotMatch(code, /tools\//, 'embedded harness must not reference tools/');
    const script = join(scratch, 'run-journey.mjs');
    writeFileSync(script, code);
    const res = spawnSync(process.execPath, [script], {
      encoding: 'utf8', cwd: REPO, timeout: 60000,
      env: { ...process.env, E2E_APP_ROOT: '.', E2E_APP_URL: FIXTURE, E2E_ARTIFACT_DIR: scratch, E2E_MODE: 'success' },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /CLASSIFICATION: PASS\s*$/);
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify it passes (or diagnose)**

Run: `E2E_BROWSER_REQUIRED=1 node --test tools/test/skill-embed-portability.test.mjs`
Expected: PASS — the installed skill's block extracts, contains no `tools/` reference, and runs against the fixture to `CLASSIFICATION: PASS`. (This test is GREEN on first write because Plan A/B already produced a runnable, dependency-clean harness; if it FAILS, it has found a real portability defect — e.g. the embed references a dev-scope path, or the block didn't survive install — fix the root cause, do not weaken the test.) The parent-dir `mkdirSync(..., {recursive:true})` is already unconditional in the Step-1 code — do NOT rely on stale local `.workflow/e2e-run` dirs (CI has none; a fresh checkout has none).

- [ ] **Step 3: Run the full suite**

Run: `npm run check`
Expected: green (the portability test self-skips locally only if Chromium is absent; with it present it runs for real). Confirm `git status` is clean (temp dirs cleaned up).

- [ ] **Step 4: Commit**

```bash
git add tools/test/skill-embed-portability.test.mjs
git commit -m "test(e2e-ui): D6d portability — installed embed runs with no tools/ dependency"
```

---

## Self-Review

**1. Spec coverage (Plan C slice = spec §5.5 routing eval + §5.11/§5.10 smoke assertions + D6d portability):**
- Routing UI case → Task 1. Smoke ship+embed-survives-sync+no-deferral → Task 2. D6d portability (extract from installed skill, run from outside tools/, resolve @playwright/test from codeforge node_modules, assert no tools/ ref + PASS) → Task 3.
- This COMPLETES Fase 3. After Plan C, the only remaining Fase 3 activity is the dev→main release (ships Fase 0+1+2+3) — a user-authorized outward action, out of plan scope.

**2. Placeholder scan:** Task 1's case is concrete JSON; Task 2's assertions are complete bash (with the `set -euo pipefail`-safe `if grep; then fail` form called out); Task 3 is complete test code. No TBD/TODO.

**3. Type/name consistency:** sentinel strings (`<!-- e2e-ui-ref:start/end -->`) match Plan B's embed. The portability test's env contract (`E2E_APP_ROOT/APP_URL/ARTIFACT_DIR/MODE`) + `browserAbsent`/`skipReason` + gitignored `.workflow/e2e-run/` scratch dir match Plan A's harness + test conventions. `CLASSIFICATION: PASS` token matches the harness. The no-`tools/`-reference assertion is the concrete form of "no hidden dev-scope dependency".

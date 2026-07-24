# Fase 3 Plan A — UI journey reference implementation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **rev2** — Opus + Codex plan-reviewed rev1 (both BLOCKING). Rework: genuine fail-first TDD, phase-based classification, tested FAIL_INFRA path, `finally` + uncancellable watchdog with a cleanup-hang test, App-root validation + tests, ESM-interop namespace normalization, fs-based version read, multi-context active-page capture, fail-closed `git check-ignore` artifact guard, corrected fixture semantics.
>
> **rev3** — Opus + Codex plan-reviewed rev2 (both BLOCKING; findings concentrated in harness runtime precision). User decision: execute under TDD — the tests are the arbiter for the remaining micro-precision. Applied the correctness P1s inline (real `try/catch/finally` where the watchdog is cleared ONLY after teardown → survives hanging cleanup; `onFailure` only captures + sets `exitInfo`; persist sub-phases so nav failures there classify FAIL_INFRA; resolution test uses a dir WITH a package.json lacking the dep; absolute-App-root test; `done()` uses synchronous `writeSync`; `meetsVersionFloor()` extracted as a pure, prerelease-aware function; package.json located by walking up to `name==='@playwright/test'`). Remaining refinements are enforced as acceptance criteria during execution — see **Appendix**.

**Goal:** Build the tested, normative standalone-execution reference (`tools/e2e-ui-ref/run-journey.mjs`) that the `verify-e2e` UI adapter's SKILL.md will embed verbatim (Plan B), proving guarantees #1–#7 from the spec against a local fixture.

**Architecture:** A single self-contained ESM script drives headless Chromium via the `@playwright/test` **library API** (no runner/config). It resolves Playwright from an explicitly-declared, containment-validated app package; runs a demarcated journey block against a tiny static fixture; and enforces phase-based error classification, a real `finally` teardown of all contexts, primary-error preservation with active-page capture, an independently-injectable watchdog whose hard exit survives hanging cleanup, and a fail-closed artifact guard. A Node `node:test` file spawns the script across success / assertion-fail / nav-fail / resolution-fail / hang-cleanup / fresh-context modes.

**Tech Stack:** Node ≥20 (`node:test`, `node:child_process`, `node:fs`, `node:module` `createRequire`, `node:url` `pathToFileURL`), `@playwright/test` ≥1.59 (Chromium), zero other deps.

## Global Constraints

- Single dev-dependency: **`@playwright/test` `>=1.59`** — NEVER also install `playwright` (coexistence breaks `npx playwright test`). Import browser APIs from `@playwright/test`.
- Driven by the **library API under plain `node`** — no `playwright test` runner, no `playwright.config`.
- Discovery uses **`page.ariaSnapshot({ mode: 'ai' })`** (`page.accessibility` was removed in 1.57 — must never appear).
- Dep resolution anchor: **require `E2E_APP_ROOT` (repo-relative; reject absolute)**, normalize to absolute, `realpath`, validate containment (`=== REPO || startsWith(REPO + sep)`), confirm its `package.json` exists, then `createRequire(join(absAppRoot,'package.json'))` + `require.resolve('@playwright/test')` + `import(pathToFileURL(resolved).href)` and **normalize `mod.default ?? mod`** (the CJS entry may not surface named exports through `import()`).
- Version floor read via **fs** (`package.json` located from the resolved entry) — NOT via a package `exports` subpath — and inside the dependency try/catch, so any failure emits a classification.
- **Phase-based classification:** failures in `resolve`/`launch`/`nav` phases → `FAIL_INFRA`; failures in the `journey`/`persist` phases (assertion/locator) → `FAIL_BUG`. Tokens are the script's stdout; the **last stdout line is always `CLASSIFICATION: <PASS|FAIL_BUG|FAIL_INFRA>`** (diagnostics printed before it).
- Timeouts independently injectable: `E2E_WATCHDOG_MS`, `E2E_EXPECT_MS` (via `expect.configure`), `E2E_ACTION_MS` (via `page.setDefaultTimeout`). The watchdog is a hard `process.exit(3)` timer that is **never cleared before teardown** and thus fires even if cleanup hangs.
- Artifacts: written only into a path confirmed ignored by `git check-ignore`; a non-ignored path or non-git dir → **fail closed** (`FAIL_INFRA`). Traces are never committed.
- Reference impl, fixture, test live under `tools/` — framework dev-scope only, never shipped (`package.json` `files` excludes `tools/`).
- Every §4.1 guarantee (#1–#7) appears as an **inline comment** in `run-journey.mjs`. The embeddable region is delimited by `// e2e-ui-ref:start` / `// e2e-ui-ref:end`; the shebang line sits ABOVE `:start` and is NOT part of the embedded region (Plan B byte-compares only the region between the sentinels).

---

### Task 1: Dev-dep + static fixture + browser-probe smoke

**Files:**
- Modify: `package.json` (add `@playwright/test` to `devDependencies`); `package-lock.json` (regenerated)
- Create: `tools/fixtures/e2e-ui/index.html`
- Test: `tools/test/e2e-ui-pattern.test.mjs` (probe test + shared helpers)

**Interfaces:**
- Produces: the fixture (`file://`); shared test helpers `REPO`, `FIXTURE`, `browserAbsent()` (= `!existsSync(chromium.executablePath())`, and a thrown launcher-resolution error is NOT swallowed as absent — it rethrows), `skipReason()` (honors `E2E_BROWSER_REQUIRED`), and `runRef(env)` (spawns the ref with `cwd: REPO`, returns `{status, stdout, stderr, artifactDir}` where `artifactDir` is a gitignored dir under `.workflow/e2e-run/`).

- [ ] **Step 1: Add the dev-dependency + browser**

Run:
```bash
npm install --save-dev "@playwright/test@>=1.59"
npx playwright install chromium
```
Expected: `@playwright/test` in `devDependencies`; `package-lock.json` updated; Chromium downloaded.

- [ ] **Step 2: Create the static fixture (correct storage semantics)**

Create `tools/fixtures/e2e-ui/index.html`. NOTE on semantics: a `file://` fixture has no server, so it demonstrates only the two *browser-context* mechanics the harness must handle — (a) reload within the same context preserves `localStorage`; (b) a fresh `browser.newContext()` is isolated, so `localStorage` is empty there. This exercises the reload path and the multi-context teardown path; it does NOT claim to test server-side durability.

```html
<!doctype html>
<meta charset="utf-8">
<title>e2e-ui fixture</title>
<h1 data-testid="title">E2E UI Fixture</h1>
<input data-testid="note-input" aria-label="Note">
<button data-testid="save">Save</button>
<p data-testid="saved"></p>
<script>
  const saved = document.querySelector('[data-testid="saved"]');
  const input = document.querySelector('[data-testid="note-input"]');
  // localStorage is per browser-context in Playwright: it survives a reload of the same
  // context, and is ABSENT in a fresh context (isolation). Restore on load so a reload shows it.
  const ls = localStorage.getItem('note');
  if (ls) saved.textContent = ls;
  document.querySelector('[data-testid="save"]').addEventListener('click', () => {
    localStorage.setItem('note', input.value);
    saved.textContent = input.value;
  });
</script>
```

- [ ] **Step 3: Write the failing probe test + shared helpers**

Create `tools/test/e2e-ui-pattern.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..');
const FIXTURE = pathToFileURL(join(REPO, 'tools/fixtures/e2e-ui/index.html')).href;
const REF = join(REPO, 'tools/e2e-ui-ref/run-journey.mjs');
const { chromium } = await import('@playwright/test');

function browserAbsent() {
  // Guarantee #7: existsSync(executablePath()) is the real probe. A thrown launcher-resolution
  // error is NOT "absent" — rethrow so a missing devDep fails instead of silently skipping.
  const p = chromium.executablePath();
  return !existsSync(p);
}
function skipReason() {
  if (browserAbsent()) {
    if (process.env.E2E_BROWSER_REQUIRED) return false; // force a real run → fail loudly
    return 'chromium not installed (npx playwright install chromium)';
  }
  return false;
}
// Artifacts go in a gitignored dir INSIDE the repo so the harness's git check-ignore guard passes.
function gitignoredArtifactDir() {
  const base = join(REPO, '.workflow', 'e2e-run');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, 'test-'));
}
function runRef(env) {
  const artifactDir = gitignoredArtifactDir();
  const res = spawnSync(process.execPath, [REF], {
    encoding: 'utf8',
    cwd: REPO,                 // resolution is cwd-anchored; pin it
    timeout: 60000,            // parent kill deadline (well above any injected watchdog)
    env: { ...process.env, E2E_APP_ROOT: '.', E2E_APP_URL: FIXTURE, E2E_ARTIFACT_DIR: artifactDir, ...env },
  });
  return { ...res, artifactDir };
}
export { FIXTURE, REF, skipReason, runRef };

test('fixture loads and ariaSnapshot(ai) works headless', { skip: skipReason() }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(FIXTURE);
    await page.locator('[data-testid="title"]').waitFor();
    assert.match(await page.ariaSnapshot({ mode: 'ai' }), /E2E UI Fixture/);
  } finally { await browser.close(); }
});
```

- [ ] **Step 4: Run**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: PASS (chromium installed). `E2E_BROWSER_REQUIRED=1 node --test tools/test/e2e-ui-pattern.test.mjs` also PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tools/fixtures/e2e-ui/index.html tools/test/e2e-ui-pattern.test.mjs
git commit -m "test(e2e-ui): dep + fixture + browser-probe smoke and shared harness helpers"
```

---

### Task 2: Dependency resolution + version floor (guarantee #1) — FAIL_INFRA path

**Files:**
- Create: `tools/e2e-ui-ref/run-journey.mjs` (resolution preamble + a stub that exits `CLASSIFICATION: PASS` after resolution succeeds)
- Test: `tools/test/e2e-ui-pattern.test.mjs` (add resolution tests)

**Interfaces:**
- Produces: `run-journey.mjs` reading env `E2E_APP_ROOT/E2E_APP_URL/E2E_ARTIFACT_DIR/E2E_MODE/E2E_PERSIST/E2E_WATCHDOG_MS/E2E_EXPECT_MS/E2E_ACTION_MS`; on any resolution/version failure prints a diagnostic then `CLASSIFICATION: FAIL_INFRA` and exits non-zero; the last stdout line is always the classification.

- [ ] **Step 1: Write failing resolution tests (the untested keystone)**

Add:
```js
import { writeFileSync } from 'node:fs';
// A dir that HAS a package.json but does NOT resolve @playwright/test → exercises the resolve
// guard (not the earlier "no package.json" guard). Under a gitignored path inside the repo.
function appRootWithoutPlaywright() {
  const dir = gitignoredArtifactDir(); // reuse the .workflow/e2e-run tmp helper
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'no-pw', version: '1.0.0' }));
  return dir;
}
test('app root WITH package.json but no @playwright/test → FAIL_INFRA (resolve guard)', { skip: skipReason() }, () => {
  const rel = appRootWithoutPlaywright().slice(REPO.length + 1); // repo-relative
  const r = runRef({ E2E_APP_ROOT: rel });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);
  assert.match(r.stdout, /not resolvable|@playwright\/test/i);
});
test('missing E2E_APP_ROOT → FAIL_INFRA', { skip: skipReason() }, () => {
  const r = runRef({ E2E_APP_ROOT: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);
});
test('absolute E2E_APP_ROOT → FAIL_INFRA (must be repo-relative)', { skip: skipReason() }, () => {
  const r = runRef({ E2E_APP_ROOT: REPO });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /repo-relative|absolute/i);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);
});
test('App root escaping the repo → FAIL_INFRA', { skip: skipReason() }, () => {
  const r = runRef({ E2E_APP_ROOT: '../..' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);
});
test('resolution success (repo root) → CLASSIFICATION: PASS', { skip: skipReason() }, () => {
  const r = runRef({ E2E_MODE: 'resolve-only' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CLASSIFICATION: PASS\s*$/);
});
```
Version-floor logic gets a **separate pure unit test** (no browser, always runs) — see Task 2 Step 3's `meetsVersionFloor()` extraction and the unit test below it.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: FAIL — `run-journey.mjs` missing.

- [ ] **Step 3: Implement the resolution preamble**

Create `tools/e2e-ui-ref/run-journey.mjs`:
```js
#!/usr/bin/env node
// e2e-ui-ref:start
// codeforge verify-e2e — UI journey reference harness (normative; Plan B embeds this region
// verbatim). Adapt ONLY the marked JOURNEY block; the harness around it carries the ship-gate
// guarantees the framework depends on — do not modify it.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve, sep, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { writeSync } from 'node:fs';
// The last stdout line is ALWAYS the classification. Use SYNCHRONOUS writes: process.exit() can
// truncate async stdout, so writeSync(1, ...) guarantees the payload is flushed before exit.
function done(cls, code, diag) {
  if (diag) writeSync(1, diag.endsWith('\n') ? diag : diag + '\n');
  writeSync(1, `CLASSIFICATION: ${cls}\n`);
  process.exit(code);
}
// Pure, unit-testable version-floor check (exported note: Task 2 Step 3b unit-tests this directly).
export function meetsVersionFloor(v, floor = [1, 59, 0]) {
  const core = String(v).split('-'); // a prerelease (1.59.0-alpha) is BELOW 1.59.0
  const nums = core[0].split('.').map((n) => Number(n));
  if (nums.some((n) => !Number.isInteger(n))) return false; // malformed → fail closed
  for (let i = 0; i < 3; i++) {
    const a = nums[i] ?? 0, b = floor[i];
    if (a !== b) return a > b;
  }
  return core.length === 1; // exactly the floor with NO prerelease suffix passes; a prerelease fails
}

const REPO = process.cwd();
// Guarantee #1 — App root: repo-relative required (reject absolute), realpath + containment,
// package.json must exist. createRequire needs an ABSOLUTE package.json filename.
const rel = process.env.E2E_APP_ROOT;
if (!rel) done('FAIL_INFRA', 1, 'E2E_APP_ROOT is required (repo-relative owning app package)');
if (isAbsolute(rel)) done('FAIL_INFRA', 1, `E2E_APP_ROOT must be repo-relative, got absolute: ${rel}`);
let absAppRoot = resolve(REPO, rel);
try { absAppRoot = realpathSync(absAppRoot); } catch { done('FAIL_INFRA', 1, `App root does not exist: ${rel}`); }
if (!(absAppRoot === REPO || absAppRoot.startsWith(REPO + sep))) done('FAIL_INFRA', 1, `App root escapes repo: ${rel}`);
const appPkg = join(absAppRoot, 'package.json');
if (!existsSync(appPkg)) done('FAIL_INFRA', 1, `No package.json at App root: ${rel}`);

// Guarantee #1 — resolve + import + normalize named exports; read version via fs (not a package
// exports subpath). ALL of this is inside one guard so any failure classifies FAIL_INFRA.
let chromium, expect;
try {
  const requireFromApp = createRequire(appPkg);
  const resolved = requireFromApp.resolve('@playwright/test');
  const mod = await import(pathToFileURL(resolved).href);
  ({ chromium, expect } = mod.default ?? mod);       // CJS entry may not surface named exports via import()
  if (!chromium || !expect) throw new Error('@playwright/test did not expose chromium/expect');
  // Locate @playwright/test's package.json by walking UP from the resolved entry to the first
  // package.json whose name === '@playwright/test' (robust to the entry not being at pkg root).
  let d = dirname(resolved), pkgJson;
  for (let i = 0; i < 8 && d !== dirname(d); i++, d = dirname(d)) {
    const p = join(d, 'package.json');
    if (existsSync(p)) { const j = JSON.parse(readFileSync(p, 'utf8')); if (j.name === '@playwright/test') { pkgJson = j; break; } }
  }
  if (!pkgJson) throw new Error('could not locate @playwright/test package.json');
  if (!meetsVersionFloor(pkgJson.version)) throw new Error(`@playwright/test ${pkgJson.version} < 1.59 (ariaSnapshot mode)`);
} catch (e) {
  done('FAIL_INFRA', 1, `dependency preflight failed: ${e.message}`);
}

const APP_URL = process.env.E2E_APP_URL || done('FAIL_INFRA', 1, 'E2E_APP_URL required');
const MODE = process.env.E2E_MODE ?? 'success';
if (MODE === 'resolve-only') done('PASS', 0);  // used by the resolution acceptance test
// e2e-ui-ref:end
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: PASS (all resolution tests + Task 1 probe).

- [ ] **Step 5: Commit**

```bash
git add tools/e2e-ui-ref/run-journey.mjs tools/test/e2e-ui-pattern.test.mjs
git commit -m "feat(e2e-ui): guarantee #1 dep resolution + version floor, FAIL_INFRA path tested"
```

---

### Task 3: Success journey + injectable assertion timeout (guarantees #2 partial, #4)

**Files:**
- Modify: `tools/e2e-ui-ref/run-journey.mjs` (replace the `resolve-only` stub with the journey + `finally` teardown)
- Test: `tools/test/e2e-ui-pattern.test.mjs` (success + expect-timeout tests)

**Interfaces:**
- Consumes: the resolution preamble (Task 2), `runRef()`.
- Produces: success path (`E2E_MODE=success` → exit 0 `PASS`); `E2E_EXPECT_MS` bounds web-first assertions via `expect.configure` (a tiny value fails fast, proving it is `expect.configure` not `page.setDefaultTimeout` that bounds assertions).

- [ ] **Step 1: Write the failing success + expect-timeout tests**

Add:
```js
test('success mode → exit 0, CLASSIFICATION: PASS', { skip: skipReason() }, () => {
  const r = runRef({ E2E_MODE: 'success', E2E_PERSIST: 'client' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CLASSIFICATION: PASS\s*$/);
});
test('tiny E2E_EXPECT_MS on a never-matching assertion fails fast as FAIL_BUG', { skip: skipReason() }, () => {
  const t0 = Date.now();
  const r = runRef({ E2E_MODE: 'expect-miss', E2E_EXPECT_MS: '250', E2E_WATCHDOG_MS: '30000' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_BUG\s*$/);
  assert.ok(Date.now() - t0 < 15000, 'expect timeout, not watchdog, ended the run');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: FAIL — the `success`/`expect-miss` modes are not implemented (still `resolve-only` stub only).

- [ ] **Step 3: Implement the journey + finally teardown**

Replace the `if (MODE === 'resolve-only') …` line and append inside the `e2e-ui-ref` region (before `// e2e-ui-ref:end`):
```js
const ARTIFACT_DIR = process.env.E2E_ARTIFACT_DIR ?? '.';
const PERSIST = process.env.E2E_PERSIST ?? 'client';
const WATCHDOG_MS = Number(process.env.E2E_WATCHDOG_MS ?? 30000);
const EXPECT_MS = Number(process.env.E2E_EXPECT_MS ?? 5000);
const ACTION_MS = Number(process.env.E2E_ACTION_MS ?? 5000);
const expectCfg = expect.configure({ timeout: EXPECT_MS });   // #4: bounds web-first assertions

let phase = 'launch';                    // #6: phase drives classification
let browser, activeContext, activePage;
const contexts = [];
try {
  browser = await chromium.launch();
  activeContext = await browser.newContext();
  contexts.push(activeContext);
  activeContext.setDefaultTimeout(ACTION_MS);
  await activeContext.tracing.start({ screenshots: true, snapshots: true });
  activePage = await activeContext.newPage();
  activePage.setDefaultTimeout(ACTION_MS);  // #4: page action timeout (spec requires page.setDefaultTimeout)

  phase = 'nav';
  await activePage.goto(APP_URL);

  phase = 'journey';
  if (MODE === 'hang-cleanup') { /* handled in Task 5 */ }
  await activePage.getByTestId('note-input').fill('hello');
  await activePage.getByTestId('save').click();
  const target = MODE === 'expect-miss' ? 'never-present-value' : 'hello';
  await expectCfg(activePage.getByTestId('saved')).toHaveText(target);

  phase = 'persist';                       // filled in Task 6
  exitInfo = { cls: 'PASS', code: 0 };
} catch (err) {
  await onFailure(err);                    // sets exitInfo + captures (implemented in Task 4)
} finally {
  // #2: real finally closes only what was created. #5: clear the watchdog ONLY after teardown
  // returns — so a hanging teardown lets the watchdog fire (uncancellable by cleanup).
  await teardownAll();
  clearTimeout(watchdog);                  // set in Task 5; no-op until then
}
done(exitInfo.cls, exitInfo.code, exitInfo.diag);

async function teardownAll() {             // #2: close ALL contexts
  for (const c of contexts) { try { await c.tracing.stop().catch(() => {}); await c.close(); } catch {} }
  try { await browser?.close(); } catch {}
}
```
(Also add near the top, before the try: `let watchdog;` (no-op until Task 5 arms it), `let exitInfo = { cls: 'FAIL_INFRA', code: 1, diag: 'unknown' };`, and a temporary `async function onFailure(err){ exitInfo = { cls: 'FAIL_INFRA', code: 1, diag: String(err) }; }` placeholder replaced in Task 4. The single `done(...)` after `finally` is the ONLY normal exit point; `done()` inside the resolution preamble stays for pre-journey fail-closed exits.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: success test PASS; `expect-miss` currently throws through the placeholder `onFailure` (unclassified) → that test still FAILS. That is expected — Task 4 implements `onFailure`. Confirm the SUCCESS test passes and resolution tests still pass. (If you prefer strict green here, mark the expect-miss test `{ todo: true }` and clear it in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add tools/e2e-ui-ref/run-journey.mjs tools/test/e2e-ui-pattern.test.mjs
git commit -m "feat(e2e-ui): success journey + finally teardown + expect.configure timeout (#4)"
```

---

### Task 4: Failure path — phase-based classification + capture (guarantees #3, #6)

**Files:**
- Modify: `tools/e2e-ui-ref/run-journey.mjs` (implement `onFailure`, capture, classification)
- Test: `tools/test/e2e-ui-pattern.test.mjs` (assertion-fail + nav-fail tests)

**Interfaces:**
- Consumes: `phase`, `activePage`, `activeContext`, `ARTIFACT_DIR`, `teardownAll`.
- Produces: on failure — best-effort screenshot + trace from the ACTIVE context/page, primary error printed, then classification: `nav`/`launch`/`resolve` phase → `FAIL_INFRA`; `journey`/`persist` phase → `FAIL_BUG`; non-zero exit.

- [ ] **Step 1: Write failing classification tests**

Add:
```js
import { existsSync as fexists } from 'node:fs';
test('in-journey assertion failure → FAIL_BUG + artifacts + primary error', { skip: skipReason() }, () => {
  const r = runRef({ E2E_MODE: 'assert-fail', E2E_PERSIST: 'client' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_BUG\s*$/);
  assert.match(r.stdout, /toHaveText|expect|Timeout/i);
  assert.ok(fexists(join(r.artifactDir, 'failure.png')), 'screenshot');
  assert.ok(fexists(join(r.artifactDir, 'trace.zip')), 'trace');
});
test('navigation failure (bad URL) → FAIL_INFRA, not FAIL_BUG', { skip: skipReason() }, () => {
  const r = runRef({ E2E_APP_URL: 'http://127.0.0.1:9/nope', E2E_MODE: 'success', E2E_ACTION_MS: '2000' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);  // #6: nav phase → INFRA even on TimeoutError
});
```
Add an `assert-fail` branch to the journey: after `save`, `await expectCfg(activePage.getByTestId('saved')).toHaveText(MODE === 'assert-fail' ? 'WRONG' : target);` (fold into the existing `target` expression).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: FAIL — `onFailure` is still the rethrow placeholder (unclassified exit).

- [ ] **Step 3: Implement `onFailure` (replace the placeholder)**

```js
async function onFailure(err) {
  // #3: preserve the PRIMARY error; best-effort capture from the ACTIVE context/page. Teardown +
  // watchdog-clear happen in the `finally` (so a hanging capture is ALSO watchdog-guarded).
  try { if (activePage) await activePage.screenshot({ path: join(ARTIFACT_DIR, 'failure.png') }); } catch {}
  try { if (activeContext) await activeContext.tracing.stop({ path: join(ARTIFACT_DIR, 'trace.zip') }); } catch {}
  // #6: classification is PHASE-based, not error-name-based. Only assertion phases are FAIL_BUG.
  const cls = (phase === 'journey' || phase === 'persist') ? 'FAIL_BUG' : 'FAIL_INFRA';
  exitInfo = { cls, code: 1, diag: String(err?.stack ?? err) };
}
```
NOTE: `onFailure` must NOT call `teardownAll()`, `clearTimeout`, or `done()` — the `finally` owns teardown + watchdog-clear, and the single `done(...)` after `finally` emits. This is what keeps capture watchdog-guarded.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: PASS (assertion-fail → FAIL_BUG; nav-fail → FAIL_INFRA; success + resolution + expect-miss all green).

- [ ] **Step 5: Commit**

```bash
git add tools/e2e-ui-ref/run-journey.mjs tools/test/e2e-ui-pattern.test.mjs
git commit -m "feat(e2e-ui): phase-based classification (#6) + active-page capture (#3)"
```

---

### Task 5: Watchdog uncancellable by hanging cleanup (guarantee #5)

**Files:**
- Modify: `tools/e2e-ui-ref/run-journey.mjs` (arm the watchdog; add a hang-cleanup mode)
- Test: `tools/test/e2e-ui-pattern.test.mjs` (hang-cleanup test)

**Interfaces:**
- Consumes: `WATCHDOG_MS`, `teardownAll`.
- Produces: a hard `process.exit(3)` watchdog armed before the journey and NOT cleared before teardown, so a hanging teardown still exits; `E2E_MODE=hang-cleanup` makes `teardownAll` await forever to prove it.

- [ ] **Step 1: Write the failing hang-cleanup test**

Add:
```js
test('hanging cleanup → watchdog forces exit within kill deadline', { skip: skipReason() }, () => {
  const t0 = Date.now();
  const r = runRef({ E2E_MODE: 'hang-cleanup', E2E_WATCHDOG_MS: '400' });
  const ms = Date.now() - t0;
  assert.notEqual(r.status, 0, 'must not exit 0');
  assert.match(r.stdout, /watchdog: overall deadline exceeded/);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);  // classification is still the last line
  assert.ok(ms < 20000, `watchdog should fire quickly, took ${ms}ms`);  // < the 60s parent timeout
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: FAIL — no watchdog armed; `hang-cleanup` mode unimplemented (the run would block until the 60s parent `spawnSync` timeout kills it, so the elapsed assertion fails).

- [ ] **Step 3: Arm the watchdog + hang-cleanup mode**

Replace `let watchdog;` with an armed timer placed right after `EXPECT_MS/ACTION_MS` are read:
```js
// #5: hard watchdog — fires even if cleanup hangs (it is NEVER cleared before teardown; only a
// fully-successful run clears it right before done('PASS')). Diagnostic THEN classification (last).
let watchdog = setTimeout(() => { done('FAIL_INFRA', 3, 'watchdog: overall deadline exceeded'); }, WATCHDOG_MS);
```
Make teardown hang on demand:
```js
async function teardownAll() {
  if (MODE === 'hang-cleanup') { await new Promise(() => {}); }  // never resolves → watchdog must fire
  for (const c of contexts) { try { await c.close(); } catch {} }
  try { await browser?.close(); } catch {}
}
```
Confirm the control flow matches Task 3's `try/catch/finally`: neither the success path nor `onFailure` clears the watchdog; ONLY the `finally` clears it, and only AFTER `await teardownAll()` returns. So when `E2E_MODE=hang-cleanup` makes `teardownAll` await forever, `clearTimeout(watchdog)` is never reached and the armed timer fires the hard `process.exit`. The single `done(exitInfo...)` after the `finally` is unreachable in the hang case (that's correct — the watchdog's own `done('FAIL_INFRA', 3, ...)` emits instead).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: PASS — hang-cleanup exits via the 400ms watchdog with `FAIL_INFRA` as the last line; all prior tests green.

- [ ] **Step 5: Commit**

```bash
git add tools/e2e-ui-ref/run-journey.mjs tools/test/e2e-ui-pattern.test.mjs
git commit -m "feat(e2e-ui): hard watchdog (#5) uncancellable by hanging cleanup"
```

---

### Task 6: Fresh-context persistence + failure-in-2nd-context capture (guarantee #2 multi-context)

**Files:**
- Modify: `tools/e2e-ui-ref/run-journey.mjs` (implement the `persist` phase for both branches, tracking the active context)
- Test: `tools/test/e2e-ui-pattern.test.mjs` (client-reload, fresh-context success, fail-in-2nd-context)

**Interfaces:**
- Consumes: `activeContext`/`activePage`/`contexts`, `PERSIST`, `expectCfg`.
- Produces: `client` → reload same page, assert note persists; `newcontext` → fresh context (tracing started, becomes the active context/page), assert empty, both contexts torn down; a `fail-newcontext` mode proving capture targets the SECOND context's page/trace.

- [ ] **Step 1: Write failing persistence tests**

Add:
```js
test('client persist → reload shows the note, exit 0 PASS', { skip: skipReason() }, () => {
  const r = runRef({ E2E_MODE: 'success', E2E_PERSIST: 'client' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CLASSIFICATION: PASS\s*$/);
});
test('fresh-context persist → isolated (empty), exit 0 PASS', { skip: skipReason() }, () => {
  const r = runRef({ E2E_MODE: 'success', E2E_PERSIST: 'newcontext' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CLASSIFICATION: PASS\s*$/);
});
test('failure inside the fresh context → FAIL_BUG, trace from the 2nd context', { skip: skipReason() }, () => {
  const r = runRef({ E2E_MODE: 'fail-newcontext', E2E_PERSIST: 'newcontext' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_BUG\s*$/);
  assert.ok(fexists(join(r.artifactDir, 'trace.zip')), 'trace from active (2nd) context');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: FAIL — the `persist` phase is a no-op stub; fresh-context branch + `fail-newcontext` unimplemented.

- [ ] **Step 3: Implement the persist phase**

Replace the `phase = 'persist';` stub with:
```js
  // #6 sub-phases: navigation/context ops during persist are INFRA (phase='nav'); only the
  // re-verify ASSERTION is a product check (phase='persist' → FAIL_BUG). A newContext()/goto()
  // failure here must classify FAIL_INFRA, not FAIL_BUG.
  if (PERSIST === 'client') {
    phase = 'nav';
    await activePage.reload();
    phase = 'persist';
    await expectCfg(activePage.getByTestId('saved')).toHaveText('hello'); // localStorage survives reload
  } else {
    phase = 'nav';
    const fresh = await browser.newContext();          // #2: fresh context becomes active for capture
    contexts.push(fresh);
    await fresh.tracing.start({ screenshots: true, snapshots: true });
    activeContext = fresh;
    activePage = await fresh.newPage();
    activePage.setDefaultTimeout(ACTION_MS);
    await activePage.goto(APP_URL);
    phase = 'persist';
    const want = MODE === 'fail-newcontext' ? 'hello' : '';  // fresh ctx has no localStorage → empty
    await expectCfg(activePage.getByTestId('saved')).toHaveText(want);
  }
```
Update `teardownAll` to stop tracing on the active context before closing (so both traces are flushed): iterate `contexts` and `try { await c.tracing.stop(); } catch {}` before `c.close()`. Keep the failure-path `tracing.stop({path})` on `activeContext` for the captured trace.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: PASS — all three persistence tests + every prior test green.

- [ ] **Step 5: Commit**

```bash
git add tools/e2e-ui-ref/run-journey.mjs tools/test/e2e-ui-pattern.test.mjs
git commit -m "feat(e2e-ui): multi-context persistence + active-context capture (#2)"
```

---

### Task 7: Fail-closed artifact guard (D4 / §4.2f)

**Files:**
- Modify: `tools/e2e-ui-ref/run-journey.mjs` (guard the artifact dir before writing)
- Test: `tools/test/e2e-ui-pattern.test.mjs` (non-ignored dir → FAIL_INFRA)

**Interfaces:**
- Consumes: `ARTIFACT_DIR`, `execFileSync`.
- Produces: before any capture, `git check-ignore` must confirm `ARTIFACT_DIR` is ignored; a non-ignored path or a non-git dir → `FAIL_INFRA` (fail closed). Traces never land in a trackable path.

- [ ] **Step 1: Write the failing guard test**

Add (a repo-relative, NON-ignored dir):
```js
import { rmSync } from 'node:fs';
test('artifact dir NOT gitignored → FAIL_INFRA (fail closed)', { skip: skipReason() }, () => {
  const bad = join(REPO, 'docs', `e2e-bad-${process.pid}`); // docs/ is tracked, not ignored
  mkdirSync(bad, { recursive: true });
  try {
    const r = runRef({ E2E_MODE: 'assert-fail', E2E_ARTIFACT_DIR: bad });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);
    assert.match(r.stdout, /check-ignore|not ignored|trackable/i);
  } finally { rmSync(bad, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: FAIL — no guard yet; the harness writes to the tracked dir and classifies FAIL_BUG (assert-fail) rather than FAIL_INFRA.

- [ ] **Step 3: Implement the guard (before the try block, after ARTIFACT_DIR is known)**

```js
// D4/§4.2f: fail closed unless the artifact dir is confirmed git-ignored (traces hold DOM/network
// /session data and must never be trackable).
mkdirSync(ARTIFACT_DIR, { recursive: true });
try {
  execFileSync('git', ['check-ignore', '-q', ARTIFACT_DIR], { cwd: REPO }); // exit 0 = ignored
} catch {
  done('FAIL_INFRA', 1, `artifact dir is not git-ignored (or not a git repo); refusing to write: ${ARTIFACT_DIR}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: PASS (bad dir → FAIL_INFRA; the `.workflow/e2e-run/` artifact dirs used by other tests are ignored, so they still work).

- [ ] **Step 5: Commit**

```bash
git add tools/e2e-ui-ref/run-journey.mjs tools/test/e2e-ui-pattern.test.mjs
git commit -m "feat(e2e-ui): fail-closed git check-ignore artifact guard (#7/D4)"
```

---

### Task 8: CI wiring — real run on ubuntu (cached), self-skip on Windows

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the full test file + `E2E_BROWSER_REQUIRED` contract.
- Produces: ubuntu job caches + installs Chromium and sets `E2E_BROWSER_REQUIRED=1` (a skip becomes a failure); Windows leaves the reference tests self-skipped.

- [ ] **Step 1: Read the current ubuntu tool-test step (get the exact name)**

Run: `sed -n '15,30p' .github/workflows/ci.yml`
Expected: an `ubuntu-latest` job with `npm ci` then a step named **"Tool unit tests"** running `node --test`.

- [ ] **Step 2: Add Chromium cache + install, and the required-flag env**

Edit `.github/workflows/ci.yml` ubuntu job — after `npm ci`, before "Tool unit tests":
```yaml
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-chromium-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - name: Install Chromium
        run: npx playwright install --with-deps chromium
```
and set the env on the existing **"Tool unit tests"** step (match its real name; do not rename it):
```yaml
        env:
          E2E_BROWSER_REQUIRED: '1'
```
(Do NOT touch the Windows job — the reference tests self-skip there.)

- [ ] **Step 3: Verify locally**

Run: `node --test tools/test/e2e-ui-pattern.test.mjs && npm run check`
Expected: all tests PASS locally; `npm run check` green (lint + evals + tools). CI parity confirmed on push.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(e2e-ui): cache+install Chromium and E2E_BROWSER_REQUIRED on ubuntu"
```

---

## Self-Review

**1. Spec coverage (Plan A slice = §4.1 #1–#7 + §5.6 test + §5.9 dep/lock + §5.10 ubuntu CI):**
- #1 resolution (required repo-relative App root, realpath+containment, package.json exists, absolute createRequire filename, `mod.default ?? mod`, fs version read, <1.59 floor) → Task 2, tested (success/missing/escape/unresolvable).
- #2 init-guarded teardown + ALL contexts + multi-context active capture → Tasks 3/6.
- #3 primary-error + active-page screenshot/trace + non-zero exit → Task 4.
- #4 `expect.configure` assertion timeout + `page.setDefaultTimeout` action timeout, injectable → Task 3 (fail-fast test).
- #5 hard watchdog uncancellable by hanging cleanup → Task 5 (hang-cleanup test).
- #6 phase-based classification (nav/launch/resolve→INFRA, journey/persist→BUG) → Tasks 2/4, both tokens tested.
- #7 browserless self-skip (existsSync, rethrow on launcher error) + E2E_BROWSER_REQUIRED → Task 1 + Task 8; fail-closed artifact guard → Task 7.
- §5.9 dep+lock → Task 1. §5.10 ubuntu chromium+cache+flag → Task 8.
- **Correctly deferred to Plan B/C:** SKILL.md verbatim embed + HTML sentinels + byte-for-byte drift check + D6d portability test (needs an installed skill), UI→N/A workflow edits, installers gitignore merge + regression test, routing evals, smoke.

**2. Placeholder scan:** every code step carries complete code; Task 3 Step 4 explicitly notes the expect-miss test goes green in Task 4 (declared cross-task dependency, not a placeholder); commands have expected output. ✓

**3. Type/name consistency:** `done(cls, code, diag)` single exit emitter (diag before classification, classification last) used everywhere. `phase` values `launch|nav|journey|persist` set consistently and read only in `onFailure`. `runRef()` → `{status, stdout, stderr, artifactDir}`, `cwd: REPO`, 60s parent timeout > any injected watchdog. Env vars (`E2E_APP_ROOT|APP_URL|MODE|PERSIST|WATCHDOG_MS|EXPECT_MS|ACTION_MS|ARTIFACT_DIR`) and modes (`resolve-only|success|expect-miss|assert-fail|hang-cleanup|fail-newcontext`) match between harness and tests. Classification tokens `PASS|FAIL_BUG|FAIL_INFRA`. Sentinels `e2e-ui-ref:start/end` mark the embeddable region; shebang is outside it (Plan B byte-compares only the interior). ✓

---

## Appendix — review findings enforced as acceptance criteria during execution (rev3)

The implementing subagent MUST satisfy each of these via a real test (tests are the arbiter):

- **Version floor is unit-tested (Task 2 Step 3b, no browser):** add `test('meetsVersionFloor')` asserting `meetsVersionFloor('1.59.0')===true`, `meetsVersionFloor('1.58.9')===false`, `meetsVersionFloor('2.0.0')===true`, `meetsVersionFloor('1.59.0-alpha')===false` (prerelease is below), `meetsVersionFloor('x.y.z')===false` (malformed → fail closed). This runs on every machine incl. Windows.
- **Green-per-commit (Task 3):** the `expect-miss` test MUST carry `{ todo: true }` in Task 3 (so `node --test` exits 0 and the commit is green), and Task 4 removes the `todo` marker once `onFailure` classifies it. Never commit a red suite.
- **Hang-cleanup ready marker (Task 5):** `run-journey.mjs` writes a synchronous `READY\n` marker to stdout once the journey has launched+navigated and BEFORE cleanup begins; the hang-cleanup test asserts `stdout` contains `READY` before `watchdog: overall deadline exceeded`, so a watchdog that fired during cold Chromium launch (never reaching cleanup) is NOT a false pass. Keep `E2E_WATCHDOG_MS` comfortably above cold-launch time for that test (e.g. read the marker, then the watchdog window covers only the hung cleanup).
- **Multi-context trace provenance (Task 6):** the `fail-newcontext` test asserts the captured `trace.zip` came from the SECOND context — e.g. the harness names the failure trace after the active context index (`trace-ctx<N>.zip`) or writes a sidecar noting `activeContextIndex`, and the test asserts the second-context artifact exists (not merely "some trace.zip").
- **#6 bounded re-discovery is Plan B scope, NOT this harness (pushback on a Codex finding):** spec §4.2b's "one bounded re-discovery per failing step, then re-run the whole journey from a clean Setup" is the AGENT's DISCOVER-phase authoring loop (documented in the skill, Plan B) — the harness runs the authored journey once. `run-journey.mjs` therefore does NOT implement a runtime action-retry; it classifies a genuine locator/assertion failure as FAIL_BUG. A one-line comment in the JOURNEY block states this so the boundary is explicit.
- **`teardownAll` idempotent tracing.stop:** stopping tracing in `onFailure` (with a path) and again in `teardownAll` (without) must not throw uncaught — both are wrapped in try/catch; the test suite passing across all modes is the proof.

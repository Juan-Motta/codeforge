#!/usr/bin/env node
// e2e-ui-ref:start
// codeforge verify-e2e — UI journey reference harness (normative; Plan B embeds this region
// verbatim). Adapt ONLY the marked JOURNEY block; the harness around it carries the ship-gate
// guarantees the framework depends on — do not modify it.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve, sep, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
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

// Import-safety guard: everything below is side-effecting (reads env, may process.exit). Only run
// it when this file is the executed entry script (`node run-journey.mjs`, or the test harness's
// spawnSync(REF)) — NOT when another module imports it (e.g. to unit-test meetsVersionFloor above,
// which must stay import-safe with zero side effects). This is not a defensive no-op: the harness
// is ALWAYS executed as the entry script in real use (Plan B embeds this e2e-ui-ref region
// verbatim as TEXT into the generated harness, never via `import`), so the preamble runs for every
// real invocation. It is intentionally skipped only when this module is imported for unit-testing
// meetsVersionFloor — no else-branch is added here, since emitting output on import would fire
// during that unit test too.
const isMain = Boolean(process.argv[1]) && (() => {
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (isMain) {
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
    // Authoritative go/no-go is resolvability, not manifest declaration: require.resolve
    // ancestor-climbs node_modules (e.g. to a hoisted monorepo-workspace-root node_modules under
    // pnpm/npm workspaces), and a hoisted-but-resolvable dependency MUST pass — a direct manifest
    // entry in the App root's own package.json is neither required nor sufficient. If resolution
    // fails, enrich the error with an advisory manifest scan (never gate on it).
    const requireFromApp = createRequire(appPkg);
    let resolved;
    try {
      resolved = requireFromApp.resolve('@playwright/test');
    } catch (resolveErr) {
      let advisory = '';
      try {
        const appPkgJson = JSON.parse(readFileSync(appPkg, 'utf8'));
        const declared = { ...appPkgJson.dependencies, ...appPkgJson.devDependencies, ...appPkgJson.peerDependencies };
        if (!declared['@playwright/test']) advisory = ' (also not declared in the App root package.json)';
      } catch { /* advisory text only — never gate on manifest read failures */ }
      throw new Error(`@playwright/test is not resolvable from the App root${advisory}: ${resolveErr.message}`);
    }
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

  const ARTIFACT_DIR = process.env.E2E_ARTIFACT_DIR ?? '.';
  const PERSIST = process.env.E2E_PERSIST ?? 'client';
  const WATCHDOG_MS = Number(process.env.E2E_WATCHDOG_MS ?? 30000);
  const EXPECT_MS = Number(process.env.E2E_EXPECT_MS ?? 5000);
  const ACTION_MS = Number(process.env.E2E_ACTION_MS ?? 5000);
  const expectCfg = expect.configure({ timeout: EXPECT_MS });   // #4: bounds web-first assertions

  // #5: hard watchdog — fires even if cleanup hangs (it is NEVER cleared before teardown; only a
  // fully-successful run clears it right before done('PASS')). Diagnostic THEN classification (last).
  let watchdog = setTimeout(() => { done('FAIL_INFRA', 3, 'watchdog: overall deadline exceeded'); }, WATCHDOG_MS);
  let exitInfo = { cls: 'FAIL_INFRA', code: 1, diag: 'unknown' };
  async function onFailure(err) {
    // #3: preserve the PRIMARY error; best-effort capture from the ACTIVE context/page. Teardown +
    // watchdog-clear happen in the `finally` (so a hanging capture is ALSO watchdog-guarded).
    try { if (activePage) await activePage.screenshot({ path: join(ARTIFACT_DIR, 'failure.png') }); } catch {}
    try { if (activeContext) await activeContext.tracing.stop({ path: join(ARTIFACT_DIR, 'trace.zip') }); } catch {}
    // #6: classification is PHASE-based, not error-name-based. Only assertion phases are FAIL_BUG.
    const cls = (phase === 'journey' || phase === 'persist') ? 'FAIL_BUG' : 'FAIL_INFRA';
    exitInfo = { cls, code: 1, diag: String(err?.stack ?? err) };
  }

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
    await activePage.getByTestId('note-input').fill('hello');
    await activePage.getByTestId('save').click();
    const target = MODE === 'expect-miss' ? 'never-present-value' : MODE === 'assert-fail' ? 'WRONG' : 'hello';
    await expectCfg(activePage.getByTestId('saved')).toHaveText(target);

    phase = 'persist';                       // filled in Task 6
    // #5: READY marker — journey has launched+navigated+asserted and is about to enter teardown.
    // Written synchronously so the hang-cleanup test can prove the watchdog fired DURING a hanging
    // teardown, not during cold Chromium launch (which would be a false pass for guarantee #5).
    writeSync(1, 'READY\n');
    exitInfo = { cls: 'PASS', code: 0 };
  } catch (err) {
    await onFailure(err);                    // sets exitInfo + captures (implemented in Task 4)
  } finally {
    // #2: real finally closes only what was created. #5: clear the watchdog ONLY after teardown
    // returns — so a hanging teardown lets the watchdog fire (uncancellable by cleanup).
    await teardownAll();
    clearTimeout(watchdog);                  // reached only if teardownAll() actually returns
  }
  done(exitInfo.cls, exitInfo.code, exitInfo.diag);

  async function teardownAll() {             // #2: close ALL contexts
    if (MODE === 'hang-cleanup') { await new Promise(() => {}); }  // never resolves → watchdog must fire
    for (const c of contexts) { try { await c.tracing.stop().catch(() => {}); await c.close(); } catch {} }
    try { await browser?.close(); } catch {}
  }
}
// e2e-ui-ref:end

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { meetsVersionFloor } from '../e2e-ui-ref/run-journey.mjs';

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

// NOTE: an in-repo "app root WITH package.json but no @playwright/test declared" case is NOT
// testable here — Node's require.resolve ancestor-climbs to THIS repo's own node_modules, so any
// containment-required (repo-relative) App root resolves @playwright/test regardless of its own
// manifest. That is intended behavior per the binding constraint (hoisted-but-resolvable MUST
// pass), not a gap: the achievable FAIL_INFRA cases below cover every guard that fires BEFORE
// resolution is even attempted.
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
test('non-existent App root (realpath fails) → FAIL_INFRA', { skip: skipReason() }, () => {
  const rel = join('.workflow', 'e2e-run', 'does-not-exist-' + Date.now());
  const r = runRef({ E2E_APP_ROOT: rel });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /does not exist/i);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);
});
test('App root dir with NO package.json → FAIL_INFRA', { skip: skipReason() }, () => {
  const dir = gitignoredArtifactDir(); // empty dir, no package.json written
  const rel = dir.slice(REPO.length + 1); // repo-relative
  const r = runRef({ E2E_APP_ROOT: rel });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /No package\.json/i);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);
});
test('resolution success (repo root) → CLASSIFICATION: PASS', { skip: skipReason() }, () => {
  const r = runRef({ E2E_MODE: 'resolve-only' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CLASSIFICATION: PASS\s*$/);
});

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
test('in-journey assertion failure → FAIL_BUG + artifacts + primary error', { skip: skipReason() }, () => {
  const r = runRef({ E2E_MODE: 'assert-fail', E2E_PERSIST: 'client' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_BUG\s*$/);
  assert.match(r.stdout, /toHaveText|expect|Timeout/i);
  assert.ok(existsSync(join(r.artifactDir, 'failure.png')), 'screenshot');
  assert.ok(existsSync(join(r.artifactDir, 'trace.zip')), 'trace');
});
test('navigation failure (bad URL) → FAIL_INFRA, not FAIL_BUG', { skip: skipReason() }, () => {
  const r = runRef({ E2E_APP_URL: 'http://127.0.0.1:9/nope', E2E_MODE: 'success', E2E_ACTION_MS: '2000' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CLASSIFICATION: FAIL_INFRA\s*$/);  // #6: nav phase → INFRA even on TimeoutError
});

test('meetsVersionFloor: pure version-floor unit test (no browser required)', () => {
  assert.equal(meetsVersionFloor('1.59.0'), true);
  assert.equal(meetsVersionFloor('1.58.9'), false);
  assert.equal(meetsVersionFloor('2.0.0'), true);
  assert.equal(meetsVersionFloor('1.59.0-alpha'), false);
  assert.equal(meetsVersionFloor('x.y.z'), false);
});

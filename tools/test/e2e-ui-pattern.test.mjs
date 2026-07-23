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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
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

function removeEmptyArtifactParents() {
  for (const path of [
    join(REPO, '.codeforge/workflow', 'e2e-run'),
    join(REPO, '.codeforge/workflow'),
    join(REPO, '.codeforge'),
  ]) {
    try { rmdirSync(path); } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
    }
  }
}

test('the embedded harness, extracted from an INSTALLED skill, runs with no tools/ dependency', { skip: skipReason() }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-portab-'));
  // scratch run dir lives INSIDE the repo under the gitignored .codeforge/workflow/ (the harness's
  // git check-ignore guard requires an ignored artifact dir; running from repo root also lets
  // createRequire resolve @playwright/test from codeforge's own node_modules).
  // .codeforge/workflow/e2e-run is gitignored and NOT guaranteed to exist in a fresh checkout/CI runner —
  // create the parent UNCONDITIONALLY before mkdtempSync (else ENOENT; masked locally by stale dirs).
  mkdirSync(join(REPO, '.codeforge/workflow', 'e2e-run'), { recursive: true });
  const scratch = mkdtempSync(join(REPO, '.codeforge/workflow', 'e2e-run', 'portab-'));
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
    assert.equal(res.status, 0, `[stdout]\n${res.stdout}\n[stderr]\n${res.stderr}`);
    assert.match(res.stdout, /CLASSIFICATION: PASS\s*$/);
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
    removeEmptyArtifactParents();
  }
});

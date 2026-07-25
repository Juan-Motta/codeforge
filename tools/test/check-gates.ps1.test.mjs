import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repoRoot, 'src', 'codeforge', 'scripts', 'check-gates.ps1');

let hasPwsh = true;
try { execFileSync('pwsh', ['-v'], { stdio: 'pipe' }); } catch { hasPwsh = false; }

function git(cwd, ...args) { execFileSync('git', args, { cwd, stdio: 'pipe' }); }

function make(box, report) {
  const dir = mkdtempSync(join(tmpdir(), 'cgps-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 's');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
${box}
- [x] State updated
`);
  if (report !== undefined) {
    mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'r.md'), report);
  }
  return dir;
}
function run(dir) {
  try { execFileSync('pwsh', [script, '.codeforge/workflow/state.md'], { cwd: dir, stdio: 'pipe' }); return 0; }
  catch (e) { return e.status; }
}

test('ps1 parity: fresh PASS → 0, missing → 1, FAIL → 1, empty N/A → 1', { skip: !hasPwsh }, () => {
  const box = '- [x] E2E verified via verify-e2e (report: docs/e2e/reports/r.md)';
  let d = make(box, 'VERDICT: PASS\n'); assert.equal(run(d), 0); rmSync(d, { recursive: true, force: true });
  d = make(box, undefined);            assert.equal(run(d), 1); rmSync(d, { recursive: true, force: true });
  d = make(box, 'VERDICT: FAIL\n');    assert.equal(run(d), 1); rmSync(d, { recursive: true, force: true });
  d = make('- [x] E2E verified — N/A:', undefined); assert.equal(run(d), 1); rmSync(d, { recursive: true, force: true });
});

test('ps1 parity: report FIRST verdict is FAIL but a LATER per-UC line is VERDICT: PASS → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.sh test 'j' — the gate must anchor to the TOP-LEVEL (first)
  // VERDICT line, not match any VERDICT: PASS line anywhere in the file.
  const box = '- [x] E2E verified via verify-e2e (report: docs/e2e/reports/r.md)';
  const d = make(box, 'VERDICT: FAIL\n\nSome narrative text.\n\n## Per-UC results\nUC1: login flow\nVERDICT: PASS\n');
  assert.equal(run(d), 1);
  rmSync(d, { recursive: true, force: true });
});

test('ps1 parity: box checked + report git-add STAGED (not committed) on branch + PASS → exit 0', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.sh test 'i' — a report `git add`-ed but not yet committed is the
  // natural post-verify-e2e state before the human runs `git commit`. Must be treated as
  // fresh, same as untracked/committed, on both sh and ps1.
  const dir = mkdtempSync(join(tmpdir(), 'cgps-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'r.md'), 'VERDICT: PASS\n');
  git(dir, 'add', 'docs/e2e/reports/r.md');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/r.md)
- [x] State updated
`);
  assert.equal(run(dir), 0);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: named-path mismatch — box names ABSENT report, unrelated fresh PASS exists → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.sh test 'l' — closes the "any report" hole. The box names feat.md
  // (absent) while an unrelated fresh PASS other.md exists; the named-path gate must fail.
  const dir = mkdtempSync(join(tmpdir(), 'cgps-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'other.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/feat.md)
- [x] State updated
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: placeholder report path rejected even with an unrelated fresh PASS → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.sh test 'm'.
  const dir = mkdtempSync(join(tmpdir(), 'cgps-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'other.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/<...>.md)
- [x] State updated
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: named report committed on the feature branch (base = main) + PASS → exit 0', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.sh test 'n'.
  const dir = mkdtempSync(join(tmpdir(), 'cgps-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'feat.md'), 'VERDICT: PASS\n');
  git(dir, 'add', 'docs/e2e/reports/feat.md'); git(dir, 'commit', '-qm', 'e2e report');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/feat.md)
- [x] State updated
`);
  assert.equal(run(dir), 0);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: dev-based branch — inherited PASS on dev cannot satisfy the box naming THIS report → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.sh test 'o' — closest merge-base is dev; the dev-inherited report
  // is not the box-named one, so the absent named report must fail the gate.
  const dir = mkdtempSync(join(tmpdir(), 'cgps-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'dev');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'inherited.md'), 'VERDICT: PASS\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'dev inherited report');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/feat.md)
- [x] State updated
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: no-base fail-safe — single branch, PRESENT+PASS → exit 0; ABSENT → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.sh tests 'q'/'r' — no main/master/dev resolves, so freshness is
  // skipped with a note, but existence + PASS are still enforced (never fail open).
  const mkSolo = (present) => {
    const dir = mkdtempSync(join(tmpdir(), 'cgps-'));
    git(dir, 'init', '-q', '-b', 'feat/solo');
    git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
    writeFileSync(join(dir, 'seed'), 'x');
    git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
    if (present) {
      mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'feat.md'), 'VERDICT: PASS\n');
    }
    mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
    writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/feat.md)
- [x] State updated
`);
    return dir;
  };
  let d = mkSolo(true);  assert.equal(run(d), 0); rmSync(d, { recursive: true, force: true });
  d = mkSolo(false);     assert.equal(run(d), 1); rmSync(d, { recursive: true, force: true });
});

// --- Adversarial re-review fixes: symlink / traversal / subdir / multi-report -------
// Mirrors check-gates.test.mjs tests 's'/'t'/'u'/'v' — sh and ps1 must accept/reject
// identical inputs for every one of these adversarial fixtures.

test('ps1 parity: SYMLINK at the box-named path (external fabricated PASS) → exit 1', { skip: !hasPwsh }, () => {
  const parent = mkdtempSync(join(tmpdir(), 'cgps-sym-'));
  const dir = join(parent, 'repo');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  writeFileSync(join(parent, 'fabricated.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  symlinkSync(join(parent, 'fabricated.md'), join(dir, 'docs', 'e2e', 'reports', 'feat.md'));
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/feat.md)
- [x] State updated
`);
  assert.equal(run(dir), 1);
  rmSync(parent, { recursive: true, force: true });
});

test('ps1 parity: path TRAVERSAL out of the repo (no base resolves) → exit 1', { skip: !hasPwsh }, () => {
  const parent = mkdtempSync(join(tmpdir(), 'cgps-trav-'));
  const dir = join(parent, 'repo');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'feat/solo');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: ../evil.md)
- [x] State updated
`);
  writeFileSync(join(parent, 'evil.md'), 'VERDICT: PASS\n');
  assert.equal(run(dir), 1);
  rmSync(parent, { recursive: true, force: true });
});

test('ps1 parity: SUBDIR path under docs/e2e/reports/ → exit 1 (whitelist rejects the extra slash)', { skip: !hasPwsh }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cgps-subdir-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports', 'sub', 'dir'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'sub', 'dir', 'x.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/sub/dir/x.md)
- [x] State updated
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: identity — 6 checked boxes but NONE are the required gates → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.test.mjs test 'w' — count-only satisfied the profile before; identity
  // must require the profile's named gates, not just a box count.
  const dir = mkdtempSync(join(tmpdir(), 'cgps-id-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 's');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] gate one
- [x] gate two
- [x] gate three
- [x] gate four
- [x] gate five
- [x] gate six
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: identity — E2E gate replaced by a non-E2E box → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.test.mjs test 'h' — the 5 non-E2E canonical gates are present but the
  // E2E gate is replaced by an unrelated box; identity must reject the missing E2E gate.
  const d = make('- [x] Change verified by exercising it', undefined);
  assert.equal(run(d), 1);
  rmSync(d, { recursive: true, force: true });
});

test('ps1 parity: MULTI-REPORT line (two "(report:" groups) → exit 1 (ambiguous)', { skip: !hasPwsh }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cgps-multi-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'real.md'), 'VERDICT: PASS\n');
  git(dir, 'add', 'docs/e2e/reports/real.md'); git(dir, 'commit', '-qm', 'e2e report');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/<...>.md) see also (report: docs/e2e/reports/real.md)
- [x] State updated
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: Tests gate omitted, fresh PASS E2E report named tdd.md must NOT satisfy it → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.test.mjs test 'x' — anchors match only each box's LEADING words, so a
  // trailing `(report: docs/e2e/reports/tdd.md)` cannot satisfy the Tests gate's `tests?` anchor.
  const dir = mkdtempSync(join(tmpdir(), 'cgps-id-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 's');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'tdd.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Code review clean
- [x] E2E verified via verify-e2e (report: docs/e2e/reports/tdd.md)
- [x] State updated
- [x] Notes captured
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: lowercase "e2e verified" satisfies identity but STILL triggers evidence check → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.test.mjs test 'x3' — the E2E evidence extractor must be at least as
  // lenient as the identity anchor (case-insensitive, optional whitespace), or a box that
  // satisfies identity would skip report validation. Lowercase E2E box + no report → exit 1.
  const dir = mkdtempSync(join(tmpdir(), 'cgps-lc-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 's');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Tests written (TDD) and passing
- [x] Code review clean
- [x] e2e verified via verify-e2e
- [x] State updated
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('ps1 parity: light profile — 3 canonical gates → exit 0; "trivial" gate renamed → exit 1', { skip: !hasPwsh }, () => {
  // Mirrors check-gates.test.mjs tests 'y'/'z' — light profile identity coverage.
  const mkLight = (thirdBox) => {
    const dir = mkdtempSync(join(tmpdir(), 'cgps-light-'));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
    writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 's');
    git(dir, 'checkout', '-q', '-b', 'feat/x');
    mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
    writeFileSync(join(dir, '.codeforge/workflow', 'state.md'),
`## Active workflow
- **Profile:** light
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Change verified (ran it)
${thirdBox}
`);
    return dir;
  };
  let d = mkLight('- [x] Still trivial (<3 files, no behavior risk)'); assert.equal(run(d), 0); rmSync(d, { recursive: true, force: true });
  d = mkLight('- [x] Looks fine to me');                               assert.equal(run(d), 1); rmSync(d, { recursive: true, force: true });
});

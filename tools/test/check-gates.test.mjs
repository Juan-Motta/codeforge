import { test as _test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repoRoot, 'src', 'shared', 'scripts', 'check-gates.sh');

// The sh script needs a POSIX shell. On Windows CI (where `node --test tools/test/`
// runs so the .ps1 parity tests execute under pwsh) `sh` may be absent — skip
// gracefully, mirroring the .ps1 test's `hasPwsh` guard, rather than hard-failing.
let hasSh = true;
try { execFileSync('sh', ['-c', 'exit 0'], { stdio: 'pipe' }); } catch { hasSh = false; }
const test = (name, fn) => _test(name, hasSh ? {} : { skip: true }, fn);

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

// Build a temp git repo with main + a feature branch, a state file, and optional report.
function setup({ box, report, onDefaultBranch = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  if (!onDefaultBranch) git(dir, 'checkout', '-q', '-b', 'feat/x');

  const boxLine = box ?? '- [x] E2E verified via verify-e2e (report: docs/e2e/reports/r.md)';
  const state = `# State
## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed by the other engine
- [x] Tests written (TDD) and passing
- [x] Code review clean — no open P0/P1/P2
${boxLine}
- [x] State updated
`;
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'), state);

  if (report !== undefined) {
    mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'r.md'), report);
  }
  return dir;
}

function run(dir) {
  try {
    execFileSync('sh', [script, '.workflow/state.md'], { cwd: dir, stdio: 'pipe' });
    return 0;
  } catch (e) { return e.status; }
}

test('a: box checked + fresh PASS report → exit 0', () => {
  const dir = setup({ report: 'VERDICT: PASS\n' });
  assert.equal(run(dir), 0);
  rmSync(dir, { recursive: true, force: true });
});

test('b: box checked + no report → exit 1', () => {
  const dir = setup({ report: undefined });
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('c: box checked + report VERDICT FAIL → exit 1', () => {
  const dir = setup({ report: 'VERDICT: FAIL\n' });
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('d: box checked + report committed on main (not fresh on branch) → exit 1', () => {
  // Report exists on main before branching → not in merge-base..HEAD diff, not untracked.
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'r.md'), 'VERDICT: PASS\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed+report');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('e: N/A with reason → exit 0', () => {
  const dir = setup({ box: '- [x] E2E verified — N/A: internal refactor', report: undefined });
  assert.equal(run(dir), 0);
  rmSync(dir, { recursive: true, force: true });
});

test('f: N/A with empty reason → exit 1', () => {
  const dir = setup({ box: '- [x] E2E verified — N/A:', report: undefined });
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('g: no base resolves (default branch), named report PRESENT + PASS → exit 0 (freshness skipped, existence+PASS enforced)', () => {
  // On the only branch (main): main == current so it is skipped, no dev/master/origin →
  // base unresolved. Freshness cannot be checked, but existence + top-level PASS still are.
  const dir = setup({ report: 'VERDICT: PASS\n', onDefaultBranch: true });
  assert.equal(run(dir), 0);
  rmSync(dir, { recursive: true, force: true });
});

test('h: E2E gate replaced by a non-E2E box → missing required gate → exit 1 (identity)', () => {
  // setup() supplies the 5 non-E2E canonical gates; replacing the E2E box with an unrelated
  // one leaves the standard profile without its E2E gate. Count is still 6, but identity
  // validation must reject the missing required gate (the count-only hole Codex flagged).
  const dir = setup({ box: '- [x] Change verified by exercising it', report: undefined });
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('w: standard profile with 6 checked boxes but NONE are the required gates → exit 1 (identity)', () => {
  // The count-only hole: six arbitrarily-named checked boxes satisfied the profile because
  // check-gates only tallied a required COUNT (6), never the required gate IDENTITIES.
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('j: report FIRST verdict is FAIL but a LATER per-UC line is VERDICT: PASS → exit 1', () => {
  // Proves Fix 1: the gate must anchor to the TOP-LEVEL (first) VERDICT line, not match
  // any VERDICT: PASS line anywhere in the file. A per-UC block below a top-level FAIL
  // must never satisfy the gate.
  const dir = setup({
    report: 'VERDICT: FAIL\n\nSome narrative text.\n\n## Per-UC results\nUC1: login flow\nVERDICT: PASS\n',
  });
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('k: E2E box line copied from the ship-gates.md doc text (no real N/A escape) + placeholder → exit 1', () => {
  // Proves the doc line in ship-gates.md contains the substring "N/A:" inside backticked
  // explanatory text ("— `N/A: <reason>` allowed for ...") but NOT the real escape form
  // "— N/A:" (em-dash, space, N/A:, no backtick). If a user mis-copies that doc line into
  // state.md and checks it, the gate must NOT treat it as an N/A skip — it falls through
  // and is rejected as a placeholder report path (`<...>`).
  const dir = setup({
    box: '- [x] E2E verified via verify-e2e (report: docs/e2e/reports/<...>.md) — `N/A: <reason>` allowed for purely internal changes (migration, refactor, tooling)',
    report: undefined,
  });
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('i: box checked + report git-add STAGED (not committed) on branch + PASS → exit 0', () => {
  // Report is `git add`-staged but not committed — the natural post-verify-e2e workflow
  // before the human runs `git commit`. Must be treated as fresh, same as untracked/committed.
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'r.md'), 'VERDICT: PASS\n');
  git(dir, 'add', 'docs/e2e/reports/r.md');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('l: named-path mismatch — box names an ABSENT report while an UNRELATED fresh PASS exists → exit 1', () => {
  // Closes the "any report" hole: the box names feat.md (which does NOT exist) but an
  // unrelated fresh PASS report other.md DOES exist. The old code scanned the whole
  // reports dir and would pass on other.md; the named-path gate must fail.
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'other.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('m: placeholder report path rejected even when an unrelated fresh PASS exists → exit 1', () => {
  // The box still carries the `<...>` placeholder. The old code would pass on the unrelated
  // fresh PASS report present in the dir; the named-path gate must reject the placeholder.
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'other.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('n: named report committed on the feature branch (base = main) + PASS → exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'feat.md'), 'VERDICT: PASS\n');
  git(dir, 'add', 'docs/e2e/reports/feat.md'); git(dir, 'commit', '-qm', 'e2e report');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('o: dev-based branch — a PASS report inherited on dev cannot satisfy the box that names THIS feature report → exit 1', () => {
  // Repo has main + dev. dev carries an inherited PASS report at a DIFFERENT path.
  // The feature branch forks from dev; its box names feat.md, which is absent. Closest
  // merge-base is dev, and the dev-inherited report is not the named one → exit 1.
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'dev');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'inherited.md'), 'VERDICT: PASS\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'dev inherited report');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('p: named report committed on base then edited unstaged on branch → fresh via unstaged edit → exit 0', () => {
  // Report committed on main (base), then edited (unstaged) on the feature branch. It is
  // not committed/staged on the branch, but the unstaged tracked edit makes it fresh.
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'feat.md'), 'VERDICT: FAIL\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed+report');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  // Unstaged edit on the branch flips it to PASS.
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'feat.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('q: no-base fail-safe — single branch (no main/master/dev), named report PRESENT + PASS → exit 0 with freshness note', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'feat/solo');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'feat.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('r: no-base fail-safe — single branch, named report ABSENT → exit 1 (never fail open)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'feat/solo');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

// --- Adversarial re-review fixes: symlink / traversal / subdir / multi-report -------

test('s: SYMLINK at the box-named path (pointing to an external fabricated PASS) → exit 1', () => {
  // Bypass found by adversarial re-review: an untracked symlink dropped at the box-named
  // path pointed at an attacker-controlled file OUTSIDE the repo carrying a fabricated
  // "VERDICT: PASS" — the old code only checked `[ -f ]`, which follows symlinks and
  // happily reads through them. Base resolves (main) so freshness would even see the
  // symlink as "untracked" — the ONLY thing that must stop this is rejecting the symlink
  // itself, before existence is even considered.
  const parent = mkdtempSync(join(tmpdir(), 'cg-sym-'));
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
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('t: path TRAVERSAL out of the repo (no base resolves) → exit 1', () => {
  // Bypass found by adversarial re-review: single-branch repo (no dev/main/master/origin
  // resolves), box names `report: ../evil.md` pointing OUTSIDE the repo to a fabricated
  // PASS. The old code resolved `$toplevel/../evil.md`, found it existed with VERDICT:
  // PASS, and — since no base resolves — freshness was skipped entirely → silent exit 0.
  // The whitelist must reject the traversal before existence is even checked.
  const parent = mkdtempSync(join(tmpdir(), 'cg-trav-'));
  const dir = join(parent, 'repo');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'feat/solo');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('u: SUBDIR path under docs/e2e/reports/ → exit 1 (whitelist rejects the extra slash)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-subdir-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports', 'sub', 'dir'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'sub', 'dir', 'x.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('v: MULTI-REPORT line (two "(report:" groups) → exit 1 (ambiguous, one report per box)', () => {
  // Bypass found by adversarial re-review: sh's greedy `.*(report:` extraction picks the
  // RIGHTMOST group while ps1's regex Match picks the leftmost — a line with a placeholder
  // group first and a real fresh PASS group second made sh pass (extracts the real path)
  // while ps1 failed (extracts the placeholder). Reject the ambiguous line outright on
  // both engines instead of trying to agree on which group "wins".
  const dir = mkdtempSync(join(tmpdir(), 'cg-multi-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'real.md'), 'VERDICT: PASS\n');
  git(dir, 'add', 'docs/e2e/reports/real.md'); git(dir, 'commit', '-qm', 'e2e report');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

// --- identity: cross-match, glob, and light-profile coverage (review P1/P2 fixes) --------

test('x: Tests gate omitted but a fresh PASS E2E report named tdd.md must NOT satisfy it → exit 1', () => {
  // Regression for the P1 cross-match: the E2E line "(report: docs/e2e/reports/tdd.md)" once
  // matched a global Tests-gate substring search, so a checklist missing the Tests gate read
  // green. Anchors now match only each box's LEADING words, so a trailing report path can't
  // satisfy another gate. (On the OLD code this exited 0 — the report is real, fresh, and PASS;
  // the ONLY defect is the missing gate.)
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, 'docs', 'e2e', 'reports'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'e2e', 'reports', 'tdd.md'), 'VERDICT: PASS\n');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('x1: Tests gate omitted; "TDD" inside an E2E N/A reason must NOT satisfy it → exit 1', () => {
  // Second cross-match vector (review round 2): free text in an "— N/A: <reason>" carried the
  // word TDD, which the old global substring anchor matched. Leading-anchored matching only
  // looks at each box's opening words, so the E2E box's trailing reason can't satisfy Tests.
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
`## Active workflow
- **Profile:** standard
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Plan written and design-reviewed
- [x] Code review clean
- [x] E2E verified — N/A: covered by TDD
- [x] State updated
- [x] Notes captured
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

test('x3: lowercase "e2e verified" satisfies identity but STILL triggers evidence check → exit 1', () => {
  // The identity anchor is case-insensitive with optional whitespace; the E2E evidence
  // extractor must be at least as lenient, or a box that satisfies identity would skip report
  // validation. Here the lowercase E2E box names no report — evidence must fire and reject it.
  // (On the OLD case-sensitive `[[:space:]]+` extractor this skipped evidence and exited 0.)
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
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

test('y: light profile with its 3 canonical gates → exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
`## Active workflow
- **Profile:** light
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Change verified (ran it)
- [x] Still trivial (<3 files, no behavior risk)
`);
  assert.equal(run(dir), 0);
  rmSync(dir, { recursive: true, force: true });
});

test('z: light profile with 3 boxes but the "trivial" gate renamed → exit 1 (identity)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'seed'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'seed');
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'),
`## Active workflow
- **Profile:** light
## Ship-gate checklist
- [x] On a feature branch (not \`main\`)
- [x] Change verified (ran it)
- [x] Looks fine to me
`);
  assert.equal(run(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

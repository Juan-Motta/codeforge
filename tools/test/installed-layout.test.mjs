// The installed FOOTPRINT is a contract with the host project, and until now nothing asserted it.
// That is why machinery was able to spread across the target root — `shared/`, `.workflow/`,
// `.forge-manifest`, `.forge-version` — without any test noticing.
//
// Rule: the target root may contain ONLY what an engine discovers by fixed convention, the two
// project-owned files, `docs/`, and the single `.codeforge/` directory holding everything else.
// A new root entry is a deliberate product decision, so it must fail here and be added on purpose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hasPwsh = (() => { try { execFileSync('pwsh', ['-v'], { stdio: 'pipe' }); return true; } catch { return false; } })();

// Engine-mandated (cannot move — each engine discovers these paths by convention), plus the two
// project-owned files, plus docs/ (human-facing project knowledge), plus the one framework dir.
const ALLOWED_ROOT = new Set([
  '.claude', '.agents', '.codex', 'opencode.json',   // engine discovery
  'CLAUDE.md', 'AGENTS.md',                          // engine auto-load
  'PROJECT.md', 'CONTINUITY.md',                     // project-owned
  'docs',                                            // project knowledge, stays in the open
  '.codeforge',                                      // everything else
  '.gitignore',                                      // modified, not created
  '.git',                                            // the fixture's own repo
]);

// Machinery that used to sit in the root and must never come back.
const FORBIDDEN_ROOT = ['shared', '.workflow', '.forge-manifest', '.forge-version'];

function freshTarget(prefix) {
  const target = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-q', '.'], { cwd: target, stdio: 'pipe' });
  return target;
}

const installers = [
  { name: 'install.sh', run: (t) => execFileSync('bash', [join(REPO, 'install.sh'), t], { stdio: 'pipe' }) },
  {
    name: 'install.ps1',
    skip: !hasPwsh,
    run: (t) => execFileSync('pwsh', ['-NoProfile', '-File', join(REPO, 'install.ps1'), '-Target', t], { stdio: 'pipe' }),
  },
];

for (const inst of installers) {
  test(`${inst.name}: the target root contains only the agreed entries`, { skip: inst.skip ? 'pwsh not installed' : false }, () => {
    const target = freshTarget('cf-layout-');
    try {
      inst.run(target);
      const unexpected = readdirSync(target).filter((e) => !ALLOWED_ROOT.has(e)).sort();
      assert.deepEqual(
        unexpected,
        [],
        `unexpected entries in the target root — either move them under .codeforge/ or add them to ALLOWED_ROOT on purpose: ${unexpected.join(', ')}`,
      );
      for (const gone of FORBIDDEN_ROOT) {
        assert.equal(existsSync(join(target, gone)), false, `${gone} must not exist in the target root any more`);
      }
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
}

test('the framework machinery is all under .codeforge/, and is committable', () => {
  const target = freshTarget('cf-layout-content-');
  try {
    execFileSync('bash', [join(REPO, 'install.sh'), target], { stdio: 'pipe' });

    for (const p of ['rules', 'scripts', 'state.template.md', 'manifest', 'version']) {
      assert.ok(existsSync(join(target, '.codeforge', p)), `.codeforge/${p} is missing`);
    }
    assert.ok(readdirSync(join(target, '.codeforge', 'rules')).length >= 10, 'rules did not land under .codeforge/rules');

    // THE FOOTGUN this guards: a bare `.codeforge/` in .gitignore would untrack the rules and
    // scripts that must ship with the project, leaving a fresh clone with no machinery at all.
    // Only the volatile workflow state may be ignored.
    execFileSync('git', ['add', '-A'], { cwd: target, stdio: 'pipe' });
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: target, encoding: 'utf8' }).split('\n');
    assert.ok(staged.some((f) => f.startsWith('.codeforge/rules/')), '.codeforge/rules/ must be trackable, not gitignored');
    assert.ok(staged.some((f) => f.startsWith('.codeforge/scripts/')), '.codeforge/scripts/ must be trackable, not gitignored');

    mkdirSync(join(target, '.codeforge', 'workflow'), { recursive: true });
    writeFileSync(join(target, '.codeforge', 'workflow', 'state.md'), '# state\n');
    const ignored = (() => {
      try {
        execFileSync('git', ['check-ignore', '-q', '.codeforge/workflow/state.md'], { cwd: target, stdio: 'pipe' });
        return true;
      } catch { return false; }
    })();
    assert.equal(ignored, true, 'the volatile workflow state must be gitignored');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ci.yml's Windows job asserts a hardcoded list of "runtime files" that must exist after an install.
// Nothing covered that list, so it drifted: it still demanded `.forge-version` after the path moved
// to `.codeforge/version`, and the only signal was a red Windows job — invisible on a dev machine
// where that step never runs. Pin it to reality here so the drift fails locally instead.
test("the runtime files ci.yml asserts on Windows actually exist after an install", () => {
  const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
  const m = ci.match(/foreach \(\$f in ([^)]+)\) \{/);
  assert.ok(m, "could not find ci.yml's runtime-file list — if the step was renamed, update this test");
  const expected = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(expected.length >= 4, `expected a meaningful runtime-file list, got ${expected.length}`);

  const target = freshTarget('cf-layout-ci-');
  try {
    execFileSync('bash', [join(REPO, 'install.sh'), target], { stdio: 'pipe' });
    const missing = expected.filter((f) => !existsSync(join(target, f)));
    assert.deepEqual(missing, [], `ci.yml asserts runtime files that an install does not produce: ${missing.join(', ')}`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('installing over the pre-.codeforge/ layout removes it instead of leaving both', () => {
  const target = freshTarget('cf-layout-legacy-');
  try {
    // Reconstruct the old scattered layout, including its root markers.
    mkdirSync(join(target, 'shared', 'rules'), { recursive: true });
    mkdirSync(join(target, '.workflow'), { recursive: true });
    writeFileSync(join(target, 'shared', 'rules', 'ship-gates.md'), 'stale copy\n');
    writeFileSync(join(target, '.forge-manifest'), 'rule:ship-gates.md\n');
    writeFileSync(join(target, '.forge-version'), '0.5.1\n');
    writeFileSync(join(target, '.workflow', 'state.md'), 'old state\n');

    execFileSync('bash', [join(REPO, 'install.sh'), target], { stdio: 'pipe' });

    // Two competing copies of the rules would be worse than either layout alone: nothing would tell
    // an agent which one it is reading.
    for (const gone of FORBIDDEN_ROOT) {
      assert.equal(existsSync(join(target, gone)), false, `${gone} survived the install`);
    }
    assert.ok(existsSync(join(target, '.codeforge', 'rules', 'ship-gates.md')), 'the new layout was not written');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

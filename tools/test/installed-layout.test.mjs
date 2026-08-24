// The installed FOOTPRINT is a contract with the host project.
// Rule: the target root may contain ONLY what an engine discovers by fixed convention, the two
// project-owned files, `docs/`, and the single `.codeforge/` directory holding everything else.
// A new root entry is a deliberate product decision, so it must fail here and be added on purpose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync, symlinkSync, lstatSync } from 'node:fs';
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
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test(`${inst.name}: install fails closed on managed ancestor reparse points`, { skip: inst.skip ? 'pwsh not installed' : false }, (t) => {
    const target = freshTarget('cf-layout-ancestor-');
    const external = mkdtempSync(join(tmpdir(), 'cf-layout-external-'));
    const linked = join(target, '.claude');
    try {
      writeFileSync(join(external, 'sentinel.txt'), 'KEEP ME\n');
      try {
        symlinkSync(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        t.skip(`directory links unavailable: ${error.message}`);
        return;
      }
      assert.throws(() => inst.run(target), /Command failed/);
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'KEEP ME\n');
      assert.equal(existsSync(join(external, 'skills')), false, 'installer wrote through .claude link');
      assert.equal(existsSync(join(target, '.codeforge')), false, 'installer mutated target before rejecting the link');
    } finally {
      rmSync(linked, { recursive: false, force: true });
      rmSync(target, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  test(`${inst.name}: install rejects links nested inside canonical .codeforge`, { skip: inst.skip ? 'pwsh not installed' : false }, (t) => {
    const target = freshTarget('cf-layout-canonical-link-');
    const external = mkdtempSync(join(tmpdir(), 'cf-layout-canonical-external-'));
    const linked = join(target, '.codeforge', 'rules');
    try {
      mkdirSync(join(target, '.codeforge'), { recursive: true });
      writeFileSync(join(external, 'sentinel.txt'), 'KEEP ME\n');
      try {
        symlinkSync(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        t.skip(`directory links unavailable: ${error.message}`);
        return;
      }
      assert.throws(() => inst.run(target), /Command failed/);
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'KEEP ME\n');
      assert.deepEqual(readdirSync(external), ['sentinel.txt']);
    } finally {
      rmSync(linked, { recursive: false, force: true });
      rmSync(target, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  test(`${inst.name}: sync replaces generated leaf symlinks without overwriting their targets`, { skip: inst.skip ? 'pwsh not installed' : false }, (t) => {
    const target = freshTarget('cf-layout-symlink-');
    try {
      inst.run(target);
      const victim = join(target, 'victim.txt');
      writeFileSync(victim, 'KEEP ME\n');
      const generated = [
        join(target, '.claude', 'agents', 'codeforge-implementer.md'),
        join(target, '.codex', 'config.toml'),
      ];
      try {
        for (const path of generated) {
          rmSync(path, { force: true });
          symlinkSync(victim, path, 'file');
        }
      } catch (error) {
        t.skip(`symbolic links unavailable: ${error.message}`);
        return;
      }

      if (inst.name === 'install.ps1') {
        execFileSync('pwsh', ['-NoProfile', '-File', join(target, '.codeforge', 'sync.ps1')], { cwd: target, stdio: 'pipe' });
      } else {
        execFileSync('bash', [join(target, '.codeforge', 'sync.sh')], { cwd: target, stdio: 'pipe' });
      }

      assert.equal(readFileSync(victim, 'utf8'), 'KEEP ME\n');
      for (const path of generated) {
        assert.equal(lstatSync(path).isSymbolicLink(), false, `${path} remained a symlink`);
        assert.equal(lstatSync(path).isFile(), true, `${path} was not regenerated as a file`);
      }
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test(`${inst.name}: sync rejects a generated leaf that resolves to a directory`, { skip: inst.skip ? 'pwsh not installed' : false }, (t) => {
    const target = freshTarget('cf-layout-leaf-dir-');
    const external = mkdtempSync(join(tmpdir(), 'cf-layout-leaf-dir-external-'));
    const generated = join(target, 'AGENTS.md');
    try {
      inst.run(target);
      rmSync(generated, { force: true });
      writeFileSync(join(external, 'sentinel.txt'), 'KEEP ME\n');
      try {
        symlinkSync(external, generated, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        t.skip(`directory links unavailable: ${error.message}`);
        return;
      }

      const runSync = () => {
        if (inst.name === 'install.ps1') {
          execFileSync('pwsh', ['-NoProfile', '-File', join(target, '.codeforge', 'sync.ps1')], { cwd: target, stdio: 'pipe' });
        } else {
          execFileSync('bash', [join(target, '.codeforge', 'sync.sh')], { cwd: target, stdio: 'pipe' });
        }
      };
      assert.throws(runSync, /Command failed/);
      assert.deepEqual(readdirSync(external), ['sentinel.txt'], 'sync wrote a temporary file through the generated leaf');
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'KEEP ME\n');
    } finally {
      rmSync(generated, { recursive: false, force: true });
      rmSync(target, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  test(`${inst.name}: failed install retries do not duplicate imported agent context`, { skip: inst.skip ? 'pwsh not installed' : false }, () => {
    const target = freshTarget('cf-layout-context-retry-');
    try {
      writeFileSync(join(target, 'CLAUDE.md'), '# Existing project context\n\nKeep this once.\n');
      mkdirSync(join(target, '.claude', 'skills'), { recursive: true });
      writeFileSync(join(target, '.claude', 'skills', 'custom.md'), 'custom skill\n');
      writeFileSync(join(target, '.claude', 'skills.pre-codeforge.bak'), 'collision\n');

      assert.throws(() => inst.run(target), /Command failed/);
      assert.throws(() => inst.run(target), /Command failed/);

      const project = readFileSync(join(target, 'PROJECT.md'), 'utf8');
      assert.equal((project.match(/<!-- codeforge:imported-context:start -->/g) ?? []).length, 1);
      assert.equal((project.match(/<!-- codeforge:imported-context:end -->/g) ?? []).length, 1);
      assert.equal((project.match(/Keep this once\./g) ?? []).length, 1);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test(`${inst.name}: reinstall preserves canonical config edits and additions`, { skip: inst.skip ? 'pwsh not installed' : false }, () => {
    const target = freshTarget('cf-layout-config-owned-');
    try {
      inst.run(target);
      const codexConfig = join(target, '.codeforge', 'configs', 'codex', 'config.toml');
      const customConfig = join(target, '.codeforge', 'configs', 'project-local.json');
      writeFileSync(codexConfig, `${readFileSync(codexConfig, 'utf8')}\n# PROJECT_CONFIG_MARKER\n`);
      writeFileSync(customConfig, '{"projectOwned":true}\n');

      inst.run(target);

      assert.match(readFileSync(codexConfig, 'utf8'), /PROJECT_CONFIG_MARKER/);
      assert.match(readFileSync(join(target, '.codex', 'config.toml'), 'utf8'), /PROJECT_CONFIG_MARKER/);
      assert.equal(readFileSync(customConfig, 'utf8'), '{"projectOwned":true}\n');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test(`${inst.name}: installed sync fails closed on a linked engine directory`, { skip: inst.skip ? 'pwsh not installed' : false }, (t) => {
    const target = freshTarget('cf-layout-sync-ancestor-');
    const external = mkdtempSync(join(tmpdir(), 'cf-layout-sync-external-'));
    const linked = join(target, '.claude');
    try {
      inst.run(target);
      rmSync(linked, { recursive: true, force: true });
      writeFileSync(join(external, 'sentinel.txt'), 'KEEP ME\n');
      try {
        symlinkSync(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        t.skip(`directory links unavailable: ${error.message}`);
        return;
      }
      const runSync = () => {
        if (inst.name === 'install.ps1') {
          execFileSync('pwsh', ['-NoProfile', '-File', join(target, '.codeforge', 'sync.ps1')], { cwd: target, stdio: 'pipe' });
        } else {
          execFileSync('bash', [join(target, '.codeforge', 'sync.sh')], { cwd: target, stdio: 'pipe' });
        }
      };
      assert.throws(runSync, /Command failed/);
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'KEEP ME\n');
      assert.equal(existsSync(join(external, 'skills')), false, 'sync wrote through .claude link');
    } finally {
      rmSync(linked, { recursive: false, force: true });
      rmSync(target, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });
}

test('the canonical framework source is all under .codeforge/, and is committable', () => {
  const target = freshTarget('cf-layout-content-');
  try {
    execFileSync('bash', [join(REPO, 'install.sh'), target], { stdio: 'pipe' });

    for (const p of [
      'WORKFLOW.md', 'agents', 'skills', 'rules', 'scripts', 'configs', 'docs', 'templates',
      'sync.sh', 'sync.ps1', 'state.template.md', 'manifest', 'version',
    ]) {
      assert.ok(existsSync(join(target, '.codeforge', p)), `.codeforge/${p} is missing`);
    }
    assert.ok(readdirSync(join(target, '.codeforge', 'rules')).length >= 10, 'rules did not land under .codeforge/rules');

    // THE FOOTGUN this guards: a bare `.codeforge/` in .gitignore would untrack the rules and
    // scripts that must ship with the project, leaving a fresh clone with no machinery at all.
    // Only the volatile workflow state may be ignored.
    execFileSync('git', ['add', '-A'], { cwd: target, stdio: 'pipe' });
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: target, encoding: 'utf8' }).split('\n');
    assert.ok(staged.some((f) => f.startsWith('.codeforge/rules/')), '.codeforge/rules/ must be trackable, not gitignored');
    assert.ok(staged.some((f) => f.startsWith('.codeforge/agents/')), '.codeforge/agents/ must be trackable, not gitignored');
    assert.ok(staged.some((f) => f.startsWith('.codeforge/scripts/')), '.codeforge/scripts/ must be trackable, not gitignored');
    assert.ok(staged.some((f) => f.startsWith('.codeforge/skills/')), '.codeforge/skills/ must be trackable, not gitignored');
    assert.ok(staged.some((f) => f.startsWith('.codeforge/configs/')), '.codeforge/configs/ must be trackable, not gitignored');

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

// ci.yml's Windows job asserts a hardcoded list of runtime files. Pin it to the installer contract
// locally so CI and the generated layout cannot drift apart.
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

test('the installed canonical source can regenerate every engine mirror', () => {
  const target = freshTarget('cf-layout-sync-');
  try {
    execFileSync('bash', [join(REPO, 'install.sh'), target], { stdio: 'pipe' });
    const marker = '\nLOCAL_CANONICAL_MARKER\n';
    writeFileSync(join(target, '.codeforge', 'WORKFLOW.md'), readFileSync(join(target, '.codeforge', 'WORKFLOW.md'), 'utf8') + marker);
    writeFileSync(join(target, '.codeforge', 'skills', 'new-feature', 'SKILL.md'), readFileSync(join(target, '.codeforge', 'skills', 'new-feature', 'SKILL.md'), 'utf8') + marker);
    writeFileSync(join(target, '.codeforge', 'configs', 'codex', 'config.toml'), readFileSync(join(target, '.codeforge', 'configs', 'codex', 'config.toml'), 'utf8') + marker);
    writeFileSync(join(target, '.codeforge', 'agents', 'codeforge-implementer.md'), readFileSync(join(target, '.codeforge', 'agents', 'codeforge-implementer.md'), 'utf8') + marker);

    execFileSync('bash', [join(target, '.codeforge', 'sync.sh')], { cwd: target, stdio: 'pipe' });

    assert.match(readFileSync(join(target, 'CLAUDE.md'), 'utf8'), /@\.codeforge\/WORKFLOW\.md/, 'CLAUDE.md does not import the workflow');
    assert.match(readFileSync(join(target, 'AGENTS.md'), 'utf8'), /`\.codeforge\/WORKFLOW\.md`/, 'AGENTS.md does not bootstrap the workflow');
    for (const p of ['.codeforge/WORKFLOW.md', '.claude/skills/new-feature/SKILL.md', '.agents/skills/new-feature/SKILL.md', '.codex/config.toml', '.claude/agents/codeforge-implementer.md', '.codex/agents/codeforge-implementer.toml']) {
      assert.match(readFileSync(join(target, p), 'utf8'), /LOCAL_CANONICAL_MARKER/, `${p} was not regenerated from .codeforge`);
    }

    const claudeAgent = readFileSync(join(target, '.claude', 'agents', 'codeforge-implementer.md'), 'utf8');
    const codexAgent = readFileSync(join(target, '.codex', 'agents', 'codeforge-implementer.toml'), 'utf8');
    assert.match(claudeAgent, /^name: codeforge-implementer$/m);
    assert.doesNotMatch(claudeAgent, /^model:/m, 'Claude adapter should inherit the active model');
    assert.match(codexAgent, /^name = "codeforge-implementer"$/m);
    assert.match(codexAgent, /^developer_instructions = '''$/m);
    assert.doesNotMatch(codexAgent, /^model\s*=/m, 'Codex adapter should inherit the active model');
    for (const contractTerm of ['commit_policy', 'defer', 'unstaged', 'BLOCKED']) {
      assert.match(claudeAgent, new RegExp(contractTerm), `Claude adapter lost ${contractTerm}`);
      assert.match(codexAgent, new RegExp(contractTerm), `Codex adapter lost ${contractTerm}`);
    }
    assert.doesNotMatch(claudeAgent, /per-task/);
    assert.doesNotMatch(codexAgent, /per-task/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

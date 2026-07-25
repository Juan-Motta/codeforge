// The setup wizard's answers must survive `--upgrade`.
//
// THE BUG THIS PINS: the wizard wrote its answers straight into two MANAGED files —
// `shared/rules/models.md` (review policy block) and `shared/state.template.md`
// (`**Profile:**`) — which install.sh/ps1 overwrite unconditionally (a bare `cp` over
// `shared/rules/*.md` and over `state.template.md`). So `npx @jualopezmo/codeforge --upgrade`
// silently reset a team's chosen reviewer and gate profile back to the shipped defaults, with no
// `.pre-forge.bak` for either file. Worse, `--upgrade` skips the wizard, so nothing reapplied
// them, and the wizard's answers were not persisted anywhere else.
//
// THE FIX: PROJECT.md (project-owned, never clobbered) is the source of truth, exactly as
// `applyExecution` already does for `## Execution` — its comment states the reason: "Lives in
// PROJECT.md because it is project-owned and survives `--upgrade` (unlike the by-name-refreshed
// shared/rules)". The installers re-render the two managed files FROM PROJECT.md on every run.
//
// Both installers are covered: the sh↔ps1 parity rule means a fix in one is a bug in the other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hasPwsh = (() => { try { execFileSync('pwsh', ['-v'], { stdio: 'pipe' }); return true; } catch { return false; } })();

// A reviewer string that is not the shipped default, so "it still says Codex" can only mean the
// upgrade clobbered it — never that the fixture happened to match the default.
const CHOSEN_REVIEWER = 'Default reviewer(s): claude (`claude-opus-5` · high)';
const CHOSEN_COUNCIL = 'Council advisors: claude (`claude-opus-5` · high)';
const CHOSEN_PROFILE = 'light';

function freshTarget(prefix) {
  const target = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-q', '.'], { cwd: target, stdio: 'pipe' });
  return target;
}

function install(target, args = []) {
  execFileSync('bash', [join(REPO, 'install.sh'), target, ...args], { stdio: 'pipe' });
}

function installPs1(target, args = []) {
  execFileSync('pwsh', ['-NoProfile', '-File', join(REPO, 'install.ps1'), '-Target', target, ...args], { stdio: 'pipe' });
}

// Stand in for the wizard: write the answers into PROJECT.md's managed section. Kept as a
// text edit (rather than importing apply.mjs) so the test proves the INSTALLER honours
// PROJECT.md, independently of how the wizard happens to write it.
function seedProjectPolicy(target) {
  const path = join(target, 'PROJECT.md');
  const md = readFileSync(path, 'utf8');
  assert.ok(md.includes('## Review policy'), 'PROJECT.md template must ship a "## Review policy" section');
  const body = [CHOSEN_REVIEWER, CHOSEN_COUNCIL, `Gate profile: ${CHOSEN_PROFILE}`].join('\n');
  const start = md.indexOf('## Review policy');
  const rest = md.slice(start + '## Review policy'.length);
  const nextRel = rest.search(/\n## /);
  const end = nextRel === -1 ? md.length : start + '## Review policy'.length + nextRel;
  writeFileSync(path, `${md.slice(0, start)}## Review policy\n\n${body}\n${md.slice(end)}`);
}

function assertPolicyPreserved(target, label) {
  const models = readFileSync(join(target, 'shared', 'rules', 'models.md'), 'utf8');
  const state = readFileSync(join(target, 'shared', 'state.template.md'), 'utf8');

  assert.match(state, /\*\*Profile:\*\*\s*light/, `${label}: chosen gate profile was reset`);
  assert.ok(!/\*\*Profile:\*\*\s*standard/.test(state), `${label}: state.template.md still carries the default profile`);

  // The managed block — not just the file — must carry the chosen reviewer, so a stray mention
  // elsewhere in models.md cannot satisfy this.
  const block = models.match(/<!-- codeforge:review-policy:start -->[\s\S]*?<!-- codeforge:review-policy:end -->/);
  assert.ok(block, `${label}: models.md lost its managed review-policy block`);
  assert.match(block[0], /claude/, `${label}: chosen reviewer was reset inside the managed block`);
  assert.ok(!/gpt-5\.6-sol/.test(block[0]), `${label}: managed block reverted to the shipped default reviewer`);
}

test('PROJECT.md template ships a Review policy section for the wizard to own', () => {
  const md = readFileSync(join(REPO, 'src', 'PROJECT.template.md'), 'utf8');
  assert.match(md, /^## Review policy$/m);
  // The section must explain that it is the source of truth, or a future maintainer will
  // "helpfully" move it back into shared/rules and reintroduce the bug.
  assert.match(md, /Managed by the codeforge setup wizard/);
});

test('install.sh --upgrade re-renders the managed files from PROJECT.md', () => {
  const target = freshTarget('cf-wiz-sh-');
  try {
    install(target);
    seedProjectPolicy(target);
    install(target, ['--upgrade']);
    assertPolicyPreserved(target, 'install.sh --upgrade');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('install.sh is idempotent over the re-render (second upgrade is byte-stable)', () => {
  const target = freshTarget('cf-wiz-idem-');
  try {
    install(target);
    seedProjectPolicy(target);
    install(target, ['--upgrade']);
    const first = {
      models: readFileSync(join(target, 'shared', 'rules', 'models.md'), 'utf8'),
      state: readFileSync(join(target, 'shared', 'state.template.md'), 'utf8'),
      project: readFileSync(join(target, 'PROJECT.md'), 'utf8'),
    };
    install(target, ['--upgrade']);
    assert.equal(readFileSync(join(target, 'shared', 'rules', 'models.md'), 'utf8'), first.models, 'models.md drifted on re-run');
    assert.equal(readFileSync(join(target, 'shared', 'state.template.md'), 'utf8'), first.state, 'state.template.md drifted on re-run');
    assert.equal(readFileSync(join(target, 'PROJECT.md'), 'utf8'), first.project, 'PROJECT.md drifted on re-run');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('a target with no Review policy section still upgrades cleanly (framework defaults win)', () => {
  const target = freshTarget('cf-wiz-nopolicy-');
  try {
    install(target);
    // Simulate an install that predates the section, or a user who deleted it: the re-render must
    // no-op rather than blank the managed block or leave a half-written file.
    const path = join(target, 'PROJECT.md');
    const md = readFileSync(path, 'utf8');
    const start = md.indexOf('## Review policy');
    const rest = md.slice(start + 1);
    const nextRel = rest.search(/\n## /);
    writeFileSync(path, md.slice(0, start) + (nextRel === -1 ? '' : md.slice(start + 1 + nextRel + 1)));

    install(target, ['--upgrade']);
    const models = readFileSync(join(target, 'shared', 'rules', 'models.md'), 'utf8');
    const state = readFileSync(join(target, 'shared', 'state.template.md'), 'utf8');
    assert.match(models, /<!-- codeforge:review-policy:start -->[\s\S]*Default reviewer\(s\):[\s\S]*<!-- codeforge:review-policy:end -->/);
    assert.match(state, /\*\*Profile:\*\*\s*standard/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('an unknown gate profile in PROJECT.md is rejected, not written through', () => {
  const target = freshTarget('cf-wiz-badprof-');
  try {
    install(target);
    seedProjectPolicy(target);
    const path = join(target, 'PROJECT.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('Gate profile: light', 'Gate profile: bogus'));
    install(target, ['--upgrade']);
    const state = readFileSync(join(target, 'shared', 'state.template.md'), 'utf8');
    // check-gates exits 3 on an unknown profile, so writing one through would hand the user a
    // template that cannot pass its own gate. Fall back to the shipped default instead.
    assert.match(state, /\*\*Profile:\*\*\s*standard/, 'a bogus profile must not reach state.template.md');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// PROJECT.md is hand-editable, so its value lines are untrusted input to whatever substitutes them.
// `awk -v x=VALUE` applies escape-sequence processing to VALUE: with `-v`, a reviewer label
// containing `C:\tmp\new` became `C:<TAB>mp` + a line break, corrupting models.md. ENVIRON[] is
// taken literally. The profile is metacharacter-proof by a different route — a `standard|light`
// allowlist before it reaches sed.
test('a hostile reviewer label survives byte-for-byte through both installers', () => {
  const HOSTILE = String.raw`claude (\`C:\tmp\new\` & 100% | $HOME · "q" \\ ^caret & sed\1)`;
  const targets = [];
  try {
    const sh = freshTarget('cf-wiz-meta-sh-');
    targets.push(sh);
    install(sh);
    const path = join(sh, 'PROJECT.md');
    // Replacement via function: a string replacement would itself process `\t`/`\n` and make the
    // fixture assert nothing (this exact trap produced a false positive while developing the fix).
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^Default reviewer\(s\):.*$/m, () => `Default reviewer(s): ${HOSTILE}`));
    install(sh, ['--upgrade']);

    const shModels = readFileSync(join(sh, 'shared', 'rules', 'models.md'), 'utf8');
    assert.ok(shModels.includes(HOSTILE), `install.sh mangled the value:\n${shModels.match(/^Default reviewer.*$/m)?.[0]}`);

    if (hasPwsh) {
      const ps = freshTarget('cf-wiz-meta-ps-');
      targets.push(ps);
      installPs1(ps);
      writeFileSync(join(ps, 'PROJECT.md'), readFileSync(path, 'utf8'));
      installPs1(ps, ['-Upgrade']);
      const psModels = readFileSync(join(ps, 'shared', 'rules', 'models.md'), 'utf8');
      assert.ok(psModels.includes(HOSTILE), 'install.ps1 mangled the value');
      // Parity here is SEMANTIC, not byte-exact: `Set-Content` re-serializes with the platform EOL,
      // so on a Windows runner ps1 emits CRLF while bash emits LF. Comparing raw bytes would fail
      // in Windows CI for a difference that carries no meaning — every reader in the repo strips
      // `\r`. Normalise, and let the content comparison do the work.
      const eol = (s) => s.replace(/\r\n/g, '\n');
      assert.equal(eol(psModels), eol(shModels), 'sh and ps1 disagree on the re-rendered models.md');
    }
  } finally {
    for (const t of targets) rmSync(t, { recursive: true, force: true });
  }
});

test('install.ps1 --upgrade re-renders the managed files from PROJECT.md (parity)', { skip: !hasPwsh ? 'pwsh not installed' : false }, () => {
  const target = freshTarget('cf-wiz-ps1-');
  try {
    installPs1(target);
    seedProjectPolicy(target);
    installPs1(target, ['-Upgrade']);
    assertPolicyPreserved(target, 'install.ps1 -Upgrade');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('the wizard writes its answers into PROJECT.md, not only into the managed files', async () => {
  const { applyAll } = await import(join(REPO, 'cli', 'lib', 'apply.mjs'));
  const target = freshTarget('cf-wiz-apply-');
  try {
    install(target);
    applyAll(target, {
      models: { claude: { model: 'claude-opus-5', effort: 'high' } },
      reviewers: ['claude'],
      council: ['claude'],
      profile: 'light',
      project: {},
      claude: {},
    });
    const project = readFileSync(join(target, 'PROJECT.md'), 'utf8');
    assert.match(project, /^## Review policy$/m, 'wizard must keep the Review policy section');
    assert.match(project, /Default reviewer\(s\):.*claude/, 'reviewer choice must be persisted in PROJECT.md');
    assert.match(project, /Gate profile:\s*light/, 'gate profile must be persisted in PROJECT.md');

    // And the derived files must reflect it immediately, without needing a re-install.
    assertPolicyPreserved(target, 'applyAll');

    // The real regression: an upgrade after the wizard keeps the choices.
    install(target, ['--upgrade']);
    assertPolicyPreserved(target, 'applyAll then --upgrade');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

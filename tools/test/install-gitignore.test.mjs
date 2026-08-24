import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const START = '# codeforge:generated:start';
const END = '# codeforge:generated:end';
const GENERATED = [
  '.claude/settings.json',
  '.claude/skills/',
  '.claude/agents/codeforge-implementer.md',
  '.agents/skills/',
  '.codex/config.toml',
  '.codex/agents/codeforge-implementer.toml',
  '/opencode.json',
];
const ENGINE_DIRS = ['.claude/', '.agents/', '.codex/'];
const CONTEXT = ['CLAUDE.md', 'AGENTS.md', 'PROJECT.md', 'CONTINUITY.md', 'docs/', '.codeforge/'];

const hasPwsh = (() => { try { execFileSync('pwsh', ['-v'], { stdio: 'pipe' }); return true; } catch { return false; } })();
const pwshPath = hasPwsh
  ? (process.platform === 'win32'
      ? execFileSync('where.exe', ['pwsh'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean)
      : execFileSync('/bin/sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).trim())
  : null;
const pwshOnlyPath = pwshPath ? dirname(pwshPath) : null;
const pwshOnlyHasGit = pwshPath
  ? spawnSync(pwshPath, ['-NoProfile', '-Command', 'if (Get-Command git -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }'], {
      env: { ...process.env, PATH: pwshOnlyPath },
    }).status === 0
  : false;

function runSh(target, ...args) {
  return execFileSync('bash', [join(REPO, 'install.sh'), target, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function runPs1(target, ...args) {
  return execFileSync('pwsh', ['-NoProfile', '-File', join(REPO, 'install.ps1'), target, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function lines(target) {
  return readFileSync(join(target, '.gitignore'), 'utf8').split(/\r?\n/);
}

function exactCount(target, value) {
  return lines(target).filter((line) => line === value).length;
}

function assertManagedOnce(target) {
  const contents = lines(target);
  const start = contents.indexOf(START);
  const end = contents.indexOf(END);
  assert.equal(exactCount(target, START), 1, 'one managed start marker');
  assert.equal(exactCount(target, END), 1, 'one managed end marker');
  assert.ok(start >= 0 && end > start, 'managed start precedes managed end');
  assert.ok(contents.slice(start + 1, end).includes('.codeforge/workflow/'), 'managed paths stay inside the block');
  assert.equal(exactCount(target, '.codeforge/workflow/'), 1, 'volatile workflow state is ignored once');
}

function assertPolicy(target, policy) {
  assertManagedOnce(target);
  const contents = lines(target);
  for (const path of GENERATED) {
    assert.equal(contents.includes(path), policy === 'ignored', `${path} matches ${policy} policy`);
  }
  for (const path of ENGINE_DIRS) {
    assert.equal(contents.includes(path), false, `${path} is not ignored wholesale`);
  }
  for (const path of CONTEXT) {
    assert.equal(contents.includes(path), false, `${path} remains trackable`);
  }
  assert.match(readFileSync(join(target, '.codeforge/manifest'), 'utf8'), new RegExp(`^generated:${policy}\\r?$`, 'm'));
}

test('install.sh creates .gitignore before git init and tracks generated adapters by default', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-default-'));
  try {
    runSh(target);
    assert.equal(existsSync(join(target, '.git')), false, 'fixture remains a non-git directory');
    assert.equal(existsSync(join(target, '.gitignore')), true, '.gitignore is still created');
    assertPolicy(target, 'tracked');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh --ignore-generated ignores only regenerable engine adapters', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ignore-'));
  try {
    mkdirSync(join(target, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(target, '.codex', 'agents'), { recursive: true });
    writeFileSync(join(target, '.claude', 'agents', 'custom.md'), 'custom claude agent\n');
    writeFileSync(join(target, '.codex', 'agents', 'custom.toml'), 'custom codex agent\n');
    execFileSync('git', ['init', '-q', '.'], { cwd: target, stdio: 'pipe' });
    runSh(target, '--ignore-generated');
    assertPolicy(target, 'ignored');
    for (const path of ['.claude/agents/custom.md', '.codex/agents/custom.toml']) {
      const ignored = spawnSync('git', ['check-ignore', '-q', path], { cwd: target });
      assert.equal(ignored.status, 1, `${path} is project-owned and must remain trackable`);
    }
    mkdirSync(join(target, 'packages', 'app'), { recursive: true });
    writeFileSync(join(target, 'packages', 'app', 'opencode.json'), '{}\n');
    assert.equal(spawnSync('git', ['check-ignore', '-q', 'opencode.json'], { cwd: target }).status, 0, 'root adapter is ignored');
    assert.equal(spawnSync('git', ['check-ignore', '-q', 'packages/app/opencode.json'], { cwd: target }).status, 1, 'nested project config remains trackable');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh recognizes an existing CRLF managed block instead of duplicating it', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-crlf-'));
  try {
    runSh(target);
    const path = join(target, '.gitignore');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
    runSh(target, '--ignore-generated');
    assertPolicy(target, 'ignored');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh JSON-escapes ancestor instruction paths', { skip: process.platform === 'win32' ? 'control characters are illegal in Windows paths' : false }, () => {
  const parent = mkdtempSync(join(tmpdir(), 'cf-json-"quote-\\slash-\tcontrol-\nline-'));
  const target = join(parent, 'target');
  try {
    mkdirSync(target);
    writeFileSync(join(parent, 'CLAUDE.md'), '# ancestor\n');
    runSh(target);
    const parsed = JSON.parse(readFileSync(join(target, '.claude', 'settings.local.json'), 'utf8'));
    assert.deepEqual(parsed.claudeMdExcludes, [join(parent, 'CLAUDE.md')]);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('install.sh rejects a malformed managed block before mutating the target', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-preflight-'));
  try {
    const originalClaude = '# Existing project instructions\n';
    writeFileSync(join(target, 'CLAUDE.md'), originalClaude);
    const malformed = `${START}\ndist/\n`;
    writeFileSync(join(target, '.gitignore'), malformed);

    assert.throws(() => runSh(target), /Command failed/);
    assert.equal(readFileSync(join(target, 'CLAUDE.md'), 'utf8'), originalClaude);
    assert.equal(readFileSync(join(target, '.gitignore'), 'utf8'), malformed);
    assert.equal(existsSync(join(target, '.codeforge')), false, 'canonical source is not created');
    assert.equal(existsSync(join(target, 'PROJECT.md')), false, 'project context is not created');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh warns when ignored generated adapters are already tracked without changing the index', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-tracked-warning-'));
  try {
    execFileSync('git', ['init', '-q', '.'], { cwd: target, stdio: 'pipe' });
    runSh(target);
    execFileSync('git', ['add', '-A'], { cwd: target, stdio: 'pipe' });

    const output = runSh(target, '--ignore-generated');
    const tracked = execFileSync('git', ['ls-files'], { cwd: target, encoding: 'utf8' });
    assert.match(tracked, /^\.claude\/settings\.json$/m);
    assert.match(tracked, /^\.codex\/config\.toml$/m);
    assert.match(tracked, /^opencode\.json$/m);
    assert.match(output, /generated adapters are ignored for new Git additions, but \d+ path\(s\) are already tracked/);
    assert.match(output, /git rm -r --cached --ignore-unmatch --/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh preserves the prior generated policy on a bare reinstall', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-preserve-'));
  try {
    runSh(target, '--ignore-generated');
    runSh(target);
    assertPolicy(target, 'ignored');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh reads generated policy and prune entries from a CRLF manifest', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-manifest-crlf-'));
  try {
    runSh(target, '--ignore-generated');
    const manifest = join(target, '.codeforge', 'manifest');
    writeFileSync(join(target, '.codeforge', 'rules', 'ghost.md'), 'ghost\n');
    writeFileSync(manifest, `${readFileSync(manifest, 'utf8')}rule:ghost.md\n`.replace(/\n/g, '\r\n'));
    runSh(target);
    assertPolicy(target, 'ignored');
    assert.equal(existsSync(join(target, '.codeforge', 'rules', 'ghost.md')), false);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh can switch back to tracked and preserves user gitignore rules', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-switch-'));
  try {
    writeFileSync(join(target, '.gitignore'), 'dist/'); // deliberately no trailing newline
    runSh(target, '--ignore-generated');
    writeFileSync(join(target, '.gitignore'), `${readFileSync(join(target, '.gitignore'), 'utf8')}custom-cache/\n`);
    runSh(target, '--track-generated');
    assertPolicy(target, 'tracked');
    assert.ok(lines(target).includes('dist/'), 'pre-existing user rule survives');
    assert.ok(lines(target).includes('custom-cache/'), 'user rule added after the managed block survives');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh rejects conflicting generated policy flags', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-conflict-'));
  try {
    assert.throws(() => runSh(target, '--ignore-generated', '--track-generated'), /Command failed/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1 supports ignored policy and creates .gitignore without git', { skip: hasPwsh ? false : 'pwsh not available' }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-ignore-'));
  try {
    runPs1(target, '-IgnoreGenerated');
    assert.equal(existsSync(join(target, '.git')), false);
    assertPolicy(target, 'ignored');
    execFileSync('git', ['init', '-q', '.'], { cwd: target, stdio: 'pipe' });
    mkdirSync(join(target, 'packages', 'app'), { recursive: true });
    writeFileSync(join(target, 'packages', 'app', 'opencode.json'), '{}\n');
    assert.equal(spawnSync('git', ['check-ignore', '-q', 'opencode.json'], { cwd: target }).status, 0, 'root adapter is ignored');
    assert.equal(spawnSync('git', ['check-ignore', '-q', 'packages/app/opencode.json'], { cwd: target }).status, 1, 'nested project config remains trackable');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1 degrades cleanly without git and rejects -GitInit clearly', {
  skip: !hasPwsh ? 'pwsh not available' : pwshOnlyHasGit ? 'git shares the PowerShell runtime directory' : false,
}, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-no-git-'));
  try {
    const base = ['-NoProfile', '-File', join(REPO, 'install.ps1'), target];
    const normal = spawnSync(pwshPath, base, {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, PATH: pwshOnlyPath },
    });
    assert.equal(normal.status, 0, normal.stderr);
    assert.match(normal.stdout, /git was not found/i);

    const required = spawnSync(pwshPath, [...base, '-GitInit'], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, PATH: pwshOnlyPath },
    });
    assert.equal(required.status, 2, required.stderr);
    assert.match(required.stderr, /requires git on PATH/i);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1 preserves policy, switches it, and keeps user rules', { skip: hasPwsh ? false : 'pwsh not available' }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-switch-'));
  try {
    writeFileSync(join(target, '.gitignore'), 'dist/\n');
    runPs1(target, '-IgnoreGenerated');
    runPs1(target);
    assertPolicy(target, 'ignored');
    runPs1(target, '-TrackGenerated');
    assertPolicy(target, 'tracked');
    assert.ok(lines(target).includes('dist/'));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1 rejects a malformed managed block before mutating the target', { skip: hasPwsh ? false : 'pwsh not available' }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-preflight-'));
  try {
    const originalClaude = '# Existing project instructions\n';
    writeFileSync(join(target, 'CLAUDE.md'), originalClaude);
    const malformed = `${START}\ndist/\n`;
    writeFileSync(join(target, '.gitignore'), malformed);

    assert.throws(() => runPs1(target), /Command failed/);
    assert.equal(readFileSync(join(target, 'CLAUDE.md'), 'utf8'), originalClaude);
    assert.equal(readFileSync(join(target, '.gitignore'), 'utf8'), malformed);
    assert.equal(existsSync(join(target, '.codeforge')), false, 'canonical source is not created');
    assert.equal(existsSync(join(target, 'PROJECT.md')), false, 'project context is not created');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1 rejects conflicting generated policy flags', { skip: hasPwsh ? false : 'pwsh not available' }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-conflict-'));
  try {
    let error;
    try { runPs1(target, '-IgnoreGenerated', '-TrackGenerated'); } catch (caught) { error = caught; }
    assert.ok(error, 'conflicting flags should fail');
    assert.equal(error.status, 2);
    assert.equal(existsSync(join(target, '.gitignore')), false);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh preserves CRLF user lines outside its managed block', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-crlf-user-'));
  try {
    writeFileSync(join(target, '.gitignore'), 'dist/\r\ncache/\r\n');
    runSh(target, '--ignore-generated');
    assert.ok(readFileSync(join(target, '.gitignore')).subarray(0, 15).equals(Buffer.from('dist/\r\ncache/\r\n')));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1 warns when ignored generated adapters are already tracked without changing the index', { skip: hasPwsh ? false : 'pwsh not available' }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-tracked-warning-'));
  try {
    execFileSync('git', ['init', '-q', '.'], { cwd: target, stdio: 'pipe' });
    runPs1(target);
    execFileSync('git', ['add', '-A'], { cwd: target, stdio: 'pipe' });

    const output = runPs1(target, '-IgnoreGenerated');
    const tracked = execFileSync('git', ['ls-files'], { cwd: target, encoding: 'utf8' });
    assert.match(tracked, /^\.claude\/settings\.json$/m);
    assert.match(tracked, /^\.codex\/config\.toml$/m);
    assert.match(tracked, /^opencode\.json$/m);
    assert.match(output, /generated adapters are ignored for new Git additions, but \d+ path\(s\) are already tracked/);
    assert.match(output, /git rm -r --cached --ignore-unmatch --/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

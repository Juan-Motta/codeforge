import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function countWorkflowIgnores(gitignorePath) {
  return readFileSync(gitignorePath, 'utf8').split('\n').filter((l) => l.trim() === '.workflow/').length;
}

// Strict (untrimmed) count — used where the fixture deliberately seeds near-miss lines (leading
// space, wrong case) that would trim-equal '.workflow/' and so must NOT be conflated with it.
function countExactWorkflowLines(gitignorePath) {
  return readFileSync(gitignorePath, 'utf8').split('\n').filter((l) => l === '.workflow/').length;
}

// Derive the EXACT marker line from install.sh so the seed byte-matches (em-dash included) — a
// mismatched marker would make the RED step vacuous (installer treats marker as absent and writes
// .workflow/ anyway, hiding the fix).
function codeforgeMarker() {
  const sh = readFileSync(join(REPO, 'install.sh'), 'utf8');
  const m = sh.match(/# codeforge \(local state[^\n']*/);
  assert.ok(m, 'could not find the codeforge gitignore marker in install.sh');
  return m[0];
}

// Per Appendix "per-installer marker robustness": derive the ps1 seed marker from install.ps1
// itself, so a future divergence between the two markers doesn't make the ps1 RED vacuous.
function codeforgeMarkerPs1() {
  const ps1 = readFileSync(join(REPO, 'install.ps1'), 'utf8');
  const m = ps1.match(/# codeforge \(local state[^\n']*/);
  assert.ok(m, 'could not find the codeforge gitignore marker in install.ps1');
  return m[0];
}

const hasPwsh = (() => { try { execFileSync('pwsh', ['-v'], { stdio: 'pipe' }); return true; } catch { return false; } })();

test('install.sh restores .workflow/ when the marker exists but the entry was removed', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-sh-'));
  try {
    writeFileSync(join(target, '.gitignore'), codeforgeMarker() + '\n.DS_Store\n.claude/settings.local.json\n');
    execFileSync('bash', [join(REPO, 'install.sh'), target], { cwd: REPO, stdio: 'pipe' });
    assert.equal(countWorkflowIgnores(join(target, '.gitignore')), 1, '.workflow/ present exactly once');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh fresh install then re-install yields .workflow/ exactly once (no double-append)', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-fresh-'));
  try {
    execFileSync('bash', [join(REPO, 'install.sh'), target], { cwd: REPO, stdio: 'pipe' }); // fresh
    execFileSync('bash', [join(REPO, 'install.sh'), target], { cwd: REPO, stdio: 'pipe' }); // idempotent re-run
    assert.equal(countWorkflowIgnores(join(target, '.gitignore')), 1, 'no duplicate .workflow/ across installs');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh: no-trailing-newline seed gets .workflow/ on its own line, exactly once', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-nonl-'));
  try {
    // Marker present, .workflow/ absent, and the file's last byte is NOT a newline — proves the
    // append is newline-safe (doesn't fuse .workflow/ onto the previous line).
    const seed = codeforgeMarker() + '\n.DS_Store\n.claude/settings.local.json';
    writeFileSync(join(target, '.gitignore'), seed);
    assert.notEqual(seed[seed.length - 1], '\n', 'seed fixture must not end in a newline');
    execFileSync('bash', [join(REPO, 'install.sh'), target], { cwd: REPO, stdio: 'pipe' });
    const contents = readFileSync(join(target, '.gitignore'), 'utf8');
    const lines = contents.split('\n');
    assert.ok(lines.includes('.workflow/'), '.workflow/ appears as its own line (not fused)');
    assert.equal(countWorkflowIgnores(join(target, '.gitignore')), 1, '.workflow/ present exactly once');
    // Guard against fusion explicitly: no line should contain .workflow/ glued onto other content.
    for (const line of lines) {
      if (line.includes('.workflow/')) {
        assert.equal(line.trim(), '.workflow/', `.workflow/ must not be fused onto other content: ${JSON.stringify(line)}`);
      }
    }
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1 restores .workflow/ when the marker exists but the entry was removed', { skip: hasPwsh ? false : 'pwsh not available' }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-'));
  try {
    writeFileSync(join(target, '.gitignore'), codeforgeMarkerPs1() + '\n.DS_Store\n.claude/settings.local.json\n');
    execFileSync('pwsh', ['-File', join(REPO, 'install.ps1'), target], { cwd: REPO, stdio: 'pipe' });
    assert.equal(countWorkflowIgnores(join(target, '.gitignore')), 1, '.workflow/ present exactly once (ps1)');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1: near-miss lines (leading space / wrong case) do not suppress the exact entry', { skip: hasPwsh ? false : 'pwsh not available' }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-nearmiss-'));
  try {
    // Marker present + near-miss lines that a sloppy match (`.Trim()`/`-eq`/SimpleMatch) would
    // treat as "already ignored" — but no EXACT `.workflow/` line. The `-ceq` guard must still append it.
    const seed = codeforgeMarkerPs1() + '\n.DS_Store\n .workflow/\n.WORKFLOW/\n.claude/settings.local.json\n';
    writeFileSync(join(target, '.gitignore'), seed);
    execFileSync('pwsh', ['-File', join(REPO, 'install.ps1'), target], { cwd: REPO, stdio: 'pipe' });
    const contents = readFileSync(join(target, '.gitignore'), 'utf8');
    assert.ok(contents.includes(' .workflow/'), 'the leading-space near-miss line is left untouched');
    assert.ok(contents.includes('.WORKFLOW/'), 'the wrong-case near-miss line is left untouched');
    assert.equal(countExactWorkflowLines(join(target, '.gitignore')), 1, 'exact .workflow/ appended despite near-miss lines');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1 fresh install then re-install yields .workflow/ exactly once (no double-append)', { skip: hasPwsh ? false : 'pwsh not available' }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-fresh-'));
  try {
    execFileSync('pwsh', ['-File', join(REPO, 'install.ps1'), target], { cwd: REPO, stdio: 'pipe' }); // fresh
    execFileSync('pwsh', ['-File', join(REPO, 'install.ps1'), target], { cwd: REPO, stdio: 'pipe' }); // idempotent re-run
    assert.equal(countWorkflowIgnores(join(target, '.gitignore')), 1, 'no duplicate .workflow/ across ps1 installs');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

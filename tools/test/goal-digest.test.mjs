import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, chmodSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = fileURLToPath(new URL('../../src/codeforge/scripts/goal-digest.sh', import.meta.url));
const hasSh = spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0;
const WIN = process.platform === 'win32';
const G = { skip: !hasSh };
const fileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex'); // portable (no `shasum` on Windows)

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'goaldig-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t.co'); git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'seed.txt'), 'seed\n'); git('add', '.'); git('commit', '-qm', 'base');
  return { dir, base: git('rev-parse', 'HEAD').toString().trim(), git };
}
const dg = (dir, base, ...x) => execFileSync('sh', [SH, base, dir, ...x], { cwd: dir }).toString().trim();

test('64-hex + deterministic', G, () => {
  const { dir, base } = initRepo(); writeFileSync(join(dir, 'seed.txt'), 'seed\nX\n');
  const d = dg(dir, base); assert.match(d, /^[0-9a-f]{64}$/); assert.equal(d, dg(dir, base));
});

test('index-state invariance: untracked == staged == committed(--from-head)', G, () => {
  const { dir, base, git } = initRepo();
  writeFileSync(join(dir, 'new.txt'), 'content\n');
  const untracked = dg(dir, base);
  git('add', 'new.txt'); assert.equal(dg(dir, base), untracked);
  git('commit', '-qm', 'c'); assert.equal(dg(dir, base, '--from-head'), untracked);
});

test('invariance holds with modify+add together', G, () => {
  const { dir, base, git } = initRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nmod\n');
  writeFileSync(join(dir, 'a.txt'), 'add\n');
  const before = dg(dir, base);
  git('add', '-A'); assert.equal(dg(dir, base), before);
});

test('excluded path is digest-neutral; in-scope change moves it', G, () => {
  const { dir, base } = initRepo(); const before = dg(dir, base);
  mkdirSync(join(dir, '.codeforge/workflow'), { recursive: true });
  writeFileSync(join(dir, '.codeforge/workflow', 'state.md'), 'noise\n'); assert.equal(dg(dir, base), before);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nY\n'); assert.notEqual(dg(dir, base), before);
});

test('positive controls: package.json, empty add, plan doc all move the digest', G, () => {
  const { dir, base } = initRepo();
  const b0 = dg(dir, base);
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n'); const b1 = dg(dir, base); assert.notEqual(b1, b0);
  writeFileSync(join(dir, 'empty.txt'), '');                    const b2 = dg(dir, base); assert.notEqual(b2, b1);
  mkdirSync(join(dir, 'docs', 'plans'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'plans', 'p.md'), 'plan\n');  const b3 = dg(dir, base); assert.notEqual(b3, b2);
});

test('executable-bit change moves the digest', { skip: !hasSh || WIN }, () => {  // git filemode is off on Windows
  const { dir, base, git } = initRepo();
  writeFileSync(join(dir, 'run.sh'), '#!/bin/sh\n'); git('add', '.'); git('commit', '-qm', 'x');
  const before = dg(dir, base); chmodSync(join(dir, 'run.sh'), 0o755);
  assert.notEqual(dg(dir, base), before);
});

test('rename moves the digest (--no-renames)', G, () => {
  const { dir, base, git } = initRepo(); const before = dg(dir, base);
  git('mv', 'seed.txt', 'renamed.txt'); assert.notEqual(dg(dir, base), before);
});

test('symlink and leading-dash untracked are bound (present != absent), crash-free', G, () => {
  const { dir, base } = initRepo(); const before = dg(dir, base);
  writeFileSync(join(dir, '-weird.txt'), 'dash\n'); const d1 = dg(dir, base); assert.notEqual(d1, before);
  symlinkSync('seed.txt', join(dir, 'link'));       const d2 = dg(dir, base); assert.notEqual(d2, d1);
});

test('linked worktree: digest works and the real index is byte-unchanged', G, () => {
  const { dir, base, git } = initRepo();
  const wt = mkdtempSync(join(tmpdir(), 'goalwt-'));
  const idxBefore = fileSha(join(dir, '.git', 'index'));
  git('worktree', 'add', '-q', wt, 'HEAD');
  writeFileSync(join(wt, 'w.txt'), 'in-worktree\n');
  const d = execFileSync('sh', [SH, base, wt], { cwd: wt }).toString().trim();
  assert.match(d, /^[0-9a-f]{64}$/);
  const idxAfter = fileSha(join(dir, '.git', 'index'));
  assert.equal(idxAfter, idxBefore);
});

test('bad base sha exits 3; empty base exits 3', G, () => {
  const { dir } = initRepo();
  assert.equal(spawnSync('sh', [SH, 'deadbeefdeadbeef', dir], { cwd: dir }).status, 3);
  assert.equal(spawnSync('sh', [SH, '', dir], { cwd: dir }).status, 3);
});

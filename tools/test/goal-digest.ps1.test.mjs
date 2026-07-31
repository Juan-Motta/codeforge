import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SH  = fileURLToPath(new URL('../../src/codeforge/scripts/goal-digest.sh',  import.meta.url));
const PS1 = fileURLToPath(new URL('../../src/codeforge/scripts/goal-digest.ps1', import.meta.url));
const hasSh   = spawnSync('sh',   ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0;
const hasPwsh = spawnSync('pwsh', ['-v'],           { stdio: 'ignore' }).status === 0;

test('ps1 == sh across mixed-case, non-ASCII, invalid-UTF-8, wildcard, spaces', { skip: !(hasSh && hasPwsh) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'goal digp-'));   // space in repo path
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t.co'); git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'seed.txt'), 'seed\n'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').toString().trim();
  writeFileSync(join(dir, 'Foo.txt'), 'A\n');
  writeFileSync(join(dir, 'bar.txt'), 'café ☕\n');
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([0x89, 0xff, 0xfe, 0x00, 0x41]));  // invalid UTF-8
  mkdirSync(join(dir, 'app', '[id]'), { recursive: true });
  writeFileSync(join(dir, 'app', '[id]', 'page.txt'), 'wild\n');
  const sh  = execFileSync('sh',   [SH,  base, dir], { cwd: dir }).toString().trim();
  const ps1 = execFileSync('pwsh', ['-NoProfile', '-File', PS1, base, dir], { cwd: dir }).toString().trim();
  assert.equal(ps1, sh);
});

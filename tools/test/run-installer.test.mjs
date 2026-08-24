import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeInstallerRun, runInstaller } from '../../cli/lib/run-installer.mjs';

test('POSIX runs bash install.sh with args verbatim', () => {
  const calls = [];
  const spawn = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  const r = runInstaller('/pkg', ['/tmp/x', '--ignore-generated'], { platform: 'linux', spawn });
  assert.equal(r.cmd, 'bash');
  assert.deepEqual(r.cmdArgs, ['/pkg/install.sh', '/tmp/x', '--ignore-generated']);
  assert.equal(r.status, 0);
});

test('Windows runs pwsh install.ps1 with translated switches', () => {
  const spawn = () => ({ status: 0 });
  const r = runInstaller('C:\\pkg', ['C:\\x', '--ignore-generated', '--track-generated'], { platform: 'win32', spawn });
  assert.equal(r.cmd, 'pwsh');
  assert.ok(r.cmdArgs.includes('-IgnoreGenerated'));
  assert.ok(r.cmdArgs.includes('-TrackGenerated'));
  assert.ok(r.cmdArgs.some((a) => a.endsWith('install.ps1')));
});

test('interactive completion applies config exactly once on installer success', () => {
  let calls = 0;
  const result = finalizeInstallerRun({ status: 0 }, () => { calls += 1; });
  assert.deepEqual(result, { status: 0 });
  assert.equal(calls, 1);
});

test('interactive completion fails when post-install config cannot be applied', () => {
  const applyError = new Error('cannot update PROJECT.md');
  const result = finalizeInstallerRun({ status: 0 }, () => { throw applyError; });
  assert.equal(result.status, 1);
  assert.equal(result.applyError, applyError);
});

test('interactive completion treats a missing installer status as failure', () => {
  let applied = false;
  const result = finalizeInstallerRun({ status: null }, () => { applied = true; });
  assert.equal(result.status, 1);
  assert.equal(applied, false);
});

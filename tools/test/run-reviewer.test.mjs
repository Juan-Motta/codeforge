import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(REPO, 'src', 'codeforge', 'scripts', 'run-reviewer.mjs');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cf-reviewer-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const fake = join(bin, 'fake-reviewer.mjs');
  writeFileSync(fake, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const mode = process.env.CODEFORGE_FAKE_MODE || 'success';
if (args[0] === 'auth' && args[1] === 'status') {
  if (mode === 'auth-failure') {
    process.stdout.write('{"loggedIn":false,"authMethod":"none"}\\n');
    process.exit(1);
  }
  if (mode === 'auth-unsupported') {
    process.stderr.write('unknown command: auth\\n');
    process.exit(1);
  }
  process.stdout.write('{"loggedIn":true,"authMethod":"test"}\\n');
  process.exit(0);
}
else if (mode === 'timeout') setTimeout(() => {}, 30000);
else if (mode === 'failure') { process.stderr.write('review failed\\n'); process.exit(7); }
else if (mode === 'empty') process.exit(0);
else {
  let prompt = '';
  const fileAt = args.indexOf('--file');
  if (fileAt >= 0) prompt = readFileSync(args[fileAt + 1], 'utf8');
  else prompt = readFileSync(0, 'utf8');
  const outputAt = args.indexOf('--output-last-message');
  const result = 'REVIEW:' + prompt;
  if (outputAt >= 0) writeFileSync(args[outputAt + 1], result);
  else process.stdout.write(result);
}
`);
  chmodSync(fake, 0o755);
  for (const name of ['codex', 'claude', 'opencode']) {
    if (process.platform === 'win32') {
      writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "%~dp0fake-reviewer.mjs" %*\r\n`);
    } else {
      writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
      chmodSync(join(bin, name), 0o755);
    }
  }
  return { root, bin };
}

function run(root, bin, overrides = {}) {
  const prompt = overrides.prompt ?? join(root, 'prompt.txt');
  const stdout = overrides.stdout ?? join(root, 'workflow', 'review.out');
  const stderr = overrides.stderr ?? join(root, 'workflow', 'review.err');
  if (overrides.createPrompt !== false && !existsSync(prompt)) writeFileSync(prompt, 'inspect this');
  const args = [
    RUNNER,
    '--engine', overrides.engine || 'claude',
    '--model', 'test-model',
    '--effort', 'high',
    '--prompt-file', prompt,
    '--stdout-file', stdout,
    '--stderr-file', stderr,
    '--timeout-seconds', String(overrides.timeout || 5),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      PATH: overrides.path ?? `${bin}${delimiter}${process.env.PATH || ''}`,
      CODEFORGE_FAKE_MODE: overrides.mode || 'success',
    },
  });
  return { result, prompt, stdout, stderr };
}

test('captures successful reviewer output for every engine without shell interpolation', () => {
  for (const engine of ['claude', 'codex', 'opencode']) {
    const { root, bin } = fixture();
    try {
      const sentinel = join(root, 'SHOULD_NOT_EXIST');
      const literal = `literal $(touch ${sentinel}) and \`touch ${sentinel}\``;
      writeFileSync(join(root, 'prompt.txt'), literal);
      const { result, stdout, stderr } = run(root, bin, { engine });
      assert.equal(result.status, 0, `${engine}: ${result.stderr}`);
      assert.equal(readFileSync(stdout, 'utf8'), `REVIEW:${literal}`);
      assert.equal(readFileSync(stderr, 'utf8'), '');
      assert.equal(existsSync(sentinel), false, `${engine} prompt was interpreted by a shell`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('returns distinct failures for timeout, reviewer failure, and empty output', () => {
  for (const [mode, expected] of [['timeout', 11], ['failure', 12], ['empty', 13]]) {
    const { root, bin } = fixture();
    try {
      const started = Date.now();
      const { result, stderr } = run(root, bin, { mode, timeout: 1 });
      assert.equal(result.status, expected, `${mode}: ${result.stderr}`);
      assert.ok(Date.now() - started < 8000, `${mode} did not remain bounded`);
      if (mode === 'timeout') assert.match(readFileSync(stderr, 'utf8'), /timed out after 1 seconds/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('returns launch failure when the configured reviewer executable is absent', () => {
  const { root, bin } = fixture();
  try {
    const emptyPath = join(root, 'empty-path');
    mkdirSync(emptyPath);
    const { result, stderr } = run(root, bin, { engine: 'codex', path: emptyPath });
    assert.equal(result.status, 10, result.stderr);
    assert.match(readFileSync(stderr, 'utf8'), /(ENOENT|not found)/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports a missing Claude executable as launch failure, not authentication failure', () => {
  const { root, bin } = fixture();
  try {
    const emptyPath = join(root, 'empty-path');
    mkdirSync(emptyPath);
    const { result, stderr } = run(root, bin, { engine: 'claude', path: emptyPath });
    assert.equal(result.status, 10, result.stderr);
    assert.match(readFileSync(stderr, 'utf8'), /(launch|ENOENT|not found)/i);
    assert.doesNotMatch(readFileSync(stderr, 'utf8'), /claude auth login/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails fast with setup guidance when Claude is not authenticated', () => {
  const { root, bin } = fixture();
  try {
    const started = Date.now();
    const { result, stdout, stderr } = run(root, bin, { engine: 'claude', mode: 'auth-failure' });
    assert.equal(result.status, 14, result.stderr);
    assert.ok(Date.now() - started < 5000, 'authentication preflight did not fail fast');
    assert.equal(readFileSync(stdout, 'utf8'), '');
    assert.match(readFileSync(stderr, 'utf8'), /claude auth login/i);
    assert.match(readFileSync(stderr, 'utf8'), /"loggedIn":false/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not misreport an unsupported Claude auth command as signed out', () => {
  const { root, bin } = fixture();
  try {
    const { result, stderr } = run(root, bin, { engine: 'claude', mode: 'auth-unsupported' });
    assert.equal(result.status, 10, result.stderr);
    assert.match(readFileSync(stderr, 'utf8'), /could not evaluate Claude authentication status/i);
    assert.doesNotMatch(readFileSync(stderr, 'utf8'), /claude auth login/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects missing or aliased prompt files as usage errors before launch', () => {
  const { root, bin } = fixture();
  try {
    const missing = run(root, bin, {
      engine: 'codex',
      prompt: join(root, 'missing.prompt'),
      createPrompt: false,
    });
    assert.equal(missing.result.status, 2, missing.result.stderr);
    assert.match(missing.result.stderr, /cannot read --prompt-file/i);

    const aliased = join(root, 'aliased.prompt');
    writeFileSync(aliased, 'must not be truncated');
    const collision = run(root, bin, { engine: 'claude', prompt: aliased, stdout: aliased });
    assert.equal(collision.result.status, 2, collision.result.stderr);
    assert.equal(readFileSync(aliased, 'utf8'), 'must not be truncated');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every classified failure replaces stale stdout', () => {
  for (const [engine, mode, expected] of [
    ['claude', 'auth-failure', 14],
    ['claude', 'failure', 12],
    ['claude', 'empty', 13],
    ['claude', 'timeout', 11],
  ]) {
    const { root, bin } = fixture();
    try {
      mkdirSync(join(root, 'workflow'), { recursive: true });
      writeFileSync(join(root, 'workflow', 'review.out'), 'STALE VERDICT\n');
      const { result, stdout } = run(root, bin, { engine, mode, timeout: 1 });
      assert.equal(result.status, expected);
      assert.equal(readFileSync(stdout, 'utf8'), '', `${mode} kept stale output`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

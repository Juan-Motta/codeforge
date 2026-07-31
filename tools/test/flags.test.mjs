import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasInstallIntent, installerFlags, nonInteractiveCommand } from '../../cli/lib/flags.mjs';
import { makeDefaultAnswers } from '../../cli/state.mjs';

test('hasInstallIntent is true for flags and targets, false for bare/--version', () => {
  assert.equal(hasInstallIntent(['--with-hooks']), true);
  assert.equal(hasInstallIntent(['./proj']), true);
  assert.equal(hasInstallIntent(['--yes']), true);
  assert.equal(hasInstallIntent([]), false);
  assert.equal(hasInstallIntent(['--version']), false);
  assert.equal(hasInstallIntent(['--help']), false);
});

test('installerFlags maps answers to install.sh args', () => {
  const a = { ...makeDefaultAnswers('/tmp/x'), withHooks: true, gitInit: true, noIsolate: false };
  assert.deepEqual(installerFlags(a), ['/tmp/x', '--git-init']);
});

test('installerFlags never emits --with-hooks (retired)', () => {
  const a = { target: '/x', withHooks: true, gitInit: false, noIsolate: false };
  assert.ok(!installerFlags(a).includes('--with-hooks'));
  assert.ok(!nonInteractiveCommand(a).includes('--with-hooks'));
});

test('--with-hooks is still install-intent (tolerated deprecated no-op)', () => {
  assert.equal(hasInstallIntent(['--with-hooks']), true);
});

test('nonInteractiveCommand emits only install.sh-valid tokens (no profile/reviewer)', () => {
  const a = { ...makeDefaultAnswers('/tmp/x'), profile: 'light' };
  const cmd = nonInteractiveCommand(a);
  assert.match(cmd, /npx @jualopezmo\/codeforge \/tmp\/x/);
  assert.match(cmd, /--yes/);
  // Review policy / profile have no non-interactive equivalent today — install.sh would
  // reject any of these tokens with exit 2, so they must never appear in the printed command.
  assert.doesNotMatch(cmd, /--profile=/);
  assert.doesNotMatch(cmd, /--reviewer=/);
  assert.doesNotMatch(cmd, /--default-reviewer=/);
  // The full command is exactly: npx @jualopezmo/codeforge <target> --yes [+ install flags]
  assert.equal(cmd, 'npx @jualopezmo/codeforge /tmp/x --yes');
});

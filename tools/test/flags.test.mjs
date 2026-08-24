import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installerFlags, nonInteractiveCommand } from '../../cli/lib/flags.mjs';
import { makeDefaultAnswers } from '../../cli/state.mjs';

test('installerFlags maps answers to install.sh args', () => {
  const a = { ...makeDefaultAnswers('/tmp/x'), gitInit: true, noIsolate: false };
  assert.deepEqual(installerFlags(a), ['/tmp/x', '--git-init', '--track-generated']);
});

test('installerFlags and reproducible command emit the selected generated policy', () => {
  const a = { ...makeDefaultAnswers('/tmp/x'), ignoreGenerated: true };
  assert.deepEqual(installerFlags(a), ['/tmp/x', '--ignore-generated']);
  assert.match(nonInteractiveCommand(a), /--ignore-generated$/);
});

test('nonInteractiveCommand emits only install.sh-valid tokens (no profile/reviewer)', () => {
  const a = { ...makeDefaultAnswers('/tmp/My Project'), profile: 'light' };
  const cmd = nonInteractiveCommand(a);
  assert.match(cmd, /npx @jualopezmo\/codeforge \. /);
  assert.match(cmd, /--yes/);
  // Review policy / profile have no non-interactive equivalent today — install.sh would
  // reject any of these tokens with exit 2, so they must never appear in the printed command.
  assert.doesNotMatch(cmd, /--profile=/);
  assert.doesNotMatch(cmd, /--reviewer=/);
  assert.doesNotMatch(cmd, /--default-reviewer=/);
  // The wizard always targets its current directory. Using `.` keeps the command portable
  // across POSIX and PowerShell even when the absolute path contains shell metacharacters.
  assert.equal(cmd, 'npx @jualopezmo/codeforge . --yes --track-generated');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { supportsNativeImplementationSubagents, wizardSteps } from '../../cli/lib/wizard-steps.mjs';

test('offers execution mode when Claude or Codex is installed', () => {
  for (const name of ['claude', 'codex']) {
    const engines = { claude: { installed: false }, codex: { installed: false } };
    engines[name].installed = true;
    assert.equal(supportsNativeImplementationSubagents(engines), true);
    assert.ok(wizardSteps(engines).includes('execution'));
  }
});

test('skips unsupported execution choice for OpenCode-only or empty environments', () => {
  const openCodeOnly = { opencode: { installed: true }, claude: { installed: false }, codex: { installed: false } };
  assert.equal(supportsNativeImplementationSubagents(openCodeOnly), false);
  assert.equal(wizardSteps(openCodeOnly).includes('execution'), false);
  assert.equal(wizardSteps({}).includes('execution'), false);
  assert.equal(wizardSteps(null).includes('execution'), false);
});

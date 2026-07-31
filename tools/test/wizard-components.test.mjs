import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import Summary from '../../cli/components/Summary.mjs';
import { makeDefaultAnswers } from '../../cli/state.mjs';

test('Summary shows the equivalent non-interactive command (defaults only, no profile)', () => {
  const answers = { ...makeDefaultAnswers('/tmp/x'), profile: 'light' };
  const { lastFrame } = render(React.createElement(Summary, { answers, onNext: () => {} }));
  assert.match(lastFrame(), /npx @jualopezmo\/codeforge/);
  // Profile/reviewer are wizard-only — install.sh has no non-interactive equivalent for
  // them, so the printed command must not claim one.
  assert.doesNotMatch(lastFrame(), /--profile=/);
  assert.match(lastFrame(), /wizard-only/); // phrase may wrap inside the card border
  // --with-hooks was retired from the wizard: Summary shows only the profile line,
  // never a separate Hooks line.
  assert.match(lastFrame(), /Profile:/);
  assert.doesNotMatch(lastFrame(), /Hooks:/);
});

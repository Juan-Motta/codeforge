import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import Summary from '../../cli/components/Summary.mjs';
import Execution, { withExecutionMode } from '../../cli/components/Execution.mjs';
import { defaultReviewerSelection } from '../../cli/components/ReviewPolicy.mjs';
import { makeDefaultAnswers } from '../../cli/state.mjs';

test('Summary shows the equivalent non-interactive command (defaults only, no profile)', () => {
  const answers = { ...makeDefaultAnswers('/tmp/x'), profile: 'light' };
  const { lastFrame } = render(React.createElement(Summary, { answers, onNext: () => {} }));
  assert.match(lastFrame(), /npx @jualopezmo\/codeforge/);
  // Profile/reviewer are wizard-only — install.sh has no non-interactive equivalent for
  // them, so the printed command must not claim one.
  assert.doesNotMatch(lastFrame(), /--profile=/);
  assert.match(lastFrame(), /wizard-only/); // phrase may wrap inside the card border
  // Hook configuration is not part of the current wizard surface.
  assert.match(lastFrame(), /Profile:/);
  assert.match(lastFrame(), /Generated adapters: tracked/);
  assert.match(lastFrame(), /--track-generated/);
  assert.doesNotMatch(lastFrame(), /Hooks:/);
});

test('Execution exposes and stores a project-wide native subagent strategy without pinning a model', () => {
  const initial = makeDefaultAnswers('/tmp/x');
  const { lastFrame } = render(React.createElement(Execution, {
    answers: initial,
    setAnswers: () => {},
    onNext: () => {},
    lang: 'en',
  }));
  assert.match(lastFrame(), /Subagent-driven/);
  const nextAnswers = withExecutionMode(initial, 'subagent-driven');
  assert.equal(nextAnswers.execution.mode, 'subagent-driven');
  assert.equal('model' in nextAnswers.execution, false);
});

test('reviewer defaults preserve cross-engine diversity without enabling a third engine implicitly', () => {
  assert.deepEqual(defaultReviewerSelection(['codex', 'claude', 'opencode']), ['codex', 'claude']);
  assert.deepEqual(defaultReviewerSelection(['codex', 'opencode']), ['codex', 'opencode']);
  assert.deepEqual(defaultReviewerSelection(['claude']), ['claude']);
});

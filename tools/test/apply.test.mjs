// tools/test/apply.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyModels, applyProfile, applyProject, applyExecution } from '../../cli/lib/apply.mjs';

function scaffoldTarget() {
  const dir = mkdtempSync(join(tmpdir(), 'cf-apply-'));
  mkdirSync(join(dir, '.codeforge', 'rules'), { recursive: true });
  writeFileSync(join(dir, '.codeforge', 'rules', 'models.md'),
    '# Models\n<!-- codeforge:review-policy:start -->\nDefault reviewer(s): OLD\n<!-- codeforge:review-policy:end -->\n');
  writeFileSync(join(dir, '.codeforge', 'state.template.md'), '- **Profile:** standard  <!-- comment -->\n');
  writeFileSync(join(dir, 'PROJECT.md'), '## Special rules\n\n_(fill in)_\n');
  return dir;
}

test('applyModels rewrites the managed block idempotently', () => {
  const dir = scaffoldTarget();
  const answers = {
    models: { codex: { model: 'gpt-5.6-sol', effort: 'xhigh' }, opencode: { model: 'opencode-go/kimi-k3', effort: null } },
    reviewers: ['codex', 'opencode'],
    council: ['codex', 'claude', 'opencode'],
  };
  applyModels(dir, answers);
  applyModels(dir, answers); // idempotent
  const md = readFileSync(join(dir, '.codeforge', 'rules', 'models.md'), 'utf8');
  assert.match(md, /Default reviewer\(s\): codex/i);
  assert.match(md, /Council advisors:/);
  assert.match(md, /kimi-k3/);
  assert.equal(md.match(/review-policy:start/g).length, 1); // not duplicated
  assert.doesNotMatch(md, /OLD/);
});

test('applyModels policy block excludes an engine omitted by the wizard', () => {
  const dir = scaffoldTarget();
  applyModels(dir, {
    models: {
      codex: { model: 'gpt-5.6-sol', effort: 'xhigh' },
      claude: { model: 'opus', effort: 'high' },
      opencode: { model: 'opencode-go/glm-5.2', effort: null },
    },
    reviewers: ['codex', 'claude'],
    council: ['codex', 'claude'],
  });
  const md = readFileSync(join(dir, '.codeforge', 'rules', 'models.md'), 'utf8');
  const block = md.match(/<!-- codeforge:review-policy:start -->[\s\S]*?<!-- codeforge:review-policy:end -->/);
  assert.ok(block);
  assert.doesNotMatch(block[0], /opencode/i, 'a skipped engine must not enter the policy allowlist');
});

test('applyProfile sets the profile in state.template.md', () => {
  const dir = scaffoldTarget();
  applyProfile(dir, { profile: 'light' });
  const md = readFileSync(join(dir, '.codeforge', 'state.template.md'), 'utf8');
  assert.match(md, /\*\*Profile:\*\* light/);
});

test('applyProject fills special rules when provided', () => {
  const dir = scaffoldTarget();
  applyProject(dir, { project: { persona: '', info: '', rules: 'Never touch prod.' } });
  const md = readFileSync(join(dir, 'PROJECT.md'), 'utf8');
  assert.match(md, /Never touch prod\./);
});

test('applyProject is idempotent across repeated calls with identical answers', () => {
  const dir = scaffoldTarget();
  const answers = { project: { persona: '', info: '', rules: 'Never touch prod.' } };
  applyProject(dir, answers);
  applyProject(dir, answers);
  const afterRun2 = readFileSync(join(dir, 'PROJECT.md'), 'utf8');
  applyProject(dir, answers);
  const afterRun3 = readFileSync(join(dir, 'PROJECT.md'), 'utf8');
  assert.equal(afterRun2, afterRun3);
  assert.equal(afterRun3, '## Special rules\n\nNever touch prod.\n');
});

test('applyProject inserts rules text containing literal replacement tokens verbatim', () => {
  const dir = scaffoldTarget();
  const tricky = 'Refund rule: give $1 credit, never $& the balance, escape $$ signs.';
  applyProject(dir, { project: { persona: '', info: '', rules: tricky } });
  const md = readFileSync(join(dir, 'PROJECT.md'), 'utf8');
  assert.ok(md.includes(tricky), 'tricky replacement-token content should appear verbatim');
});

test('applyExecution records the mode in PROJECT.md and overwrites on re-run', () => {
  const dir = scaffoldTarget();
  applyExecution(dir, { execution: { mode: 'subagent-driven' } });
  let md = readFileSync(join(dir, 'PROJECT.md'), 'utf8');
  assert.match(md, /## Execution/);
  assert.match(md, /Execution: subagent-driven/);
  assert.doesNotMatch(md, /model:/);
  applyExecution(dir, { execution: { mode: 'inline' } }); // switch to inline
  md = readFileSync(join(dir, 'PROJECT.md'), 'utf8');
  assert.match(md, /Execution: inline/);
  assert.doesNotMatch(md, /subagent-driven/);
});

test('applyModels throws when the target file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-apply-missing-'));
  const answers = { models: {}, reviewers: ['codex'], council: ['codex'] };
  assert.throws(() => applyModels(dir, answers), /not found/);
});

// tools/test/apply.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyModels, applyProfile, applyProject, applyClaudeAgents, applyExecution } from '../../cli/lib/apply.mjs';

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

test('applyClaudeAgents writes an agent file with the chosen model when subagent-driven', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-agents-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  applyClaudeAgents(dir, { claude: { subagents: true, model: { model: 'sonnet', effort: 'high' } } });
  const f = readFileSync(join(dir, '.claude', 'agents', 'codeforge-implementer.md'), 'utf8');
  assert.match(f, /^model: sonnet$/m);
  assert.match(f, /name: codeforge-implementer/);
});

test('generated implementer agent is commit_policy-aware in its BODY (not just description)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-agents-cp-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  applyClaudeAgents(dir, { claude: { subagents: true, model: { model: 'sonnet', effort: 'high' } } });
  const f = readFileSync(join(dir, '.claude', 'agents', 'codeforge-implementer.md'), 'utf8');
  const body = f.split('\n---\n').slice(1).join('\n---\n');   // everything after frontmatter
  assert.match(body, /commit_policy/);
  assert.match(body, /per-task/);                             // per-task branch present (body)
  assert.match(body, /commit sha/i);                          // ...reports the commit sha (only per-task branch)
  assert.match(body, /defer[\s\S]*(do NOT commit|stage[^\n]*only)/i); // defer branch: stage only (body)
  assert.doesNotMatch(body, /make it pass with the minimal change, run the covering tests, commit,/); // no unconditional commit
  assert.match(f, /^model: sonnet$/m);                        // still parameterized
  assert.match(f, /name: codeforge-implementer/);
});

test('applyClaudeAgents overwrites a stale (pre-commit_policy) agent file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-agents-stale-'));
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  const p = join(dir, '.claude', 'agents', 'codeforge-implementer.md');
  writeFileSync(p, '---\nname: codeforge-implementer\nmodel: old\n---\n…runs the covering tests, commit, then report the commit sha.\n');
  applyClaudeAgents(dir, { claude: { subagents: true, model: { model: 'sonnet' } } });
  const f = readFileSync(p, 'utf8');
  assert.match(f, /commit_policy/);            // refreshed
  assert.match(f, /^model: sonnet$/m);         // and re-parameterized
});

test('applyClaudeAgents is a no-op for inline mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-agents-inline-'));
  applyClaudeAgents(dir, { claude: { subagents: false, model: null } });
  assert.equal(existsSync(join(dir, '.claude', 'agents', 'codeforge-implementer.md')), false);
});

test('applyExecution records the mode in PROJECT.md and overwrites on re-run', () => {
  const dir = scaffoldTarget();
  applyExecution(dir, { claude: { subagents: true, model: { model: 'sonnet' } } });
  let md = readFileSync(join(dir, 'PROJECT.md'), 'utf8');
  assert.match(md, /## Execution/);
  assert.match(md, /Execution: subagent-driven \(model: sonnet\)/);
  applyExecution(dir, { claude: { subagents: false } }); // switch to inline
  md = readFileSync(join(dir, 'PROJECT.md'), 'utf8');
  assert.match(md, /Execution: inline/);
  assert.doesNotMatch(md, /subagent-driven/);
});

test('applyModels throws when the target file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-apply-missing-'));
  const answers = { models: {}, reviewers: ['codex'], council: ['codex'] };
  assert.throws(() => applyModels(dir, answers), /not found/);
});

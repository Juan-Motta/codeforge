import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(REPO, path), 'utf8');

test('review policy is an allowlist and forbids implicit OpenCode fallback', () => {
  const models = read('src/codeforge/rules/models.md');
  const review = read('src/skills/review/SKILL.md');
  const council = read('src/skills/council/SKILL.md');

  assert.match(models, /authoritative allowlists/i);
  assert.match(models, /Never launch an engine absent from the line/i);
  assert.match(review, /authoritative allowlist/i);
  assert.match(review, /must not switch[\s\S]*to OpenCode[\s\S]*explicitly listed/i);
  assert.match(council, /Never add OpenCode/i);
  assert.match(council, /fewer than two[\s\S]*council (cannot run|failed)/i);

  const project = read('src/PROJECT.template.md');
  assert.match(project, /^Default reviewer\(s\):.*Codex.*Claude/m);
  assert.doesNotMatch(project, /^Default reviewer\(s\):.*OpenCode/m);
});

test('external reviewer execution is bounded and Claude is tool-free', () => {
  const models = read('src/codeforge/rules/models.md');
  const review = read('src/skills/review/SKILL.md');
  const runner = read('src/codeforge/scripts/run-reviewer.mjs');

  assert.match(models, /run-reviewer\.mjs --engine claude/);
  assert.match(runner, /--tools', ''/);
  assert.match(runner, /--disallowedTools', 'Bash,Edit,Write,NotebookEdit'/);
  assert.match(runner, /--permission-mode', 'plan'/);
  assert.match(runner, /--no-session-persistence/);
  assert.match(runner, /'timeout-seconds': '600'/);
  assert.match(runner, /windowsVerbatimArguments: true/);
  assert.match(runner, /model_reasoning_effort='\$\{effort\}'/);
  assert.match(runner, /timeout-backstop/);
  assert.match(runner, /maxRetries: 3/);
  assert.match(runner, /writeSync\(2,/);
  assert.match(runner, /SIGINT[\s\S]*SIGTERM/);
  assert.match(models, /10-minute \(600-second\) deadline/i);
  assert.match(models, /terminates the child process tree/i);
  assert.match(models, /Retry[\s\S]*once/i);
  assert.match(review, /real 10-minute \(600-second\) deadline/i);
  assert.match(review, /at most one retry/i);
  assert.match(review, /Exit `14` means the CLI[\s\S]*confirmed it is signed out/i);
  assert.match(review, /network-enabled\/escalated execution/i);
});

test('external source export is authorized before prompt creation and host denial is explicit', () => {
  const review = read('src/skills/review/SKILL.md');
  const council = read('src/skills/council/SKILL.md');
  const models = read('src/codeforge/rules/models.md');
  const setup = read('src/codeforge/rules/goal-autonomy-setup.md');

  for (const contract of [review, council]) {
    assert.match(contract, /explicit human authorization/i);
    assert.match(contract, /before (creating|writing)[\s\S]*prompt/i);
    assert.match(contract, /repository configuration.*not.*consent/i);
  }
  assert.match(review, /not launched.*host approval denied/i);
  assert.match(review, /do not retry.*host denial/i);
  assert.match(models, /Node\.js 20\+/i);
  assert.match(models, /no runner exit code/i);
  assert.match(setup, /source-export authorization/i);
  assert.doesNotMatch(`${review}\n${council}\n${models}\n${setup}`, /dangerously-bypass-approvals-and-sandbox/);
  assert.match(read('README.md'), /Node\.js 20\+/i);
});

test('Codex network expansion is documented but not enabled globally by default', () => {
  const config = read('src/configs/codex/config.toml');
  const setup = read('src/codeforge/rules/goal-autonomy-setup.md');

  assert.doesNotMatch(config, /^network_access\s*=\s*true$/m);
  assert.match(setup, /\[sandbox_workspace_write\][\s\S]*network_access = true/);
  assert.match(setup, /all[\s\S]*commands running in that sandbox/i);
});

test('large reviews are partitioned without weakening engine or verdict policy', () => {
  const review = read('src/skills/review/SKILL.md');
  const models = read('src/codeforge/rules/models.md');

  for (const contract of [review, models]) {
    assert.match(contract, /60 KiB/);
    assert.match(contract, /same[\s\S]{0,30}engine\/model/i);
    assert.match(contract, /one logical (reviewer )?pass/i);
    assert.match(contract, /every batch[\s\S]*(succeed|returned a parseable verdict)/i);
  }
  assert.match(review, /run batches sequentially/i);
  assert.match(review, /do not[\s\S]*clean unless every batch/i);
});

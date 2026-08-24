import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(REPO, path), 'utf8');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

test('implementation agents leave Git integration to the parent', () => {
  const execution = read('src/codeforge/rules/execution.md');
  const implementer = read('src/agents/codeforge-implementer.md');

  assert.match(execution, /only supported value is `defer`/i);
  assert.match(execution, /unstaged and uncommitted/i);
  assert.match(implementer, /do not stage or commit/i);
  assert.match(implementer, /parent driver owns the git\s+index/i);
  assert.match(implementer, /no `git add`[\s\S]*`git stash`[\s\S]*`git reset`[\s\S]*`git clean`/i);
  for (const path of walk(join(REPO, 'src'))) {
    if (/\.(?:md|toml|json|sh|ps1|mjs)$/.test(path)) {
      assert.doesNotMatch(readFileSync(path, 'utf8'), /per-task/i, `${path} references removed per-task policy`);
    }
  }
});

test('shared-checkout writes are sequential and parallel writes require isolation', () => {
  const execution = read('src/codeforge/rules/execution.md');
  assert.match(execution, /implementation tasks \*\*sequentially\*\* in the shared project/i);
  assert.match(execution, /Parallel write tasks[\s\S]*separate git worktrees/i);
  assert.match(execution, /tests proven not to create[\s\S]*coverage[\s\S]*in-repo temporary files/i);
  assert.match(read('src/configs/codex/config.toml'), /max_concurrent_threads_per_session\s*=\s*1/);
});

test('OpenCode falls back inline when native implementation subagents are selected', () => {
  const goal = read('src/skills/goal/SKILL.md');
  assert.match(goal, /On OpenCode \(no native[\s\S]*adapter\)[\s\S]*inline fallback and continue/i);
  assert.match(goal, /YAML frontmatter[\s\S]*codeforge:generated-agent[\s\S]*complete canonical contract/i);
  assert.match(goal, /developer_instructions[\s\S]*equal to the complete canonical\s+contract/i);
  assert.match(goal, /sandbox_mode = "workspace-write"/i);
});

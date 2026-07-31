import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gates = readFileSync(join(repoRoot, 'src', 'docs', 'ci-templates', 'gates.yml'), 'utf8');
const readme = readFileSync(join(repoRoot, 'src', 'docs', 'ci-templates', 'README.md'), 'utf8');

test('gates.yml triggers on pull_request', () => {
  assert.match(gates, /^on:\s*[\s\S]*pull_request:/m);
});

test('gates.yml also triggers on merge_group (so merge queues stay reported)', () => {
  assert.match(gates, /^on:\s*[\s\S]*merge_group:/m);
});

test('gates.yml checks out the code (merge result) via actions/checkout', () => {
  assert.match(gates, /actions\/checkout@v\d/);
});

test('gates.yml default test step is the fail-closed sentinel (exit 1)', () => {
  // An un-edited required check must FAIL, not pass green while running nothing.
  assert.match(gates, /exit 1/);
});

test('README documents required-check + do-not-allow-bypassing', () => {
  assert.match(readme, /required status check/i);
  assert.match(readme, /do not allow bypassing/i);
});

test('README documents CODEOWNERS protection', () => {
  assert.match(readme, /CODEOWNERS/);
});

test('README requires CODEOWNERS on both the workflow path and the test-defining files', () => {
  // A regression that protects only the workflow (and drops the test-defining files, e.g.
  // package.json) would still match a bare /CODEOWNERS/ assertion — require both concretely.
  assert.match(readme, /\.github\/workflows/);
  assert.match(readme, /package\.json/);
});

test('gates.yml sets least-privilege permissions (contents: read)', () => {
  assert.match(gates, /permissions:\s*[\s\S]*?contents:\s*read/);
});

test('gates.yml disables persisted checkout credentials', () => {
  assert.match(gates, /persist-credentials:\s*false/);
});

test('README documents dismissing stale PR approvals on new commits', () => {
  assert.match(readme, /dismiss stale/i);
});

test('README documents strict/up-to-date branches or a merge queue', () => {
  assert.match(readme, /up to date before merging|merge queue/i);
});

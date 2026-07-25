// publish.yml is the only workflow that mints an npm publish credential (`id-token: write`,
// OIDC trusted publishing). Three invariants matter there, none enforced by YAML syntax:
//
//   1. NO `${{ ... }}` EXPANSION INSIDE A `run:` SCRIPT. GitHub Actions substitutes expressions
//      textually BEFORE the shell parses the script, so `tag="${{ inputs.tag }}"` lets a
//      workflow_dispatch input close the quote and append commands — in the one job that holds the
//      publish credential. Inputs must reach the script through `env:` (where the runner passes
//      them as environment values, never as shell source text).
//   2. THE CREDENTIAL IS ISOLATED. `id-token: write` belongs to the publish job alone, and that job
//      runs no project code — no `npm ci`, no tests, no dependency lifecycle scripts. Otherwise a
//      malicious dependency `preinstall` could request the token and publish before the checks.
//   3. THE TAG IS A TAG, AND IT IS GATED. Checkout is `refs/tags/`-qualified so a same-named branch
//      cannot be published, the input is matched against an anchored semver pattern, and the full
//      suite runs on that tag first: "CI was green on main at some point" is not evidence that THIS
//      tag passes — tags can be hand-created, and main can break between push and dispatch.
//
// Both are properties of the workflow file, so they are asserted here rather than discovered in
// production. Kept generic (any `${{`, any input) so a future step can't reintroduce the class.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLISH = join(repoRoot, '.github', 'workflows', 'publish.yml');

// Always read the workflow with normalised newlines. This repo has no .gitattributes, so a Windows
// checkout produces CRLF; every `^...$` and line-split assertion below would then behave differently
// there than on the developer's machine. Read once, normalise once.
const readPublish = () => readFileSync(PUBLISH, 'utf8').replace(/\r\n/g, '\n');

// Extract every `run:` script body with its 1-indexed start line. Handles both block scalars
// (`run: |`, `run: >`) — body = the following more-indented lines — and the inline `run: cmd`
// form. Indentation-based rather than YAML-parsed so the test adds no dependency; the workflow
// is small and uses plain 2-space block style.
function runScripts(yaml) {
  // Normalise CRLF first. There is no .gitattributes in this repo, so a Windows checkout gets CRLF
  // and every line ends in `\r` — which made this extractor find ZERO run: scripts and silently
  // turned the injection guard below into a no-op on the Windows CI job (LF: 9 scripts, CRLF: 0).
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)run:(\s*)(\S?.*)$/);
    if (!m) continue;
    const [, indent, , tail] = m;
    if (tail && !/^[|>][-+]?\d*$/.test(tail.trim())) {
      out.push({ body: tail, line: i + 1 });
      continue;
    }
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') { body.push(l); continue; }
      const lead = l.match(/^\s*/)[0].length;
      if (lead <= indent.length) break;
      body.push(l);
    }
    out.push({ body: body.join('\n'), line: i + 1 });
  }
  return out;
}

test('runScripts finds the block scalars it is used to police (guards against a vacuous pass)', () => {
  const scripts = runScripts(readPublish());
  assert.ok(scripts.length >= 2, `expected at least 2 run: scripts in publish.yml, found ${scripts.length}`);
  // Self-test the extractor on a fixture whose expansion sits in the body, not the `run:` line —
  // the exact shape the real bug had. If the extractor missed this, test 2 below could pass
  // while the injection is still present.
  const fixture = [
    'jobs:',
    '  j:',
    '    steps:',
    '      - name: bad',
    '        run: |',
    '          tag="${{ inputs.tag }}"',
    '      - name: after',
    '        uses: actions/checkout@v4',
  ].join('\n');
  const got = runScripts(fixture);
  assert.equal(got.length, 1);
  assert.match(got[0].body, /\$\{\{ inputs\.tag \}\}/);
});

test('no run: script in publish.yml interpolates a ${{ }} expression', () => {
  const scripts = runScripts(readPublish());
  const offenders = scripts
    .filter((s) => s.body.includes('${{'))
    .map((s) => `publish.yml:${s.line}`);
  assert.deepEqual(
    offenders,
    [],
    `run: scripts must take inputs via env:, not \${{ }} textual substitution — offenders: ${offenders.join(', ')}`,
  );
});

test('publish.yml passes the dispatch tag through env: and validates its shape', () => {
  const yaml = readPublish();
  assert.match(yaml, /^\s+TAG:\s*\$\{\{\s*inputs\.tag\s*\}\}\s*$/m, 'the tag must be bound to an env: var');
  // The pattern must be ANCHORED. A `case` glob like `v[0-9]*.[0-9]*.[0-9]*` also matches
  // `v1x.2y.3z` and `v1.2.3-rc` — an earlier version of this test looked only for the substring
  // `v[0-9]` and therefore accepted exactly that broken glob.
  assert.match(
    yaml,
    /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/,
    'publish.yml must validate the tag against an anchored ^vMAJOR.MINOR.PATCH$ pattern',
  );
});

test('checkout resolves the input as a TAG, never a same-named branch', () => {
  const yaml = readPublish();
  const refs = [...yaml.matchAll(/^\s+ref:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(refs.length > 0, 'expected at least one checkout ref');
  for (const ref of refs) {
    assert.match(ref, /^refs\/tags\//, `checkout ref must be refs/tags/-qualified, got: ${ref}`);
  }
});

test('the publish credential is isolated from every step that runs project code', () => {
  const yaml = readPublish();

  // Anchored to the step's `run:` so this file's own header prose (which mentions `npm publish`
  // while explaining the rules) cannot be mistaken for the publish step.
  const publishAt = yaml.indexOf('run: npm publish');
  assert.ok(publishAt !== -1, 'expected a `run: npm publish` step');
  assert.equal(yaml.split('run: npm publish').length - 1, 1, 'expected exactly one publish step');

  // Comment lines are stripped first: this file's own header explains the rule in prose, and
  // counting that mention as a grant made an earlier version of this assertion fail spuriously.
  const code = yaml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  // `id-token: write` must not be workflow-wide: at top level every job inherits it, including the
  // one that runs `npm ci` and the tests.
  const topLevel = code.slice(0, code.indexOf('\njobs:'));
  assert.ok(!/id-token:\s*write/.test(topLevel), 'id-token: write must be scoped to the publish job, not the workflow');
  assert.equal((code.match(/id-token:\s*write/g) || []).length, 1, 'exactly one job may hold id-token: write');

  // The publish job must depend on the gate, and must not install dependencies itself (a
  // dependency lifecycle script would run inside the credentialed job).
  const publishJob = yaml.slice(yaml.indexOf('\n  publish:'));
  assert.match(publishJob, /needs:\s*gate/, 'publish must declare `needs: gate`');
  assert.ok(!/npm ci/.test(publishJob), 'the credentialed job must not run `npm ci`');
  assert.ok(!/node --test|tests\/smoke\.sh|lint-skills/.test(publishJob), 'the credentialed job must not run tests');
});

test('the gate job runs the full suite, and runs before publish', () => {
  const yaml = readPublish();
  const gateJob = yaml.slice(yaml.indexOf('\n  gate:'), yaml.indexOf('\n  publish:'));
  for (const step of ['npm ci', 'lint-skills.mjs', 'run-evals.mjs', 'node --test', 'tests/smoke.sh']) {
    assert.ok(gateJob.includes(step), `the gate job must run ${step}`);
  }
  assert.match(gateJob, /E2E_BROWSER_REQUIRED/, 'the gate must not let the browser journeys skip silently');
});

test('the globally installed npm is version-pinned (publish-chain supply surface)', () => {
  const yaml = readPublish();
  const m = yaml.match(/npm install -g (npm@\S+)/);
  assert.ok(m, 'expected a global npm install step');
  assert.notEqual(m[1], 'npm@latest', 'pin the npm major used to publish rather than taking whatever is latest that day');
});

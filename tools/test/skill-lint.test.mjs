// Tests for tools/lib/skill-lint.mjs — run with `node --test tools/test/`.
// Builds throwaway skill trees in a temp dir (no network, no repo mutation).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintSkills } from '../lib/skill-lint.mjs';

/** Build a minimal repo layout: src/skills/<name>/SKILL.md + src/CLAUDE.md + src/codeforge/rules. */
function scaffold(skills, { indexSlugs, sharedFiles = ['rules/models.md'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skill-lint-'));
  const src = join(root, 'src');
  const skillsDir = join(src, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  for (const rel of sharedFiles) {
    // The payload dir has NO dot (src/codeforge/); the installer adds it when copying to
    // the target, which is why references are written `.codeforge/...`.
    const p = join(src, 'codeforge', rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, '# shared\n');
  }
  for (const [name, body] of Object.entries(skills)) {
    mkdirSync(join(skillsDir, name), { recursive: true });
    writeFileSync(join(skillsDir, name, 'SKILL.md'), body);
  }
  const slugs = indexSlugs ?? Object.keys(skills);
  const index = ['## Workflow skills', '', ...slugs.map((s) => `- \`${s}\` — desc`)].join('\n');
  writeFileSync(join(src, 'CLAUDE.md'), index + '\n');
  return { root, srcDir: src, skillsDir, claudeMd: join(src, 'CLAUDE.md') };
}

const run = (s) => lintSkills({ skillsDir: s.skillsDir, claudeMd: s.claudeMd, srcDir: s.srcDir });
const errorsFor = (res, skill) => res.results.find((r) => r.skill === skill)?.errors ?? [];

const GOOD = `---
name: good
description: Does a thing well. Use when you need the thing under Claude Code, Codex, or OpenCode.
---
# good
## Process
Do it.
## Common rationalizations
| Excuse | Reality |
| --- | --- |
| skip it | don't |
## Red flags
- something is off
## Verification
- [ ] It worked.
`;

test('a well-formed skill passes with zero errors', () => {
  const s = scaffold({ good: GOOD });
  const res = run(s);
  assert.equal(res.totalErrors, 0, JSON.stringify(res.results));
  rmSync(s.root, { recursive: true, force: true });
});

test('name mismatch is an error', () => {
  const s = scaffold({ good: GOOD.replace('name: good', 'name: wrong') });
  const res = run(s);
  assert.ok(errorsFor(res, 'good').some((e) => /!= directory/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('missing description trigger clause is an error', () => {
  const body = `---
name: good
description: Just a statement with no trigger.
---
# good
## Verification
x
`;
  const s = scaffold({ good: body });
  const res = run(s);
  assert.ok(errorsFor(res, 'good').some((e) => /trigger clause/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('over-long description is an error', () => {
  const long = 'Use it. ' + 'x'.repeat(1100);
  const s = scaffold({ good: GOOD.replace(/description: .*/, `description: ${long}`) });
  const res = run(s);
  assert.ok(errorsFor(res, 'good').some((e) => /> 1024 max/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('hard-coded model id is quarantined', () => {
  const s = scaffold({ good: GOOD + '\nRun the reviewer on gpt-5.6-sol for this.\n' });
  const res = run(s);
  assert.ok(errorsFor(res, 'good').some((e) => /hard-codes a model id/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('engine names (Claude/Codex/OpenCode) are NOT flagged as model ids', () => {
  const s = scaffold({ good: GOOD });
  const res = run(s);
  assert.ok(!errorsFor(res, 'good').some((e) => /model id/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('broken .codeforge/ reference is an error', () => {
  const s = scaffold({ good: GOOD + '\nSee .codeforge/rules/does-not-exist.md for more.\n' });
  const res = run(s);
  assert.ok(errorsFor(res, 'good').some((e) => /broken reference/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('valid .codeforge/ reference passes', () => {
  const s = scaffold({ good: GOOD + '\nSee .codeforge/rules/models.md for ids.\n' });
  const res = run(s);
  assert.ok(!errorsFor(res, 'good').some((e) => /broken reference/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('skill missing from CLAUDE.md index is an error', () => {
  const s = scaffold({ good: GOOD }, { indexSlugs: [] });
  const res = run(s);
  assert.ok(errorsFor(res, 'good').some((e) => /not listed in CLAUDE.md/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('index entry with no skill dir is an error', () => {
  const s = scaffold({ good: GOOD }, { indexSlugs: ['good', 'ghost'] });
  const res = run(s);
  assert.ok(errorsFor(res, '(index:ghost)').some((e) => /does not exist/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('missing Verification section is an error', () => {
  const body = `---
name: good
description: Does a thing. Use when needed under Claude Code, Codex, or OpenCode.
---
# good
## Process
no verification heading here
`;
  const s = scaffold({ good: body });
  const res = run(s);
  assert.ok(errorsFor(res, 'good').some((e) => /Verification/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('missing anti-rationalization anatomy is an error', () => {
  const body = `---
name: good
description: Does a thing. Use when needed under Claude Code, Codex, or OpenCode.
---
# good
## Process
steps here
## Verification
- [ ] done
`;
  const s = scaffold({ good: body });
  const res = run(s);
  const errs = errorsFor(res, 'good');
  assert.ok(errs.some((e) => /Common rationalizations/.test(e)));
  assert.ok(errs.some((e) => /Red flags/.test(e)));
  rmSync(s.root, { recursive: true, force: true });
});

test('a skill with full anatomy passes clean', () => {
  const full = `---
name: full
description: Does a thing. Use when needed under Claude Code, Codex, or OpenCode.
---
# full
## Process
Do it.
## Common rationalizations
| Excuse | Reality |
| --- | --- |
| skip it | don't |
## Red flags
- something is off
## Verification
- [ ] done
`;
  const s = scaffold({ full });
  const res = run(s);
  assert.equal(errorsFor(res, 'full').length, 0);
  assert.equal(res.results.find((r) => r.skill === 'full').warnings.length, 0);
  rmSync(s.root, { recursive: true, force: true });
});

test('duplicate name across dirs is an error', () => {
  const s = scaffold({ a: GOOD.replace('name: good', 'name: dup'), b: GOOD.replace('name: good', 'name: dup') });
  // both dirs claim name "dup" → mismatch + duplicate; assert duplicate fires on the second
  const res = run(s);
  const dupHit = res.results.some((r) => r.errors.some((e) => /duplicate skill name/.test(e)));
  assert.ok(dupHit);
  rmSync(s.root, { recursive: true, force: true });
});

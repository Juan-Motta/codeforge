// The VERSION file (read by the installers to stamp .codeforge/version) and the
// npm package version (what `npx codeforge` publishes/pins) must never drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('VERSION matches package.json version', () => {
  const version = readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim();
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  assert.match(version, /^\d+\.\d+\.\d+$/, 'VERSION should be semver x.y.z');
  assert.equal(pkg.version, version, `package.json version (${pkg.version}) != VERSION (${version})`);
});

test('the bin the npx entry point points to is whitelisted in files', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.bin['codeforge'], 'bin/codeforge.mjs');
  assert.ok(pkg.files.includes('bin/'), 'files[] must ship bin/');
  assert.ok(pkg.files.includes('src/'), 'files[] must ship the src/ payload');
  assert.ok(pkg.files.includes('VERSION'), 'files[] must ship VERSION');
});

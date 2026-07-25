// Every byte inside `package.json#files` is downloaded by every `npx @jualopezmo/codeforge` run.
// The payload is shell scripts and markdown, so a binary asset in there is always either dead
// weight or a dev-only input that leaked into the published tree.
//
// The concrete regression this guards: `cli/assets/codeforge-icon.png` (867 kB) was the source
// image for the splash art and lived under the shipped `cli/` tree, making it ~90% of a 960 kB
// tarball — while the runtime only ever reads the generated ASCII in `cli/assets/anvil.ans.mjs`.
// Dev-only inputs belong under `tools/`, which is not in `files`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

// Generous ceiling on the shipped payload. Not a golden number to chase — it exists so that a
// future asset of the same class fails here instead of in every user's `npx` download.
const PAYLOAD_BUDGET_BYTES = 400 * 1024;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|mp4|mov|zip|tgz|woff2?|ttf|otf)$/i;

function walk(abs, acc = []) {
  if (!existsSync(abs)) return acc;
  const st = statSync(abs);
  if (!st.isDirectory()) { acc.push({ path: abs, size: st.size }); return acc; }
  for (const entry of readdirSync(abs)) walk(join(abs, entry), acc);
  return acc;
}

// The union of everything `files` ships. node_modules is never included by npm, and `files`
// entries here are all explicit paths, so a plain walk is faithful.
function shippedFiles() {
  const out = [];
  for (const entry of pkg.files) out.push(...walk(join(repoRoot, entry)));
  return out.map((f) => ({ rel: relative(repoRoot, f.path).split(sep).join('/'), size: f.size }));
}

test('files[] ships no binary/media assets', () => {
  const offenders = shippedFiles()
    .filter((f) => BINARY_EXT.test(f.rel))
    .map((f) => `${f.rel} (${(f.size / 1024).toFixed(1)} kB)`);
  assert.deepEqual(
    offenders,
    [],
    `binary assets must not ship in the npx payload — move dev-only inputs under tools/: ${offenders.join(', ')}`,
  );
});

test('the shipped payload stays within its size budget', () => {
  const files = shippedFiles();
  const total = files.reduce((n, f) => n + f.size, 0);
  const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 3)
    .map((f) => `${f.rel} ${(f.size / 1024).toFixed(1)} kB`);
  assert.ok(
    total <= PAYLOAD_BUDGET_BYTES,
    `shipped payload is ${(total / 1024).toFixed(1)} kB, budget ${(PAYLOAD_BUDGET_BYTES / 1024).toFixed(0)} kB. Largest: ${biggest.join(', ')}`,
  );
});

test("the splash generator's source image is a dev-only input, outside files[]", () => {
  // Derive the path from the generator instead of hard-coding it, so moving the asset again
  // without updating the generator can't make this assertion vacuous.
  const gen = readFileSync(join(repoRoot, 'tools', 'gen-splash.mjs'), 'utf8');
  const m = gen.match(/join\(\s*repoRoot\s*,\s*((?:'[^']+'\s*,\s*)*'[^']+')\s*\)/);
  assert.ok(m, 'could not find the source-image path in tools/gen-splash.mjs');
  const rel = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).join('/');

  assert.ok(existsSync(join(repoRoot, rel)), `generator source image ${rel} does not exist`);
  const shipped = shippedFiles().some((f) => f.rel === rel);
  assert.equal(shipped, false, `${rel} is a dev-only generator input but is inside files[]`);
});

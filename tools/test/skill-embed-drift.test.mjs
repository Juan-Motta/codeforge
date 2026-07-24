import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REF = readFileSync(join(REPO, 'tools/e2e-ui-ref/run-journey.mjs'), 'utf8');
const SKILL = readFileSync(join(REPO, 'src/skills/verify-e2e/SKILL.md'), 'utf8');

function occurrences(text, needle) {
  let n = 0, i = text.indexOf(needle);
  while (i !== -1) { n++; i = text.indexOf(needle, i + needle.length); }
  return n;
}
function between(text, start, end) {
  const i = text.indexOf(start);
  const j = text.indexOf(end, i + start.length);
  assert.ok(i !== -1 && j !== -1, `markers not found: ${start} .. ${end}`);
  return text.slice(i + start.length, j);
}

test('verify-e2e SKILL.md embeds the run-journey.mjs region byte-for-byte', () => {
  // Reject duplicate sentinels (indexOf would silently take the first pair).
  for (const m of ['// e2e-ui-ref:start', '// e2e-ui-ref:end']) assert.equal(occurrences(REF, m), 1, `ref: exactly one ${m}`);
  for (const m of ['<!-- e2e-ui-ref:start -->', '<!-- e2e-ui-ref:end -->']) assert.equal(occurrences(SKILL, m), 1, `skill: exactly one ${m}`);
  const refRegion = between(REF, '// e2e-ui-ref:start', '// e2e-ui-ref:end');
  const skillRegion = between(SKILL, '<!-- e2e-ui-ref:start -->', '<!-- e2e-ui-ref:end -->');
  // BYTE-FOR-BYTE (D6b): the skill region must equal the ref region wrapped in EXACTLY the fence,
  // no trimming. `between` includes the newline after `:start` and before `:end`, so the ref
  // region is `<eol><code><eol>`; the skill wraps that same code in a ```js fence. Derive the EOL
  // from refRegion so a CRLF checkout (Windows CI, no .gitattributes) doesn't false-fail — both
  // files check out with the same EOL, so the wrapper must use that EOL, not a hardcoded `\n`.
  const eol = refRegion.includes('\r\n') ? '\r\n' : '\n';
  assert.equal(skillRegion, `${eol}\`\`\`js${refRegion}\`\`\`${eol}`,
    'embedded harness has drifted from tools/e2e-ui-ref/run-journey.mjs (byte-for-byte, no trim)');
});

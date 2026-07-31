import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = fileURLToPath(new URL('../../src/codeforge/scripts/goal-state.sh', import.meta.url));
const hasSh = spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0;
const G = { skip: !hasSh };
const run = (args, cwd) => execFileSync('sh', [SH, ...args], { cwd }).toString().trim();
const mk = (body) => { const d = mkdtempSync(join(tmpdir(), 'goalst-')); writeFileSync(join(d, 'state.md'), body); return d; };
const STATE = `## /goal loop
| phase | code-review |
| reentries | 2 |

## Review log
- loop=code — round=1 — kind=round — reviewer=codex — result=P1=1 — digest=aa — ts=t1
- loop=code — round=2 — kind=round — reviewer=self — result=clean — digest=bb — ts=t2
- loop=code — round=3 — kind=cert — reviewer=codex — result=clean — digest=bb — ts=t3
- loop=plan — round=1 — kind=round — reviewer=codex — result=clean — digest=cc — ts=t0

## Notes
| phase | DECOY |
`;

test('field is section-scoped', G, () => {
  const d = mk(STATE);
  assert.equal(run(['field', 'phase', 'state.md'], d), 'code-review');
  assert.equal(run(['field', 'reentries', 'state.md'], d), '2');
  assert.equal(run(['field', 'absent', 'state.md'], d), '');
});
test('round-count: kind=round per loop; single 0 on empty', G, () => {
  const d = mk(STATE);
  assert.equal(run(['round-count', 'code', 'state.md'], d), '2');
  assert.equal(run(['round-count', 'plan', 'state.md'], d), '1');
  assert.equal(run(['round-count', 'code', 'state.md'], mk('## Review log\n')), '0');
});
test('CRLF state file still parses', G, () => {
  const d = mk(STATE.replace(/\n/g, '\r\n'));
  assert.equal(run(['field', 'phase', 'state.md'], d), 'code-review');
  assert.equal(run(['round-count', 'code', 'state.md'], d), '2');
});
test('ship-red-bump is monotonic and lands inside ## Attempts', G, () => {
  const d = mk('## /goal loop\n| phase | ship |\n\n## Notes\nend\n');
  assert.equal(run(['ship-red-bump', 'state.md'], d), '1');
  assert.equal(run(['ship-red-bump', 'state.md'], d), '2');
  assert.equal(run(['ship-red-bump', 'state.md'], d), '3');
  assert.equal(run(['ship-red-count', 'state.md'], d), '3');
  assert.match(readFileSync(join(d, 'state.md'), 'utf8'), /## Attempts[\s\S]*n=3/);
});
test('unknown subcommand exits 3', G, () => {
  assert.equal(spawnSync('sh', [SH, 'bogus'], { cwd: mk('x') }).status, 3);
});

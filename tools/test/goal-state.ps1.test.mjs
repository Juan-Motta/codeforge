import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SH  = fileURLToPath(new URL('../../src/codeforge/scripts/goal-state.sh',  import.meta.url));
const PS1 = fileURLToPath(new URL('../../src/codeforge/scripts/goal-state.ps1', import.meta.url));
const hasSh   = spawnSync('sh',   ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0;
const hasPwsh = spawnSync('pwsh', ['-v'],           { stdio: 'ignore' }).status === 0;
const STATE = `## /goal loop
| phase | code-review |

## Review log
- loop=code — round=1 — kind=round — reviewer=codex — result=P1=1 — digest=aa — ts=t1
- loop=code — round=2 — kind=cert — reviewer=self — result=clean — digest=bb — ts=t2
`;

test('ps1 matches sh: reads, 2 bumps, unknown-exit', { skip: !(hasSh && hasPwsh) }, () => {
  const mk = () => { const d = mkdtempSync(join(tmpdir(), 'goalstp-')); writeFileSync(join(d, 'state.md'), STATE); return d; };
  const sh  = (a, d) => execFileSync('sh',   [SH,  ...a], { cwd: d }).toString().trim();
  const ps1 = (a, d) => execFileSync('pwsh', ['-NoProfile', '-File', PS1, ...a], { cwd: d }).toString().trim();
  for (const a of [['field','phase','state.md'], ['round-count','code','state.md'], ['ship-red-count','state.md']]) {
    assert.equal(ps1(a, mk()), sh(a, mk()), `read: ${a.join(' ')}`);
  }
  const ds = mk(), dp = mk();
  sh(['ship-red-bump','state.md'], ds); assert.equal(sh(['ship-red-bump','state.md'], ds), '2');
  ps1(['ship-red-bump','state.md'], dp); assert.equal(ps1(['ship-red-bump','state.md'], dp), '2');
  assert.equal(ps1(['ship-red-count','state.md'], dp), sh(['ship-red-count','state.md'], ds));
  assert.equal(spawnSync('sh',   [SH,  'bogus'], { cwd: mk() }).status, 3);
  assert.equal(spawnSync('pwsh', ['-NoProfile','-File',PS1,'bogus'], { cwd: mk() }).status, 3);
});

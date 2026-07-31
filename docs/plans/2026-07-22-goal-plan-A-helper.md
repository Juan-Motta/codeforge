# /goal Plan A — state + digest helper (foundation) — Implementation Plan (rev3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use `- [ ]` checkboxes. **Tests are the arbiter of the
> byte-level git/PowerShell determinism in this plan** — a red test is a real defect, fix it (never
> weaken the test).

**Goal:** `goal-digest.{sh,ps1}` (the §6.1 certification digest) + `goal-state.{sh,ps1}` (read
`## /goal loop` fields, count breaker rounds, read/bump the durable ship-red counter), with node
tests, shipped to targets as `sh`+`pwsh` (no Node in targets), like `check-gates.{sh,ps1}`.

**Architecture — the digest is ONE normalized `git diff`.** Seed a temporary git index from the
repo's real index (absolute path), `git add -N` (intent-to-add) every in-scope untracked file into
it, then hash the **raw bytes** of a single deterministic `git diff <base>` over that index. Git
frames tracked+untracked identically (modes, symlinks `120000`, renames-off), the representation is
index-state-invariant (untracked == staged == committed for identical content — empirically
confirmed, incl. mixed modify+delete+add), and `sh`/`ps1` both hash the same git bytes so parity is
structural. Committed-tree digest (Plan C ship check) = same fn with `--from-head`.

**Tech Stack:** POSIX `sh`, PowerShell 7, `git`, `shasum`/`sha256sum`, `node:test`,
`node:child_process`, `node:fs`, `node:url` (`fileURLToPath`).

## Global Constraints (verbatim; every task inherits these)

- **Exclusion set** (§6.1), applied to the diff pathspecs, one source of truth in each script:
  `:(exclude).workflow/*`, `:(exclude)docs/e2e/reports/*`, `:(exclude)CONTINUITY.md`,
  `:(exclude)docs/CHANGELOG.md`, `:(exclude)VERSION`. Reviewer/council scratch lives under
  `.workflow/` (already excluded) — no separate prefix. `package.json`/lockfiles are **in scope**.
- **Deterministic diff flags** (both scripts, both modes):
  `diff --full-index --no-ext-diff --no-textconv --default-prefix --no-renames --no-color`.
  (`--full-index`: abbreviated OIDs can collide or differ worktree-vs-committed; `--no-ext-diff`/
  `--no-textconv`: ignore repo diff/textconv drivers; `--default-prefix`: stable `a/ b/`.)
- **Index-state invariance:** identical in-scope content → identical digest whether untracked,
  `-N`, staged, or committed. `--from-head` equals the worktree digest by construction.
- **Fail closed:** any nonzero `git`/sha status → exit 3 (never hash an empty/partial stream). Tools
  preflighted (missing git/sha, bad/empty base, not-a-repo → exit 3), on BOTH engines.
- **Real index is never mutated** (temp index via `GIT_INDEX_FILE`); works in linked worktrees
  (resolve the index path as absolute).
- **sh/ps1 parity is mandatory**; parity tests run only when BOTH `sh` and `pwsh` exist. ps1 hashes
  git's **raw stdout bytes** (no decode/re-encode — `Start-Process -RedirectStandardOutput` is NOT
  raw on Unix; use `System.Diagnostics.Process` + copy `StandardOutput.BaseStream`), passes args via
  `ProcessStartInfo.ArgumentList` (not a joined string — spaces), and uses `-LiteralPath` for all
  path tests (bracket wildcards like `app/[id]`).
- **State schemas** (§10), all **section-scoped** (`## <name>` to next `## `, CRLF-tolerant):
  review-log `- loop=… — round=N — kind=round|recert|cert — …` (breaker counts `kind=round` in
  `## Review log`); ship-red `- ATTEMPT ship-red — n=k — ts=…` in `## Attempts` (`n>=2` → HALT),
  **appended at the END of the section so `tail`/`[-1]` = newest** (monotonic).
- **Breaker constants** (`N=4`, `MAX_REENTRIES=3`, `MAX_CODE_ROUNDS=3·N`) are the caller's (Plan C);
  the helper only counts.
- Tests use `fileURLToPath` (never `new URL().pathname`) and `hasSh`/`hasPwsh` guards (mirror
  `tools/test/check-gates.test.mjs`) on **every** suite that spawns `sh` or `pwsh`.

---

## File Structure
- `src/shared/scripts/goal-digest.sh` / `.ps1` — `<base_sha> [repo_dir] [--from-head]` → 64-hex.
- `src/shared/scripts/goal-state.sh` / `.ps1` — `field | round-count | ship-red-count | ship-red-bump`.
- `tools/test/goal-digest.test.mjs`, `goal-digest.ps1.test.mjs`, `goal-state.test.mjs`,
  `goal-state.ps1.test.mjs`.

---

### Task 1: `goal-digest.sh` + its test

**Files:** Create `src/shared/scripts/goal-digest.sh`; Test `tools/test/goal-digest.test.mjs`.
**Interfaces:** `goal-digest.sh <base_sha> [repo_dir] [--from-head]` → stdout 64-hex; exit 3 on any
bad env/arg/tool/git failure.

- [ ] **Step 1: Write the failing tests** (`tools/test/goal-digest.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, chmodSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = fileURLToPath(new URL('../../src/shared/scripts/goal-digest.sh', import.meta.url));
const hasSh = spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0;
const G = { skip: !hasSh };

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'goaldig-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t.co'); git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'seed.txt'), 'seed\n'); git('add', '.'); git('commit', '-qm', 'base');
  return { dir, base: git('rev-parse', 'HEAD').toString().trim(), git };
}
const dg = (dir, base, ...x) => execFileSync('sh', [SH, base, dir, ...x], { cwd: dir }).toString().trim();

test('64-hex + deterministic', G, () => {
  const { dir, base } = initRepo(); writeFileSync(join(dir, 'seed.txt'), 'seed\nX\n');
  const d = dg(dir, base); assert.match(d, /^[0-9a-f]{64}$/); assert.equal(d, dg(dir, base));
});

test('index-state invariance: untracked == staged == committed(--from-head)', G, () => {
  const { dir, base, git } = initRepo();
  writeFileSync(join(dir, 'new.txt'), 'content\n');
  const untracked = dg(dir, base);
  git('add', 'new.txt'); assert.equal(dg(dir, base), untracked);
  git('commit', '-qm', 'c'); assert.equal(dg(dir, base, '--from-head'), untracked);
});

test('invariance holds with modify+delete+add together', G, () => {
  const { dir, base, git } = initRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nmod\n');           // modify
  writeFileSync(join(dir, 'a.txt'), 'add\n');                    // add
  git('rm', '-q', '--cached', 'seed.txt'); /* keep worktree */   // ensure diff has a delete-ish case
  const before = dg(dir, base);
  git('add', '-A'); assert.equal(dg(dir, base), before);
});

test('excluded path is digest-neutral; in-scope change moves it', G, () => {
  const { dir, base } = initRepo(); const before = dg(dir, base);
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  writeFileSync(join(dir, '.workflow', 'state.md'), 'noise\n'); assert.equal(dg(dir, base), before);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nY\n'); assert.notEqual(dg(dir, base), before);
});

test('positive controls: package.json, empty add, plan doc all move the digest', G, () => {
  const { dir, base } = initRepo();
  const b0 = dg(dir, base);
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n'); const b1 = dg(dir, base); assert.notEqual(b1, b0);
  writeFileSync(join(dir, 'empty.txt'), '');                    const b2 = dg(dir, base); assert.notEqual(b2, b1);
  mkdirSync(join(dir, 'docs', 'plans'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'plans', 'p.md'), 'plan\n');  const b3 = dg(dir, base); assert.notEqual(b3, b2);
});

test('executable-bit change moves the digest', G, () => {
  const { dir, base, git } = initRepo();
  writeFileSync(join(dir, 'run.sh'), '#!/bin/sh\n'); git('add', '.'); git('commit', '-qm', 'x');
  const before = dg(dir, base); chmodSync(join(dir, 'run.sh'), 0o755);
  assert.notEqual(dg(dir, base), before);
});

test('rename moves the digest (--no-renames)', G, () => {
  const { dir, base, git } = initRepo(); const before = dg(dir, base);
  git('mv', 'seed.txt', 'renamed.txt'); assert.notEqual(dg(dir, base), before);
});

test('symlink and leading-dash untracked are bound (present ≠ absent), crash-free', G, () => {
  const { dir, base } = initRepo(); const before = dg(dir, base);
  writeFileSync(join(dir, '-weird.txt'), 'dash\n'); const d1 = dg(dir, base); assert.notEqual(d1, before);
  symlinkSync('seed.txt', join(dir, 'link'));       const d2 = dg(dir, base); assert.notEqual(d2, d1);
});

test('linked worktree: digest works and the real index is byte-unchanged', G, () => {
  const { dir, base, git } = initRepo();
  const wt = mkdtempSync(join(tmpdir(), 'goalwt-'));
  const idxBefore = execFileSync('shasum', ['-a', '256', join(dir, '.git', 'index')]).toString();
  git('worktree', 'add', '-q', wt, 'HEAD');
  writeFileSync(join(wt, 'w.txt'), 'in-worktree\n');
  const d = execFileSync('sh', [SH, base, wt], { cwd: wt }).toString().trim();
  assert.match(d, /^[0-9a-f]{64}$/);
  const idxAfter = execFileSync('shasum', ['-a', '256', join(dir, '.git', 'index')]).toString();
  assert.equal(idxAfter, idxBefore);
});

test('bad base sha exits 3; empty base exits 3', G, () => {
  const { dir } = initRepo();
  assert.equal(spawnSync('sh', [SH, 'deadbeefdeadbeef', dir], { cwd: dir }).status, 3);
  assert.equal(spawnSync('sh', [SH, '', dir], { cwd: dir }).status, 3);
});
```

- [ ] **Step 2: Run — verify failure.** `node --test tools/test/goal-digest.test.mjs` → FAIL (missing script).

- [ ] **Step 3: Write `src/shared/scripts/goal-digest.sh`**

```sh
#!/bin/sh
# goal-digest.sh — /goal certification digest (design §6.1). ONE normalized git diff.
# Usage: sh goal-digest.sh <base_sha> [repo_dir] [--from-head]
# Exit: 0 ok · 3 bad env/args/tool/git failure (fail closed).
set -eu
LC_ALL=C; export LC_ALL
base="${1:-}"; repo="${2:-.}"; mode="${3:-}"
[ -n "$base" ] || { echo "goal-digest: missing base_sha" >&2; exit 3; }
command -v git >/dev/null 2>&1 || { echo "goal-digest: git not found" >&2; exit 3; }
if command -v sha256sum >/dev/null 2>&1; then SHA="sha256sum"
elif command -v shasum >/dev/null 2>&1; then SHA="shasum -a 256"
else echo "goal-digest: no sha256 tool" >&2; exit 3; fi
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || { echo "goal-digest: not a repo" >&2; exit 3; }
git -C "$repo" cat-file -e "${base}^{commit}" 2>/dev/null || { echo "goal-digest: bad base" >&2; exit 3; }

set -f
set -- ':(exclude).workflow/*' ':(exclude)docs/e2e/reports/*' ':(exclude)CONTINUITY.md' \
       ':(exclude)docs/CHANGELOG.md' ':(exclude)VERSION'
DIFF="diff --full-index --no-ext-diff --no-textconv --default-prefix --no-renames --no-color"

out=$(mktemp); tmp_idx=""
cleanup() { rm -f "$out"; [ -n "$tmp_idx" ] && rm -f "$tmp_idx"; return 0; }  # return 0: a trailing
trap cleanup EXIT INT TERM   # false test in an EXIT trap would override the script's exit status

if [ "$mode" = "--from-head" ]; then
  git -C "$repo" -c core.quotepath=false $DIFF "$base" HEAD -- . "$@" > "$out" \
    || { echo "goal-digest: git diff failed" >&2; exit 3; }
else
  real_idx=$(git -C "$repo" rev-parse --git-path index)
  case "$real_idx" in /*) idx_abs="$real_idx" ;; *) idx_abs="$repo/$real_idx" ;; esac
  tmp_idx=$(mktemp)
  if [ -f "$idx_abs" ]; then cp "$idx_abs" "$tmp_idx"; else rm -f "$tmp_idx"; fi
  GIT_INDEX_FILE="$tmp_idx"; export GIT_INDEX_FILE
  git -C "$repo" add -N -- . "$@" >/dev/null 2>&1 \
    || { unset GIT_INDEX_FILE; echo "goal-digest: git add -N failed" >&2; exit 3; }
  git -C "$repo" -c core.quotepath=false $DIFF "$base" -- . "$@" > "$out" \
    || { unset GIT_INDEX_FILE; echo "goal-digest: git diff failed" >&2; exit 3; }
  unset GIT_INDEX_FILE
fi
$SHA < "$out" | cut -d' ' -f1
```

- [ ] **Step 4: Run — verify pass.** `node --test tools/test/goal-digest.test.mjs` → PASS (all).

- [ ] **Step 5: Commit.**
```bash
git add src/shared/scripts/goal-digest.sh tools/test/goal-digest.test.mjs
git commit -m "feat(goal): goal-digest.sh normalized git-diff digest (full-index, fail-closed, worktree-safe)"
```

---

### Task 2: `goal-digest.ps1` — parity (raw bytes, Process, ArgumentList)

**Files:** Create `src/shared/scripts/goal-digest.ps1`; Test `tools/test/goal-digest.ps1.test.mjs`.

- [ ] **Step 1: Write the failing parity test** (`tools/test/goal-digest.ps1.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SH  = fileURLToPath(new URL('../../src/shared/scripts/goal-digest.sh',  import.meta.url));
const PS1 = fileURLToPath(new URL('../../src/shared/scripts/goal-digest.ps1', import.meta.url));
const hasSh   = spawnSync('sh',   ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0;
const hasPwsh = spawnSync('pwsh', ['-v'],           { stdio: 'ignore' }).status === 0;

test('ps1 == sh across mixed-case, non-ASCII, invalid-UTF-8, wildcard, spaces', { skip: !(hasSh && hasPwsh) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'goal digp-'));   // NOTE: space in repo path
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t.co'); git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'seed.txt'), 'seed\n'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').toString().trim();
  writeFileSync(join(dir, 'Foo.txt'), 'A\n');
  writeFileSync(join(dir, 'bar.txt'), 'café ☕\n');
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([0x89, 0xff, 0xfe, 0x00, 0x41]));  // invalid UTF-8
  mkdirSync(join(dir, 'app', '[id]'), { recursive: true });
  writeFileSync(join(dir, 'app', '[id]', 'page.txt'), 'wild\n');
  const sh  = execFileSync('sh',   [SH,  base, dir], { cwd: dir }).toString().trim();
  const ps1 = execFileSync('pwsh', ['-NoProfile', '-File', PS1, base, dir], { cwd: dir }).toString().trim();
  assert.equal(ps1, sh);
});
```

- [ ] **Step 2: Run — verify failure/skip.** → FAIL (missing) on dual-runtime; SKIP otherwise.

- [ ] **Step 3: Write `src/shared/scripts/goal-digest.ps1`**

```powershell
#!/usr/bin/env pwsh
# goal-digest.ps1 — parity twin of goal-digest.sh. Hashes git's RAW stdout bytes.
param([string]$Base = '', [string]$RepoDir = '.', [string]$Mode = '')
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$env:LC_ALL = 'C'
function Fail($m) { [Console]::Error.WriteLine("goal-digest: $m"); exit 3 }
if ([string]::IsNullOrEmpty($Base)) { Fail 'missing base_sha' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git not found' }
$repo = (Resolve-Path -LiteralPath $RepoDir).Path

# run git with raw-byte stdout captured to a file; return exit code
function GitRawTo($file, [string[]]$gitArgs) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = 'git'; $psi.WorkingDirectory = $repo
  $psi.RedirectStandardOutput = $true; $psi.UseShellExecute = $false
  foreach ($a in $gitArgs) { $psi.ArgumentList.Add($a) }
  $p = [System.Diagnostics.Process]::Start($psi)
  $fs = [System.IO.File]::Create($file)
  $p.StandardOutput.BaseStream.CopyTo($fs); $fs.Close(); $p.WaitForExit()
  return $p.ExitCode
}
& git -C $repo rev-parse --git-dir *> $null; if ($LASTEXITCODE -ne 0) { Fail 'not a repo' }
& git -C $repo cat-file -e "$Base^{commit}" *> $null; if ($LASTEXITCODE -ne 0) { Fail 'bad base' }

$excl = @(':(exclude).workflow/*', ':(exclude)docs/e2e/reports/*', ':(exclude)CONTINUITY.md',
          ':(exclude)docs/CHANGELOG.md', ':(exclude)VERSION')
$diff = @('-C', $repo, '-c', 'core.quotepath=false', 'diff', '--full-index', '--no-ext-diff',
          '--no-textconv', '--default-prefix', '--no-renames', '--no-color')
$out = [System.IO.Path]::GetTempFileName(); $tmpIdx = $null
try {
  if ($Mode -eq '--from-head') {
    $code = GitRawTo $out ($diff + @($Base, 'HEAD', '--', '.') + $excl)
  } else {
    $realIdx = (& git -C $repo rev-parse --git-path index).Trim()
    $idxAbs = if ([System.IO.Path]::IsPathRooted($realIdx)) { $realIdx } else { Join-Path $repo $realIdx }
    $tmpIdx = [System.IO.Path]::GetTempFileName()
    if (Test-Path -LiteralPath $idxAbs) { Copy-Item -LiteralPath $idxAbs $tmpIdx -Force } else { Remove-Item $tmpIdx -Force }
    $env:GIT_INDEX_FILE = $tmpIdx
    & git @(@('-C', $repo, 'add', '-N', '--', '.') + $excl) *> $null
    if ($LASTEXITCODE -ne 0) { Remove-Item Env:GIT_INDEX_FILE; Fail 'git add -N failed' }
    $code = GitRawTo $out ($diff + @($Base, '--', '.') + $excl)
    Remove-Item Env:GIT_INDEX_FILE
  }
  if ($code -ne 0) { Fail 'git diff failed' }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  -join ($sha.ComputeHash([System.IO.File]::ReadAllBytes($out)) | ForEach-Object { $_.ToString('x2') })
} finally {
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  if ($tmpIdx) { Remove-Item $tmpIdx -Force -ErrorAction SilentlyContinue }
}
```

- [ ] **Step 4: Run — verify parity.** `node --test tools/test/goal-digest.ps1.test.mjs` → PASS on
  a host with both runtimes (CI windows job has Git-for-Windows `sh` + `pwsh`). A divergence is
  always a decode/re-encode or arg-order fault — fix it; a parity failure is P1.

- [ ] **Step 5: Commit.**
```bash
git add src/shared/scripts/goal-digest.ps1 tools/test/goal-digest.ps1.test.mjs
git commit -m "feat(goal): goal-digest.ps1 parity (raw bytes via Process, ArgumentList, LiteralPath)"
```

---

### Task 3: `goal-state.sh` — section-scoped (CRLF-tolerant) readers + monotonic `ship-red-bump`

**Files:** Create `src/shared/scripts/goal-state.sh`; Test `tools/test/goal-state.test.mjs`.

- [ ] **Step 1: Write the failing tests** (`tools/test/goal-state.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = fileURLToPath(new URL('../../src/shared/scripts/goal-state.sh', import.meta.url));
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
  assert.equal(run(['field', 'phase', 'state.md'], d), 'code-review'); // not the Notes DECOY
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
  assert.equal(run(['ship-red-bump', 'state.md'], d), '3');   // monotonic (catches inverted counter)
  assert.equal(run(['ship-red-count', 'state.md'], d), '3');
  assert.match(readFileSync(join(d, 'state.md'), 'utf8'), /## Attempts[\s\S]*n=3/);
});
test('unknown subcommand exits 3', G, () => {
  assert.equal(spawnSync('sh', [SH, 'bogus'], { cwd: mk('x') }).status, 3);
});
```

- [ ] **Step 2: Run — verify failure.** → FAIL (missing script).

- [ ] **Step 3: Write `src/shared/scripts/goal-state.sh`**

```sh
#!/bin/sh
# goal-state.sh — section-scoped, CRLF-tolerant readers/writers for /goal state.md (§4/§6.2/§10).
# field <name> [file] | round-count <plan|code> [file] | ship-red-count [file] | ship-red-bump [file]
set -eu
# section <header> <file>: lines under '## <header>' up to the next '## ' (CRLF-tolerant)
section() { awk -v h="$1" '{ sub(/\r$/,"") } $0=="## " h {i=1;next} /^## / {i=0} i {print}' "$2"; }
cmd="${1:-}"
case "$cmd" in
  field)
    name="${2:-}"; file="${3:-.workflow/state.md}"; [ -f "$file" ] || { printf ''; exit 0; }
    section "/goal loop" "$file" | awk -v k="$name" '
      $0 ~ ("^\\| *" k " *\\|") { s=$0; sub(/^\| *[^|]* *\| */,"",s); sub(/ *\|.*$/,"",s); print s; exit }'
    ;;
  round-count)
    loop="${2:-}"; file="${3:-.workflow/state.md}"; [ -f "$file" ] || { echo 0; exit 0; }
    section "Review log" "$file" | grep -c -e "loop=$loop .*kind=round" 2>/dev/null | head -1 || echo 0
    ;;
  ship-red-count)
    file="${2:-.workflow/state.md}"; [ -f "$file" ] || { echo 0; exit 0; }
    n=$(section "Attempts" "$file" | sed -n 's/.*ATTEMPT ship-red — n=\([0-9][0-9]*\).*/\1/p' | tail -1)
    [ -n "$n" ] && echo "$n" || echo 0
    ;;
  ship-red-bump)
    file="${2:-.workflow/state.md}"
    cur=$(sh "$0" ship-red-count "$file"); next=$((cur + 1))
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ); line="- ATTEMPT ship-red — n=$next — ts=$ts"
    [ -f "$file" ] || : > "$file"
    if grep -q '^## Attempts' "$file" 2>/dev/null; then
      # append at the END of the ## Attempts section (before next '## ' or EOF) → newest last
      awk -v L="$line" '
        { sub(/\r$/,"") }
        /^## / && insec { print L; insec=0 }
        { print }
        $0=="## Attempts" { insec=1 }
        END { if (insec) print L }' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    else
      printf '\n## Attempts\n%s\n' "$line" >> "$file"
    fi
    echo "$next"
    ;;
  *) echo "goal-state: unknown subcommand '$cmd'" >&2; exit 3 ;;
esac
```

- [ ] **Step 4: Run — verify pass.** → PASS (incl. monotonicity, CRLF, section-scope, zero).

- [ ] **Step 5: Commit.**
```bash
git add src/shared/scripts/goal-state.sh tools/test/goal-state.test.mjs
git commit -m "feat(goal): goal-state.sh section-scoped CRLF-tolerant readers + monotonic ship-red-bump"
```

---

### Task 4: `goal-state.ps1` — parity (all four subcommands, exit 3, append-at-end)

**Files:** Create `src/shared/scripts/goal-state.ps1`; Test `tools/test/goal-state.ps1.test.mjs`.

- [ ] **Step 1: Write the failing parity test** (`tools/test/goal-state.ps1.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SH  = fileURLToPath(new URL('../../src/shared/scripts/goal-state.sh',  import.meta.url));
const PS1 = fileURLToPath(new URL('../../src/shared/scripts/goal-state.ps1', import.meta.url));
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
  const ds = mk(), dp = mk();               // two bumps each → both must read '2'
  sh(['ship-red-bump','state.md'], ds); assert.equal(sh(['ship-red-bump','state.md'], ds), '2');
  ps1(['ship-red-bump','state.md'], dp); assert.equal(ps1(['ship-red-bump','state.md'], dp), '2');
  assert.equal(ps1(['ship-red-count','state.md'], dp), sh(['ship-red-count','state.md'], ds));
  assert.equal(spawnSync('sh',   [SH,  'bogus'], { cwd: mk() }).status, 3);
  assert.equal(spawnSync('pwsh', ['-NoProfile','-File',PS1,'bogus'], { cwd: mk() }).status, 3);
});
```

- [ ] **Step 2: Run — verify failure/skip.**

- [ ] **Step 3: Write `src/shared/scripts/goal-state.ps1`**

```powershell
#!/usr/bin/env pwsh
# goal-state.ps1 — parity twin of goal-state.sh (§4/§6.2/§10), section-scoped, CRLF-tolerant.
param([string]$Cmd = '', [string]$A2 = '', [string]$A3 = '')
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
function DefaultFile($f) { if ($f) { $f } else { '.workflow/state.md' } }
function Section([string]$header, [string]$file) {
  $in = $false
  foreach ($raw in Get-Content -LiteralPath $file) {
    $line = $raw -replace "`r$", ''
    if ($line -eq "## $header") { $in = $true; continue } elseif ($line -like '## *') { $in = $false }
    if ($in) { $line }
  }
}
switch ($Cmd) {
  'field' {
    $name = $A2; $file = DefaultFile $A3; if (-not (Test-Path -LiteralPath $file)) { return }
    foreach ($l in Section '/goal loop' $file) {
      if ($l -match "^\|\s*$([regex]::Escape($name))\s*\|\s*(.*?)\s*\|") { $matches[1]; break }
    }
  }
  'round-count' {
    $loop = $A2; $file = DefaultFile $A3; if (-not (Test-Path -LiteralPath $file)) { '0'; break }
    (Section 'Review log' $file | Where-Object { $_ -match "loop=$loop .*kind=round" }).Count
  }
  'ship-red-count' {
    $file = DefaultFile $A2; if (-not (Test-Path -LiteralPath $file)) { '0'; break }
    $ns = Section 'Attempts' $file | ForEach-Object { if ($_ -match 'ATTEMPT ship-red — n=(\d+)') { [int]$matches[1] } }
    if ($ns) { $ns[-1] } else { '0' }
  }
  'ship-red-bump' {
    $file = DefaultFile $A2
    $cur = [int](& pwsh -NoProfile -File $PSCommandPath 'ship-red-count' $file)
    $next = $cur + 1; $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $line = "- ATTEMPT ship-red — n=$next — ts=$ts"
    if (-not (Test-Path -LiteralPath $file)) { New-Item -ItemType File -Path $file | Out-Null }
    $content = @(Get-Content -LiteralPath $file)
    if ($content -contains '## Attempts') {
      $outLines = New-Object System.Collections.Generic.List[string]; $insec = $false
      foreach ($l in $content) {
        if (($l -like '## *') -and $insec) { $outLines.Add($line); $insec = $false }
        $outLines.Add($l)
        if ($l -eq '## Attempts') { $insec = $true }
      }
      if ($insec) { $outLines.Add($line) }
      Set-Content -LiteralPath $file -Value $outLines
    } else { Add-Content -LiteralPath $file -Value "`n## Attempts`n$line" }
    $next
  }
  default { [Console]::Error.WriteLine("goal-state: unknown subcommand '$Cmd'"); exit 3 }
}
```

- [ ] **Step 4: Run — verify parity.** → PASS on a dual-runtime host.

- [ ] **Step 5: Commit.**
```bash
git add src/shared/scripts/goal-state.ps1 tools/test/goal-state.ps1.test.mjs
git commit -m "feat(goal): goal-state.ps1 parity (section-scoped, append-at-end, exit 3)"
```

---

### Task 5: Verify CI auto-discovers the new tests (no CI edit)

- [ ] **Step 1:** `grep -n "node --test" .github/workflows/ci.yml` → Ubuntu bare `node --test`,
  Windows `node --test tools/test/`; both auto-discover `tools/test/*.test.mjs`. No CI edit needed.
- [ ] **Step 2:** `npm run check` → lint + evals + `node --test` green; `.ps1.test.mjs` SKIP without `pwsh`.
- [ ] **Step 3:** No commit (CI unchanged). Do NOT run an empty `git commit`.

---

## Self-Review (rev3)

**Plan-review round-2 findings (Opus + Codex) — disposition (all fixed here):**
- ship-red counter inverted → **append at END** of `## Attempts` (sh awk + ps1 list); **monotonicity
  test** (`bump→bump→bump→count==3`) added (Tasks 3, 4).
- `git diff` abbreviated-OID collision / textconv / ext-diff / prefix config →
  `--full-index --no-ext-diff --no-textconv --default-prefix` on both scripts, both modes (Global
  Constraints; Tasks 1, 2).
- linked-worktree absolute `--git-path index` → rooted-path check (`case /*` / `IsPathRooted`);
  worktree test asserting the real index is byte-unchanged (Tasks 1, 2).
- fail-open producer failures → every `git add -N`/`git diff` nonzero → exit 3 (both engines).
- ps1 `Start-Process -RedirectStandardOutput` not raw on Unix → `System.Diagnostics.Process` +
  `StandardOutput.BaseStream.CopyTo` (raw); invalid-UTF-8 (`0x89 0xff 0xfe`) parity fixture.
- ps1 arg splitting / wildcard `Test-Path`/`Resolve-Path` → `ProcessStartInfo.ArgumentList` +
  `-LiteralPath` everywhere; parity fixture uses a **space in the repo path** and `app/[id]/`.
- CRLF → `sub(/\r$/,"")` in sh `section()`/bump awk; `-replace "\r$"` in ps1 `Section`; CRLF test.
- sh-only tests lacked `hasSh` → every sh-spawning suite guarded with `hasSh` (`G`); parity suites
  guarded with `hasSh && hasPwsh`.
- §6.1 coverage → added empty-file, plan-doc, config, package.json positive controls, executable-bit
  change, symlink/leading-dash present≠absent, modify+delete+add invariance, linked-worktree.
- ps1 empty-base exit 1 → `$Base=''` default + `IsNullOrEmpty` guard → exit 3; empty-base test (sh).
- broken inline test stub in Task 1 Step 1 → removed (single `spawnSync` exit-3 test).

**Placeholder scan:** clean. **Name/signature consistency:** subcommands + `<base_sha> [repo_dir]
[--from-head]` + the exclusion set + diff flags are identical across `.sh`, `.ps1`, and Global
Constraints. **Deferred to Plan C:** the state *write* path (gate1/gate2/SIMPLIFY/blocker writers)
and the caller-side breaker comparison.

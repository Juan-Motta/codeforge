# Fase 3 Plan B — verify-e2e skill + workflow wiring + installers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **rev2** — Opus + Codex plan-reviewed rev1 (both BLOCKING). Applied: 6th steer site (SKILL.md:8-11 intro) + broadened grep; extending.md roadmap; byte-for-byte drift test; normative UI-flow specifics; ps1 exact-line match + pwsh-guarded test; fresh-install no-dup assertion; marker derived from install.sh.
>
> **rev3** — Opus + Codex plan-reviewed rev2 (both BLOCKING; residuals shell/cross-platform robustness). Applied inline: `src/docs/extending.md` added to Task 3's `git add`; owner=goal HALT scope tightened to dep/resolution/version/browser-absence (NOT app/infra nav failure, which is retry-then-block per §4.2a); drift test derives EOL from `refRegion` (no hardcoded LF → CRLF-checkout safe); ps1 guard uses `$_ -ceq '.workflow/'` (exact, case-sensitive, no trim); bash append is newline-safe (won't fuse onto a no-EOL last line); typo fixed. Finer test-coverage criteria (ps1 false-positive case, ps1 no-dup count, no-trailing-newline seed) enforced as execution acceptance criteria — see **Appendix**. User decision: after this, EXECUTE (tests + Windows CI are the arbiter for the remaining shell/EOL robustness, as with Plan A).

**Goal:** Wire Plan A's tested reference harness into the shipped product: embed `run-journey.mjs` verbatim into `verify-e2e/SKILL.md` (drift-guarded), extend the skill with the UI journey flow + classification + UC template fields, flip every workflow that currently steers UI changes to `N/A`, and make the installers' `.workflow/` gitignore entry robust.

**Architecture:** codeforge's source of truth is `src/` (skills, rules, CLAUDE.md); `src/sync.{sh,ps1}` copies these into a target at install time (codeforge does NOT commit `.claude`/`.agents` mirrors — the smoke test verifies install-time sync). So edits land in `src/` only. The reference harness lives in `tools/` (framework dev-scope, never shipped); the skill carries a **verbatim copy** of its sentinel-delimited region, kept honest by a byte-for-byte drift test in `tools/test/`.

**Tech Stack:** Markdown (skills/rules), Bash + PowerShell (installers), Node `node:test` (drift + installer regression tests).

## Global Constraints

- Source of truth is `src/`; do NOT hand-edit or commit `.claude`/`.agents` mirrors (none exist in this repo — sync generates them into targets at install).
- The skill must read identically for Claude Code, Codex, and OpenCode (engine-neutral prose; no engine-specific-only instructions in the shared skill body).
- The embedded harness in `SKILL.md` is a **byte-for-byte verbatim** copy of the region between `// e2e-ui-ref:start` and `// e2e-ui-ref:end` in `tools/e2e-ui-ref/run-journey.mjs`, wrapped in HTML sentinels `<!-- e2e-ui-ref:start -->` / `<!-- e2e-ui-ref:end -->` around a ```` ```js ```` fenced block. A drift test fails if they diverge. The shebang line is NOT part of the region.
- UI classification (from the certified spec): required-but-unrunnable UI journey → `FAIL_INFRA` (blocks); `N/A` ONLY when there is no applicable UI journey; under `owner=goal` an unavoidable browser-approval requirement → HALT (schema-valid blocker + `status=halted`).
- The UI UC template requires `App root` (repo-relative filesystem anchor) and `App URL` (served base origin); their absence is a shape reject (`MISSING_APP_ROOT` / `MISSING_APP_URL` → `FAIL_INVALID_UC`).
- `@playwright/test >=1.59` (library API, no runner/config) is the documented target prerequisite; `page.ariaSnapshot({mode:'ai'})` (NOT the removed `page.accessibility`).
- `npm run check` (lint:skills + eval:routing + test:tools) must stay green after every task.

---

### Task 1: Clean the reference harness comments (pre-embed hygiene)

**Files:**
- Modify: `tools/e2e-ui-ref/run-journey.mjs`
- Test: `tools/test/e2e-ui-pattern.test.mjs` (no change; must still pass)

**Interfaces:**
- Produces: a `run-journey.mjs` whose sentinel region has accurate comments, so the verbatim embed (Task 2) ships correct text to users.

- [ ] **Step 1: Fix the two inaccurate comments (final-review P3 nits)**

In `tools/e2e-ui-ref/run-journey.mjs`:
- The watchdog comment that says (approximately) "only a fully-successful run clears it" is imprecise — teardown clears it on failure paths too. Replace it with: `// #5: hard watchdog — cleared ONLY in the finally, after teardownAll() returns (both success and failure paths), so a hanging teardown lets it fire.`
- Do NOT touch the port-9 test comment here (that comment is in the test file, `e2e-ui-pattern.test.mjs`, not the harness region) — fix it in Step 2.

- [ ] **Step 2: Fix the test's port-9 comment**

In `tools/test/e2e-ui-pattern.test.mjs`, the `navigation failure (bad URL)` test comment claims a `TimeoutError`; port 9 actually yields `net::ERR_UNSAFE_PORT`. Update the comment to: `// nav-phase failure (ERR_UNSAFE_PORT) classifies FAIL_INFRA — proves classification is phase-based, not error-name-based.`

- [ ] **Step 3: Verify nothing broke**

Run: `E2E_BROWSER_REQUIRED=1 node --test tools/test/e2e-ui-pattern.test.mjs`
Expected: 17/17 pass, 0 skipped (comment-only changes).
Run: `npm run check`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add tools/e2e-ui-ref/run-journey.mjs tools/test/e2e-ui-pattern.test.mjs
git commit -m "docs(e2e-ui): fix imprecise harness/test comments before verbatim embed"
```

---

### Task 2: Embed the harness into verify-e2e/SKILL.md + UI section + drift guard

**Files:**
- Modify: `src/skills/verify-e2e/SKILL.md`
- Create: `tools/test/skill-embed-drift.test.mjs`

**Interfaces:**
- Consumes: the sentinel region of `tools/e2e-ui-ref/run-journey.mjs` (Task 1).
- Produces: a `verify-e2e` skill that documents UI journeys (Interface `UI`, the a–f flow, classification matrix, UC template fields) and carries the verbatim harness; a drift test that binds the embed to the reference file.

- [ ] **Step 1: Write the failing drift test**

Create `tools/test/skill-embed-drift.test.mjs`:
```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/test/skill-embed-drift.test.mjs`
Expected: FAIL — the `<!-- e2e-ui-ref:start/end -->` markers do not yet exist in `SKILL.md`.

- [ ] **Step 3: Add the UI section + embed to SKILL.md**

Read `src/skills/verify-e2e/SKILL.md` first. Make these edits (the skill today covers API + CLI; UI is deferred):

1. **Frontmatter `description`:** change the API/CLI-only wording to "Execute user-journey use cases (API, CLI, and UI) against the running app, classify each, and write a committed evidence report the ship-gate binds to."
1b. **The skill's intro paragraph (`verify-e2e/SKILL.md:8-11`)** currently says "API and CLI are executed in v1; UI is deferred (record `E2E verified — N/A: UI journey, no v1 adapter`)." REWRITE it so UI is a first-class executed interface (no deferral, no UI N/A instruction) — e.g. "API, CLI, and UI journeys are executed. Run **user journeys** — not unit tests — against real interfaces, then bind the result to the ship-gate with an evidence report." This is a SIXTH steer site with different wording than the ship-gates line; it MUST be edited here or the shipped skill self-contradicts its own §4.
2. **§0/§1 (validate journey shape):** add `UI` to the Interface enum; add the UI shape reason codes `MISSING_APP_ROOT` and `MISSING_APP_URL`; add UI Verification vocabulary (sees / appears / is shown / the toast says / the row is highlighted; a single element-visible check is `THIN_VERIFICATION`). Add the UI UC required fields: `App root` (repo-relative filesystem path — the owning package with `@playwright/test`), `App URL` (served base origin, env-var reference allowed), `Persistence mechanism` (localStorage | sessionStorage | cookie | server).
3. **§4 (ACT + VERIFY):** add a new **UI** subsection describing the a–f flow, with these NORMATIVE specifics from the spec (do not summarize them away — they are fixed behavior, spec §4.2):
   - **DISCOVER** via `page.ariaSnapshot({mode:'ai'})`, **iterative + bounded**: drive to the step whose controls aren't yet known, re-snapshot; **at most ONE repair re-discovery per failing step, then re-run the whole journey from a clean Setup before classifying** (spec §4.2b).
   - **PERSIST per the exact declared mechanism** (spec §4.2e): `localStorage` → reload OR new page in the SAME context; `sessionStorage` → same-page RELOAD only (a new page/tab false-fails it); `cookie`/auth → reload or new page per cookie scope; `server` state → FRESH context (discards storage) + sanctioned UI re-login. State the required reset/re-verify operation per mechanism.
   - **DETECT/PREFLIGHT + failure matrix** (spec §4.2a): Playwright (`@playwright/test >=1.59`) is a documented target prerequisite; a required UI journey with missing/unresolvable/too-old tooling → `FAIL_INFRA` (not N/A, not blind-retried); app/infra nav failure → `FAIL_INFRA` (retry once); missing `App root`/`App URL` → `FAIL_INVALID_UC`; `N/A` only when no applicable UI journey. **Under `owner=goal`, an unavoidable/unrecoverable failure → HALT** with a schema-valid blocker `- [ ] BLOCKER — <phase> — <reason> — ts=<ISO>` + `status=halted`. "Unrecoverable" = a browser-approval requirement that cannot self-serve, OR a dependency/resolution/version/browser-absence `FAIL_INFRA` (tooling that can't be made to run). It does NOT include an app/infra nav failure (server down/timeout), which per §4.2a is `FAIL_INFRA` retry-once-then-block — a normal ship-blocking result, not a HALT. Match the spec §4.2a matrix exactly.
   - **CAPTURE/CLEANUP** with `git check-ignore` (fail closed); traces never committed.
   - Reference the embedded harness as the canonical pattern, with the boundary note: **"Adapt ONLY the marked JOURNEY block; the harness around it is verbatim — do not modify it."**
4. **Embed the harness** (immediately after the UI subsection): a fenced block delimited by the HTML sentinels:
   ```
   <!-- e2e-ui-ref:start -->
   ```js
   <PASTE the exact text between `// e2e-ui-ref:start` and `// e2e-ui-ref:end` from tools/e2e-ui-ref/run-journey.mjs, verbatim>
   ```
   <!-- e2e-ui-ref:end -->
   ```
   Copy the region byte-for-byte (the drift test enforces this). Do NOT include the shebang.
5. **§5 (classify + verdict):** add the UI rows to the classification guidance — `FAIL_INFRA` for tooling/resolution/version failures (not blind-retried) and app/infra nav failures (retry once); `FAIL_INVALID_UC` for missing `App root`/`App URL`; `FAIL_BUG` for a genuine UI assertion failure.
6. **§ Safety:** UI specifics — non-prod default; redact screenshots/console output; **traces are never committed**; escape UC-provided values into scripts, never `eval` raw UC text; headless.
7. **§6 (report):** the UI evidence block is a durable text digest (finalized locator map, exact assertions, sanitized observations, package + browser versions, command + exit status); artifact paths (screenshots/traces under gitignored `.workflow/e2e-run/`) are labeled **local-only, not reviewable proof**.
8. **Common rationalizations + Red flags:** add UI rows ("asserted a CSS class" → use role/testid/text; "read the DB to confirm" → assert through the page; "the screenshot proves it" → the assertion, not the image, is the check).
9. **Verification checklist:** add UI-aware lines.

- [ ] **Step 4: Run the drift test + skill lint**

Run: `node --test tools/test/skill-embed-drift.test.mjs`
Expected: PASS (embed matches the reference region byte-for-byte).
Run: `npm run lint:skills`
Expected: PASS (the skill linter accepts the UI section + embedded code block; if the linter flags the fenced block or a structural rule, adjust the SKILL.md structure — NOT the embedded code — and re-run; if the linter genuinely cannot accept a fenced code block, STOP and report as DONE_WITH_CONCERNS).
Run: `npm run check`
Expected: green (lint + evals + all tool tests incl. the new drift test).

- [ ] **Step 5: Commit**

```bash
git add src/skills/verify-e2e/SKILL.md tools/test/skill-embed-drift.test.mjs
git commit -m "feat(verify-e2e): UI journey adapter + verbatim harness embed + drift guard"
```

---

### Task 3: Flip the workflows that steer UI changes to N/A

**Files:**
- Modify: `src/skills/new-feature/SKILL.md`, `src/skills/fix-bug/SKILL.md`, `src/shared/rules/ship-gates.md`, `src/CLAUDE.md`, `README.md`
- Modify: `src/docs/extending.md` (roadmap: UI adapter future→done)
- Modify: `tools/test/check-gates.test.mjs` (the test that embeds the ship-gates.md doc line)

**Interfaces:**
- Consumes: the UI adapter now existing in `verify-e2e` (Task 2).
- Produces: workflows that route UI-facing changes THROUGH the UI adapter instead of recording `N/A`; a ship-gate whose N/A carve-out no longer excuses UI.

- [ ] **Step 1: Read the current steering text**

Run: `grep -rn "UI-only\|API/CLI\|API & CLI\|no v1 adapter" src/skills/new-feature/SKILL.md src/skills/fix-bug/SKILL.md src/shared/rules/ship-gates.md src/CLAUDE.md README.md`
Note each exact string (they differ per file). These are what you edit.

- [ ] **Step 2: Edit each steering site**

- `src/skills/new-feature/SKILL.md` §6 (Verify): change "design/execute API & CLI user-journey use cases … For purely internal or UI-only changes, record `E2E verified — N/A`" so that **UI-facing** changes get a UI use case (API + CLI + UI); keep `N/A` ONLY for purely-internal changes (migration, refactor, tooling).
- `src/skills/fix-bug/SKILL.md`: change "confirm the fix through the user-facing interface (API/CLI). Internal-only fixes record `N/A`" to include UI (API/CLI/UI); `N/A` only for internal-only fixes.
- `src/shared/rules/ship-gates.md` (the `E2E verified` line): drop "and UI-only changes (no v1 adapter)" from the N/A carve-out, so it reads `— N/A: <reason> allowed for purely internal changes (migration, refactor, tooling)` only.
- `src/CLAUDE.md` (the `verify-e2e` index line): "execute API/CLI user-journey use cases" → "execute API/CLI **and UI** user-journey use cases".
- `README.md` (the `verify-e2e` table row): same wording update to include UI.
- `src/docs/extending.md` (spec §5.3): the "verify-e2e roadmap (v2)" list (~lines 117-124) still lists "UI interface adapter: drive browser-based use cases (today's skill covers API/CLI)" as PLANNED. Move it from future→done (delete it from the future list, or note it as shipped), and KEEP "Playwright `.spec.ts` regression bridge" as the next deferred item (Fase 3.5).

- [ ] **Step 3: Update the check-gates test that embeds the doc line**

`tools/test/check-gates.test.mjs` test `k` embeds the `ship-gates.md` `E2E verified` doc line VERBATIM (including "and UI-only changes (no v1 adapter)"). Update that embedded string to match the new ship-gates.md wording from Step 2. The test's PURPOSE (a mis-copied doc line with a placeholder report path must exit 1) must be preserved — only the embedded doc-line string changes.

- [ ] **Step 4: Verify**

Run: `node --test tools/test/check-gates.test.mjs`
Expected: PASS (the updated embedded string still exercises the placeholder-rejection path → exit 1).
Run: `npm run check`
Expected: green.
Run: `grep -rniE "no v1 adapter|UI (is |journey, )?deferred|UI-only changes|today's skill covers API/CLI" src/ README.md tools/`
Expected: no matches (every UI-deferral phrasing removed — the SKILL.md intro, the ship-gates carve-out, extending.md roadmap, and any other). This broad pattern catches the differently-worded intro (`UI journey, no v1 adapter`) that a narrow grep would miss. (A `docs/CHANGELOG.md` history match is acceptable — it's release documentation, not active steering; exclude it or ignore it.)

- [ ] **Step 5: Commit**

```bash
git add src/skills/new-feature/SKILL.md src/skills/fix-bug/SKILL.md src/shared/rules/ship-gates.md src/CLAUDE.md README.md src/docs/extending.md tools/test/check-gates.test.mjs
git commit -m "feat(workflows): route UI-facing changes through the verify-e2e UI adapter (drop UI N/A carve-out)"
```

---

### Task 4: Robust `.workflow/` gitignore merge in both installers

**Files:**
- Modify: `install.sh`, `install.ps1`
- Create: `tools/test/install-gitignore.test.mjs`

**Interfaces:**
- Produces: installers that guarantee `.workflow/` is git-ignored in the target even when the codeforge marker block already exists but the `.workflow/` line was removed — closing the D4 gap the harness's `git check-ignore` guard depends on.

- [ ] **Step 1: Write the failing regression test**

Create `tools/test/install-gitignore.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function countWorkflowIgnores(gitignorePath) {
  return readFileSync(gitignorePath, 'utf8').split('\n').filter((l) => l.trim() === '.workflow/').length;
}
// Derive the EXACT marker line from install.sh so the seed byte-matches (em-dash included) — a
// mismatched marker would make the RED step vacuous (installer treats marker as absent and writes
// .workflow/ anyway, hiding the fix).
function codeforgeMarker() {
  const sh = readFileSync(join(REPO, 'install.sh'), 'utf8');
  const m = sh.match(/# codeforge \(local state[^\n']*/);
  assert.ok(m, 'could not find the codeforge gitignore marker in install.sh');
  return m[0];
}
const hasPwsh = (() => { try { execFileSync('pwsh', ['-v'], { stdio: 'pipe' }); return true; } catch { return false; } })();

test('install.sh restores .workflow/ when the marker exists but the entry was removed', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-sh-'));
  try {
    writeFileSync(join(target, '.gitignore'), codeforgeMarker() + '\n.DS_Store\n.claude/settings.local.json\n');
    execFileSync('bash', [join(REPO, 'install.sh'), target], { cwd: REPO, stdio: 'pipe' });
    assert.equal(countWorkflowIgnores(join(target, '.gitignore')), 1, '.workflow/ present exactly once');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.sh fresh install then re-install yields .workflow/ exactly once (no double-append)', () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-fresh-'));
  try {
    execFileSync('bash', [join(REPO, 'install.sh'), target], { cwd: REPO, stdio: 'pipe' }); // fresh
    execFileSync('bash', [join(REPO, 'install.sh'), target], { cwd: REPO, stdio: 'pipe' }); // idempotent re-run
    assert.equal(countWorkflowIgnores(join(target, '.gitignore')), 1, 'no duplicate .workflow/ across installs');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('install.ps1 restores .workflow/ when the marker exists but the entry was removed', { skip: hasPwsh ? false : 'pwsh not available' }, () => {
  const target = mkdtempSync(join(tmpdir(), 'cf-gi-ps1-'));
  try {
    writeFileSync(join(target, '.gitignore'), codeforgeMarker() + '\n.DS_Store\n.claude/settings.local.json\n');
    execFileSync('pwsh', ['-File', join(REPO, 'install.ps1'), target], { cwd: REPO, stdio: 'pipe' });
    assert.equal(countWorkflowIgnores(join(target, '.gitignore')), 1, '.workflow/ present exactly once (ps1)');
  } finally { rmSync(target, { recursive: true, force: true }); }
});
```
(If `install.sh`/`install.ps1`'s argument form differs, match its real CLI — check the top of each for how it takes the target dir, and how `install.ps1` binds `$Target` as a positional param. Adjust the invocation and note it. `install.ps1` may need `-Target` named vs positional — verify.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/test/install-gitignore.test.mjs`
Expected: FAIL — the current installer adds the whole block only when the marker is ABSENT, so a damaged `.gitignore` (marker present, `.workflow/` missing) is not repaired → `countWorkflowIgnores` is 0.

- [ ] **Step 3: Make the `.workflow/` merge independent of the marker block**

In `install.sh`, after the existing marker-gated block, add an idempotent independent merge (so `.workflow/` is ensured regardless of the marker):
```bash
# Ensure .workflow/ is ignored even if the marker block predates it or was edited (idempotent).
if ! grep -qxF '.workflow/' "$TARGET/.gitignore"; then
  # If the file's last byte isn't a newline, add one first so we don't fuse onto that line.
  [ -s "$TARGET/.gitignore" ] && [ -n "$(tail -c1 "$TARGET/.gitignore")" ] && printf '\n' >> "$TARGET/.gitignore"
  printf '.workflow/\n' >> "$TARGET/.gitignore"
fi
```
Apply the equivalent in `install.ps1` — use an EXACT-LINE match, NOT a substring search (`Select-String -SimpleMatch '.workflow/'` would falsely match a comment like `# .workflow/` or a longer pattern, suppressing the required entry):
```powershell
# Ensure .workflow/ is ignored (idempotent, exact-line), independent of the marker block.
$giPath = Join-Path $Target '.gitignore'
$giLines = if (Test-Path $giPath) { Get-Content -Path $giPath } else { @() }
# Exact, case-SENSITIVE, whole-line match (mirrors the sh side's `grep -qxF`) — NOT .Trim()/-eq,
# which would let ` .workflow/` or `.WORKFLOW/` falsely suppress the required entry.
if (-not ($giLines | Where-Object { $_ -ceq '.workflow/' })) {
  Add-Content -Path $giPath -Value '.workflow/'
}
```
(Match the actual variable names in each installer — `$TARGET`/`$Target` etc. Read the surrounding code to use the right ones and the right conditional style. `install.ps1` uses `$Target` — verified.)

- [ ] **Step 4: Run to verify it passes + no double-append**

Run: `node --test tools/test/install-gitignore.test.mjs`
Expected: PASS — `.workflow/` present exactly once (the `grep -qxF` guard prevents a duplicate when the entry already exists from a fresh install).
Run: `npm run check` and `sh tests/smoke.sh`
Expected: green (smoke's fresh-install path still yields a single `.workflow/` entry — the idempotent guard is a no-op there).

- [ ] **Step 5: Commit**

```bash
git add install.sh install.ps1 tools/test/install-gitignore.test.mjs
git commit -m "fix(install): ensure .workflow/ gitignore entry independent of the marker block"
```

---

## Self-Review

**1. Spec coverage (Plan B slice):**
- Embed verbatim + drift guard + "adapt only the marked block" boundary → Task 2. UI Interface + flow + classification matrix + UC template fields (App root/App URL/Persistence) + shape codes → Task 2. The 5 UI→N/A steer edits + check-gates.test drift → Task 3. Installer `.workflow/` independent merge + regression → Task 4. Harness comment cleanup → Task 1.
- **Deferred to Plan C (correctly):** routing evals for the UI journey case; `tests/smoke.sh` assertions (verify-e2e ships to both mirrors, UI-N/A wording gone, embed survives sync); the D6d portability test (extract the fenced block from an INSTALLED skill + run it in a throwaway target).

**2. Placeholder scan:** Task 2 Step 3 describes exact edits to an existing large file (the full SKILL.md can't be reproduced here, but each edit names the section + exact new wording); the embedded code is a verbatim copy of an existing file's region (enforced by the drift test, not free-authored). Tasks 1/3/4 carry complete code/edits. No TBD/TODO.

**3. Type/name consistency:** sentinel strings match Plan A (`// e2e-ui-ref:start/end` in the reference; `<!-- e2e-ui-ref:start/end -->` in the skill). Shape codes `MISSING_APP_ROOT`/`MISSING_APP_URL` match the spec. The ship-gates.md wording change in Task 3 Step 2 and the check-gates.test.mjs embedded string in Step 3 are edited together (no drift). `.workflow/` ignore string is consistent across installers + the harness's `git check-ignore` (Plan A Task 7).

---

## Appendix — review residuals enforced as acceptance criteria during execution (rev3)

The implementing subagent MUST satisfy these via real tests (Windows CI runs `tools/test/`, so cross-platform correctness is verified there, not just locally):

- **ps1 exactness false-positive test:** add a case seeding `.gitignore` with a near-miss line (` .workflow/` with a leading space AND/OR `.WORKFLOW/`) plus the marker but no exact `.workflow/`; assert `install.ps1` still appends the exact `.workflow/` (the `-ceq` guard must not treat the near-miss as present). pwsh-guarded skip.
- **ps1 no-duplicate (fresh/re-install):** add a ps1 case that runs `install.ps1` twice on a fresh target and asserts `.workflow/` appears exactly once (mirror of the bash fresh/re-install test).
- **No-trailing-newline seed:** add a case (at least sh) seeding a `.gitignore` whose last line has NO terminating newline (marker present, `.workflow/` absent, no final `\n`); assert after install `.workflow/` is on its own line (not fused onto the previous line) and appears exactly once — proving the newline-safe append.
- **Per-installer marker robustness (nice-to-have):** the ps1 test may derive its seed marker from `install.ps1` (not `install.sh`) so a future divergence between the two markers doesn't make the ps1 RED vacuous. Today they're byte-identical, so deriving from either works.
- **Drift-test EOL:** the byte-for-byte assertion derives its fence EOL from `refRegion` (rev3); confirm it passes on both an LF and (if reproducible) a CRLF checkout, or note that `.gitattributes` is absent and the derive-from-content approach handles it.

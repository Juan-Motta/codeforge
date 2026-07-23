# Fase 3 v1 — UI interface adapter for `verify-e2e` (design)

**Status:** rev5 — Opus + Codex reviewed rev1–rev4 (all BLOCKING); converging (rev4 opened only
one-line-precision fixes; both engines agree D1–D6 are sound and F1/F5/F7/F8-ownership/F10/
browserless/watchdog/portability/package-surface resolved). rev5 applies the rev4 residuals:
absolute `App root` + Windows `pathToFileURL` import, `FAIL_INFRA` for all tooling/dep failures, a
required `App URL` field, bounded D6d execution env, and the `/goal` HALT-on-missing-dep wiring.
**rev6** (both engines CLEAN on rev5; applies the two agreed P2s + P3 nits): missing App fields are a
§1 shape reject (`FAIL_INVALID_UC`), not `FAIL_INFRA`; resolve+import+resolved-version is the single
authoritative dep check (a hoisted-but-resolvable dep passes; direct manifest declaration is not
required); dep/resolution `FAIL_INFRA` is not blind-retried.
**Date:** 2026-07-23. **Branch:** `feat/verify-e2e-ui` (off `dev`, `b618764`).
**Scope owner:** codeforge (`Juan-Motta/codeforge`, npm `@jualopezmo/codeforge`).

## 1. Problem

`src/skills/verify-e2e/SKILL.md` executes **API** and **CLI** user-journey use cases, classifies
each, and writes a committed evidence report the ship-gate binds to. **UI journeys are deferred** —
the skill and every workflow that calls it (`new-feature`, `fix-bug`, `ship-gates.md`) steer
UI-only changes to `E2E verified — N/A`. So any change whose only surface is a web UI cannot be
E2E-verified today. Fase 3 closes this gap — the last major capability gap vs claude-codex-forge.

## 2. Goal (v1) and non-goals

**Goal:** extend `verify-e2e` to execute **UI** user-journeys end-to-end and classify them with the
same rigor as API/CLI, producing the same committed evidence report that binds the `E2E verified`
gate — preserving codeforge's three constraints: **runs identically on Claude Code / Codex /
OpenCode**, **thin install** (only runtime files land in the target), **honest tiered enforcement**.

**Non-goals (deferred):**
- The Playwright `.spec.ts` **regression bridge** (`playwright test` runner + committed specs +
  `playwright.config` + CI rerun = the **Verified** tier for UI). v1 uses the *same*
  `@playwright/test` dep (D2) so 3.5 drops in with zero dependency churn.
- Auto-installing browsers into targets; mandatory shared auth fixture.
- **Multi-package/monorepo resolution beyond a single explicitly-declared owning app package**
  (§4.2a fails closed; a richer resolution knob is a documented 3.5 follow-up).
- Automatic multi-surface coverage audit.

## 3. Fixed decisions

| # | Decision | Value | Rationale |
|---|---|---|---|
| D1 | Scope v1 | UI adapter only; spec bridge → Fase 3.5 | YAGNI; the Fase 2 lesson |
| D2 | Driving + dep | Script-and-run via subprocess (no MCP); dev-dep **`@playwright/test` `>=1.59`** in the **target** (documented prerequisite, like `curl` for API) AND in **codeforge itself** (for the reference test); library API `import { chromium, expect } from '@playwright/test'` under plain `node`; **no runner, no config** in v1 | Engine-neutral; `expect` = web-first asserts; `playwright`+`@playwright/test` can't coexist ([PW 1.34]); `ariaSnapshot({mode})` needs 1.59 ([PW 1.57 removed `accessibility`, 1.59 added `mode`]) |
| D3 | Selector discovery | Iterative bounded discovery via `page.ariaSnapshot({ mode: 'ai' })` | `mode:"ai"` emits `[ref=e2]`; one start-URL snapshot can't reveal post-login/dialog controls |
| D4 | Artifacts | Scripts + trace/screenshots in gitignored `.workflow/e2e-run/`, guarded by `git check-ignore` (fail-closed); only the markdown report is committed, carrying a durable text digest | Repo thin; traces hold DOM/network/session → never trackable |
| D5 | Tooling missing for a **required** UI journey | **`FAIL_INFRA` (blocks)** — the single classification for every tooling/resolution/import/version failure (there is no generic `FAIL` in the report contract). The **authoritative** check is whether `@playwright/test` **resolves + imports** from the App root AND its **resolved version is >=1.59** — a hoisted-but-resolvable dep passes; a direct manifest declaration is neither required nor sufficient (the manifest scan is advisory, for the remediation message only). If it does not resolve or is <1.59 → `FAIL_INFRA`. Remediation during verify is limited to **non-repository state** (`npx playwright install chromium`); the devDep itself is an **implementation-phase prerequisite** — added to the target's `package.json` as a plan task and reviewed *before* verify (verify is read-only re: the repo; a manifest/lockfile edit here would slip an unreviewed dependency past the code-review gate). A verify-time absence is **not blind-retried** (retrying a missing dep is pointless); under `owner=goal` it takes the existing **unrecoverable→HALT** path (no automated re-entry into implementation is claimed — the human adds the dep and re-runs). `N/A` only when **no applicable UI journey** | Applicable-but-unrunnable is blocked infra; resolution (not declaration) is what determines runnability under hoisting; one classification keeps the report contract consistent |
| D6 | Standalone execution pattern | **Normative = a tested reference implementation** (`tools/e2e-ui-ref/run-journey.mjs`): (a) each §4.1 guarantee is an **inline comment** in the file so the "why" ships with the code; (b) it is **embedded verbatim** into SKILL.md between `<!-- e2e-ui-ref:start -->` / `<!-- e2e-ui-ref:end -->` sentinels, with a **byte-for-byte drift check** keyed on those sentinels; (c) SKILL.md demarcates an explicit **"adapt ONLY the marked journey block — the harness above/below is verbatim, do not modify"** boundary; (d) a portability acceptance test extracts the fenced block from an **installed** `.claude`/`.agents` skill and runs it in a throwaway target (proves no hidden dependency on unshipped `tools/`) | Fase 2 lesson: prose can't specify runtime failure/teardown/watchdog semantics without endless revs — code + tests is the right medium; but the shipped skill must carry the invariants + a do-not-touch boundary, else an adapting agent silently regresses the harness |

## 4. Architecture

### 4.1 Runtime pattern — normative reference implementation (D6)

Source of truth: `tools/e2e-ui-ref/run-journey.mjs` (framework-only, never shipped to targets),
exercised by `tools/test/e2e-ui-pattern.test.mjs`, embedded verbatim (sentinel-delimited) into
`verify-e2e/SKILL.md`. The reference MUST demonstrate these **guarantees** (each asserted by the
test, each present as an inline comment in the file):

1. **Dependency resolution (F8):** the owning app package is the **explicit repo-relative
   `App root` field the UI UC declares** — exactly one `package.json`. Normalize it to an
   **absolute** path against the repo root and validate containment (Node's `createRequire` rejects
   a relative arg). Resolve `@playwright/test` via `createRequire(path.join(absAppRoot,
   'package.json'))` (the arg is a **filename**, not a dir) + `require.resolve`, then
   dynamic-`import(pathToFileURL(resolved).href)` — `pathToFileURL` is required because a bare
   Windows path (`C:\…`) is an unsupported URL scheme for `import()`. So the throwaway script in
   `.workflow/e2e-run/` imports a dep even when hoisted into a workspace root. This resolve+import
   is the **authoritative** go/no-go (§4.2a); a `package.json` text-scan is advisory only.
2. **Init-guarded teardown:** `browser`/`context`/`tracing` declared before `try`; `finally` closes
   only what was created; **all** opened contexts closed (multi-context journeys).
3. **Primary-error preservation:** one `catch` keeps the first error, best-effort
   `page.screenshot()` + `tracing.stop({path})`, emits classification, exits **non-zero**; teardown
   errors never overwrite the primary error or exit code.
4. **Assertion timeout:** `expect.configure({ timeout })` (NOT `page.setDefaultTimeout`, which does
   not bound web-first assertions) + `page.setDefaultTimeout` for actions — **independently
   injectable** (see #5).
5. **Watchdog:** an overall deadline **injectable separately** from the assertion/action timeouts,
   implemented as a hard timer that calls `process.exit(nonzero)` **even if cleanup hangs** (cleanup
   must not be able to postpone the hard exit; a bare `Promise.race` does not cancel the underlying
   op).
6. **Error→classification map:** locator/action `TimeoutError` after one re-discovery AND failed
   `expect(...)` assertion errors → `FAIL_BUG`; browser launch/navigation failure, AND every
   dependency **resolution/import/version (<1.59)** failure → `FAIL_INFRA` (the single tooling
   classification — see D5); approval-boundary refusal under `owner=goal` → HALT (§4.2a). Covers
   action AND assertion paths.
7. **Browserless detection:** the reference **test** skips ONLY when the browser binary is truly
   absent — probe `existsSync(chromium.executablePath())` (executablePath alone returns the
   *expected* location, not proof). An **import/resolution failure must FAIL, never skip** (a skip
   there would hide a missing devDependency, broken #1 resolution, or a packaging regression). The
   ubuntu CI job sets a **`E2E_BROWSER_REQUIRED` flag** so a skip there is itself a test failure.

### 4.2 The UI journey flow (added to SKILL.md §4)

```
a. DETECT / PREFLIGHT
   - Shape (validated at SKILL.md §1, BEFORE execution): the UI UC MUST declare `App root` (a
     repo-relative filesystem path) and `App URL` (the served base origin, e.g.
     http://localhost:3000 or an env-var reference). Their absence is a shape reject
     (`MISSING_APP_ROOT`/`MISSING_APP_URL` → FAIL_INVALID_UC → rewrite the UC), NOT a preflight
     FAIL_INFRA. App root is a filesystem anchor for dependency resolution; App URL is where
     page.goto() lands — NOT the same (a monorepo app at apps/web/ is served at :5173).
   - Preflight go/no-go (AUTHORITATIVE): normalize App root to an absolute, containment-validated
     path; createRequire resolve + import @playwright/test from it + assert resolved version >=1.59
     + chromium.launch() + navigation to `App URL` + trial page.ariaSnapshot({mode:'ai'}). A
     package.json text-scan is advisory only (pick the PM remediation message) — a hoisted-dep repo
     that resolves fine is NOT failed on the scan; a directly-declared-but-unresolvable dep IS
     failed. Resolve/import failure, or resolved version <1.59 → FAIL_INFRA (not blind-retried; fix
     = add/bump the devDep during IMPLEMENTATION + re-review, D5 — verify never edits the repo).
   - Remediation allowed inside verify = browser binary only (`npx playwright install chromium`,
     non-repo state). Package manager for the message: `packageManager` field else lockfile.
   - Sandbox/approval matrix:
       * Interactive engines (Claude ask / Codex on-request / OpenCode ask): a boundary-crossing
         launch prompts → human approves. Fine.
       * owner=goal (unattended, ALL THREE engines): a required approval cannot self-serve → HALT.
         Write `- [ ] BLOCKER — <phase> — <reason> — ts=<ISO>` and set status=halted
         (shared/rules/goal-state.md); never per-round prompt or silently pass.
   - Failure matrix (deterministic — every tooling/dep failure is FAIL_INFRA):
       resolve/import failure or resolved version <1.59 → FAIL_INFRA, NOT retried (fix via
         implementation + re-review; verify read-only. Under owner=goal → existing unrecoverable→HALT.)
       browser binary absent (after `npx playwright install chromium` attempt) → FAIL_INFRA, not retried
       launch/nav blocked by approval boundary under owner=goal → HALT (terminal)
       launch/nav fails for app/infra reasons (server down, timeout) → FAIL_INFRA, retry once
       missing App root/App URL → FAIL_INVALID_UC (shape reject, §1) — rewrite the UC
       no applicable UI journey for the change → N/A (only here)

b. DISCOVER (iterative, bounded)  — page.ariaSnapshot({mode:'ai'}) to stdout; confirm getByRole/
   getByTestId/text locators. Multi-step: drive to the step whose controls aren't yet known,
   re-snapshot that state. At most one repair re-discovery per failing step, then re-run the whole
   journey from a clean Setup before classifying.

c. JOURNEY  — author the UC Steps as the reference-pattern script (§4.1) with confirmed locators;
   run headless with resolution anchored at the declared App root.

d. VERIFY   — assert ONLY user-observable outcomes THROUGH the page via web-first expect. Never
   CSS-class internals; never DB/log back-channels.

e. PERSIST (the UC declares the exact mechanism + reset op)
   - localStorage   → same context; reload OR a new page; re-assert.
   - sessionStorage → same page RELOAD only (scoped to the browsing context; new page/tab false-fails).
   - cookie / auth  → per the cookie scope; reload or new page in same context.
   - server state   → FRESH context (discards cookies/storage) + sanctioned UI re-login; re-assert.
                      2nd-context trace/screenshot/teardown owned by the reference pattern (#2).

f. CAPTURE / CLEANUP  — before any write, `git check-ignore` the target path; not ignored (or not a
   git repo) → FAIL closed. Traces are never committed.
```

**Auth/session:** UC `Setup` logs in via the public UI flow (sanctioned ARRANGE); `storageState`
reuse is an optional optimization. No raw DB writes / internal endpoints / on-disk injection.

### 4.3 Where things live

`.workflow/` is added to the target `.gitignore` by `install.sh:288-292` / `install.ps1` **only
when the codeforge marker line is absent** (whole-block-or-nothing) — not an absolute guarantee. So
v1: (1) both installers **merge the `.workflow/` entry independently** of the marker block
(idempotent); (2) the skill `git check-ignore`s before every capture and fails closed.

## 5. Change surface

1. **`src/skills/verify-e2e/SKILL.md`** — description "API, CLI **and UI**"; §1 add `UI` to the
   Interface enum + UI Verification vocabulary; §4 the a–f flow **with the §4.1 reference snippet
   embedded verbatim between `<!-- e2e-ui-ref:start/end -->` sentinels** and an explicit
   **"adapt ONLY the marked journey block; harness is verbatim, do not modify"** boundary; §5 UI
   classification (D5 matrix) — the existing `FAIL_INFRA` row (SKILL.md:62, "retry once") is refined
   so dep/resolution/version `FAIL_INFRA` is NOT blind-retried, only app/infra (server down) retries
   once; §3 Safety (non-prod, redact screenshots/console,
   traces never committed, escape UC values, headless); §6 report = durable text digest + artifact
   paths labeled local-only; UI rationalizations/red-flags; UI-aware Verification checklist; the
   UI UC template gains the required `App root` (filesystem anchor), `App URL` (served base origin,
   env-var reference allowed), and `Persistence mechanism` fields — and shape validation
   (`MISSING_APP_ROOT`/`MISSING_APP_URL`) rejects a UI UC lacking either.
2. **Workflows steering UI→N/A** (grep-confirmed): `src/skills/new-feature/SKILL.md` §6,
   `src/skills/fix-bug/SKILL.md`, `src/shared/rules/ship-gates.md:19` (drop "and UI-only changes
   (no v1 adapter)"), `src/CLAUDE.md:49`, `README.md:95`.
3. **`src/docs/extending.md`** — UI adapter future→done; keep `.spec.ts` bridge as next (3.5).
4. **Installers** — `install.sh` + `install.ps1`: independent `.workflow/` gitignore merge (§4.3).
5. **`tools/evals/routing-cases.json`** — add/verify a UI-journey `verify-e2e` case; no collision.
6. **Reference impl + fixture + test (NEW):** `tools/e2e-ui-ref/run-journey.mjs` (canonical pattern,
   guarantees as inline comments), `tools/fixtures/e2e-ui/index.html` (tiny static page),
   `tools/test/e2e-ui-pattern.test.mjs` — spawns the reference script in **success**,
   **forced-assertion-failure** (asserts non-zero exit + screenshot + trace + primary-error
   preserved + full teardown), and **hang** (child prints a ready marker then awaits a
   never-resolving promise; parent asserts the watchdog forces exit within a kill deadline much
   larger than the injected watchdog, AND that hanging cleanup cannot postpone it) modes, over BOTH
   single-context (reload) and `newContext()` paths; browser probe = `existsSync(chromium.
   executablePath())`, import failure FAILS, `E2E_BROWSER_REQUIRED` on ubuntu makes a skip a
   failure (§4.1 #7); PLUS a **portability** assertion (D6d) that extracts the sentinel-fenced block
   from an installed `.claude`/`.agents` skill and **executes** it from a scratch dir that resolves
   `@playwright/test` from **codeforge's own `node_modules`**, reuses the already-installed chromium
   and `tools/fixtures/e2e-ui/index.html`, with `tools/` **off the resolution path** — asserting
   success (proves the block has no hidden `tools/` dependency, at the cost of the one existing
   browser install, not a second one).
7. **`tools/test/check-gates.test.mjs`** — update test `k` (`:170-177`) verbatim ship-gates.md:19
   string when §5.2 changes that line (drift).
8. **`tools/test/install-gitignore.test.mjs` (NEW)** — seed `.gitignore` with the marker present but
   `.workflow/` removed; run each installer; assert `.workflow/` restored exactly once (sh + ps1).
9. **`package.json` + `package-lock.json`** — add `@playwright/test >=1.59` to codeforge's own
   **devDependencies** and update the lockfile (current devDeps have no Playwright; CI uses
   `npm ci`, so both must change for D2 + the ubuntu browser-install to be reproducible).
10. **`.github/workflows/ci.yml`** — ubuntu job: `npx playwright install chromium` (cached) +
    `E2E_BROWSER_REQUIRED=1` so the pattern test runs for real and a skip is a failure; Windows job
    leaves it skipped (documented — OS-agnostic, ubuntu proves it). No new `eval:routing` step
    (`check` already runs it — `package.json:22`).
11. **`tests/smoke.sh`** — assert skill + workflow files ship to both mirrors; UI-only N/A wording
    gone; the sentinel-fenced SKILL.md reference block === the reference file (drift guard, D6b).

**Not changed:** no `src/shared/rules/testing.md` (does not exist — UC discipline lives in the skill).

## 6. Testing strategy

Per D6 the standalone pattern is proven by the executable reference test (§5.6) — the arbiter for
every §4.1 guarantee, catching Playwright API drift (the class of bug F1 was) and, via the
portability assertion, any hidden dependency on unshipped `tools/`. Reference impl/fixture/test live
in `tools/` (framework dev-scope, never copied into targets — verified against `install.sh` copy
logic), so thin-install of targets is unaffected. Verify never mutates the target repo (D5): the
only inside-verify remediation is the non-repo browser-binary install.

CI = `npm run check` (`lint:skills` + `eval:routing` + `test:tools`; the pattern test self-skips
browserless except on ubuntu where `E2E_BROWSER_REQUIRED` forces a real run) + `sh tests/smoke.sh`.

## 7. Risk disposition (rev6)

All rev1–rev4 findings resolved:
- F1 (>=1.59 + ariaSnapshot preflight); F5 (owner=goal HALT all engines + schema blocker + matrix);
  F7/D6 (reference impl normative; inline-comment invariants + do-not-touch boundary + verbatim
  sentinel embed + drift check shipped to the skill); F10 (exact per-storage persistence +
  multi-context teardown).
- **F8 (rev4 residual):** `App root` normalized to **absolute** + containment-validated;
  `createRequire(join(absAppRoot,'package.json'))`; **`import(pathToFileURL(resolved).href)`** for
  Windows; resolve+import authoritative, text-scan advisory.
- **App URL (rev4):** a required UC field distinct from `App root`; preflight/DISCOVER/JOURNEY
  navigate to it; shape validation rejects its absence.
- **Classification (rev4):** every tooling/dep/resolution/import/version failure = `FAIL_INFRA`
  (one value; no generic `FAIL`); dep-absent under `owner=goal` = existing unrecoverable→HALT (no
  invented route-back).
- **Browserless (rev4):** `existsSync(chromium.executablePath())`; import failure FAILS;
  `E2E_BROWSER_REQUIRED` on ubuntu.
- **Watchdog (rev4):** deadline independently injectable; hard exit not postponable by cleanup;
  ready-marker + kill-deadline hang test.
- **D6d portability (rev4):** bounded execution env (scratch dir resolving `@playwright/test` from
  codeforge `node_modules`, reusing the one chromium install + the fixture, `tools/` off path).
- **Change surface (rev4):** codeforge `package.json` + `package-lock.json`; `check-gates.test.mjs`
  drift; installer gitignore regression test.

No open reviewer questions remain from rev4; this rev is believed clean pending the pass.

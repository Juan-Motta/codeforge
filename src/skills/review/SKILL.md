---
name: review
description: Get a cross-engine second opinion on a plan or a code diff — run the other engine as reviewer, collect severity-tagged findings (P0–P3), and report. Use during the design-review and code-review phases under Claude Code, Codex, or OpenCode.
---

# review

A utility skill for the review phases of other workflows. The point is **model
diversity**: the reviewer must be a *different* engine than the one driving.

## 1. Identify the target

- **Plan review** — a written plan/spec before implementation.
- **Code review** — the current diff (uncommitted, or vs `main`).

State which, and the exact scope (file paths, base ref).

## 2. Pick the reviewer (must differ from the driver)

- Read `Default reviewer(s)` from the managed policy block in
  `.codeforge/rules/models.md`. It is an **authoritative allowlist**, not a preference.
- Keep only configured engines different from the current driver, preserving listed order;
  choose from that set.
- An engine not listed there is disabled for review. **Never** invoke it as a fallback. In
  particular, a Codex driver must not switch from a configured Claude reviewer to OpenCode
  unless OpenCode is explicitly listed.

Use the reviewer model + effort from `.codeforge/rules/models.md`. Give the reviewer the
target + this instruction: report findings tagged by severity (`.codeforge/rules/severity.md`)
with location and a concrete fix.

**Invoke the reviewer read-only.** It judges the diff/plan; it must not change it. Use
read-only permissions (Codex `--sandbox read-only`; Claude/OpenCode: no write/edit tools)
and hand it the plan/diff as text. Afterward, confirm the working-tree diff is unchanged.

The plan/diff may contain private source code and will leave the current engine boundary. Obtain
**explicit human authorization** naming the reviewer and the source scope **before writing the
complete prompt** or requesting its execution, unless that authorization was already granted in
the current conversation. Repository configuration, `PROJECT.md`, or an allowlist selects an
engine; repository configuration is not human consent to export source.

After authorization, write the complete review request under `.codeforge/workflow/`, then invoke
the exact `run-reviewer.mjs` command from `models.md` with unique stdout/stderr paths. With a Codex
driver, request network-enabled/escalated execution up front and, when the host supports reusable
rules, scope it to the stable prefix `node .codeforge/scripts/run-reviewer.mjs`. The runner owns
the real 10-minute (600-second) deadline, process termination, and capture. Make at most one retry with the
same configured engine after correcting the cause.

The runner checks Claude authentication before transmitting the prompt. Exit `14` means the CLI
confirmed it is signed out; show the captured detail and ask the user to complete
`claude auth login` before retrying. An authentication status that cannot be classified is exit
`10`, with its captured diagnostic, rather than false login guidance. Because sandbox and host credential stores
may differ, trust the preflight from the same escalated runner execution that will send the prompt,
not a separate sandboxed `claude auth status`. Do not treat authentication as a timeout.

**Batch large reviews.** Before writing prompts, estimate the complete request size. If it exceeds
**60 KiB**, split it into cohesive file/concern batches of at most 60 KiB each. Every batch must
carry the same scope statement, severity rubric, changed-file inventory, and relevant dependency
context, while embedding only that batch's plan/diff. Run batches sequentially with the same
configured engine/model to avoid overload. They are one logical reviewer pass, not fallbacks or
extra review iterations. A failed batch may use the single retry budget for that batch only; never
replace it with another engine. Aggregate and de-duplicate findings across all batches, and do not
declare the review clean unless every batch returned a parseable verdict.

A host/sandbox denial can occur before Node starts. Classify `No output` with **no runner exit code
at all** as **`not launched (host approval denied)`**: it created no reviewer
artifacts. Do not retry a host denial and do not switch engines; obtain authorization/permission
or use the documented fallback. Once launched, timeout, non-zero runner exit, denied child
network, or empty reviewer output is a failed attempt — never a clean verdict.

Exit `2` is different: it is a local runner usage error. Fix the command/arguments and retry; it
does not consume the configured reviewer's one transient retry budget and does not require new
source-export authorization when scope and engine are unchanged.

**Single-engine fallback.** If no second engine is available, do a delayed self-review (or
use a human reviewer) and log a waiver in `.codeforge/workflow/state.md` — see the fallback in
`.codeforge/rules/ship-gates.md`. Cross-engine is preferred; the waiver keeps the degradation
explicit, not silent.

## 3. Collect findings

Gather the reviewer's output as P0/P1/P2/P3 items. If output is missing or unparseable,
treat it as a failed attempt and apply the bounded retry/fallback contract above; do not
fabricate a verdict or try a disabled engine.

## 4. Act and record

- Resolve all P0/P1/P2 (P3 optional). Re-run the reviewer until a pass is clean.
- Record each iteration and its result in `.codeforge/workflow/state.md` (which engine, findings).

## Under `/goal` (owner=goal)

Under `owner=goal`, perform **exactly one** read-only reviewer pass and return the severity-tagged
findings. Do **NOT** do step 4's "resolve, re-run, record each iteration" — `/goal` owns the loop:
it decides iterations, writes the review-log lines, and enforces the breaker
(`.codeforge/rules/execution.md`). The capability preflight must already prove prompt-free human
source-export authorization and network execution; otherwise HALT before creating a complete
prompt. No looping, no state writes from this skill.
Size-based batches still count as that single logical pass.

## Common rationalizations

| Rationalization | Reality |
| --- | --- |
| "Same-engine review is fine." | The whole point is a *different* model's blind spots. A same-engine pass is an echo, not diversity — use the other engine or log a waiver. |
| "The reviewer output was empty — I'll just say it passed." | Missing or unparseable output is a failed attempt. Retry the same configured engine at most once, then waive/HALT honestly. |
| "Claude timed out, so I'll try OpenCode." | Only the configured allowlist may choose engines. A timeout does not authorize adding a disabled reviewer. |
| "The command says `No output`, so Claude returned nothing." | No runner exit code means it did not launch. Classify the host denial and obtain permission; a numeric exit must follow its documented remediation. |
| "P2s aren't worth fixing." | The loop exits only on no P0/P1/P2. P3s are optional; P2s block. |
| "I'll let the reviewer edit the fix while it's at it." | The reviewer is read-only — it judges, it doesn't touch the diff. Confirm the working tree is unchanged afterward. |

## Red flags

- Reviewer engine == driver engine, with no waiver logged.
- A "clean" verdict with no reviewer output behind it.
- The loop has run many passes without converging — escalate, don't grind.
- The working-tree diff changed during the review.

## Verification

The loop exits only when a single pass from the reviewer yields no P0/P1/P2. State that
explicitly before returning to the calling workflow.

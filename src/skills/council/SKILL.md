---
name: council
description: Multi-perspective decision analysis — consult two or more engines (Claude, Codex, OpenCode) as independent advisors on one hard, expensive decision, then synthesize a verdict with a mandatory minority report. Use for architecture choices, approach forks, or any fork-in-the-road where being wrong is costly. Not for routine choices with an obvious default.
---

# council

Turn an expensive, hard-to-reverse decision into a diverse, auditable vote. The value is
**model diversity**: independent advisors from *different* engines, synthesized by the
driver acting as chairman.

## When to use

- Architecture decisions, approach forks, tech/tradeoff choices where being wrong is
  costly or hard to undo.

**Do NOT use** for routine choices with an obvious default — that's just the driver
deciding. Council is for genuine ambiguity with real stakes.

## 1. Frame the question

Write ONE decision-shaped question with the concrete options and the constraints that
matter. Not "how do I do X" — rather "should we do A or B, given C, D?". List the options
explicitly. A vague prompt produces vague advice.

## 2. Pick the advisors (must span engines)

Read `Council advisors` from the managed policy block in `.codeforge/rules/models.md` and use
**only** those engines. This line is an authoritative allowlist. Never add OpenCode (or any
other engine) merely to increase diversity. A valid council needs at least two distinct
configured engines; if fewer are listed/available, report that the council cannot run and ask
the user to update the policy. The driver may include itself as one voice. Optionally assign
each advisor a different lens so they don't all reason the same way, e.g.:

- **Simplicity** — the least-moving-parts option.
- **Blast radius / risk** — what breaks, how reversible.
- **Longevity** — maintainability and cost over time.

## 3. Consult each advisor independently

The framed question and supporting project material leave the current engine boundary. Obtain
**explicit human authorization** naming every external advisor and the source scope **before creating
any complete advisor prompt**, unless it was already granted in the current
conversation. Repository configuration is not human consent to export source; the council
allowlist only controls which engines are eligible. Under unattended `/goal`, HALT unless its
capability preflight proves this authorization and execution will both be prompt-free.

Send each advisor the **same framed question** (plus its lens), and do it
**independently** — an advisor must not see another's answer, or you lose the diversity.
Use each configured engine's **non-interactive** mode. The exact model, invocation, network
requirements, 10-minute (600-second) deadline, capture rules, and one-retry limit live in
`.codeforge/rules/models.md`; create a separate prompt/stdout/stderr set per advisor and invoke
its `run-reviewer.mjs` command rather than hard-coding engine commands. Advisors must run
read-only.

Capture from each: its position, key reasoning, and a one-line recommendation. If an
advisor's output is missing or unparseable, retry that same configured advisor at most once.
After a second failure, mark it unavailable; do not substitute an engine outside the allowlist
or invent a position. A host approval denial before the runner launches is not a transient
reviewer failure: do not retry it until authorization/permission changes. If fewer than two
advisors remain, the council failed.

## 4. Synthesize (chairman)

As the driver, produce the verdict:

- **Agreement** — where advisors converge (the strongest signal).
- **Divergence** — where and why they differ.
- **Verdict** — the recommended decision and the reason.
- **Minority report (mandatory)** — the strongest dissenting view, stated fairly. If every
  advisor agreed, say so explicitly and note the biggest residual risk. Never drop this —
  it is the guard against groupthink.

## 5. Record

Write the framed question, each advisor's one-line position, the verdict, and the minority
report into `.codeforge/workflow/state.md` (or the relevant plan/decision doc), so the decision is
auditable later.

## Common rationalizations

| Rationalization | Reality |
| --- | --- |
| "I'll ask one engine twice for the two views." | A panel of one engine is groupthink. Advisors must span ≥2 distinct engines or it isn't a council. |
| "A configured advisor failed, so I'll add OpenCode." | Availability failures do not expand policy. Retry once, then fail the council if fewer than two configured advisors remain. |
| "Let the advisors see each other's answers to build on them." | Independence is the whole point — shared answers collapse the diversity into one view. Consult each blind. |
| "They all agreed, so I'll drop the minority report." | The minority report is mandatory. If all agreed, state the biggest residual risk — it's the guard against groupthink. |
| "This is a routine call — run a council to be safe." | Council is for expensive, hard-to-reverse forks. For an obvious default, just decide; don't burn the ceremony. |

## Red flags

- All advisors are the same engine.
- Advisors saw each other's positions before answering.
- The verdict has no minority report / residual-risk note.
- You convened a council for a decision that had an obvious default.

## Verification

Before returning, confirm the output contains: the framed question, ≥2 distinct-engine
advisor positions, a verdict, and a non-empty minority report. Missing any of these means
the council did not actually run — redo it rather than presenting a thin verdict.

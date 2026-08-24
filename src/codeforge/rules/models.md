# Models

Default model + effort per engine for the cross-engine roles (research, review, council).
Maintained by hand — edit this table to change defaults; the skills read from here so
model IDs live in one place, not scattered across skills.

**Principle:** the reviewer/advisor must run on a **different engine than the driver**
(model diversity is the point). The driver's own model is whatever you opened the CLI
with — not pinned by this project.

## Invocation catalog (not an allowlist)

This table says **how** to run an engine if the review policy enables it. Merely appearing
here does not make an engine eligible. The managed `Default reviewer(s)` and `Council
advisors` lines below are the authoritative allowlists.

| Engine | Model | Effort | Invocation |
| --- | --- | --- | --- |
| **Codex** | `gpt-5.6-sol` | `xhigh` | `node .codeforge/scripts/run-reviewer.mjs --engine codex --model gpt-5.6-sol --effort xhigh --prompt-file <prompt-file> --stdout-file <stdout-file> --stderr-file <stderr-file>` |
| **Claude** | `opus` | `high` | `node .codeforge/scripts/run-reviewer.mjs --engine claude --model opus --effort high --prompt-file <prompt-file> --stdout-file <stdout-file> --stderr-file <stderr-file>` |
| **OpenCode** | `opencode-go/glm-5.2` | default | `node .codeforge/scripts/run-reviewer.mjs --engine opencode --model opencode-go/glm-5.2 --effort default --prompt-file <prompt-file> --stdout-file <stdout-file> --stderr-file <stderr-file>` |

<!-- codeforge:review-policy:start -->
<!-- DERIVED — do not edit. Re-rendered by the installers from `PROJECT.md` § Review policy,
     which is project-owned and survives `--upgrade`. Editing here is lost on the next install. -->
Default reviewer(s): Codex (`gpt-5.6-sol`, xhigh), Claude (`opus`, high)
Council advisors: Codex (`gpt-5.6-sol`, xhigh), Claude (`opus`, high), OpenCode (`opencode-go/glm-5.2`, default)
<!-- codeforge:review-policy:end -->

## Policy resolution (fail closed)

1. Read the relevant managed line above before every dispatch.
2. Treat only the engine names listed on that line as eligible, in listed order.
3. Remove the current driver from the reviewer candidates.
4. Never launch an engine absent from the line — not as a fallback, retry, or diversity boost.
5. If no eligible configured engine remains, use the documented single-engine/human waiver;
   do not silently expand the allowlist.

For a council, use only `Council advisors`. If it contains fewer than two distinct configured
engines, report that a council cannot be formed and ask the user to change the project policy;
never auto-add OpenCode or another engine.

Same model/effort per engine regardless of role — the role only decides **which
engine(s)** to use:

| Role | Engine(s) |
| --- | --- |
| **Driver** (implementation / TDD) | the CLI you open (not pinned) |
| **Reviewer** (design + code review) | the non-driver engine |
| **Research** (when delegated) | a non-driver, web/synthesis-capable engine |
| **Council advisors** | only the explicit engines in the review policy above |

## Running these from an agent (non-interactive)

The cross-platform runner owns stdin, process lifetime, output capture, and Codex's
`--output-last-message` workaround. It passes arguments directly without a shell, so prompt text
is never interpolated as a command. Create one prompt file and a unique stdout/stderr pair per
reviewer under `.codeforge/workflow/`; do not invoke the engine CLI directly.

### Bounded external reviewer execution

Every external reviewer run must be foreground, captured, and bounded:

- **Node.js 20+ is required** for `.codeforge/scripts/run-reviewer.mjs`. Installation and normal
  local workflows remain usable without it, but review/council must fail preflight with a clear
  setup error rather than attempting another engine.
- The runner enforces one **10-minute (600-second) deadline** by default across Claude's authentication
  preflight and the reviewer run, terminates the child process tree, uses a bounded post-kill backstop, and
  atomically captures stdout/stderr separately under `.codeforge/workflow/`. Exit `2` is a runner
  usage error (fix the command; it does not consume reviewer retry budget), `11` means timeout,
  `10` launch/preflight-evaluation failure, `12` reviewer failure, `13` empty output, and `14`
  confirmed signed-out authentication; all are failed attempts, never a clean review. Before sending a
  Claude prompt, the runner checks `claude auth status` and gives `claude auth login` guidance only
  when its output confirms the CLI is signed out. A caller may pass `--timeout-seconds` for a bounded probe/test.
- On Windows, the runner resolves `.exe` and npm-style `.cmd`/`.bat` shims explicitly and invokes
  batch shims through `ComSpec` with prompt text kept on stdin/file, never shell-interpolated.
- Retry a transient launch failure **once**, using the same configured engine and model. Fix the
  cause first (authentication, permissions, or network). A second failure makes that reviewer
  unavailable for this review.
- Do not replace a failed configured reviewer with an engine outside the allowlist. Use the
  single-engine/human waiver (interactive workflow), or HALT under `/goal`.
- Claude receives the complete plan/diff as prompt text and runs with `--tools ""` plus
  `--no-session-persistence`. This makes the reviewer read-only without tool permission prompts
  and avoids leaving a resumable review session.

**Codex driver:** the runner's child reviewer CLI needs outbound network. Codex's
`workspace-write` sandbox may deny it. Request a network-enabled/escalated shell execution for
the runner command up front; when reusable approval prefixes exist, scope one to
`node .codeforge/scripts/run-reviewer.mjs`. Do not let the CLI sit retrying inside a
network-denied sandbox. Explicitly tell the user which plan/diff and engine will receive source;
an engine allowlist is not export consent.

If the host denies execution before Node launches, there is **no runner exit code** and the
runner cannot create stdout/stderr artifacts. Record `not launched (host approval denied)` and do
not consume the one transient runner retry. If the user denies the request, treat the configured
reviewer as unavailable. For unattended `/goal`, the capability preflight must prove both source
export authorization and network execution are prompt-free before starting.

### Size-aware review batches

A monolithic prompt can be valid yet exceed the review model's practical response time. Before
dispatch, split a complete review request larger than **60 KiB** into cohesive batches no larger
than 60 KiB. Use the same engine/model, authorization scope, severity rubric, and changed-file
inventory for every batch; execute sequentially and aggregate the results as one logical pass.
Every batch must succeed before the overall review can be called clean. This is partitioning, not
retry or permission to add an engine outside the allowlist.

## Read-only for reviewers / advisors

A reviewer (`review`) or council advisor must not modify the working tree it's judging.
Invoke it read-only: Codex `--sandbox read-only`; for Claude/OpenCode restrict to
read-only (no write/edit tools). Hand it the diff/plan as text and confirm the
working-tree diff is unchanged afterward.

## Cost note

These are quality-first defaults (top models, high effort) because review/council
decisions are where being wrong is expensive. If cost matters, downgrade here — e.g.
Codex `gpt-5.4-mini`, OpenCode `opencode-go/deepseek-v4-flash`, or a lower `--effort` /
`model_reasoning_effort` — and the skills follow automatically.

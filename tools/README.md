# tools/ — framework dev tooling

Dev-only quality machinery for codeforge itself. **Never shipped into a target project**; the
published payload contains only the CLI, installers, and canonical `src/` harness.

## Skill linter (`lint-skills.mjs`)

Structural + codeforge-bespoke lint over `src/skills/*/SKILL.md`. Exit 1 on any error.

```bash
node tools/lint-skills.mjs          # full report
node tools/lint-skills.mjs --quiet  # errors only
npm run lint:skills
```

**Hard rules (errors):**

- Each skill has a `SKILL.md` with valid `--- name / description ---` frontmatter.
- `name` matches the directory; no duplicate names.
- `description` ≤ 1024 chars and carries a "Use when/for/to…" trigger clause (what + when).
- **Index parity** — every skill is listed in `src/CLAUDE.md`'s skill index and vice versa.
  (This source ships as `.codeforge/WORKFLOW.md`; the root entrypoints load it.)
- **Model-ID quarantine** — a skill must not hard-code a model id (`gpt-…`, `glm-…`,
  `kimi-k…`, `opencode-go/…`, `opus`/`sonnet`/`haiku`). `.codeforge/rules/models.md` is the single
  source. Engine *names* (Claude / Codex / OpenCode) are fine.
- **Reference integrity** — every `.codeforge/…​.md` path a skill mentions exists under `src/codeforge/`.
- Every skill has a `## Verification` exit-criteria section.

**Warnings (do not fail the build):**

- `SKILL.md` over 500 lines (progressive-disclosure budget).

## Routing evals (`run-evals.mjs`)

Deterministic, dependency-free approximation of skill routing — a stemmed TF-IDF cosine over the
skill `description`s. Catches the two dominant trigger bugs: a description missing the vocabulary
users actually say (false negative) and two descriptions so similar neither routes reliably
(collision). Cases live in `evals/routing-cases.json`.

```bash
node tools/run-evals.mjs                 # report + enforce
node tools/run-evals.mjs --min-rank1 80  # raise the rank-1 floor
npm run eval:routing
```

**Fails (exit 1) on:** a skill with no eval case (coverage), a positive prompt whose owner falls
outside top-k, a negative prompt whose true owner does not outrank the sibling, a description
collision ≥ 0.75, or a rank-1 rate below the floor (default 70). Near-collisions ≥ 0.50 print as
warnings. A failing positive usually means **improve the description**, not the eval — if a
realistic prompt can't rank, the description is missing its vocabulary.

## Tests

```bash
node --test           # auto-discovers tools/test/*.test.mjs (Node 20+)
npm run test:tools     # complete Node test suite
npm run check          # lint + evals + tests (what CI runs)
```

All run in CI (`.github/workflows/ci.yml`) on every push/PR alongside the installer smoke test.

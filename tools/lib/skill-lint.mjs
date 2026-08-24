// skill-lint — structural + codeforge-bespoke linter for src/skills/*/SKILL.md
//
// Pure, dependency-free logic (Node built-ins only) so it is unit-testable in
// isolation and reusable by the CLI wrapper (tools/lint-skills.mjs) and CI.
//
// Design: HARD rules that all 11 current skills already satisfy are ERRORS
// (exit 1). Anatomy niceties that the Phase-2 retrofit will add later are
// WARNINGS, so the linter is green today and still flags the gap.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const DESC_MAX = 1024;        // per B's skill-anatomy spec
const SKILL_MAX_LINES = 500;  // progressive-disclosure budget (warning)

// Model-ID quarantine: models.md is the single source of truth for model
// identifiers. A skill must never hard-code one. Matches version- or
// provider-qualified IDs and the bare Claude tier tokens — NOT engine names
// (Claude / Codex / OpenCode), which skills legitimately mention everywhere.
const MODEL_ID_RE =
  /(opencode-go\/[a-z0-9.\-]+|gpt-[0-9][0-9a-z.\-]*|glm-[0-9][0-9a-z.\-]*|kimi-k[0-9]+|claude-(?:opus|sonnet|haiku|fable)[0-9a-z.\-]*|\bopus\b|\bsonnet\b|\bhaiku\b)/i;

// A skill's SKILL.md may reference framework machinery by repo-relative path.
// Every such path must exist under src/ or it degrades silently (sync copies
// skills into two destinations, so one broken link breaks all three engines).
//
// Paths are written as they appear IN THE INSTALLED TARGET (`.codeforge/rules/x.md`), while the
// payload keeps them under `src/codeforge/` — the installer adds the dot when it copies. The lookup
// below strips the leading dot for that reason.
// NOTE: no leading `\b` — a word boundary cannot exist between a space and the `.` of
// `.codeforge`, so `\b` made this regex match NOTHING and silently disabled the whole
// reference-integrity check. Use an explicit lookbehind instead, which still prevents
const CODEFORGE_REF_RE = /(?<![\w/-])(\.codeforge\/[a-z0-9/_-]+\.md)\b/gi;

/** Parse the leading `--- ... ---` YAML-ish frontmatter. Returns {name, description} or null. */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  const body = m[1];
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

/** Extract the skill slugs listed in CLAUDE.md's "Workflow skills" index (`- \`name\``). */
function parseClaudeIndex(claudeMdText) {
  const slugs = new Set();
  for (const line of claudeMdText.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s+`([a-z0-9-]+)`/);
    if (m) slugs.add(m[1]);
  }
  return slugs;
}

/**
 * Lint every skill under `skillsDir`.
 * @param {object} opts
 * @param {string} opts.skillsDir  path to src/skills
 * @param {string} opts.claudeMd   path to src/CLAUDE.md (index-parity source)
 * @param {string} opts.srcDir     path to src/ (reference-integrity root)
 * @returns {{results: Array, totalErrors: number, totalWarnings: number}}
 */
export function lintSkills({ skillsDir, claudeMd, srcDir }) {
  const results = [];
  const err = (r, msg) => r.errors.push(msg);
  const warn = (r, msg) => r.warnings.push(msg);

  if (!existsSync(skillsDir)) {
    return {
      results: [{ skill: '(none)', errors: [`skills directory not found: ${skillsDir}`], warnings: [] }],
      totalErrors: 1,
      totalWarnings: 0,
    };
  }

  const skillDirs = readdirSync(skillsDir)
    .filter((d) => statSync(join(skillsDir, d)).isDirectory())
    .sort();

  // Index-parity source of truth.
  const indexSlugs = existsSync(claudeMd)
    ? parseClaudeIndex(readFileSync(claudeMd, 'utf8'))
    : new Set();

  const seenNames = new Map(); // name -> dir, for duplicate detection

  for (const dir of skillDirs) {
    const r = { skill: dir, errors: [], warnings: [] };
    results.push(r);

    const skillPath = join(skillsDir, dir, 'SKILL.md');
    if (!existsSync(skillPath)) {
      err(r, 'missing SKILL.md');
      continue;
    }
    const text = readFileSync(skillPath, 'utf8');
    const fm = parseFrontmatter(text);

    // --- Frontmatter (hard) ---
    if (!fm) {
      err(r, 'missing or malformed frontmatter (--- ... ---)');
    } else {
      if (!fm.name) err(r, 'frontmatter missing `name`');
      else {
        if (fm.name !== dir) err(r, `frontmatter name "${fm.name}" != directory "${dir}"`);
        const prior = seenNames.get(fm.name);
        if (prior) err(r, `duplicate skill name "${fm.name}" (also in ${prior})`);
        else seenNames.set(fm.name, dir);
      }

      if (!fm.description) err(r, 'frontmatter missing `description`');
      else {
        if (fm.description.length > DESC_MAX)
          err(r, `description ${fm.description.length} chars > ${DESC_MAX} max`);
        // "what + when": every good description carries a trigger clause.
        if (!/\bUse\b/i.test(fm.description))
          err(r, 'description has no "Use when/for/to…" trigger clause (what + when)');
      }
    }

    // --- Index parity (hard) ---
    if (!indexSlugs.has(dir))
      err(r, `not listed in CLAUDE.md skill index (add \`${dir}\` there)`);

    // --- Model-ID quarantine (hard) ---
    const idHit = text.match(MODEL_ID_RE);
    if (idHit)
      err(r, `hard-codes a model id "${idHit[0]}" — reference .codeforge/rules/models.md instead`);

    // --- Reference integrity (hard) ---
    for (const m of text.matchAll(CODEFORGE_REF_RE)) {
      const rel = m[1];
      // `.codeforge/workflow/**` is RUNTIME state: a workflow creates it from the template at
      // start, and it is gitignored. It is legitimately absent from the payload, so requiring it to
      // exist here would force every skill that mentions the state file to fail.
      if (rel.startsWith('.codeforge/workflow/')) continue;
      // `.codeforge/x` in the target == `src/codeforge/x` in the payload.
      if (!existsSync(join(srcDir, rel.replace(/^\./, ''))))
        err(r, `broken reference: ${rel} (not found under src/codeforge/)`);
    }

    // --- Anatomy ---
    // Verification is now mandatory (all skills carry it) — a skill without an
    // exit-criteria checklist can't gate its own "done" in a no-hooks system.
    if (!/^##\s+Verification\b/im.test(text))
      err(r, 'missing "## Verification" section (exit-criteria checklist)');
    // Anti-rationalization anatomy is the enforcement of an advisory system —
    // now present catalog-wide, so absence is a hard error (a new skill ships
    // with the rebuttals or it doesn't ship).
    if (!/^##\s+Common rationalizations\b/im.test(text))
      err(r, 'missing "## Common rationalizations" table (anti-rationalization anatomy)');
    if (!/^##\s+Red flags\b/im.test(text))
      err(r, 'missing "## Red flags" section (anti-rationalization anatomy)');
    const lineCount = text.split(/\r?\n/).length;
    if (lineCount > SKILL_MAX_LINES)
      warn(r, `${lineCount} lines > ${SKILL_MAX_LINES} (move detail to supporting files)`);
  }

  // Index parity, other direction: an index entry with no skill dir.
  const dirSet = new Set(skillDirs);
  for (const slug of indexSlugs) {
    if (!dirSet.has(slug)) {
      const orphan = { skill: `(index:${slug})`, errors: [`CLAUDE.md lists "${slug}" but src/skills/${slug}/ does not exist`], warnings: [] };
      results.push(orphan);
    }
  }

  const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);
  const totalWarnings = results.reduce((n, r) => n + r.warnings.length, 0);
  return { results, totalErrors, totalWarnings };
}

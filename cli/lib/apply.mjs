// cli/lib/apply.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const START = '<!-- codeforge:review-policy:start -->';
const END = '<!-- codeforge:review-policy:end -->';

// The three value lines the wizard owns. PROJECT.md § Review policy is their source of truth
// (project-owned → survives `--upgrade`); models.md / state.template.md are DERIVED, and the
// installers re-render them from PROJECT.md on every run. Keep these key strings in sync with the
// installers' readers (install.sh / install.ps1) — tools/test/wizard-config-upgrade.test.mjs
// exercises the round trip through both.
const KEY_REVIEWERS = 'Default reviewer(s):';
const KEY_COUNCIL = 'Council advisors:';
const KEY_PROFILE = 'Gate profile:';

function engineLabeller(answers) {
  const models = answers.models || {};
  const label = (en) => {
    const m = models[en];
    return m ? `${en} (\`${m.model}\`${m.effort ? ' · ' + m.effort : ''})` : en;
  };
  return (engines) => (engines && engines.length ? engines.map(label).join(', ') : 'none');
}

function renderReviewBlock(answers) {
  const list = engineLabeller(answers);
  const lines = [
    START,
    '<!-- DERIVED — do not edit. Re-rendered by the installers from `PROJECT.md` § Review policy,',
    "     which is project-owned and survives `--upgrade`. Editing here is lost on the next install. -->",
    `${KEY_REVIEWERS} ${list(answers.reviewers)}`,
    `${KEY_COUNCIL} ${list(answers.council)}`,
    END,
  ];
  return lines.join('\n');
}

// Replace a `Key: value` line in-place, or append it if absent. Comment lines and ordering of
// everything else are preserved, so the section's explanatory comment survives repeated wizard
// runs (a whole-body replace would drop it).
function upsertKeyLine(lines, key, value) {
  if (value === undefined || value === null) return lines;
  const at = lines.findIndex((l) => l.trimStart().startsWith(key));
  const rendered = `${key} ${value}`;
  if (at === -1) return [...lines, rendered];
  const next = [...lines];
  next[at] = rendered;
  return next;
}

function assertExists(path) {
  if (!existsSync(path)) {
    throw new Error(`apply: ${path} not found — target not installed?`);
  }
}

// Replaces the body of a `## <heading>` section with `bodyText`, consuming
// ALL trailing content (including any number of trailing blank lines) up to
// the next top-level `## ` heading or end-of-file, and re-emitting a single
// canonical form that ends in exactly one trailing `\n` before whatever
// follows (or one trailing `\n` at end-of-file). This makes repeated calls
// with identical input byte-stable (idempotent), and — because the body is
// spliced in via plain string concatenation rather than String.replace's
// special replacement-pattern string — `$&`, `$$`, `` $` ``, `$'` etc. inside
// bodyText are inserted completely literally.
function replaceSection(md, heading, bodyText) {
  const startIdx = md.indexOf(heading);
  if (startIdx === -1) return md;
  const searchFrom = startIdx + heading.length;
  const rest = md.slice(searchFrom);
  const nextHeadingRel = rest.search(/\n## /);
  const endIdx = nextHeadingRel === -1 ? md.length : searchFrom + nextHeadingRel;
  const before = md.slice(0, startIdx);
  const after = md.slice(endIdx);
  return `${before}${heading}\n\n${bodyText}\n${after}`;
}

export function applyModels(targetDir, answers) {
  const path = join(targetDir, 'shared', 'rules', 'models.md');
  assertExists(path);
  const md = readFileSync(path, 'utf8');
  const re = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (!re.test(md)) throw new Error('models.md is missing the managed review-policy block');
  // Replacer is a FUNCTION (not a string) so `$&`, `$$`, etc. in the
  // rendered block are inserted literally instead of being interpreted as
  // String.replace special replacement patterns.
  writeFileSync(path, md.replace(re, () => renderReviewBlock(answers)));
}

export function applyProfile(targetDir, answers) {
  const path = join(targetDir, 'shared', 'state.template.md');
  assertExists(path);
  if (!answers.profile) return;
  const md = readFileSync(path, 'utf8');
  writeFileSync(path, md.replace(/(\*\*Profile:\*\*\s*)([A-Za-z-]+)/, (_m, prefix) => `${prefix}${answers.profile}`));
}

export function applyProject(targetDir, answers) {
  const path = join(targetDir, 'PROJECT.md');
  assertExists(path);
  const p = answers.project || {};
  let md = readFileSync(path, 'utf8');
  if (p.rules && p.rules.trim()) {
    md = replaceSection(md, '## Special rules', p.rules.trim());
  }
  writeFileSync(path, md);
}

// Claude-only: when subagent-driven execution is chosen, write a Claude Code agent
// definition whose `model:` is the model dispatched implementation subagents run with.
// No-op for inline mode (or non-Claude installs). Not shipped to other engines.
// Always regenerates (overwrites) so an upgraded install can't keep a stale template.
// NOTE: this runs only via the wizard; `sync`/`--upgrade` do NOT touch .claude/agents, so
// /goal's capability-preflight (design §6.4) MUST verify this file contains `commit_policy`
// and HALT if it doesn't (stale pre-Plan-B agent), telling the user to re-run codeforge
// setup. Owned by Plan C; noted here so it isn't lost.
export function applyClaudeAgents(targetDir, answers) {
  const c = answers.claude;
  if (!c?.subagents || !c.model?.model) return;
  const dir = join(targetDir, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const file = `---
name: codeforge-implementer
description: Implements exactly one task from the active codeforge plan (TDD: red → green → refactor), runs the covering tests, and reports back. Honors the dispatch brief's commit_policy (per-task = commit + report sha; defer = stage only, no commit). Dispatch one per task when running subagent-driven.
model: ${c.model.model}
---

You implement ONE task from the active codeforge plan. Read the task, write the failing
test first, make it pass with the minimal change, and run the covering tests. Then honor the
**commit_policy** the dispatching driver gave you (see shared/rules/execution.md):

- commit_policy=per-task (the default): commit, then report status (DONE / BLOCKED), the
  commit sha, and a one-line test summary.
- commit_policy=defer (used by /goal): do NOT commit — stage this task's files only, then
  report status (DONE / BLOCKED), the task id, and a one-line test summary. Do not compute a
  digest; the orchestrator owns it and makes the single commit at ship.

On BLOCKED: report the blocker; do not commit and do not stage a half-done task. Do not start
other tasks. Follow the repo's TDD and ship-gate rules.
`;
  writeFileSync(join(dir, 'codeforge-implementer.md'), file);
}

// Record the execution mode in PROJECT.md's "## Execution" section so the workflow skills
// (via shared/rules/execution.md) can read it. Lives in PROJECT.md because it is
// project-owned and survives `--upgrade` (unlike the by-name-refreshed shared/rules).
export function applyExecution(targetDir, answers) {
  const path = join(targetDir, 'PROJECT.md');
  if (!existsSync(path)) return;
  const c = answers.claude || {};
  const body = `Execution: ${c.subagents ? `subagent-driven (model: ${c.model?.model ?? '?'})` : 'inline'}`;
  let md = readFileSync(path, 'utf8');
  md = md.includes('## Execution')
    ? replaceSection(md, '## Execution', body)
    : `${md.replace(/\s*$/, '')}\n\n## Execution\n\n${body}\n`;
  writeFileSync(path, md);
}

// Persist the wizard's review policy into PROJECT.md § Review policy — the source of truth the
// installers re-render `shared/rules/models.md` and `shared/state.template.md` from. Same reason
// as applyExecution: PROJECT.md is project-owned and survives `--upgrade`, whereas anything
// written only into shared/** is overwritten by name on the next install.
//
// An absent answer leaves the existing line alone rather than blanking it, so a partial wizard run
// (or a future wizard that stops asking one of these) cannot silently drop a team's choice.
export function applyReviewPolicy(targetDir, answers) {
  const path = join(targetDir, 'PROJECT.md');
  if (!existsSync(path)) return;
  const list = engineLabeller(answers);
  const md = readFileSync(path, 'utf8');

  const heading = '## Review policy';
  const startIdx = md.indexOf(heading);
  const body = (() => {
    if (startIdx === -1) return [];
    const searchFrom = startIdx + heading.length;
    const rest = md.slice(searchFrom);
    const nextRel = rest.search(/\n## /);
    const raw = nextRel === -1 ? md.slice(searchFrom) : md.slice(searchFrom, searchFrom + nextRel);
    return raw.replace(/^\n+/, '').replace(/\n+$/, '').split('\n');
  })();

  let lines = body;
  if (answers.reviewers) lines = upsertKeyLine(lines, KEY_REVIEWERS, list(answers.reviewers));
  if (answers.council) lines = upsertKeyLine(lines, KEY_COUNCIL, list(answers.council));
  if (answers.profile) lines = upsertKeyLine(lines, KEY_PROFILE, answers.profile);

  const bodyText = lines.join('\n');
  const next = startIdx === -1
    ? `${md.replace(/\s*$/, '')}\n\n${heading}\n\n${bodyText}\n`
    : replaceSection(md, heading, bodyText);
  writeFileSync(path, next);
}

export function applyAll(targetDir, answers) {
  // PROJECT.md first: it is the source of truth, and the derived renders below must agree with it.
  applyReviewPolicy(targetDir, answers);
  applyModels(targetDir, answers);
  applyProfile(targetDir, answers);
  applyProject(targetDir, answers);
  applyExecution(targetDir, answers);
  applyClaudeAgents(targetDir, answers);
}

#!/usr/bin/env bash
#
# codeforge sync — generate each engine's config + skills from the neutral source.
#
#   .codeforge/sync.sh [--out <dir>]
#
# No symlinks (Windows-safe; use sync.ps1 on Windows). Inputs are read from this script's
# own directory (the canonical source). When installed under `.codeforge/`, output defaults
# to the project root; in the framework source tree it defaults to in place.
#
#   --out <dir>   write the generated engine artifacts into <dir> instead of alongside the
#                 source. Installed projects can simply run `.codeforge/sync.sh`.
#
# Neutral source layout (read from the script's dir):
#   WORKFLOW.md                   → installed methodology (`src/CLAUDE.md` in this repo)
#   agents/*.md                   → native implementation-agent adapters
#   skills/<name>/SKILL.md        → skills, copied into each engine's discovery dir
#   configs/claude/settings.json  → .claude/settings.json
#   configs/codex/config.toml     → .codex/config.toml
#   configs/opencode.json         → opencode.json (OpenCode reads it from the root)
#   rules/*.md                    → discipline (read in place by the agent; not copied here)
#
# Skill discovery paths differ per engine (verified against each CLI's docs):
#   Claude Code → .claude/skills   |   Codex → .agents/skills   |   OpenCode → any of
#   .opencode/.claude/.agents. So .claude/skills + .agents/skills covers all three.
#
# GENERATED (do NOT hand-edit — regenerated on every run): CLAUDE.md, AGENTS.md, opencode.json,
# .claude/, .agents/, .codex/. Missing project-owned templates/docs are seeded, never clobbered.
#
set -euo pipefail
SRC_ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ "$(basename "$SRC_ROOT")" = ".codeforge" ]; then
  OUT_ROOT="$(dirname "$SRC_ROOT")"
else
  OUT_ROOT="$SRC_ROOT"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --out)   shift; OUT_ROOT="${1:-}"; [ -n "$OUT_ROOT" ] || { echo "error: --out requires a directory" >&2; exit 2; } ;;
    --out=*) OUT_ROOT="${1#--out=}" ;;
    *)       echo "usage: $0 [--out <dir>]  (unknown arg: $1)" >&2; exit 2 ;;
  esac
  shift
done

# The development payload keeps this file as CLAUDE.md because its skill index is linted there;
# installation names the same content WORKFLOW.md to make its engine-neutral role explicit.
WORKFLOW="$SRC_ROOT/WORKFLOW.md"
[ -f "$WORKFLOW" ] || WORKFLOW="$SRC_ROOT/CLAUDE.md"

# validate required inputs BEFORE mutating anything
[ -d "$SRC_ROOT/skills" ]    || { echo "error: no skills/ base found in $SRC_ROOT" >&2; exit 2; }
[ -f "$WORKFLOW" ] || { echo "error: no WORKFLOW.md found in $SRC_ROOT" >&2; exit 2; }
[ -f "$SRC_ROOT/agents/codeforge-implementer.md" ] || { echo "error: no codeforge implementer contract found in $SRC_ROOT/agents" >&2; exit 2; }
agent_body="$SRC_ROOT/agents/codeforge-implementer.md"
grep -Fq "'''" "$agent_body" && { echo "error: agents/codeforge-implementer.md contains TOML multiline delimiter '''" >&2; exit 2; }

mkdir -p "$OUT_ROOT"
OUT_ROOT="$(cd "$OUT_ROOT" && pwd)"

forge_reject_managed_link() {
  candidate="$1"
  if [ -L "$candidate" ]; then
    echo "error: refusing managed symlink/reparse path: $candidate" >&2
    exit 2
  fi
}

for relative in \
  .claude .agents .codex docs \
  .claude/skills .claude/agents .agents/skills .codex/agents \
  docs/prds docs/plans docs/research docs/solutions docs/adr docs/e2e \
  docs/e2e/reports docs/e2e/use-cases docs/ci-templates \
  PROJECT.md CONTINUITY.md docs/CHANGELOG.md; do
  forge_reject_managed_link "$OUT_ROOT/$relative"
done
if [ -d "$SRC_ROOT/docs/ci-templates" ]; then
  for source_template in "$SRC_ROOT"/docs/ci-templates/*; do
    [ -e "$source_template" ] || continue
    forge_reject_managed_link "$OUT_ROOT/docs/ci-templates/$(basename "$source_template")"
  done
fi
for scaffold in prds plans research solutions adr e2e/reports e2e/use-cases; do
  forge_reject_managed_link "$OUT_ROOT/docs/$scaffold/.gitkeep"
done

# Generated files are replaced from a temporary file in the same directory. This keeps writes
# atomic and replaces a leaf symlink instead of truncating the file it points to.
forge_write_generated() {
  destination="$1"
  if [ -d "$destination" ]; then
    echo "error: generated file destination resolves to a directory: $destination" >&2
    return 2
  fi
  destination_dir="$(dirname "$destination")"
  mkdir -p "$destination_dir"
  temporary="$(mktemp "$destination_dir/.codeforge-write.XXXXXX")"
  if ! cat > "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  chmod 0644 "$temporary"
  if ! mv -f "$temporary" "$destination"; then
    rm -f "$temporary"
    return 1
  fi
}

forge_require_generated_entrypoint() {
  entrypoint="$1"
  if [ -f "$entrypoint" ] && [ ! -L "$entrypoint" ] \
     && ! grep -Fq 'codeforge:entrypoint' "$entrypoint" 2>/dev/null; then
    adopted_backup="$SRC_ROOT/backups/$(basename "$entrypoint").pre-codeforge.bak"
    if [ "$(basename "$SRC_ROOT")" = '.codeforge' ] \
       && [ "$OUT_ROOT" = "$(dirname "$SRC_ROOT")" ] \
       && [ -f "$adopted_backup" ]; then
      return 0
    fi
    echo "error: refusing to replace non-codeforge entrypoint: $entrypoint (run the installer to adopt it)" >&2
    exit 2
  fi
}

if [ "$WORKFLOW" != "$OUT_ROOT/CLAUDE.md" ]; then
  forge_require_generated_entrypoint "$OUT_ROOT/CLAUDE.md"
fi
forge_require_generated_entrypoint "$OUT_ROOT/AGENTS.md"

if [ "$WORKFLOW" = "$OUT_ROOT/.codeforge/WORKFLOW.md" ]; then
  workflow_reference='.codeforge/WORKFLOW.md'
else
  workflow_reference="$WORKFLOW"
fi

# Minimal engine entrypoints. Claude expands @ imports natively; Codex/OpenCode receive an
# explicit bootstrap because AGENTS.md has no portable include syntax.
if [ "$WORKFLOW" != "$OUT_ROOT/CLAUDE.md" ]; then
{
cat <<'EOF'
# Project agent entrypoint

<!-- codeforge:entrypoint -->

@PROJECT.md
EOF
printf '@%s\n' "$workflow_reference"
} | forge_write_generated "$OUT_ROOT/CLAUDE.md"
fi

{
cat <<'EOF'
# Project agent entrypoint

<!-- codeforge:entrypoint -->

Before analyzing, planning, or modifying this project, read and follow:

1. `PROJECT.md` — project context, architecture, commands, and conventions.
EOF
printf '2. `%s` — required development workflow and ship discipline.\n\n' "$workflow_reference"
printf 'If they conflict, the safety and ship rules in `%s` take precedence.\n' "$workflow_reference"
} | forge_write_generated "$OUT_ROOT/AGENTS.md"

# skills -> each engine's discovery dir (full mirror: replace so deletions propagate).
# .claude/skills = Claude Code (+ OpenCode); .agents/skills = Codex (+ OpenCode).
for dir in .claude .agents; do
  mkdir -p "$OUT_ROOT/$dir"
  rm -rf "$OUT_ROOT/$dir/skills"
  cp -R "$SRC_ROOT/skills" "$OUT_ROOT/$dir/skills"
  # ownership marker: lets the installer tell a forge-generated dir from the user's own,
  # so it never wipes a user's skills (even one coincidentally named new-feature).
  printf 'generated by codeforge sync — do not edit; edit .codeforge/skills instead\n' > "$OUT_ROOT/$dir/skills/.codeforge-generated"
done

# One engine-neutral task contract -> each harness's native agent format. These paths are
# generated even when PROJECT.md selects inline mode, so changing that project-owned line never
# requires reinstalling. No model is pinned: both adapters inherit the active session defaults.
mkdir -p "$OUT_ROOT/.claude/agents" "$OUT_ROOT/.codex/agents"
{
  cat <<'EOF'
---
name: codeforge-implementer
description: Implements exactly one bounded task from the active codeforge plan using TDD and the dispatch brief's owner and commit_policy.
---

<!-- codeforge:generated-agent — edit .codeforge/agents/codeforge-implementer.md, then sync -->

EOF
  cat "$agent_body"
} | forge_write_generated "$OUT_ROOT/.claude/agents/codeforge-implementer.md"

{
  cat <<'EOF'
# codeforge:generated-agent — edit .codeforge/agents/codeforge-implementer.md, then sync
name = "codeforge-implementer"
description = "Implements exactly one bounded task from the active codeforge plan using TDD and the dispatch brief's owner and commit_policy."
sandbox_mode = "workspace-write"
developer_instructions = '''
EOF
  cat "$agent_body"
  printf "'''\n"
} | forge_write_generated "$OUT_ROOT/.codex/agents/codeforge-implementer.toml"

# per-engine config, placed where each engine looks for it
mkdir -p "$OUT_ROOT/.claude" "$OUT_ROOT/.codex"
[ -f "$SRC_ROOT/configs/claude/settings.json" ] && forge_write_generated "$OUT_ROOT/.claude/settings.json" < "$SRC_ROOT/configs/claude/settings.json"
[ -f "$SRC_ROOT/configs/codex/config.toml" ]    && forge_write_generated "$OUT_ROOT/.codex/config.toml" < "$SRC_ROOT/configs/codex/config.toml"
[ -f "$SRC_ROOT/configs/opencode.json" ]        && forge_write_generated "$OUT_ROOT/opencode.json" < "$SRC_ROOT/configs/opencode.json"

# Project-owned artifacts are seed-only. Re-running sync restores missing scaffolding without
# overwriting project knowledge or configuration.
[ -f "$OUT_ROOT/PROJECT.md" ] || { [ ! -f "$SRC_ROOT/templates/PROJECT.md" ] || cp "$SRC_ROOT/templates/PROJECT.md" "$OUT_ROOT/PROJECT.md"; }
[ -f "$OUT_ROOT/CONTINUITY.md" ] || { [ ! -f "$SRC_ROOT/templates/CONTINUITY.md" ] || cp "$SRC_ROOT/templates/CONTINUITY.md" "$OUT_ROOT/CONTINUITY.md"; }
if [ -d "$SRC_ROOT/docs" ]; then
  mkdir -p "$OUT_ROOT/docs"
  for d in prds plans research solutions adr e2e/reports e2e/use-cases; do
    mkdir -p "$OUT_ROOT/docs/$d"
    [ -e "$OUT_ROOT/docs/$d/.gitkeep" ] || : > "$OUT_ROOT/docs/$d/.gitkeep"
  done
  [ -f "$OUT_ROOT/docs/CHANGELOG.md" ] || { [ ! -f "$SRC_ROOT/docs/CHANGELOG.md" ] || cp "$SRC_ROOT/docs/CHANGELOG.md" "$OUT_ROOT/docs/CHANGELOG.md"; }
  if [ -d "$SRC_ROOT/docs/ci-templates" ]; then
    mkdir -p "$OUT_ROOT/docs/ci-templates"
    for f in "$SRC_ROOT"/docs/ci-templates/*; do
      [ -e "$f" ] || continue
      dst="$OUT_ROOT/docs/ci-templates/$(basename "$f")"
      [ -e "$dst" ] || cp "$f" "$dst"
    done
  fi
fi

echo "codeforge sync: generated engine adapters and ensured project scaffolding in $OUT_ROOT"

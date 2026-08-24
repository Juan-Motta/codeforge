#!/usr/bin/env bash
#
# codeforge installer — copy the workflow discipline into a target project.
#
#   ./install.sh [target-dir] [--upgrade] [--git-init] [--no-isolate]
#                [--ignore-generated | --track-generated]
#
# With no target-dir, installs into the current working directory. So the common flow is:
#   cd my-project && /path/to/codeforge/install.sh
#
# SELF-CONTAINED INSTALL: `.codeforge/` is the canonical installed source. It contains
# everything required to inspect, customize, and regenerate the harness without a checkout
# of this repository: instructions, agent contracts, skills, rules, scripts, configs, docs, templates, and
# sync.sh/sync.ps1. The engine-specific discovery paths are generated from that directory by
# plain copy (no symlinks), so generation behaves the same on macOS, Linux, and Windows.
#
# LANDS IN THE TARGET:
#   .codeforge/                    canonical framework source + local workflow state
#   CLAUDE.md, AGENTS.md           generated engine instructions
#   .claude/, .agents/, .codex/    generated engine discovery/config
#   opencode.json                  generated OpenCode config
#   docs/                          project knowledge scaffold
#   PROJECT.md, CONTINUITY.md      project-owned, seeded only when missing
#
# MANAGED (framework baseline — OVERWRITTEN on install/upgrade): `.codeforge/WORKFLOW.md`,
#   agents/, skills/, docs/, templates/, sync scripts, state template, scripts, and the
#   framework's own rule entries. Your own rules in `.codeforge/rules/` survive upgrades.
# PROJECT-OWNED CONFIG: `.codeforge/configs/` is seeded only when entries are missing, so local
#   engine configuration remains the canonical input to sync across reinstall/upgrade.
# PROJECT-OWNED (created only if missing — NEVER clobbered): PROJECT.md, CONTINUITY.md,
#   docs/CHANGELOG.md. Per-project Claude overrides go in .claude/settings.local.json.
#
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD="$SRC/src"
FORGE_VERSION="unknown"
[ -f "$SRC/VERSION" ] && FORGE_VERSION="$(head -n1 "$SRC/VERSION" | tr -d '[:space:]')"
[ -n "$FORGE_VERSION" ] || FORGE_VERSION="unknown"
MODE="install"
GIT_INIT=0
ISOLATE=1   # auto-isolate Claude Code from ancestor CLAUDE.md by default (--no-isolate to keep inheritance)
GENERATED_POLICY="" # explicit flag, prior manifest value, or "tracked" for a fresh install
TARGET=""
usage="usage: $0 [target-dir] [--upgrade] [--git-init] [--no-isolate] [--ignore-generated | --track-generated]"
while [ $# -gt 0 ]; do
  case "$1" in
    --upgrade)     MODE="upgrade" ;;
    --git-init)    GIT_INIT=1 ;;
    --no-isolate)  ISOLATE=0 ;;
    --ignore-generated)
      [ "$GENERATED_POLICY" != "tracked" ] || { echo "$usage  (conflicting generated-adapter flags)" >&2; exit 2; }
      GENERATED_POLICY="ignored" ;;
    --track-generated)
      [ "$GENERATED_POLICY" != "ignored" ] || { echo "$usage  (conflicting generated-adapter flags)" >&2; exit 2; }
      GENERATED_POLICY="tracked" ;;
    -*)            echo "$usage  (unknown arg: $1)" >&2; exit 2 ;;
    *)             if [ -z "$TARGET" ]; then TARGET="$1"; else echo "$usage  (unexpected arg: $1)" >&2; exit 2; fi ;;
  esac
  shift
done
TARGET="${TARGET:-$PWD}"

[ -d "$TARGET" ] || { echo "error: target dir not found: $TARGET" >&2; exit 2; }
TARGET="$(cd "$TARGET" && pwd)"

# Fail before reading or mutating managed paths if any directory component codeforge owns is a
# symlink. Leaf generated files are replaced atomically later, but a linked ancestor would make
# mkdir/cp/rm operate outside the selected project.
forge_reject_managed_link() {
  _forge_link="$1"
  if [ -L "$_forge_link" ]; then
    echo "error: refusing managed symlink/reparse path: $_forge_link" >&2
    exit 2
  fi
}

for _forge_rel in \
  .codeforge .claude .agents .codex docs \
  .claude/skills .claude/agents .claude/settings.local.json \
  .agents/skills .codex/agents \
  docs/prds docs/plans docs/research docs/solutions docs/adr docs/e2e \
  docs/e2e/reports docs/e2e/use-cases docs/ci-templates \
  docs/prds/.gitkeep docs/plans/.gitkeep docs/research/.gitkeep \
  docs/solutions/.gitkeep docs/adr/.gitkeep docs/e2e/reports/.gitkeep \
  docs/e2e/use-cases/.gitkeep docs/CHANGELOG.md \
  PROJECT.md CONTINUITY.md .gitignore; do
  forge_reject_managed_link "$TARGET/$_forge_rel"
done
if [ -d "$TARGET/.codeforge" ]; then
  _forge_nested_link="$(find "$TARGET/.codeforge" -type l -print -quit 2>/dev/null || true)"
  [ -z "$_forge_nested_link" ] || {
    echo "error: refusing symlink inside canonical .codeforge source: $_forge_nested_link" >&2
    exit 2
  }
fi
if [ -d "$TARGET/docs/ci-templates" ]; then
  _forge_docs_link="$(find "$TARGET/docs/ci-templates" -type l -print -quit 2>/dev/null || true)"
  [ -z "$_forge_docs_link" ] || {
    echo "error: refusing symlink inside managed docs/ci-templates: $_forge_docs_link" >&2
    exit 2
  }
fi

# Validate the existing managed .gitignore range before creating `.codeforge/`, rewriting the
# root entrypoints, or touching any project file. A missing file is valid and will be created
# later; a malformed existing block makes the intended merge ambiguous, so installation must be
# a no-op rather than a partial install.
gi="$TARGET/.gitignore"
gi_start='# codeforge:generated:start'
gi_end='# codeforge:generated:end'
if [ -f "$gi" ]; then
  gi_stats="$(awk -v s="$gi_start" -v e="$gi_end" '
    { line=$0; sub(/\r$/, "", line) }
    line == s { sc++; if (!sp) sp=NR }
    line == e { ec++; if (!ep) ep=NR }
    END { printf "%d %d %d %d", sc+0, ec+0, sp+0, ep+0 }
  ' "$gi")"
  set -- $gi_stats
  if { [ "$1" -ne 0 ] || [ "$2" -ne 0 ]; } && { [ "$1" -ne 1 ] || [ "$2" -ne 1 ] || [ "$3" -ge "$4" ]; }; then
    echo "error: malformed codeforge block in $gi; fix/remove '$gi_start' and '$gi_end', then re-run" >&2
    exit 1
  fi
fi

# Existing imported-context markers are also managed as one replaceable range. Validate them
# before installation so a retry can update that range atomically instead of appending a second
# copy or guessing how to repair malformed project-owned content.
context_start='<!-- codeforge:imported-context:start -->'
context_end='<!-- codeforge:imported-context:end -->'
PROJECT_IMPORT_PRESENT=0
if [ -f "$TARGET/PROJECT.md" ]; then
  context_stats="$(awk -v s="$context_start" -v e="$context_end" '
    { line=$0; sub(/\r$/, "", line) }
    line == s { sc++; if (!sp) sp=NR }
    line == e { ec++; if (!ep) ep=NR }
    END { printf "%d %d %d %d", sc+0, ec+0, sp+0, ep+0 }
  ' "$TARGET/PROJECT.md")"
  set -- $context_stats
  if { [ "$1" -ne 0 ] || [ "$2" -ne 0 ]; } && { [ "$1" -ne 1 ] || [ "$2" -ne 1 ] || [ "$3" -ge "$4" ]; }; then
    echo "error: malformed imported-context block in $TARGET/PROJECT.md; fix/remove '$context_start' and '$context_end', then re-run" >&2
    exit 1
  fi
  [ "$1" -eq 0 ] || PROJECT_IMPORT_PRESENT=1
fi

# Did a prior forge install own .claude/settings.local.json? (read before the manifest is
# rewritten below, so the settings writer knows whether it may safely regenerate the file.)
PRIOR_LOCAL_MANAGED=0
awk '{ sub(/\r$/, "") } $0 == "localsettings:managed" { found=1 } END { exit !found }' \
  "$TARGET/.codeforge/manifest" 2>/dev/null && PRIOR_LOCAL_MANAGED=1
# Preserve the project's prior choice on a bare reinstall/upgrade. Explicit flags always win;
# a fresh install defaults to tracked adapters so a clone works without a post-clone step.
if [ -z "$GENERATED_POLICY" ]; then
  GENERATED_POLICY="$(awk -F: '{ sub(/\r$/, "", $2) } $1 == "generated" && ($2 == "tracked" || $2 == "ignored") { print $2; exit }' "$TARGET/.codeforge/manifest" 2>/dev/null || true)"
  GENERATED_POLICY="${GENERATED_POLICY:-tracked}"
fi
{ [ -f "$PAYLOAD/CLAUDE.md" ] && [ -d "$PAYLOAD/skills" ] \
  && [ -f "$PAYLOAD/agents/codeforge-implementer.md" ] \
  && [ -f "$PAYLOAD/codeforge/scripts/run-reviewer.mjs" ]; } \
  || { echo "error: payload not found — run this from the codeforge repo" >&2; exit 2; }
[ "$TARGET" != "$SRC" ]     || { echo "error: refusing to install into codeforge itself" >&2; exit 2; }
[ "$TARGET" != "$PAYLOAD" ] || { echo "error: refusing to install into the codeforge payload dir (src/)" >&2; exit 2; }

echo "codeforge $FORGE_VERSION → installing into: $TARGET  (mode: $MODE)"

# --- version drift advisory (informational only, never blocks) ---
# Compare the version that last stamped this target against the one we're installing.
PRIOR_VERSION=""
[ -f "$TARGET/.codeforge/version" ] && PRIOR_VERSION="$(head -n1 "$TARGET/.codeforge/version" | tr -d '[:space:]')"
if [ -n "$PRIOR_VERSION" ] && [ "$PRIOR_VERSION" != "$FORGE_VERSION" ] \
   && [ "$FORGE_VERSION" != "unknown" ] && [ "$PRIOR_VERSION" != "unknown" ]; then
  lower="$(printf '%s\n%s\n' "$PRIOR_VERSION" "$FORGE_VERSION" | sort -V | head -n1)"
  if [ "$lower" = "$PRIOR_VERSION" ]; then
    echo "  ~ upgrading this target: codeforge $PRIOR_VERSION -> $FORGE_VERSION"
  else
    echo "  ! this target was installed by a NEWER codeforge ($PRIOR_VERSION) than you're running ($FORGE_VERSION)."
    echo "    You may be downgrading it; teammates pinned to $PRIOR_VERSION could see drift. (advisory only)"
  fi
fi

# --- CANONICAL INSTALLED SOURCE: everything required to regenerate the harness ---
# The package source stays organized for framework development, but an installed
# project gets one self-contained `.codeforge/` tree. Engine discovery files
# and project scaffolding below are generated/seeded from this local source.
AW="$TARGET/.codeforge"
mkdir -p "$AW"
manifest="$AW/manifest"

cp "$PAYLOAD/CLAUDE.md" "$AW/WORKFLOW.md"

# Framework agent contracts are refreshed by name; project-specific contracts with other names
# survive upgrades and are rendered by sync only when codeforge has a matching adapter.
mkdir -p "$AW/agents"
for f in "$PAYLOAD"/agents/*.md; do
  [ -e "$f" ] || continue
  cp "$f" "$AW/agents/$(basename "$f")"
done

mkdir -p "$AW/configs" "$AW/docs" "$AW/templates"

# Skills are managed per directory so project-specific additions survive an upgrade. A
# framework skill with the same name is refreshed; a framework skill removed upstream is
# pruned using the previous manifest.
mkdir -p "$AW/skills"
new_skills="$(find "$PAYLOAD/skills" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort)"
if [ -f "$manifest" ]; then
  while IFS= read -r line; do
    line="${line%$'\r'}"
    case "$line" in
      skill:*)
        n="${line#skill:}"
        case "$n" in
          *[!a-z0-9-]*|*--*|-*|*-|"") echo "  ! ignoring unsafe manifest skill entry: $n" >&2 ;;
          *) printf '%s\n' "$new_skills" | grep -qxF "$n" || { rm -rf "$AW/skills/$n"; echo "  - pruned framework skill removed upstream: $n"; } ;;
        esac ;;
    esac
  done < "$manifest"
fi
for d in "$PAYLOAD"/skills/*; do
  [ -d "$d" ] || continue
  n="$(basename "$d")"
  rm -rf "$AW/skills/$n"
  cp -R "$d" "$AW/skills/$n"
done

# Configs are project-owned canonical inputs once seeded. Preserve both edits to shipped files and
# project-added files; deleting an entry is the explicit way to ask a later install to reseed it.
find "$PAYLOAD/configs" -type f -print | while IFS= read -r source_config; do
  config_relative="${source_config#"$PAYLOAD/configs/"}"
  config_target="$AW/configs/$config_relative"
  mkdir -p "$(dirname "$config_target")"
  [ -e "$config_target" ] || cp "$source_config" "$config_target"
done
# Framework docs refresh by name while differently named project additions survive.
cp -R "$PAYLOAD/docs/." "$AW/docs/"
cp "$PAYLOAD/PROJECT.template.md" "$AW/templates/PROJECT.md"
cp "$PAYLOAD/CONTINUITY.template.md" "$AW/templates/CONTINUITY.md"
cp "$PAYLOAD/sync.sh" "$AW/sync.sh"
cp "$PAYLOAD/sync.ps1" "$AW/sync.ps1"
chmod +x "$AW/sync.sh"

# --- PROJECT CONTEXT ADOPTION: preserve pre-existing agent entrypoints verbatim ---
# PROJECT.md is project-owned and becomes the canonical home for project description,
# architecture, commands, and conventions. Generated entrypoints are identified by a marker,
# so routine re-installs never import their own bootstrap text.
[ -f "$TARGET/PROJECT.md" ] || { cp "$AW/templates/PROJECT.md" "$TARGET/PROJECT.md"; echo "  + created PROJECT.md (fill in persona/info/variables/special rules)"; }

old_claude=""
old_agents=""
if [ -f "$TARGET/CLAUDE.md" ] && ! grep -q 'codeforge:entrypoint' "$TARGET/CLAUDE.md" 2>/dev/null; then
  old_claude="$TARGET/CLAUDE.md"
  mkdir -p "$AW/backups"
  [ -e "$AW/backups/CLAUDE.md.pre-codeforge.bak" ] || cp "$old_claude" "$AW/backups/CLAUDE.md.pre-codeforge.bak"
fi
if [ -f "$TARGET/AGENTS.md" ] && ! grep -q 'codeforge:entrypoint' "$TARGET/AGENTS.md" 2>/dev/null; then
  old_agents="$TARGET/AGENTS.md"
  mkdir -p "$AW/backups"
  [ -e "$AW/backups/AGENTS.md.pre-codeforge.bak" ] || cp "$old_agents" "$AW/backups/AGENTS.md.pre-codeforge.bak"
fi

  if [ -n "$old_claude" ] || [ -n "$old_agents" ]; then
  context_block="$(mktemp "$TARGET/.codeforge-context.XXXXXX")" || { echo "install: cannot create a context temp file in $TARGET" >&2; exit 1; }
  project_tmp="$(mktemp "$TARGET/.codeforge-project.XXXXXX")" || { rm -f "$context_block"; echo "install: cannot create a project temp file in $TARGET" >&2; exit 1; }
  {
    printf '%s\n\n' "$context_start"
    if [ -n "$old_claude" ] && [ -n "$old_agents" ] && cmp -s "$old_claude" "$old_agents"; then
      printf '### From existing CLAUDE.md and AGENTS.md\n\n'
      cat "$old_claude"
      printf '\n'
    else
      if [ -n "$old_claude" ]; then
        printf '### From existing CLAUDE.md\n\n'
        cat "$old_claude"
        printf '\n'
      fi
      if [ -n "$old_agents" ]; then
        printf '### From existing AGENTS.md\n\n'
        cat "$old_agents"
        printf '\n'
      fi
    fi
    printf '\n%s\n' "$context_end"
  } > "$context_block"

  if [ "$PROJECT_IMPORT_PRESENT" = 1 ]; then
    awk -v s="$context_start" -v e="$context_end" -v block="$context_block" '
      function emit_block( line) {
        while ((getline line < block) > 0) print line
        close(block)
      }
      { normalized=$0; sub(/\r$/, "", normalized) }
      normalized == s { emit_block(); inside=1; next }
      inside && normalized == e { inside=0; next }
      !inside { print }
    ' "$TARGET/PROJECT.md" > "$project_tmp"
  else
    {
      cat "$TARGET/PROJECT.md"
      printf '\n## Imported agent context\n\n'
      cat "$context_block"
    } > "$project_tmp"
  fi
  project_mode="$(stat -f '%Lp' "$TARGET/PROJECT.md" 2>/dev/null || stat -c '%a' "$TARGET/PROJECT.md" 2>/dev/null || printf '600')"
  chmod "$project_mode" "$project_tmp"
  mv -f "$project_tmp" "$TARGET/PROJECT.md"
  rm -f "$context_block"
  PROJECT_IMPORT_PRESENT=1
  echo "  + preserved existing agent context in PROJECT.md (originals backed up under .codeforge/backups/)"
fi

# --- MANAGED: framework .codeforge/rules/ (per-entry overwrite by name) ---
# Refresh only the framework's own rule entries; anything else in .codeforge/rules/ (your
# project's own rules) is left untouched, so it survives --upgrade.
mkdir -p "$TARGET/.codeforge/rules"
new_rules="$(cd "$PAYLOAD/codeforge/rules" && ls *.md 2>/dev/null)"

# Prune framework rules removed upstream: anything in the last-install manifest that is no
# longer in the current payload is a framework rule deleted upstream — remove it. Project-owned
# rules are never in the manifest, so they are untouched. (No manifest yet = skip prune.)
if [ -f "$manifest" ]; then
  while IFS= read -r line; do
    line="${line%$'\r'}"
    case "$line" in
      rule:*)
        n="${line#rule:}"
        # The manifest is committed (and with --git-init, git-added), so treat it as untrusted:
        # a prune target must be a bare *.md filename — never a path or traversal — so a tampered
        # entry can't delete outside .codeforge/rules/.
        case "$n" in
          */*|*..*|"") echo "  ! ignoring unsafe manifest rule entry: $n" >&2 ;;
          *.md) printf '%s\n' "$new_rules" | grep -qxF "$n" || { rm -f "$TARGET/.codeforge/rules/$n"; echo "  - pruned framework rule removed upstream: $n"; } ;;
          *) echo "  ! ignoring non-.md manifest rule entry: $n" >&2 ;;
        esac ;;
    esac
  done < "$manifest"
fi

for f in "$PAYLOAD"/codeforge/rules/*.md; do
  cp "$f" "$TARGET/.codeforge/rules/$(basename "$f")"
done

# Record framework-owned entries for the next selective upgrade/prune.
{
  printf '%s\n' "$new_rules" | sed 's/^/rule:/'
  printf '%s\n' "$new_skills" | sed 's/^/skill:/'
  printf 'generated:%s\n' "$GENERATED_POLICY"
} > "$manifest"

# Stamp the version that produced this install, for drift detection on the next run.
printf '%s\n' "$FORGE_VERSION" > "$TARGET/.codeforge/version"

# --- MANAGED: workflow state template (lives in .codeforge/, copied to .codeforge/workflow/state.md at
#     workflow start by the skills) ---
cp "$PAYLOAD/codeforge/state.template.md" "$TARGET/.codeforge/state.template.md"

# --- MANAGED: framework .codeforge/scripts/ (agent-invoked Tier-B helpers, e.g. check-gates) ---
if [ -d "$PAYLOAD/codeforge/scripts" ]; then
  mkdir -p "$TARGET/.codeforge/scripts"
  for f in "$PAYLOAD"/codeforge/scripts/*; do
    [ -e "$f" ] || continue
    cp "$f" "$TARGET/.codeforge/scripts/$(basename "$f")"
  done
  chmod +x "$TARGET"/.codeforge/scripts/*.sh 2>/dev/null || true
fi

# --- MANAGED: docs/ scaffolding ---
mkdir -p "$TARGET/docs"
for d in prds plans research solutions adr e2e/reports e2e/use-cases; do
  mkdir -p "$TARGET/docs/$d"
  [ -e "$TARGET/docs/$d/.gitkeep" ] || touch "$TARGET/docs/$d/.gitkeep"
done

# --- MANAGED: CI templates (Verified-tier gate + activation guide) ---
# Copied into the target (overwritten on upgrade). A pre-existing, non-ours file is backed up
# once so first adoption never clobbers a user's own docs/ci-templates content.
if [ -d "$AW/docs/ci-templates" ]; then
  mkdir -p "$TARGET/docs/ci-templates"
  for f in "$AW"/docs/ci-templates/*; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    dst="$TARGET/docs/ci-templates/$base"
    if [ -f "$dst" ] && ! grep -q 'codeforge' "$dst" 2>/dev/null && [ ! -e "$dst.pre-codeforge.bak" ]; then
      cp "$dst" "$dst.pre-codeforge.bak"
      echo "  ! backed up existing docs/ci-templates/$base -> $base.pre-codeforge.bak"
    fi
    cp "$f" "$dst"
  done
fi

# --- PROJECT-OWNED: PROJECT.md / CONTINUITY.md / docs/CHANGELOG.md (create only if missing) ---
[ -f "$TARGET/PROJECT.md" ]    || cp "$AW/templates/PROJECT.md" "$TARGET/PROJECT.md"
[ -f "$TARGET/CONTINUITY.md" ] || cp "$AW/templates/CONTINUITY.md" "$TARGET/CONTINUITY.md"
[ -f "$TARGET/docs/CHANGELOG.md" ] || cp "$AW/docs/CHANGELOG.md" "$TARGET/docs/CHANGELOG.md"

# --- re-render the wizard-owned values FROM PROJECT.md (project-owned) into the MANAGED files ---
# The wizard's review policy and gate profile used to be written straight into
# .codeforge/rules/models.md and .codeforge/state.template.md, which the copy loops above overwrite by name
# — so `--upgrade` silently reset a team's reviewer and profile to the shipped defaults, with no
# backup, and (because --upgrade skips the wizard) nothing reapplied them. PROJECT.md is
# project-owned and never clobbered, so it is the SOURCE OF TRUTH and those two are DERIVED.
# Only value lines are substituted, so the section's comments survive. A missing section, a missing
# line, an unparseable profile, or a malformed managed block is a NO-OP that keeps the shipped
# default — never a partial write.

# Atomic replace of $1 from stdin. The temp is created by mktemp INSIDE the destination directory
# rather than at a predictable "$1.tmp": we install into repos we did not create, and a pre-planted
# symlink at that predictable path would make the redirection write through it to a file outside the
# target. Any failure is fatal, so no caller can print "applied" after a write that did not happen.
forge_atomic_write() {
  _aw_dst="$1"; _aw_dir=$(dirname "$_aw_dst")
  _aw_tmp=$(mktemp "$_aw_dir/.codeforge-render.XXXXXX") || { echo "install: cannot create a temp file in $_aw_dir" >&2; exit 1; }
  if ! cat > "$_aw_tmp"; then rm -f "$_aw_tmp"; echo "install: failed writing $_aw_dst" >&2; exit 1; fi
  # mktemp creates 0600; these are framework-owned markdown docs, world-readable like the payload.
  chmod 644 "$_aw_tmp" || { rm -f "$_aw_tmp"; echo "install: failed setting mode on $_aw_dst" >&2; exit 1; }
  mv "$_aw_tmp" "$_aw_dst" || { rm -f "$_aw_tmp"; echo "install: failed replacing $_aw_dst" >&2; exit 1; }
}

# No migration for targets predating this section: reinstall from scratch to adopt it. Say so out
# loud rather than no-opping silently, since the symptom otherwise looks like the bug this fixes.
if [ -f "$TARGET/PROJECT.md" ] && ! grep -q '^## Review policy[[:space:]]*$' "$TARGET/PROJECT.md" 2>/dev/null; then
  echo "  ~ PROJECT.md has no '## Review policy' section — the shipped defaults stay in effect."
  echo "    Add the section (see src/PROJECT.template.md) or reinstall the target to adopt it."
fi

if [ -f "$TARGET/PROJECT.md" ]; then
  # Body of the FIRST '## Review policy' section only (CRLF-tolerant). A duplicated heading must not
  # concatenate two bodies and mix a reviewer from one with a profile from the other.
  policy=$(awk '{ sub(/\r$/,"") }
    /^## Review policy[[:space:]]*$/ { if (!seen) { seen=1; f=1; next } }
    f && /^## / { f=0 }
    f { print }' "$TARGET/PROJECT.md")
  _pol_count=$(grep -c '^## Review policy[[:space:]]*$' "$TARGET/PROJECT.md" || true)
  [ "${_pol_count:-0}" -le 1 ] || echo "  ! PROJECT.md has $_pol_count '## Review policy' sections — using the first"

  # First match wins, `exit` instead of `head` so nothing can die on SIGPIPE (141) under `pipefail`
  # after the managed files were already replaced. The key is matched as a LITERAL PREFIX via
  # index(), not as a dynamic regex: `awk -v` applies escape processing, so a key written
  # `Default reviewer\(s\):` arrives as `Default reviewer(s):` and the parens become a capture
  # group that no longer matches the real line — which is exactly how this returned empty once.
  pol_line() {
    printf '%s\n' "$policy" | awk -v k="$1" '
      { line = $0; sub(/^[[:space:]]+/, "", line) }
      index(line, k) == 1 { sub(/[[:space:]]+$/, "", line); print line; exit }'
  }
  rev_line=$(pol_line 'Default reviewer(s):')
  cou_line=$(pol_line 'Council advisors:')
  prof=$(printf '%s\n' "$policy" | awk 'match($0, /^[[:space:]]*Gate profile:[[:space:]]*[A-Za-z][A-Za-z-]*/) {
    s = substr($0, RSTART, RLENGTH); sub(/.*Gate profile:[[:space:]]*/, "", s); print s; exit }')

  # models.md: substitute each present key INDEPENDENTLY inside the managed block. Requiring both
  # would discard a valid reviewer just because the council line was missing.
  mm="$TARGET/.codeforge/rules/models.md"
  if { [ -n "$rev_line" ] || [ -n "$cou_line" ]; } && [ -f "$mm" ]; then
    # Exactly one well-ordered marker pair, or skip: an extra start would leave the in-block state
    # active to EOF, and a missing pair would report success while changing nothing.
    _mk=$(awk '/codeforge:review-policy:start/ { s++; if (!f) f=NR }
               /codeforge:review-policy:end/   { e++; if (!l) l=NR }
               END { printf "%d %d %d %d", s+0, e+0, f+0, l+0 }' "$mm")
    set -- $_mk
    if [ "$1" = 1 ] && [ "$2" = 1 ] && [ "$3" -lt "$4" ]; then
      # Values pass through the ENVIRONMENT, not `awk -v`: -v applies escape-sequence processing, so
      # a hand-edited label containing `C:\tmp\new` would become a TAB plus a line break and split
      # the file. ENVIRON[] is literal. The profile is metacharacter-proof by a different route —
      # an allowlist before it ever reaches sed.
      REV_LINE="$rev_line" COU_LINE="$cou_line" awk '
        /codeforge:review-policy:start/ { inblk=1; print; next }
        /codeforge:review-policy:end/   { inblk=0; print; next }
        inblk && /^[[:space:]]*Default reviewer\(s\):/ { if (ENVIRON["REV_LINE"] != "") { print ENVIRON["REV_LINE"]; next } }
        inblk && /^[[:space:]]*Council advisors:/      { if (ENVIRON["COU_LINE"] != "") { print ENVIRON["COU_LINE"]; next } }
        { print }
      ' "$mm" | forge_atomic_write "$mm"
      echo "  = review policy applied from PROJECT.md -> .codeforge/rules/models.md"
    else
      echo "  ! .codeforge/rules/models.md has a malformed review-policy marker pair — left untouched"
    fi
  fi

  # state.template.md: only a profile check-gates accepts may be written through, or the user gets a
  # template that exits 3 ("unknown gate profile") against its own validator. Case-sensitive on
  # purpose, so `LIGHT` is rejected here exactly as install.ps1 rejects it.
  st="$TARGET/.codeforge/state.template.md"
  case "$prof" in
    standard|light)
      if [ -f "$st" ]; then
        sed "s/\(\*\*Profile:\*\*[[:space:]]*\)[A-Za-z][A-Za-z-]*/\1$prof/" "$st" | forge_atomic_write "$st"
        echo "  = gate profile applied from PROJECT.md -> .codeforge/state.template.md ($prof)"
      fi ;;
    "") : ;;
    *) echo "  ! PROJECT.md 'Gate profile: $prof' is not 'standard' or 'light' — keeping the shipped default" ;;
  esac
fi

# --- back up any pre-existing, NON-forge per-engine skills dir before sync overwrites it ---
# (generated dirs carry a .codeforge-generated marker; a dir without it is the user's own,
#  so we never wipe a user's skills — even one coincidentally named new-feature.)
for eng in .claude .agents; do
  sd="$TARGET/$eng/skills"
  if [ -e "$sd" ] && [ ! -e "$sd/.codeforge-generated" ]; then
    mv "$sd" "$sd.pre-codeforge.bak"
    echo "  ! backed up existing $eng/skills -> $eng/skills.pre-codeforge.bak (add custom skills under .codeforge/skills)"
  fi
done

# The generated implementer uses a codeforge-owned name. Preserve a pre-existing definition once
# before sync claims that path; unrelated custom agents in either directory are never touched.
for agent_path in .claude/agents/codeforge-implementer.md .codex/agents/codeforge-implementer.toml; do
  existing="$TARGET/$agent_path"
  if [ -f "$existing" ] && ! grep -q 'codeforge:generated-agent' "$existing" 2>/dev/null; then
    backup="$existing.pre-codeforge.bak"
    [ -e "$backup" ] || cp "$existing" "$backup"
    echo "  ! backed up existing $agent_path -> $agent_path.pre-codeforge.bak"
  fi
done
# --- GENERATE engine dirs + AGENTS.md + opencode.json from the installed source ---
# Users can re-run this exact command after inspecting/customizing `.codeforge/`.
bash "$AW/sync.sh" --out "$TARGET" >/dev/null

# --- Claude Code .claude/settings.local.json: auto-isolation ---
# Lands in this one gitignored, per-developer, machine-specific file. Auto-isolation (default;
# --no-isolate to keep inheritance) adds `claudeMdExcludes` so Claude Code does NOT blend ancestor
# CLAUDE.md / .claude/rules into this project — Codex and OpenCode already scope to the project
# root, Claude Code walks to the filesystem root. codeforge only (re)writes this file when it is
# absent or a prior forge install owned it (tracked as `localsettings:managed` in .codeforge/manifest);
# a file it doesn't own is left alone.
# JSON-escape one path without jq/Python/Node. Escape each path while traversing: a newline is a
# legal filename byte, so raw paths must never be accumulated in a newline-delimited variable.
forge_json_escape() {
  LC_ALL=C awk 'BEGIN {
      ORS=""
      for (code=1; code<32; code++) controls=controls sprintf("%c", code)
    }
    {
      if (NR > 1) printf "\\n"
      for (i=1; i<=length($0); i++) {
        ch=substr($0, i, 1)
        if (ch == "\\") printf "\\\\"
        else if (ch == "\"") printf "\\\""
        else if ((code=index(controls, ch)) > 0) printf "\\u%04x", code
        else printf "%s", ch
      }
    }'
}

excl_json=""
n_excl=0
forge_add_exclude() {
  escaped_p="$(printf '%s' "$1" | forge_json_escape)"
  if [ -z "$excl_json" ]; then excl_json="$(printf '\n    "%s"' "$escaped_p")"
  else excl_json="$excl_json$(printf ',\n    "%s"' "$escaped_p")"; fi
  n_excl=$((n_excl + 1))
}

if [ "$ISOLATE" = "1" ]; then
  d="$(dirname "$TARGET")"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    [ ! -f "$d/CLAUDE.md" ]       || forge_add_exclude "$d/CLAUDE.md"
    [ ! -f "$d/CLAUDE.local.md" ] || forge_add_exclude "$d/CLAUDE.local.md"
    if [ -d "$d/.claude/rules" ] && [ "$d" != "$HOME" ]; then
      forge_add_exclude "$d/.claude/rules/**"
    fi
    nd="$(dirname "$d")"; [ "$nd" = "$d" ] && break; d="$nd"
  done
fi

sl="$TARGET/.claude/settings.local.json"
if [ "$n_excl" -gt 0 ]; then
  if [ -f "$sl" ] && [ "$PRIOR_LOCAL_MANAGED" != "1" ]; then
    echo "  ! .claude/settings.local.json exists and isn't codeforge-managed — not touching it."
    echo "    (skipped auto-isolation; remove that file and re-run, or edit it by hand.)"
  else
    {
      printf '{'
      [ "$n_excl" -gt 0 ] && printf '\n  "claudeMdExcludes": [%s\n  ]' "$excl_json"
      printf '\n}\n'
    } > "$sl"
    awk '{ sub(/\r$/, "") } $0 == "localsettings:managed" { found=1 } END { exit !found }' \
      "$manifest" 2>/dev/null || printf 'localsettings:managed\n' >> "$manifest"
    [ "$n_excl" -gt 0 ]      && echo "  + auto-isolated Claude Code from $n_excl ancestor instruction path(s) -> .claude/settings.local.json (--no-isolate to keep inheritance)"
  fi
elif [ "$PRIOR_LOCAL_MANAGED" = "1" ] && [ -f "$sl" ]; then
  rm -f "$sl"
  echo "  - removed codeforge-managed .claude/settings.local.json (nothing to configure now)"
fi

# --- .gitignore (managed block; user content outside it is preserved) ---
# `.codeforge/`, the root entrypoints, PROJECT.md, CONTINUITY.md, and docs/ are always
# trackable. Only engine-specific copies are optional because `.codeforge/sync.*` can rebuild
# them. The file is created even before `git init`, preventing a later accidental bulk add.
touch "$gi"

gi_tmp="$(mktemp "$TARGET/.codeforge-gitignore.XXXXXX")" || { echo "install: cannot create a temp file in $TARGET" >&2; exit 1; }
awk -v s="$gi_start" -v e="$gi_end" '
  { line=$0; sub(/\r$/, "", line) }
  line == s { inblk=1; next }
  inblk && line == e { inblk=0; next }
  !inblk { raw[++n]=$0; normalized[n]=line }
  END { while (n > 0 && normalized[n] == "") n--; for (i=1; i<=n; i++) print raw[i] }
' "$gi" > "$gi_tmp"

{
  [ ! -s "$gi_tmp" ] || printf '\n'
  printf '%s\n' "$gi_start"
  printf '# Local-only codeforge state\n'
  printf '.DS_Store\n.codeforge/workflow/\n.claude/settings.local.json\n'
  if [ "$GENERATED_POLICY" = "ignored" ]; then
    printf '# Generated adapters (rebuild with .codeforge/sync.sh or sync.ps1)\n'
    printf '.claude/settings.json\n.claude/skills/\n.claude/agents/codeforge-implementer.md\n'
    printf '.agents/skills/\n'
    printf '.codex/config.toml\n.codex/agents/codeforge-implementer.toml\n'
    printf '/opencode.json\n'
  fi
  printf '%s\n' "$gi_end"
} >> "$gi_tmp"
chmod 644 "$gi_tmp"
mv "$gi_tmp" "$gi"

if [ "$GENERATED_POLICY" = "ignored" ]; then
  echo "  = generated engine adapters are gitignored (regenerate from .codeforge/)"
  tracked_generated="$(git -C "$TARGET" ls-files -- \
    .claude/settings.json .claude/skills .claude/agents/codeforge-implementer.md \
    .agents/skills .codex/config.toml .codex/agents/codeforge-implementer.toml \
    opencode.json 2>/dev/null || true)"
  if [ -n "$tracked_generated" ]; then
    tracked_count="$(printf '%s\n' "$tracked_generated" | awk 'END { print NR }')"
    echo "  ! generated adapters are ignored for new Git additions, but $tracked_count path(s) are already tracked."
    echo "    The installer left the Git index unchanged. To untrack them without deleting local files, run:"
    echo "    git rm -r --cached --ignore-unmatch -- .claude/settings.json .claude/skills .claude/agents/codeforge-implementer.md .agents/skills .codex/config.toml .codex/agents/codeforge-implementer.toml opencode.json"
  fi
else
  echo "  = generated engine adapters remain trackable (fresh clones work immediately)"
fi

# --- warn if the generated config lacks the forge push/PR gate (points at the codeforge
#     source baseline that produced it) ---
warn_gate() {  # $1 = generated file in target, $2 = grep needle, $3 = hint
  if [ -f "$TARGET/$1" ] && ! grep -q "$2" "$TARGET/$1" 2>/dev/null; then
    echo "  ! $1 has no forge push/PR gate ($3) — update .codeforge/configs, then run .codeforge/sync.sh"
  fi
}
warn_gate ".claude/settings.json" "git push"       "ask-tier on git push / gh pr create"
warn_gate ".codex/config.toml"    "approval_policy" "approval_policy"
warn_gate "opencode.json"         "git push"       "permission.bash git push* / gh pr create*"

# --- post-install validation: generated skills + AGENTS.md + engine configs must exist ---
ok=1
for p in .claude/skills .agents/skills; do
  [ -e "$TARGET/$p/new-feature/SKILL.md" ] || { echo "  ! discovery FAILED: $p was not generated"; ok=0; }
done
for f in CLAUDE.md AGENTS.md PROJECT.md .claude/settings.json .codex/config.toml opencode.json \
         .claude/agents/codeforge-implementer.md .codex/agents/codeforge-implementer.toml \
         .codeforge/WORKFLOW.md .codeforge/skills/new-feature/SKILL.md \
         .codeforge/agents/codeforge-implementer.md \
         .codeforge/configs/codex/config.toml .codeforge/sync.sh \
         .codeforge/sync.ps1 .codeforge/scripts/run-reviewer.mjs \
         .codeforge/state.template.md; do
  [ -f "$TARGET/$f" ] || { echo "  ! FAILED: $f was not generated"; ok=0; }
done
if [ "$ok" != 1 ]; then
  echo "  ✗ install INCOMPLETE — issues above; NOT marking as installed" >&2
  exit 1
fi
echo "  ✓ validation: minimal entrypoints, project context, skills, and engine configs generated"

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  case "$node_major" in
    ''|*[!0-9]*) echo "  ! Node.js 20+ is required to run cross-engine review/council (found: $(node --version 2>/dev/null || echo unknown))" ;;
    *) [ "$node_major" -ge 20 ] || echo "  ! Node.js 20+ is required to run cross-engine review/council (found: $(node --version 2>/dev/null || echo unknown))" ;;
  esac
else
  echo "  ! Node.js 20+ was not found; installation is usable, but cross-engine review/council cannot run until Node is installed"
fi

# --- git: the workflow (branches/commits) and ship gates operate on git ---
if git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  :  # already a git repo — the workflow uses it
elif [ "$GIT_INIT" = "1" ]; then
  command -v git >/dev/null 2>&1 || { echo "error: --git-init requires git on PATH" >&2; exit 2; }
  git -C "$TARGET" init -q || { echo "error: git init failed in $TARGET" >&2; exit 1; }
  git -C "$TARGET" add -A || { echo "error: git add failed in $TARGET" >&2; exit 1; }
  if git -C "$TARGET" commit -q -m "chore: adopt codeforge" 2>/dev/null; then
    echo "  + initialized a git repo + baseline commit (chore: adopt codeforge)"
  else
    echo "  + initialized a git repo (baseline commit skipped — set git user.name/email, then commit)"
  fi
else
  echo "  ! not a git repo — codeforge's workflow (branches, commits) and the ship gates assume git."
  echo "    Run 'git init' here, or re-run the installer with --git-init."
fi

echo "codeforge installed."
echo "  next: (1) fill PROJECT.md   (2) in Codex, trust the project when prompted"
echo "        (3) open the project in any of Claude Code / Codex / OpenCode"
echo "  customize locally in .codeforge/, then run: .codeforge/sync.sh"
echo "  upgrade the framework baseline by re-running this installer with --upgrade."

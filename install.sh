#!/usr/bin/env bash
#
# codeforge installer — copy the workflow discipline into a target project.
#
#   ./install.sh [target-dir] [--upgrade] [--git-init] [--no-isolate]
#
# With no target-dir, installs into the current working directory. So the common flow is:
#   cd my-project && /path/to/codeforge/install.sh
#
# THIN INSTALL: the target receives only what the agent needs at RUNTIME. All framework
# machinery (the neutral source in ./src/, the generators sync.sh/ps1, the generation
# inputs in configs/, and the seed templates) stays in the codeforge repo — never copied
# into the target. To customize or upgrade, edit the codeforge source and re-run this
# installer against the target (`--upgrade`, or a bare re-run from inside the project).
#
# The shippable payload is the NEUTRAL source in ./src/ (CLAUDE.md, skills/, shared/,
# configs/, docs/, *.template.md). This installer copies the runtime subset into the
# target, then runs `sync.sh --out <target>` to GENERATE each engine's config + skills
# (.claude/ + .agents/skills + .codex/config.toml + AGENTS.md + opencode.json) straight
# into the target. No symlinks (Windows-safe). The generated engine artifacts are COMMITTED
# with the target project so a fresh clone works immediately — no codeforge dependency at
# runtime; re-run the installer after editing the source to regenerate.
#
# LANDS IN THE TARGET (runtime only):
#   CLAUDE.md, AGENTS.md, opencode.json, .claude/, .agents/, .codex/ (generated),
#   shared/rules/*.md + shared/state.template.md + shared/scripts/* (managed), docs/ scaffolding + CHANGELOG,
#   PROJECT.md + CONTINUITY.md (project-owned, seeded if missing).
# STAYS IN codeforge (never copied): src/skills (neutral), configs/, sync.sh, sync.ps1,
#   *.template.md, docs/extending.md.
#
# MANAGED (framework baseline — OVERWRITTEN on install/upgrade): CLAUDE.md, the framework's
#   OWN entries in shared/rules/, shared/state.template.md. Your own rules dropped into
#   shared/rules/ survive upgrades (selective, per-entry by name).
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
TARGET=""
usage="usage: $0 [target-dir] [--upgrade] [--git-init] [--no-isolate]"
while [ $# -gt 0 ]; do
  case "$1" in
    --upgrade)     MODE="upgrade" ;;
    --with-hooks)  echo "  ! --with-hooks is retired (the Claude gate hook is superseded by the CI Verified tier); ignoring." >&2 ;;
    --git-init)    GIT_INIT=1 ;;
    --no-isolate)  ISOLATE=0 ;;
    -*)            echo "$usage  (unknown arg: $1)" >&2; exit 2 ;;
    *)             if [ -z "$TARGET" ]; then TARGET="$1"; else echo "$usage  (unexpected arg: $1)" >&2; exit 2; fi ;;
  esac
  shift
done
TARGET="${TARGET:-$PWD}"

[ -d "$TARGET" ] || { echo "error: target dir not found: $TARGET" >&2; exit 2; }
TARGET="$(cd "$TARGET" && pwd)"
# Did a prior forge install own .claude/settings.local.json? (read before the manifest is
# rewritten below, so the settings writer knows whether it may safely regenerate the file.)
PRIOR_LOCAL_MANAGED=0
grep -q '^localsettings:managed$' "$TARGET/.forge-manifest" 2>/dev/null && PRIOR_LOCAL_MANAGED=1
{ [ -f "$PAYLOAD/CLAUDE.md" ] && [ -d "$PAYLOAD/skills" ]; } || { echo "error: payload not found — run this from the codeforge repo" >&2; exit 2; }
[ "$TARGET" != "$SRC" ]     || { echo "error: refusing to install into codeforge itself" >&2; exit 2; }
[ "$TARGET" != "$PAYLOAD" ] || { echo "error: refusing to install into the codeforge payload dir (src/)" >&2; exit 2; }

echo "codeforge $FORGE_VERSION → installing into: $TARGET  (mode: $MODE)"

# --- version drift advisory (informational only, never blocks) ---
# Compare the version that last stamped this target against the one we're installing.
PRIOR_VERSION=""
[ -f "$TARGET/.forge-version" ] && PRIOR_VERSION="$(head -n1 "$TARGET/.forge-version" | tr -d '[:space:]')"
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

# --- self-healing: drop machinery this version no longer installs into the target ---
# (thin model — machinery lives in the codeforge repo; the target gets runtime only.) This
# migrates a target from an older, bloated install. Gated on a prior forge install
# (.forge-manifest present) so a FIRST install never touches an unrelated project's own
# configs/ or skills/ dirs.
if [ -f "$TARGET/.forge-manifest" ]; then
  if [ -e "$TARGET/shared/scripts/claude-gate-hook.sh" ] || [ -e "$TARGET/shared/scripts/claude-gate-hook.ps1" ]; then
    echo "  ~ the Claude gate hook (--with-hooks) is retired — enforcement is now the CI Verified tier (docs/ci-templates/)."
  fi
  # Retired: the opt-in Claude gate hook (superseded by the CI Verified tier).
  for f in shared/scripts/claude-gate-hook.sh shared/scripts/claude-gate-hook.ps1; do
    [ -e "$TARGET/$f" ] && { rm -f "$TARGET/$f"; echo "  - removed retired gate hook: $f"; }
  done
  # Detect a genuinely OLD (pre-thin) forge install: it left this machinery at the target root.
  # A modern thin install — or an unrelated app that happens to keep its own top-level configs/
  # or skills/ — does NOT. Gate the configs/skills migration on this signal so a routine
  # re-install never relocates a project's own configs/ or skills/ just because a manifest exists.
  old_install=0
  for f in sync.sh sync.ps1 state.template.md PROJECT.template.md CONTINUITY.template.md docs/extending.md; do
    [ -e "$TARGET/$f" ] && old_install=1
  done
  # Framework-owned machinery, no user content — removed outright.
  for f in sync.sh sync.ps1 state.template.md PROJECT.template.md CONTINUITY.template.md docs/extending.md; do
    [ -e "$TARGET/$f" ] && { rm -f "$TARGET/$f"; echo "  - removed obsolete framework file: $f"; }
  done
  # Only migrate configs/ and the neutral skills/ when this was actually an old bloated install
  # (back them up rather than delete, so nothing is lost).
  if [ "$old_install" = 1 ] && [ -d "$TARGET/configs" ]; then
    rm -rf "$TARGET/configs.pre-forge.bak"; mv "$TARGET/configs" "$TARGET/configs.pre-forge.bak"
    echo "  ! configs/ is obsolete (engine configs are generated now) -> configs.pre-forge.bak; per-project Claude tweaks go in .claude/settings.local.json"
  fi
  if [ "$old_install" = 1 ] && [ -d "$TARGET/skills" ]; then
    rm -rf "$TARGET/skills.pre-forge.bak"; mv "$TARGET/skills" "$TARGET/skills.pre-forge.bak"
    echo "  ! neutral skills/ is obsolete (skills are generated now) -> skills.pre-forge.bak; add custom skills to the codeforge repo"
  fi
fi

# --- MANAGED: CLAUDE.md (back up a pre-existing, non-forge one on first install) ---
if [ -f "$TARGET/CLAUDE.md" ] && ! grep -q "Workflow discipline for Claude Code" "$TARGET/CLAUDE.md" 2>/dev/null; then
  cp "$TARGET/CLAUDE.md" "$TARGET/CLAUDE.md.pre-forge.bak"
  echo "  ! backed up existing CLAUDE.md -> CLAUDE.md.pre-forge.bak (move project-specifics into PROJECT.md)"
fi
cp "$PAYLOAD/CLAUDE.md" "$TARGET/CLAUDE.md"

# --- MANAGED: framework shared/rules/ (per-entry overwrite by name) ---
# Refresh only the framework's own rule entries; anything else in shared/rules/ (your
# project's own rules) is left untouched, so it survives --upgrade.
mkdir -p "$TARGET/shared/rules"
new_rules="$(cd "$PAYLOAD/shared/rules" && ls *.md 2>/dev/null)"

# Prune framework rules removed upstream: anything in the last-install manifest that is no
# longer in the current payload is a framework rule deleted upstream — remove it. Project-owned
# rules are never in the manifest, so they are untouched. (No manifest yet = skip prune.)
manifest="$TARGET/.forge-manifest"
if [ -f "$manifest" ]; then
  while IFS= read -r line; do
    case "$line" in
      rule:*)
        n="${line#rule:}"
        # The manifest is committed (and with --git-init, git-added), so treat it as untrusted:
        # a prune target must be a bare *.md filename — never a path or traversal — so a tampered
        # entry can't delete outside shared/rules/.
        case "$n" in
          */*|*..*|"") echo "  ! ignoring unsafe manifest rule entry: $n" >&2 ;;
          *.md) printf '%s\n' "$new_rules" | grep -qxF "$n" || { rm -f "$TARGET/shared/rules/$n"; echo "  - pruned framework rule removed upstream: $n"; } ;;
          *) echo "  ! ignoring non-.md manifest rule entry: $n" >&2 ;;
        esac ;;
    esac
  done < "$manifest"
fi

for f in "$PAYLOAD"/shared/rules/*.md; do
  cp "$f" "$TARGET/shared/rules/$(basename "$f")"
done

# Record the framework-owned manifest for the next upgrade's prune (rules only; skills are
# fully generated by sync, so there is nothing skill-level to selectively prune).
{ printf '%s\n' "$new_rules" | sed 's/^/rule:/'; } > "$manifest"

# Stamp the version that produced this install, for drift detection on the next run.
printf '%s\n' "$FORGE_VERSION" > "$TARGET/.forge-version"

# --- MANAGED: workflow state template (lives in shared/, copied to .workflow/state.md at
#     workflow start by the skills) ---
cp "$PAYLOAD/shared/state.template.md" "$TARGET/shared/state.template.md"

# --- MANAGED: framework shared/scripts/ (agent-invoked Tier-B helpers, e.g. check-gates) ---
if [ -d "$PAYLOAD/shared/scripts" ]; then
  mkdir -p "$TARGET/shared/scripts"
  for f in "$PAYLOAD"/shared/scripts/*; do
    [ -e "$f" ] || continue
    cp "$f" "$TARGET/shared/scripts/$(basename "$f")"
  done
  chmod +x "$TARGET"/shared/scripts/*.sh 2>/dev/null || true
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
if [ -d "$PAYLOAD/docs/ci-templates" ]; then
  mkdir -p "$TARGET/docs/ci-templates"
  for f in "$PAYLOAD"/docs/ci-templates/*; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    dst="$TARGET/docs/ci-templates/$base"
    if [ -f "$dst" ] && ! grep -q 'codeforge' "$dst" 2>/dev/null && [ ! -e "$dst.pre-forge.bak" ]; then
      cp "$dst" "$dst.pre-forge.bak"
      echo "  ! backed up existing docs/ci-templates/$base -> $base.pre-forge.bak"
    fi
    cp "$f" "$dst"
  done
fi

# --- PROJECT-OWNED: PROJECT.md / CONTINUITY.md / docs/CHANGELOG.md (create only if missing) ---
[ -f "$TARGET/PROJECT.md" ]    || { cp "$PAYLOAD/PROJECT.template.md" "$TARGET/PROJECT.md"; echo "  + created PROJECT.md (fill in persona/info/variables/special rules)"; }
[ -f "$TARGET/CONTINUITY.md" ] || cp "$PAYLOAD/CONTINUITY.template.md" "$TARGET/CONTINUITY.md"
[ -f "$TARGET/docs/CHANGELOG.md" ] || cp "$PAYLOAD/docs/CHANGELOG.md" "$TARGET/docs/CHANGELOG.md"

# --- re-render the wizard-owned values FROM PROJECT.md (project-owned) into the MANAGED files ---
# The wizard's review policy and gate profile used to be written straight into
# shared/rules/models.md and shared/state.template.md, which the copy loops above overwrite by name
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
  _aw_tmp=$(mktemp "$_aw_dir/.forge-render.XXXXXX") || { echo "install: cannot create a temp file in $_aw_dir" >&2; exit 1; }
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
  mm="$TARGET/shared/rules/models.md"
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
      echo "  = review policy applied from PROJECT.md -> shared/rules/models.md"
    else
      echo "  ! shared/rules/models.md has a malformed review-policy marker pair — left untouched"
    fi
  fi

  # state.template.md: only a profile check-gates accepts may be written through, or the user gets a
  # template that exits 3 ("unknown gate profile") against its own validator. Case-sensitive on
  # purpose, so `LIGHT` is rejected here exactly as install.ps1 rejects it.
  st="$TARGET/shared/state.template.md"
  case "$prof" in
    standard|light)
      if [ -f "$st" ]; then
        sed "s/\(\*\*Profile:\*\*[[:space:]]*\)[A-Za-z][A-Za-z-]*/\1$prof/" "$st" | forge_atomic_write "$st"
        echo "  = gate profile applied from PROJECT.md -> shared/state.template.md ($prof)"
      fi ;;
    "") : ;;
    *) echo "  ! PROJECT.md 'Gate profile: $prof' is not 'standard' or 'light' — keeping the shipped default" ;;
  esac
fi

# --- back up any pre-existing, NON-forge per-engine skills dir before sync overwrites it ---
# (forge-generated dirs carry a .forge-generated marker; a dir without it is the user's own,
#  so we never wipe a user's skills — even one coincidentally named new-feature.)
for eng in .claude .agents; do
  sd="$TARGET/$eng/skills"
  if [ -e "$sd" ] && [ ! -e "$sd/.forge-generated" ]; then
    mv "$sd" "$sd.pre-forge.bak"
    echo "  ! backed up existing $eng/skills -> $eng/skills.pre-forge.bak (add custom skills to the codeforge repo)"
  fi
done
# back up a real, non-forge AGENTS.md before sync overwrites it
if [ -f "$TARGET/AGENTS.md" ] && ! grep -q "Workflow discipline for Claude Code" "$TARGET/AGENTS.md" 2>/dev/null; then
  cp "$TARGET/AGENTS.md" "$TARGET/AGENTS.md.pre-forge.bak"
  echo "  ! backed up existing AGENTS.md -> AGENTS.md.pre-forge.bak"
fi

# --- GENERATE engine dirs + AGENTS.md + opencode.json via sync (reads the codeforge source,
#     writes straight into the target — no source or sync script copied there) ---
bash "$PAYLOAD/sync.sh" --out "$TARGET" >/dev/null

# --- Claude Code .claude/settings.local.json: auto-isolation ---
# Lands in this one gitignored, per-developer, machine-specific file. Auto-isolation (default;
# --no-isolate to keep inheritance) adds `claudeMdExcludes` so Claude Code does NOT blend ancestor
# CLAUDE.md / .claude/rules into this project — Codex and OpenCode already scope to the project
# root, Claude Code walks to the filesystem root. codeforge only (re)writes this file when it is
# absent or a prior forge install owned it (tracked as `localsettings:managed` in .forge-manifest);
# a file it doesn't own is left alone.
excludes=""
if [ "$ISOLATE" = "1" ]; then
  d="$(dirname "$TARGET")"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    [ -f "$d/CLAUDE.md" ]       && excludes="$excludes$d/CLAUDE.md
"
    [ -f "$d/CLAUDE.local.md" ] && excludes="$excludes$d/CLAUDE.local.md
"
    { [ -d "$d/.claude/rules" ] && [ "$d" != "$HOME" ]; } && excludes="$excludes$d/.claude/rules/**
"
    nd="$(dirname "$d")"; [ "$nd" = "$d" ] && break; d="$nd"
  done
fi
n_excl=$(printf '%s' "$excludes" | grep -c . || true)

sl="$TARGET/.claude/settings.local.json"
if [ "$n_excl" -gt 0 ]; then
  if [ -f "$sl" ] && [ "$PRIOR_LOCAL_MANAGED" != "1" ]; then
    echo "  ! .claude/settings.local.json exists and isn't codeforge-managed — not touching it."
    echo "    (skipped auto-isolation; remove that file and re-run, or edit it by hand.)"
  else
    excl_json=""
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      if [ -z "$excl_json" ]; then excl_json="$(printf '\n    "%s"' "$p")"
      else excl_json="$excl_json$(printf ',\n    "%s"' "$p")"; fi
    done <<EOF
$excludes
EOF
    {
      printf '{'
      [ "$n_excl" -gt 0 ] && printf '\n  "claudeMdExcludes": [%s\n  ]' "$excl_json"
      printf '\n}\n'
    } > "$sl"
    grep -q '^localsettings:managed$' "$manifest" 2>/dev/null || printf 'localsettings:managed\n' >> "$manifest"
    [ "$n_excl" -gt 0 ]      && echo "  + auto-isolated Claude Code from $n_excl ancestor instruction path(s) -> .claude/settings.local.json (--no-isolate to keep inheritance)"
  fi
elif [ "$PRIOR_LOCAL_MANAGED" = "1" ] && [ -f "$sl" ]; then
  rm -f "$sl"
  echo "  - removed codeforge-managed .claude/settings.local.json (nothing to configure now)"
fi

# --- .gitignore (merge, don't clobber): ONLY local state ---
# The generated engine artifacts (.claude/, .agents/, .codex/, AGENTS.md, opencode.json)
# are COMMITTED with the project so a fresh clone works immediately — no post-clone step,
# no dependency on codeforge. Only genuinely local/transient state is ignored here.
touch "$TARGET/.gitignore"
if ! grep -qx '# codeforge (local state — do not commit)' "$TARGET/.gitignore"; then
  {
    printf '\n# codeforge (local state — do not commit)\n'
    printf '.DS_Store\n.workflow/\n.claude/settings.local.json\n'
  } >> "$TARGET/.gitignore"
fi

# Ensure .workflow/ is ignored even if the marker block predates it or was edited (idempotent).
if ! grep -qxF '.workflow/' "$TARGET/.gitignore"; then
  # If the file's last byte isn't a newline, add one first so we don't fuse onto that line.
  [ -s "$TARGET/.gitignore" ] && [ -n "$(tail -c1 "$TARGET/.gitignore")" ] && printf '\n' >> "$TARGET/.gitignore"
  printf '.workflow/\n' >> "$TARGET/.gitignore"
fi

# --- warn if the generated config lacks the forge push/PR gate (points at the codeforge
#     source baseline that produced it) ---
warn_gate() {  # $1 = generated file in target, $2 = grep needle, $3 = hint
  if [ -f "$TARGET/$1" ] && ! grep -q "$2" "$TARGET/$1" 2>/dev/null; then
    echo "  ! $1 has no forge push/PR gate ($3) — add it to the codeforge source, then re-run."
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
for f in AGENTS.md .claude/settings.json .codex/config.toml opencode.json shared/state.template.md; do
  [ -f "$TARGET/$f" ] || { echo "  ! FAILED: $f was not generated"; ok=0; }
done
if [ "$ok" != 1 ]; then
  echo "  ✗ install INCOMPLETE — issues above; NOT marking as installed" >&2
  exit 1
fi
echo "  ✓ validation: skills (.claude + .agents), AGENTS.md, and engine configs generated"

# --- git: the workflow (branches/commits) and ship gates operate on git ---
if git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  :  # already a git repo — the workflow uses it
elif [ "$GIT_INIT" = "1" ]; then
  git -C "$TARGET" init -q
  git -C "$TARGET" add -A
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
echo "  to customize or upgrade: edit the codeforge source, then re-run this installer"
echo "  against the project (--upgrade, or a bare re-run from inside it)."

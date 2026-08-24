#!/usr/bin/env bash
#
# codeforge smoke test — install into throwaway targets and assert the result.
# Backs the README's "validated on bash and PowerShell" claim and guards install/sync
# parity. Framework dev tool — NOT payload, never installed into a target.
#
#   ./tests/smoke.sh
#
# Exits 0 with "ALL PASS", or non-zero on the first failed assertion.
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# Write a `standard`-profile workflow state with the full 6-gate checklist (matches
# .codeforge/rules/ship-gates.md — check-gates validates gate IDENTITY, so the box wording must
# name each canonical gate). The E2E gate uses the `— N/A:` escape so no report file is needed
# in the throwaway target. $1 = file, $2 = green (all checked) | red (last box unchecked).
write_state() {
  { printf '## Active workflow\n- **Profile:** standard\n## Ship-gate checklist\n'
    printf -- '- [x] On a feature branch\n- [x] Plan reviewed\n- [x] Tests passing\n'
    printf -- '- [x] Code review clean\n- [x] E2E verified — N/A: smoke test\n'
    if [ "$2" = green ]; then printf -- '- [x] State updated\n'; else printf -- '- [ ] State updated\n'; fi
  } > "$1"
}

# --- 1. bash install: self-contained canonical source + generated engine mirrors ---
TB="$TMP/bash"; mkdir -p "$TB"
"$ROOT/install.sh" "$TB" >/dev/null || fail "install.sh exited non-zero"
# runtime files the agent needs must be present
for f in CLAUDE.md AGENTS.md opencode.json PROJECT.md CONTINUITY.md \
         .claude/skills/new-feature/SKILL.md .agents/skills/new-feature/SKILL.md \
         .claude/settings.json .claude/agents/codeforge-implementer.md \
         .codex/config.toml .codex/agents/codeforge-implementer.toml docs/CHANGELOG.md \
         .codeforge/state.template.md \
         .codeforge/scripts/check-gates.sh .codeforge/scripts/check-gates.ps1 \
         .codeforge/scripts/goal-digest.sh .codeforge/scripts/goal-state.sh \
         .codeforge/scripts/goal-digest.ps1 .codeforge/scripts/goal-state.ps1 \
         .codeforge/rules/goal-state.md .codeforge/rules/goal-autonomy-setup.md \
         .codeforge/WORKFLOW.md .codeforge/agents/codeforge-implementer.md \
         .codeforge/skills/new-feature/SKILL.md \
         .codeforge/configs/claude/settings.json .codeforge/configs/codex/config.toml \
         .codeforge/configs/opencode.json .codeforge/docs/extending.md \
         .codeforge/templates/PROJECT.md .codeforge/templates/CONTINUITY.md \
         .codeforge/sync.sh .codeforge/sync.ps1 \
         .claude/skills/goal/SKILL.md .agents/skills/goal/SKILL.md; do
  [ -e "$TB/$f" ] || fail "bash: expected runtime file $f was not produced"
done
[ -x "$TB/.codeforge/scripts/check-gates.sh" ] || fail "bash: check-gates.sh is not executable"
ls "$TB"/.codeforge/rules/*.md >/dev/null 2>&1 || fail "bash: .codeforge/rules/*.md missing"
# ci-templates land as a managed copy
[ -f "$TB/docs/ci-templates/gates.yml" ]  || fail "bash: docs/ci-templates/gates.yml not installed"
[ -f "$TB/docs/ci-templates/README.md" ]  || fail "bash: docs/ci-templates/README.md not installed"
grep -q 'exit 1' "$TB/docs/ci-templates/gates.yml" || fail "bash: ci template lost its fail-closed sentinel"
# Framework development tooling stays out of the target; installed source lives in .codeforge/.
for f in install.sh install.ps1 README.md LICENSE src \
         skills configs sync.sh sync.ps1 \
         state.template.md PROJECT.template.md CONTINUITY.template.md docs/extending.md; do
  [ -e "$TB/$f" ] && fail "bash: framework file leaked into target: $f"
done
grep -q '@PROJECT.md' "$TB/CLAUDE.md" || fail "CLAUDE.md does not import PROJECT.md"
grep -q '@.codeforge/WORKFLOW.md' "$TB/CLAUDE.md" || fail "CLAUDE.md does not import WORKFLOW.md"
grep -q '`PROJECT.md`' "$TB/AGENTS.md" || fail "AGENTS.md does not bootstrap PROJECT.md"
grep -q '`.codeforge/WORKFLOW.md`' "$TB/AGENTS.md" || fail "AGENTS.md does not bootstrap WORKFLOW.md"
[ "$(grep -l 'authoritative allowlist' "$TB/.codeforge/skills/review/SKILL.md" "$TB/.claude/skills/review/SKILL.md" "$TB/.agents/skills/review/SKILL.md" | wc -l | tr -d ' ')" = 3 ] \
  || fail "strict reviewer allowlist did not reach canonical and generated skill copies"
grep -q '600-second) deadline' "$TB/.codeforge/rules/models.md" \
  || fail "bounded reviewer execution contract was not installed"
grep -q '^developer_instructions' "$TB/.codex/agents/codeforge-implementer.toml" \
  || fail "Codex implementer is not a native custom-agent TOML definition"
grep -q 'commit_policy' "$TB/.claude/agents/codeforge-implementer.md" \
  || fail "Claude implementer lost the canonical task contract"
grep -q 'commit_policy' "$TB/.codex/agents/codeforge-implementer.toml" \
  || fail "Codex implementer lost the canonical task contract"
grep -q '^\[agents\]$' "$TB/.codex/config.toml" \
  || fail "Codex native subagent support is not enabled"
grep -q 'must not switch.*configured Claude reviewer to OpenCode' "$TB/.codeforge/skills/review/SKILL.md" \
  || fail "disabled-engine fallback guard was not installed"
[ "$(wc -l < "$TB/CLAUDE.md" | tr -d ' ')" -le 10 ] || fail "CLAUDE.md entrypoint is not minimal"
[ "$(wc -l < "$TB/AGENTS.md" | tr -d ' ')" -le 15 ] || fail "AGENTS.md entrypoint is not minimal"
grep -qx 'generated:tracked' "$TB/.codeforge/manifest" || fail "default generated policy was not persisted"
grep -qx '# codeforge:generated:start' "$TB/.gitignore" || fail "managed gitignore block start missing"
grep -qx '# codeforge:generated:end' "$TB/.gitignore" || fail "managed gitignore block end missing"
for p in .claude/ .agents/ .codex/ opencode.json; do
  grep -qxF "$p" "$TB/.gitignore" && fail "default policy unexpectedly ignores $p"
done
echo "ok: bash install (self-contained .codeforge source + minimal generated entrypoints)"

# --- 1b. optional generated-adapter policy: ignore mirrors, keep canonical/context trackable ---
TI="$TMP/ignored"; mkdir -p "$TI"; git -C "$TI" init -q
"$ROOT/install.sh" "$TI" --ignore-generated >/dev/null || fail "install.sh --ignore-generated exited non-zero"
grep -qx 'generated:ignored' "$TI/.codeforge/manifest" || fail "ignored generated policy was not persisted"
for p in .claude/settings.json .agents/skills/new-feature/SKILL.md .codex/config.toml opencode.json; do
  git -C "$TI" check-ignore -q "$p" || fail "ignored policy does not ignore $p"
done
mkdir -p "$TI/.claude/agents" "$TI/.codex/agents"
printf 'custom\n' > "$TI/.claude/agents/custom.md"
printf 'custom\n' > "$TI/.codex/agents/custom.toml"
for p in .claude/agents/custom.md .codex/agents/custom.toml; do
  if git -C "$TI" check-ignore -q "$p"; then fail "ignored policy hides project-owned engine file: $p"; fi
done
for p in CLAUDE.md AGENTS.md PROJECT.md CONTINUITY.md docs/CHANGELOG.md .codeforge/WORKFLOW.md; do
  if git -C "$TI" check-ignore -q "$p"; then fail "context/canonical path must remain trackable: $p"; fi
done
"$ROOT/install.sh" "$TI" >/dev/null || fail "bare reinstall did not preserve ignored policy"
grep -qx 'generated:ignored' "$TI/.codeforge/manifest" || fail "bare reinstall changed ignored policy"
echo "ok: generated-adapter Git policy (ignore managed mirrors, keep custom/canonical/context)"

# --- verify-e2e UI adapter: ships to both mirrors BYTE-IDENTICAL (embed survives sync, §5.11/D6b),
#     and no UI-deferral wording in ANY shipped surface that had it removed. ---
for m in .claude .agents; do
  se="$TB/$m/skills/verify-e2e/SKILL.md"
  [ -f "$se" ] || fail "verify-e2e skill missing from $m mirror"
  grep -qF '<!-- e2e-ui-ref:start -->' "$se" || fail "$m: verify-e2e embed sentinels missing (embed did not survive sync)"
  # sync (src/sync.sh) copies skills with a pure cp -R (no templating), so the installed skill must
  # be byte-identical to src. Combined with the src-vs-reference drift test (skill-embed-drift),
  # this proves the INSTALLED embedded block === the reference harness byte-for-byte (§5.11).
  diff -q "$se" "$ROOT/src/skills/verify-e2e/SKILL.md" >/dev/null \
    || fail "$m: installed verify-e2e skill differs from src (embed did not survive sync byte-for-byte)"
done
# The UI→N/A carve-out was removed from these surfaces (Plan B); assert it did not leak into ANY of
# their SHIPPED copies (both mirrors + the flipped workflows/gates + generated CLAUDE.md/AGENTS.md).
for f in "$TB"/.claude/skills/verify-e2e/SKILL.md "$TB"/.agents/skills/verify-e2e/SKILL.md \
         "$TB"/.claude/skills/new-feature/SKILL.md "$TB"/.agents/skills/new-feature/SKILL.md \
         "$TB"/.claude/skills/fix-bug/SKILL.md "$TB"/.agents/skills/fix-bug/SKILL.md \
         "$TB"/.codeforge/rules/ship-gates.md "$TB"/CLAUDE.md "$TB"/AGENTS.md; do
  [ -f "$f" ] || fail "expected shipped surface missing: $f"
  if grep -qiE 'no v1 adapter|UI (is |journey,? )?deferred|UI-only changes' "$f"; then
    fail "UI-deferral wording leaked into shipped $f"
  fi
done
echo "ok: verify-e2e UI adapter ships byte-identical to both mirrors; no UI-deferral wording in any shipped surface"

# --- 1b. bash install scaffolds the e2e report/use-case dirs (ship-gate binds to these) ---
[ -d "$TB/docs/e2e/reports" ]   || fail "bash: docs/e2e/reports was not scaffolded"
[ -d "$TB/docs/e2e/use-cases" ] || fail "bash: docs/e2e/use-cases was not scaffolded"
echo "ok: bash install scaffolds docs/e2e/{reports,use-cases}"

# --- 2. pwsh install (if available) must be byte-identical to bash ---
if command -v pwsh >/dev/null 2>&1; then
  TP="$TMP/ps"; mkdir -p "$TP"
  pwsh -NoProfile -File "$ROOT/install.ps1" "$TP" >/dev/null || fail "install.ps1 exited non-zero"
  [ -d "$TP/docs/e2e/reports" ]   || fail "pwsh: docs/e2e/reports was not scaffolded"
  [ -d "$TP/docs/e2e/use-cases" ] || fail "pwsh: docs/e2e/use-cases was not scaffolded"
  diff -rq "$TB" "$TP" >/dev/null || fail "bash and pwsh targets differ (install/sync parity broken)"
  echo "ok: pwsh install + parity with bash"
else
  echo "skip: pwsh not installed — parity check skipped"
fi

# --- 3. --upgrade preserves project-owned files and project-owned rules ---
printf 'MYPROJECT_MARKER\n' > "$TB/PROJECT.md"
printf 'mine\n' > "$TB/.codeforge/rules/my-rule.md"
mkdir -p "$TB/.codeforge/skills/my-skill"
printf '%s\n' '---' 'name: my-skill' 'description: Use when testing a custom skill.' '---' > "$TB/.codeforge/skills/my-skill/SKILL.md"
"$ROOT/install.sh" "$TB" --upgrade >/dev/null || fail "install --upgrade exited non-zero"
grep -q MYPROJECT_MARKER "$TB/PROJECT.md" || fail "upgrade clobbered project-owned PROJECT.md"
[ -f "$TB/.codeforge/rules/my-rule.md" ] || fail "upgrade dropped a project-owned rule from .codeforge/rules/"
[ -f "$TB/.codeforge/skills/my-skill/SKILL.md" ] || fail "upgrade dropped a project-owned skill from .codeforge/skills/"
echo "ok: --upgrade preserves project-owned files, rules, and skills"

# --- 4. data-loss guard: a user's own new-feature skill is backed up, not wiped ---
TG="$TMP/guard"; mkdir -p "$TG/.claude/skills/new-feature"
printf 'USER_CUSTOM_MARKER\n' > "$TG/.claude/skills/new-feature/SKILL.md"
"$ROOT/install.sh" "$TG" >/dev/null || fail "guard-case install exited non-zero"
grep -q USER_CUSTOM_MARKER "$TG/.claude/skills.pre-codeforge.bak/new-feature/SKILL.md" \
  || fail "user's own new-feature skill was not backed up (data loss)"
echo "ok: data-loss guard backs up a user's own skills"

# --- 4b. existing CLAUDE.md / AGENTS.md context is adopted into PROJECT.md exactly once ---
TA="$TMP/adopt"; mkdir -p "$TA"
printf '# Existing Claude context\nUse pnpm.\n' > "$TA/CLAUDE.md"
printf '# Existing Codex context\nRun make test.\n' > "$TA/AGENTS.md"
"$ROOT/install.sh" "$TA" >/dev/null || fail "context-adoption install exited non-zero"
grep -q 'Existing Claude context' "$TA/PROJECT.md" || fail "existing CLAUDE.md context was not moved into PROJECT.md"
grep -q 'Existing Codex context' "$TA/PROJECT.md" || fail "existing AGENTS.md context was not moved into PROJECT.md"
[ -f "$TA/.codeforge/backups/CLAUDE.md.pre-codeforge.bak" ] || fail "existing CLAUDE.md was not backed up"
[ -f "$TA/.codeforge/backups/AGENTS.md.pre-codeforge.bak" ] || fail "existing AGENTS.md was not backed up"
grep -q 'codeforge:entrypoint' "$TA/CLAUDE.md" || fail "CLAUDE.md was not replaced by the generated entrypoint"
grep -q 'codeforge:entrypoint' "$TA/AGENTS.md" || fail "AGENTS.md was not replaced by the generated entrypoint"
"$ROOT/install.sh" "$TA" >/dev/null || fail "context-adoption reinstall exited non-zero"
[ "$(grep -c 'Existing Claude context' "$TA/PROJECT.md")" = 1 ] || fail "reinstall duplicated imported CLAUDE.md context"
[ "$(grep -c 'Existing Codex context' "$TA/PROJECT.md")" = 1 ] || fail "reinstall duplicated imported AGENTS.md context"
echo "ok: existing agent entrypoints move into PROJECT.md once and retain backups"

# --- 5. sync fails (non-zero) on missing input; --out generates into a separate dir ---
FS="$TMP/syncfail"; mkdir -p "$FS/skills/x"; printf -- '---\n' > "$FS/skills/x/SKILL.md"
cp "$ROOT/src/sync.sh" "$FS/"
if bash "$FS/sync.sh" >/dev/null 2>&1; then fail "sync.sh should fail without WORKFLOW.md but exited 0"; fi
[ -e "$FS/AGENTS.md" ] && fail "sync.sh produced output despite missing WORKFLOW.md"
SO="$TMP/syncout"; mkdir -p "$SO"
bash "$ROOT/src/sync.sh" --out "$SO" >/dev/null || fail "sync.sh --out exited non-zero"
[ -f "$SO/AGENTS.md" ] || fail "sync.sh --out did not generate AGENTS.md into the out dir"
workflow_ref=$(grep '^@' "$SO/CLAUDE.md" | tail -n 1 | sed 's/^@//')
case "$workflow_ref" in
  /*) [ -f "$workflow_ref" ] || fail "sync.sh --out generated a dangling absolute workflow import" ;;
  *)  [ -f "$SO/$workflow_ref" ] || fail "sync.sh --out generated a dangling relative workflow import" ;;
esac
[ -f "$ROOT/src/AGENTS.md" ] && fail "sync.sh --out wrote into the source instead of the out dir"
SF="$TMP/sync-foreign"; mkdir -p "$SF"; printf 'FOREIGN_ENTRYPOINT\n' > "$SF/CLAUDE.md"
if bash "$ROOT/src/sync.sh" --out "$SF" >/dev/null 2>&1; then fail "sync.sh replaced a foreign entrypoint"; fi
grep -q FOREIGN_ENTRYPOINT "$SF/CLAUDE.md" || fail "sync.sh modified a foreign entrypoint before refusing"
echo "ok: sync fails non-zero on missing input; --out targets a separate dir"

# --- 5b. framework-source in-place sync must preserve CLAUDE.md as the methodology input ---
SI="$TMP/sync-in-place"; mkdir -p "$SI"; cp -R "$ROOT/src/." "$SI/"
cp "$SI/CLAUDE.md" "$SI/CLAUDE.before.md"
( cd "$SI" && bash ./sync.sh >/dev/null ) || fail "framework-source in-place sync exited non-zero"
cmp -s "$SI/CLAUDE.before.md" "$SI/CLAUDE.md" || fail "in-place sync overwrote canonical CLAUDE.md"
[ -f "$SI/AGENTS.md" ] || fail "in-place sync did not generate AGENTS.md"
echo "ok: framework-source in-place sync preserves canonical CLAUDE.md"

# --- 6. --upgrade prunes framework rules removed upstream, keeps project-owned ones ---
printf 'rule:ghost.md\n' >> "$TB/.codeforge/manifest"
printf 'ghost\n'   > "$TB/.codeforge/rules/ghost.md"
printf 'keep-me\n' > "$TB/.codeforge/rules/keep-me.md"
"$ROOT/install.sh" "$TB" --upgrade >/dev/null || fail "prune-case upgrade exited non-zero"
[ -e "$TB/.codeforge/rules/ghost.md" ] && fail "framework rule removed upstream was not pruned"
[ -e "$TB/.codeforge/rules/keep-me.md" ] || fail "project rule was wrongly pruned"
echo "ok: --upgrade prunes upstream-removed framework rules, keeps project rules"

# --- 7. bare run installs into cwd; running from inside codeforge is refused ---
TC="$TMP/cwd"; mkdir -p "$TC"
( cd "$TC" && "$ROOT/install.sh" >/dev/null ) || fail "bare install into cwd exited non-zero"
[ -f "$TC/CLAUDE.md" ] || fail "bare run did not install into the current directory"
if ( cd "$ROOT"     && "$ROOT/install.sh" >/dev/null 2>&1 ); then fail "self-install from codeforge root should be refused"; fi
if ( cd "$ROOT/src" && "$ROOT/install.sh" >/dev/null 2>&1 ); then fail "install into the payload dir (src) should be refused"; fi
echo "ok: bare run targets cwd; self-install into codeforge/src is refused"

# --- 8. installed .codeforge source regenerates root instructions, skills, and configs ---
TM="$TMP/regenerate"; mkdir -p "$TM"
"$ROOT/install.sh" "$TM" >/dev/null || fail "regeneration-base install exited non-zero"
printf '\nCANONICAL_LOCAL_MARKER\n' >> "$TM/.codeforge/WORKFLOW.md"
printf '\nSKILL_LOCAL_MARKER\n' >> "$TM/.codeforge/skills/new-feature/SKILL.md"
printf '\n# CONFIG_LOCAL_MARKER\n' >> "$TM/.codeforge/configs/codex/config.toml"
printf '\nAGENT_LOCAL_MARKER\n' >> "$TM/.codeforge/agents/codeforge-implementer.md"
rm -rf "$TM/docs/e2e/use-cases"
( cd "$TM" && .codeforge/sync.sh >/dev/null ) || fail "installed sync exited non-zero"
grep -q '@.codeforge/WORKFLOW.md' "$TM/CLAUDE.md" || fail "installed sync did not regenerate CLAUDE.md bootstrap"
grep -q '`.codeforge/WORKFLOW.md`' "$TM/AGENTS.md" || fail "installed sync did not regenerate AGENTS.md bootstrap"
grep -q SKILL_LOCAL_MARKER "$TM/.claude/skills/new-feature/SKILL.md" || fail "installed sync did not regenerate Claude skills"
grep -q SKILL_LOCAL_MARKER "$TM/.agents/skills/new-feature/SKILL.md" || fail "installed sync did not regenerate Codex skills"
grep -q CONFIG_LOCAL_MARKER "$TM/.codex/config.toml" || fail "installed sync did not regenerate Codex config"
grep -q AGENT_LOCAL_MARKER "$TM/.claude/agents/codeforge-implementer.md" || fail "installed sync did not regenerate Claude implementer"
grep -q AGENT_LOCAL_MARKER "$TM/.codex/agents/codeforge-implementer.toml" || fail "installed sync did not regenerate Codex implementer"
[ -d "$TM/docs/e2e/use-cases" ] || fail "installed sync did not ensure the docs scaffold"
echo "ok: installed .codeforge source regenerates entrypoints and engine mirrors"

# --- 9. first install (no prior forge install) leaves an unrelated project's own dirs alone ---
TF="$TMP/first"; mkdir -p "$TF/configs" "$TF/skills/mine"
printf 'mine\n' > "$TF/configs/mine.txt"; printf 'mine\n' > "$TF/skills/mine/SKILL.md"
"$ROOT/install.sh" "$TF" >/dev/null || fail "first-install-with-own-dirs exited non-zero"
[ -f "$TF/configs/mine.txt" ] || fail "first install clobbered an unrelated project's configs/"
[ -f "$TF/skills/mine/SKILL.md" ] || fail "first install clobbered an unrelated project's skills/"
[ -e "$TF/configs.pre-codeforge.bak" ] && fail "first install wrongly backed up an unrelated configs/"
echo "ok: first install leaves an unrelated project's own configs/ and skills/ untouched"

# --- 10. check-gates (Tier B): green state passes, an unchecked box fails non-zero ---
TC="$TMP/gates"; mkdir -p "$TC/.codeforge/workflow"
"$ROOT/install.sh" "$TC" >/dev/null || fail "check-gates case install exited non-zero"
GATES="$TC/.codeforge/scripts/check-gates.sh"
write_state "$TC/.codeforge/workflow/state.md" green
( cd "$TC" && sh "$GATES" >/dev/null 2>&1 ) || fail "check-gates: a fully-checked state should exit 0"
write_state "$TC/.codeforge/workflow/state.md" red
if ( cd "$TC" && sh "$GATES" >/dev/null 2>&1 ); then fail "check-gates: an unchecked box should exit non-zero"; fi
printf '## Active workflow\n- **Profile:** standard\n## Ship-gate checklist\n- [x] a\n- [x] b\n' > "$TC/.codeforge/workflow/state.md"
if ( cd "$TC" && sh "$GATES" >/dev/null 2>&1 ); then fail "check-gates: a standard checklist missing required gates must not pass"; fi
[ -f "$TC/nope.md" ] && fail "test setup error"
( cd "$TC" && sh "$GATES" nope.md >/dev/null 2>&1 ) && fail "check-gates: a missing state file should exit non-zero" || true
echo "ok: check-gates passes a green state and blocks an unchecked box"

# --- 11. .codeforge/version: fresh install stamps VERSION; an older prior triggers an upgrade advisory ---
TV="$TMP/version"; mkdir -p "$TV"
"$ROOT/install.sh" "$TV" >/dev/null || fail "version-case install exited non-zero"
want="$(head -n1 "$ROOT/VERSION" | tr -d '[:space:]')"
got="$(head -n1 "$TV/.codeforge/version" 2>/dev/null | tr -d '[:space:]')"
[ "$got" = "$want" ] || fail ".codeforge/version stamp '$got' != VERSION '$want'"
printf '0.0.1\n' > "$TV/.codeforge/version"
up_out="$("$ROOT/install.sh" "$TV" --upgrade 2>&1)"
printf '%s' "$up_out" | grep -q "upgrading this target" || fail "older prior did not produce an upgrade advisory"
[ "$(head -n1 "$TV/.codeforge/version" | tr -d '[:space:]')" = "$want" ] || fail "upgrade did not re-stamp .codeforge/version"
echo "ok: .codeforge/version stamped on install; drift advisory on version change"

# --- 12. removed APIs fail instead of being tolerated as compatibility aliases ---
TH="$TMP/hooks"; mkdir -p "$TH"
if "$ROOT/install.sh" "$TH" --with-hooks >/dev/null 2>&1; then fail "removed --with-hooks flag should be rejected"; fi
if ( cd "$TH" && node "$ROOT/bin/codeforge.mjs" --with-hooks >/dev/null 2>&1 ); then
  fail "npx entrypoint should reject removed --with-hooks flag"
fi
if command -v pwsh >/dev/null 2>&1 && pwsh -NoProfile -File "$ROOT/install.ps1" "$TH" -WithHooks >/dev/null 2>&1; then
  fail "removed -WithHooks flag should be rejected"
fi
echo "ok: removed hook flags are rejected; no compatibility alias remains"

# --- 13. git: a non-git target warns (and stays non-git); --git-init initializes a repo ---
TG1="$TMP/nogit"; mkdir -p "$TG1"
g_out="$("$ROOT/install.sh" "$TG1" 2>&1)"
printf '%s' "$g_out" | grep -q "not a git repo" || fail "non-git target should print the git advisory"
if git -C "$TG1" rev-parse --is-inside-work-tree >/dev/null 2>&1; then fail "advisory-only install must NOT create a git repo"; fi
TG2="$TMP/gitinit"; mkdir -p "$TG2"
"$ROOT/install.sh" "$TG2" --git-init >/dev/null 2>&1 || fail "--git-init install exited non-zero"
git -C "$TG2" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "--git-init did not initialize a git repo"
echo "ok: non-git target warns; --git-init initializes a repo"

# --- 14. auto-isolation: a target under an ancestor CLAUDE.md gets claudeMdExcludes; --no-isolate opts out ---
ANC="$TMP/anc"; mkdir -p "$ANC/.claude/rules"
printf '# ancestor\n' > "$ANC/CLAUDE.md"; printf 'x\n' > "$ANC/.claude/rules/sec.md"
TI="$ANC/proj"; mkdir -p "$TI"
"$ROOT/install.sh" "$TI" >/dev/null || fail "auto-isolation install exited non-zero"
SLI="$TI/.claude/settings.local.json"
[ -f "$SLI" ] || fail "auto-isolation did not write the local settings file under an ancestor"
grep -q "claudeMdExcludes" "$SLI" || fail "auto-isolation did not add claudeMdExcludes"
grep -q "$ANC/CLAUDE.md" "$SLI" || fail "claudeMdExcludes is missing the ancestor CLAUDE.md path"
grep -q "$ANC/.claude/rules" "$SLI" || fail "claudeMdExcludes is missing the ancestor .claude/rules path"
TN="$ANC/proj-noiso"; mkdir -p "$TN"
"$ROOT/install.sh" "$TN" --no-isolate >/dev/null || fail "--no-isolate install exited non-zero"
if [ -f "$TN/.claude/settings.local.json" ]; then fail "--no-isolate must not write a local settings file when no other feature is enabled"; fi
echo "ok: auto-isolation adds claudeMdExcludes under an ancestor; --no-isolate opts out"

# --- 15. re-install must NOT relocate a project's own top-level configs/ or skills/ (not an old install) ---
TR="$TMP/reinstall"; mkdir -p "$TR/skills/mine" "$TR/configs"
printf 'mine\n' > "$TR/skills/mine/SKILL.md"; printf 'mine\n' > "$TR/configs/app.json"
"$ROOT/install.sh" "$TR" >/dev/null || fail "first install (with own dirs) exited non-zero"
"$ROOT/install.sh" "$TR" >/dev/null || fail "second install exited non-zero"
[ -f "$TR/skills/mine/SKILL.md" ] || fail "re-install relocated the project's own skills/"
[ -f "$TR/configs/app.json" ] || fail "re-install relocated the project's own configs/"
[ -e "$TR/skills.pre-codeforge.bak" ] && fail "re-install wrongly backed up a project skills/ directory"
echo "ok: re-install leaves a project's own configs/ and skills/ in place"

# --- 16. the npx entry point installs on POSIX (must use bash, not sh — install.sh needs pipefail) ---
if command -v node >/dev/null 2>&1; then
  TX="$TMP/npx"; mkdir -p "$TX"
  node "$ROOT/bin/codeforge.mjs" "$TX" >/dev/null 2>&1 || fail "npx wrapper (node bin/codeforge.mjs) exited non-zero"
  [ -f "$TX/CLAUDE.md" ] || fail "npx wrapper did not install (no CLAUDE.md)"
  [ "$(node "$ROOT/bin/codeforge.mjs" --version)" = "$(head -n1 "$ROOT/VERSION" | tr -d '[:space:]')" ] || fail "npx --version mismatch"
  echo "ok: npx entry point installs on POSIX and reports the version"
else
  echo "skip: node not installed — npx entry-point case skipped"
fi

# --- 17. the npx entry point stays non-interactive when stdin/stdout are not a TTY ---
if command -v node >/dev/null 2>&1; then
  TX2="$TMP/npx-notty"; mkdir -p "$TX2"
  node "$ROOT/bin/codeforge.mjs" "$TX2" </dev/null >/dev/null 2>&1 || fail "npx non-TTY install exited non-zero"
  [ -f "$TX2/CLAUDE.md" ] || fail "npx non-TTY did not fall back to install (no CLAUDE.md)"
  echo "ok: npx entry point stays non-interactive without a TTY"
fi

echo "ALL PASS"

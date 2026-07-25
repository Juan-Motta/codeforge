#!/usr/bin/env pwsh
#
# codeforge installer (Windows / PowerShell) — copy the workflow discipline into a target
# project. Mirror of install.sh.
#
#   pwsh ./install.ps1 [target-dir] [-Upgrade] [-GitInit] [-NoIsolate]
#
# With no target-dir, installs into the current working directory.
#
# THIN INSTALL: the target receives only what the agent needs at RUNTIME. All framework
# machinery (the neutral source in ./src/, the generators sync.sh/ps1, the generation
# inputs in configs/, and the seed templates) stays in the codeforge repo — never copied
# into the target. To customize or upgrade, edit the codeforge source and re-run this
# installer against the target (-Upgrade, or a bare re-run from inside the project).
#
# This installer copies the runtime subset into the target, then runs `sync.ps1 -Out <target>`
# to GENERATE each engine's config + skills straight into the target. No symlinks. The
# generated engine artifacts are COMMITTED with the target so a fresh clone works with no
# codeforge dependency at runtime.
#
# LANDS IN THE TARGET (runtime only): CLAUDE.md, AGENTS.md, opencode.json, .claude/,
#   .agents/, .codex/ (generated), shared/rules/*.md + shared/state.template.md + shared/scripts/* (managed),
#   docs/ scaffolding + CHANGELOG, PROJECT.md + CONTINUITY.md (project-owned, seeded).
# STAYS IN codeforge (never copied): src/skills (neutral), configs/, sync.sh, sync.ps1,
#   *.template.md, docs/extending.md.
#
param(
  [Parameter(Mandatory = $false)][string]$Target,
  [switch]$Upgrade,
  [switch]$WithHooks,
  [switch]$GitInit,
  [switch]$NoIsolate
)
$ErrorActionPreference = 'Stop'

if ($WithHooks) {
  [Console]::Error.WriteLine("  ! -WithHooks is retired (the Claude gate hook is superseded by the CI Verified tier); ignoring.")
}

$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$Payload = Join-Path $Src 'src'
$forgeVersion = "unknown"
$versionFile = Join-Path $Src 'VERSION'
if (Test-Path -LiteralPath $versionFile -PathType Leaf) {
  $v = (Get-Content -LiteralPath $versionFile -TotalCount 1)
  if ($v) { $forgeVersion = $v.Trim() }
}
$Mode = if ($Upgrade) { 'upgrade' } else { 'install' }
if (-not $Target) { $Target = (Get-Location).Path }

if (-not (Test-Path -PathType Container $Target)) { Write-Error "target dir not found: $Target"; exit 2 }
$Target = (Resolve-Path $Target).Path
# Did a prior forge install own .claude/settings.local.json? (read before the manifest is rewritten)
$priorLocalManaged = $false
$mf = Join-Path $Target '.forge-manifest'
if ((Test-Path -LiteralPath $mf -PathType Leaf) -and (Select-String -LiteralPath $mf -Pattern '^localsettings:managed$' -Quiet)) {
  $priorLocalManaged = $true
}
if (-not ((Test-Path (Join-Path $Payload 'CLAUDE.md')) -and (Test-Path (Join-Path $Payload 'skills')))) {
  Write-Error "payload not found — run this from the codeforge repo"; exit 2
}
if ($Target -eq $Src) { Write-Error "refusing to install into codeforge itself"; exit 2 }
if ($Target -eq $Payload) { Write-Error "refusing to install into the codeforge payload dir (src/)"; exit 2 }

Write-Host "codeforge $forgeVersion -> installing into: $Target  (mode: $Mode)"

# --- version drift advisory (informational only, never blocks) ---
$priorVersion = ""
$fvFile = Join-Path $Target '.forge-version'
if (Test-Path -LiteralPath $fvFile -PathType Leaf) {
  $pv = (Get-Content -LiteralPath $fvFile -TotalCount 1)
  if ($pv) { $priorVersion = $pv.Trim() }
}
if ($priorVersion -and $priorVersion -ne $forgeVersion -and $forgeVersion -ne 'unknown' -and $priorVersion -ne 'unknown') {
  try { $isUpgrade = ([version]$priorVersion -lt [version]$forgeVersion) }
  catch { $isUpgrade = ($priorVersion -lt $forgeVersion) }
  if ($isUpgrade) {
    Write-Host "  ~ upgrading this target: codeforge $priorVersion -> $forgeVersion"
  } else {
    Write-Host "  ! this target was installed by a NEWER codeforge ($priorVersion) than you're running ($forgeVersion)."
    Write-Host "    You may be downgrading it; teammates pinned to $priorVersion could see drift. (advisory only)"
  }
}

function Has-ForgeMarker([string]$file) {
  return (Test-Path $file) -and (Select-String -Quiet -SimpleMatch 'Workflow discipline for Claude Code' $file)
}

# --- self-healing: drop machinery this version no longer installs into the target ---
# (thin model — migrates a target from an older, bloated install.) Gated on a prior forge
# install (.forge-manifest present) so a FIRST install never touches an unrelated project's
# own configs/ or skills/ dirs.
if (Test-Path (Join-Path $Target '.forge-manifest')) {
  $ghSh = Join-Path $Target 'shared/scripts/claude-gate-hook.sh'
  $ghPs1 = Join-Path $Target 'shared/scripts/claude-gate-hook.ps1'
  if ((Test-Path $ghSh) -or (Test-Path $ghPs1)) {
    Write-Host "  ~ the Claude gate hook (-WithHooks) is retired — enforcement is now the CI Verified tier (docs/ci-templates/)."
  }
  # Retired: the opt-in Claude gate hook (superseded by the CI Verified tier).
  foreach ($rel in 'shared/scripts/claude-gate-hook.sh', 'shared/scripts/claude-gate-hook.ps1') {
    $p = Join-Path $Target $rel
    if (Test-Path $p) { Remove-Item -Force $p; Write-Host "  - removed retired gate hook: $rel" }
  }
  # Detect a genuinely OLD (pre-thin) forge install by its machinery; only then migrate
  # configs/skills, so a routine re-install never relocates an app's own top-level dirs.
  $oldInstall = $false
  foreach ($f in 'sync.sh', 'sync.ps1', 'state.template.md', 'PROJECT.template.md', 'CONTINUITY.template.md', 'docs/extending.md') {
    if (Test-Path (Join-Path $Target $f)) { $oldInstall = $true }
  }
  foreach ($f in 'sync.sh', 'sync.ps1', 'state.template.md', 'PROJECT.template.md', 'CONTINUITY.template.md', 'docs/extending.md') {
    $p = Join-Path $Target $f
    if (Test-Path $p) { Remove-Item -Force $p; Write-Host "  - removed obsolete framework file: $f" }
  }
  # configs/ and neutral skills/ may hold pre-forge user edits — back up rather than delete.
  $tConfigs = Join-Path $Target 'configs'
  if ($oldInstall -and (Test-Path -PathType Container $tConfigs)) {
    $bak = Join-Path $Target 'configs.pre-forge.bak'
    if (Test-Path $bak) { Remove-Item -Recurse -Force $bak }
    Move-Item $tConfigs $bak
    Write-Host "  ! configs/ is obsolete (engine configs are generated now) -> configs.pre-forge.bak; per-project Claude tweaks go in .claude/settings.local.json"
  }
  $tSkills = Join-Path $Target 'skills'
  if ($oldInstall -and (Test-Path -PathType Container $tSkills)) {
    $bak = Join-Path $Target 'skills.pre-forge.bak'
    if (Test-Path $bak) { Remove-Item -Recurse -Force $bak }
    Move-Item $tSkills $bak
    Write-Host "  ! neutral skills/ is obsolete (skills are generated now) -> skills.pre-forge.bak; add custom skills to the codeforge repo"
  }
}

# --- MANAGED: CLAUDE.md (back up a pre-existing, non-forge one) ---
$tClaude = Join-Path $Target 'CLAUDE.md'
if ((Test-Path $tClaude) -and -not (Has-ForgeMarker $tClaude)) {
  Copy-Item $tClaude "$tClaude.pre-forge.bak" -Force
  Write-Host "  ! backed up existing CLAUDE.md -> CLAUDE.md.pre-forge.bak (move project-specifics into PROJECT.md)"
}
Copy-Item (Join-Path $Payload 'CLAUDE.md') $tClaude -Force

# --- MANAGED: framework shared/rules/ (per-entry overwrite by name) ---
New-Item -ItemType Directory -Force -Path (Join-Path $Target 'shared/rules') | Out-Null
$newRules = @(Get-ChildItem -File (Join-Path $Payload 'shared/rules') -Filter *.md).Name

# Prune framework rules removed upstream (see install.sh for rationale). Project-owned rules
# aren't in the manifest, so they're untouched. No manifest yet = skip prune.
$manifest = Join-Path $Target '.forge-manifest'
if (Test-Path $manifest) {
  foreach ($line in Get-Content $manifest) {
    if ($line -like 'rule:*') {
      $n = $line.Substring(5)
      # Treat the committed manifest as untrusted: a prune target must be a bare *.md filename,
      # never a path/traversal, so a tampered entry can't delete outside shared/rules/.
      if ($n -match '[\\/]' -or $n -match '\.\.' -or $n -eq '' -or $n -notmatch '\.md$') {
        [Console]::Error.WriteLine("  ! ignoring unsafe manifest rule entry: $n")
      } elseif ($newRules -notcontains $n) {
        Remove-Item -Force (Join-Path $Target "shared/rules/$n") -ErrorAction SilentlyContinue
        Write-Host "  - pruned framework rule removed upstream: $n"
      }
    }
  }
}

foreach ($f in Get-ChildItem -File (Join-Path $Payload 'shared/rules') -Filter *.md) {
  Copy-Item $f.FullName (Join-Path $Target "shared/rules/$($f.Name)") -Force
}

# Record the framework-owned manifest for the next upgrade's prune (rules only).
Set-Content -Path $manifest -Value (@($newRules | ForEach-Object { "rule:$_" }))

# Stamp the version that produced this install, for drift detection on the next run.
Set-Content -Path (Join-Path $Target '.forge-version') -Value $forgeVersion

# --- MANAGED: workflow state template (in shared/) ---
Copy-Item (Join-Path $Payload 'shared/state.template.md') (Join-Path $Target 'shared/state.template.md') -Force

# --- MANAGED: framework shared/scripts/ (agent-invoked Tier-B helpers, e.g. check-gates) ---
$scriptsSrc = Join-Path $Payload 'shared/scripts'
if (Test-Path -LiteralPath $scriptsSrc -PathType Container) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Target 'shared/scripts') | Out-Null
  foreach ($f in Get-ChildItem -File $scriptsSrc) {
    Copy-Item $f.FullName (Join-Path $Target "shared/scripts/$($f.Name)") -Force
  }
}

# --- MANAGED: docs/ scaffolding ---
New-Item -ItemType Directory -Force -Path (Join-Path $Target 'docs') | Out-Null
foreach ($d in 'prds', 'plans', 'research', 'solutions', 'adr', 'e2e/reports', 'e2e/use-cases') {
  $dd = Join-Path $Target "docs/$d"
  New-Item -ItemType Directory -Force -Path $dd | Out-Null
  $gk = Join-Path $dd '.gitkeep'
  if (-not (Test-Path $gk)) { New-Item -ItemType File -Path $gk | Out-Null }
}

# --- MANAGED: CI templates (Verified-tier gate + activation guide) ---
$ctSrc = Join-Path $Payload 'docs/ci-templates'
if (Test-Path $ctSrc) {
  $ctDst = Join-Path $Target 'docs/ci-templates'
  New-Item -ItemType Directory -Force -Path $ctDst | Out-Null
  foreach ($f in Get-ChildItem -File $ctSrc) {
    $dst = Join-Path $ctDst $f.Name
    if ((Test-Path $dst) -and -not (Select-String -LiteralPath $dst -Pattern 'codeforge' -Quiet) -and -not (Test-Path "$dst.pre-forge.bak")) {
      Copy-Item $dst "$dst.pre-forge.bak"
      Write-Host "  ! backed up existing docs/ci-templates/$($f.Name) -> $($f.Name).pre-forge.bak"
    }
    Copy-Item $f.FullName $dst -Force
  }
}

# --- PROJECT-OWNED: PROJECT.md / CONTINUITY.md / docs/CHANGELOG.md (create only if missing) ---
$tProject = Join-Path $Target 'PROJECT.md'
if (-not (Test-Path $tProject)) {
  Copy-Item (Join-Path $Payload 'PROJECT.template.md') $tProject
  Write-Host "  + created PROJECT.md (fill in persona/info/variables/special rules)"
}
$tCont = Join-Path $Target 'CONTINUITY.md'
if (-not (Test-Path $tCont)) { Copy-Item (Join-Path $Payload 'CONTINUITY.template.md') $tCont }
$tChangelog = Join-Path $Target 'docs/CHANGELOG.md'
if (-not (Test-Path $tChangelog)) { Copy-Item (Join-Path $Payload 'docs/CHANGELOG.md') $tChangelog }

# --- re-render the wizard-owned values FROM PROJECT.md (project-owned) into the MANAGED files ---
# Twin of the same block in install.sh — see the rationale there. All comparisons use the
# CASE-SENSITIVE c-variants (-ceq/-clike/-cmatch/-ccontains/-creplace): PowerShell's defaults are
# case-insensitive, so `Gate profile: LIGHT` would be accepted here and rejected by the POSIX twin,
# and the profile written through would then be one `check-gates` exits 3 on. PROJECT.md is the source of truth
# because it is never clobbered; shared/rules/models.md and shared/state.template.md are refreshed
# by name on every install, so a value written only there is silently reset by `--upgrade`.
# Only value lines are substituted. Missing section / line / unparseable value => no-op.
if (Test-Path $tProject) {
  # Body of '## Review policy' up to the next top-level heading (CRLF-tolerant).
  $policy = @()
  $inSec = $false
  foreach ($raw in Get-Content -LiteralPath $tProject) {
    $l = $raw -replace "`r$", ''
    if ($l -ceq '## Review policy') { $inSec = $true; continue }
    if ($inSec -and $l -clike '## *') { $inSec = $false }
    if ($inSec) { $policy += $l }
  }
  $firstMatch = {
    param($pattern)
    $hit = $policy | Where-Object { $_ -cmatch $pattern } | Select-Object -First 1
    if ($hit) { $hit -creplace '\s+$', '' } else { '' }
  }
  $revLine = & $firstMatch '^\s*Default reviewer\(s\):'
  $couLine = & $firstMatch '^\s*Council advisors:'
  $profHit = & $firstMatch '^\s*Gate profile:\s*[A-Za-z][A-Za-z-]*'
  $prof = if ($profHit -cmatch '^\s*Gate profile:\s*([A-Za-z][A-Za-z-]*)') { $Matches[1] } else { '' }

  # models.md: swap the two value lines inside the managed block, in place.
  $mm = Join-Path $Target 'shared/rules/models.md'
  if ($revLine -and $couLine -and (Test-Path $mm)) {
    $out = New-Object System.Collections.Generic.List[string]
    $inBlk = $false
    foreach ($line in Get-Content -LiteralPath $mm) {
      if ($line -cmatch 'codeforge:review-policy:start') { $inBlk = $true;  $out.Add($line); continue }
      if ($line -cmatch 'codeforge:review-policy:end')   { $inBlk = $false; $out.Add($line); continue }
      if ($inBlk -and $line -cmatch '^\s*Default reviewer\(s\):') { $out.Add($revLine); continue }
      if ($inBlk -and $line -cmatch '^\s*Council advisors:')      { $out.Add($couLine); continue }
      $out.Add($line)
    }
    Set-Content -Path $mm -Value $out
    Write-Host "  = review policy applied from PROJECT.md -> shared/rules/models.md"
  }

  # state.template.md: only a profile check-gates accepts may be written through, or the user gets a
  # template that exits 3 ("unknown gate profile") against its own validator.
  $st = Join-Path $Target 'shared/state.template.md'
  if ($prof -and @('standard', 'light') -ccontains $prof) {
    if (Test-Path $st) {
      $stLines = Get-Content -LiteralPath $st | ForEach-Object {
        $_ -creplace '(\*\*Profile:\*\*\s*)[A-Za-z][A-Za-z-]*', ('${1}' + $prof)
      }
      Set-Content -Path $st -Value $stLines
      Write-Host "  = gate profile applied from PROJECT.md -> shared/state.template.md ($prof)"
    }
  } elseif ($prof) {
    Write-Host "  ! PROJECT.md 'Gate profile: $prof' is not 'standard' or 'light' — keeping the shipped default"
  }
}

# --- back up any pre-existing, NON-forge per-engine skills dir before sync overwrites it ---
foreach ($eng in '.claude', '.agents') {
  $sd = Join-Path $Target "$eng/skills"
  if ((Test-Path $sd) -and -not (Test-Path (Join-Path $sd '.forge-generated'))) {
    Move-Item $sd "$sd.pre-forge.bak"
    Write-Host "  ! backed up existing $eng/skills -> $eng/skills.pre-forge.bak (add custom skills to the codeforge repo)"
  }
}
# back up a real, non-forge AGENTS.md before sync overwrites it
$tAgents = Join-Path $Target 'AGENTS.md'
if ((Test-Path $tAgents) -and -not (Has-ForgeMarker $tAgents)) {
  Copy-Item $tAgents "$tAgents.pre-forge.bak" -Force
  Write-Host "  ! backed up existing AGENTS.md -> AGENTS.md.pre-forge.bak"
}

# --- GENERATE engine dirs + AGENTS.md + opencode.json via sync (reads the codeforge source,
#     writes straight into the target) ---
& (Join-Path $Src 'src/sync.ps1') -Out $Target | Out-Null

# --- Claude Code .claude/settings.local.json: auto-isolation ---
# Auto-isolation (default; -NoIsolate to keep inheritance) adds claudeMdExcludes so Claude Code
# doesn't blend ancestor CLAUDE.md/.claude/rules into this project (Codex/OpenCode already scope
# to the project root). Lands in the one gitignored file; codeforge only (re)writes it when
# absent or a prior install owned it.
$excludes = @()
if (-not $NoIsolate) {
  $d = Split-Path -Parent $Target
  $homeDir = [System.IO.Path]::GetFullPath($HOME)
  while ($d -and $d -ne (Split-Path -Parent $d)) {
    if (Test-Path -LiteralPath (Join-Path $d 'CLAUDE.md') -PathType Leaf)       { $excludes += (Join-Path $d 'CLAUDE.md') }
    if (Test-Path -LiteralPath (Join-Path $d 'CLAUDE.local.md') -PathType Leaf) { $excludes += (Join-Path $d 'CLAUDE.local.md') }
    if ((Test-Path -LiteralPath (Join-Path $d '.claude/rules') -PathType Container) -and ($d -ne $homeDir)) { $excludes += (Join-Path $d '.claude/rules/**') }
    $d = Split-Path -Parent $d
  }
}

$sl = Join-Path $Target '.claude/settings.local.json'
if ($excludes.Count -gt 0) {
  if ((Test-Path -LiteralPath $sl -PathType Leaf) -and (-not $priorLocalManaged)) {
    Write-Host "  ! .claude/settings.local.json exists and isn't codeforge-managed — not touching it."
    Write-Host "    (skipped auto-isolation; remove that file and re-run, or edit it by hand.)"
  } else {
    $settings = [ordered]@{}
    if ($excludes.Count -gt 0) { $settings['claudeMdExcludes'] = $excludes }
    $settings | ConvertTo-Json -Depth 10 | Set-Content -Path $sl
    if (-not (Select-String -LiteralPath $mf -Pattern '^localsettings:managed$' -Quiet)) { Add-Content -Path $mf -Value 'localsettings:managed' }
    if ($excludes.Count -gt 0) { Write-Host "  + auto-isolated Claude Code from $($excludes.Count) ancestor instruction path(s) -> .claude/settings.local.json (-NoIsolate to keep inheritance)" }
  }
} elseif ($priorLocalManaged -and (Test-Path -LiteralPath $sl -PathType Leaf)) {
  Remove-Item -LiteralPath $sl -Force
  Write-Host "  - removed codeforge-managed .claude/settings.local.json (nothing to configure now)"
}

# --- .gitignore (merge, don't clobber): ONLY local state (generated files are committed) ---
$gi = Join-Path $Target '.gitignore'
if (-not (Test-Path $gi)) { New-Item -ItemType File -Path $gi | Out-Null }
$marker = '# codeforge (local state — do not commit)'
if (-not (Select-String -Quiet -SimpleMatch $marker $gi)) {
  $block = @"

# codeforge (local state — do not commit)
.DS_Store
.workflow/
.claude/settings.local.json
"@
  Add-Content -Path $gi -Value $block
}

# Ensure .workflow/ is ignored (idempotent, exact-line), independent of the marker block.
$giPath = Join-Path $Target '.gitignore'
$giLines = if (Test-Path $giPath) { Get-Content -Path $giPath } else { @() }
# Exact, case-SENSITIVE, whole-line match (mirrors the sh side's `grep -qxF`) — NOT .Trim()/-eq,
# which would let ` .workflow/` or `.WORKFLOW/` falsely suppress the required entry.
if (-not ($giLines | Where-Object { $_ -ceq '.workflow/' })) {
  Add-Content -Path $giPath -Value '.workflow/'
}

# --- warn if the generated config lacks the forge push/PR gate ---
function Warn-Gate([string]$rel, [string]$needle, [string]$hint) {
  $f = Join-Path $Target $rel
  if ((Test-Path $f) -and -not (Select-String -Quiet -SimpleMatch $needle $f)) {
    Write-Host "  ! $rel has no forge push/PR gate ($hint) — add it to the codeforge source, then re-run."
  }
}
Warn-Gate '.claude/settings.json' 'git push'       'ask-tier on git push / gh pr create'
Warn-Gate '.codex/config.toml'    'approval_policy' 'approval_policy'
Warn-Gate 'opencode.json'         'git push'       'permission.bash git push* / gh pr create*'

# --- post-install validation: generated skill copies + AGENTS.md must exist ---
$ok = $true
foreach ($p in '.claude/skills', '.agents/skills') {
  if (-not (Test-Path (Join-Path $Target "$p/new-feature/SKILL.md"))) {
    Write-Host "  ! discovery FAILED: $p was not generated"; $ok = $false
  }
}
foreach ($f in 'AGENTS.md', '.claude/settings.json', '.codex/config.toml', 'opencode.json', 'shared/state.template.md') {
  if (-not (Test-Path (Join-Path $Target $f))) { Write-Host "  ! FAILED: $f was not generated"; $ok = $false }
}
if (-not $ok) {
  Write-Host "  x install INCOMPLETE — issues above; NOT marking as installed"; exit 1
}
Write-Host "  + validation: skills (.claude + .agents), AGENTS.md, and engine configs generated"

# --- git: the workflow (branches/commits) and ship gates operate on git ---
& git -C $Target rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -eq 0) {
  # already a git repo — the workflow uses it
} elseif ($GitInit) {
  & git -C $Target init -q
  & git -C $Target add -A
  & git -C $Target commit -q -m "chore: adopt codeforge" 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  + initialized a git repo + baseline commit (chore: adopt codeforge)"
  } else {
    Write-Host "  + initialized a git repo (baseline commit skipped — set git user.name/email, then commit)"
  }
} else {
  Write-Host "  ! not a git repo — codeforge's workflow (branches, commits) and the ship gates assume git."
  Write-Host "    Run 'git init' here, or re-run the installer with -GitInit."
}

Write-Host "codeforge installed."
Write-Host "  next: (1) fill PROJECT.md   (2) in Codex, trust the project when prompted"
Write-Host "        (3) open the project in any of Claude Code / Codex / OpenCode"
Write-Host "  to customize or upgrade: edit the codeforge source, then re-run this installer"
Write-Host "  against the project (-Upgrade, or a bare re-run from inside it)."

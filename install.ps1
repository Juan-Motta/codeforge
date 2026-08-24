#!/usr/bin/env pwsh
#
# codeforge installer (Windows / PowerShell) — copy the workflow discipline into a target
# project. Mirror of install.sh.
#
#   pwsh ./install.ps1 [target-dir] [-Upgrade] [-GitInit] [-NoIsolate]
#                              [-IgnoreGenerated | -TrackGenerated]
#
# With no target-dir, installs into the current working directory.
#
# SELF-CONTAINED INSTALL: `.codeforge/` is the canonical installed source. It contains
# everything required to inspect, customize, and regenerate the harness without a checkout
# of this repository: instructions, agent contracts, skills, rules, scripts, configs, docs, templates, and
# sync.sh/sync.ps1. Engine-specific discovery paths are generated from that directory by
# plain copy (no symlinks).
#
param(
  [Parameter(Mandatory = $false)][string]$Target,
  [switch]$Upgrade,
  [switch]$GitInit,
  [switch]$NoIsolate,
  [switch]$IgnoreGenerated,
  [switch]$TrackGenerated
)
$ErrorActionPreference = 'Stop'

function Exit-CodeforgeError {
  param([Parameter(Mandatory = $true)][string]$Message, [int]$Code = 2)
  [Console]::Error.WriteLine($Message)
  exit $Code
}

if ($IgnoreGenerated -and $TrackGenerated) {
  Exit-CodeforgeError '-IgnoreGenerated and -TrackGenerated are mutually exclusive'
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

if (-not (Test-Path -PathType Container $Target)) { Exit-CodeforgeError "target dir not found: $Target" }
$Target = (Resolve-Path $Target).Path

function Test-CodeforgeReparsePoint {
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    return (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
  } catch {
    if (($_.Exception -is [System.Management.Automation.ItemNotFoundException]) -or
        ($_.FullyQualifiedErrorId -like 'PathNotFound*')) {
      return $false
    }
    throw
  }
}

function Assert-CodeforgeSafeManagedPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (Test-CodeforgeReparsePoint -Path $Path) {
    Exit-CodeforgeError "refusing managed symlink/reparse path: $Path"
  }
}

foreach ($relative in @(
  '.codeforge', '.claude', '.agents', '.codex', 'docs',
  '.claude/skills', '.claude/agents', '.claude/settings.local.json',
  '.agents/skills', '.codex/agents',
  'docs/prds', 'docs/plans', 'docs/research', 'docs/solutions', 'docs/adr', 'docs/e2e',
  'docs/e2e/reports', 'docs/e2e/use-cases', 'docs/ci-templates',
  'docs/prds/.gitkeep', 'docs/plans/.gitkeep', 'docs/research/.gitkeep',
  'docs/solutions/.gitkeep', 'docs/adr/.gitkeep', 'docs/e2e/reports/.gitkeep',
  'docs/e2e/use-cases/.gitkeep', 'docs/CHANGELOG.md',
  'PROJECT.md', 'CONTINUITY.md', '.gitignore'
)) {
  Assert-CodeforgeSafeManagedPath -Path (Join-Path $Target $relative)
}
$managedDocsTemplates = Join-Path $Target 'docs\ci-templates'
if (Test-Path -LiteralPath $managedDocsTemplates -PathType Container) {
  $docsLink = Get-ChildItem -LiteralPath $managedDocsTemplates -Recurse -Force -ErrorAction Stop |
    Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
    Select-Object -First 1
  if ($docsLink) {
    Exit-CodeforgeError "refusing symlink inside managed docs/ci-templates: $($docsLink.FullName)"
  }
}
$canonicalRoot = Join-Path $Target '.codeforge'
if (Test-Path -LiteralPath $canonicalRoot -PathType Container) {
  $nestedLink = Get-ChildItem -LiteralPath $canonicalRoot -Recurse -Force -ErrorAction Stop |
    Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
    Select-Object -First 1
  if ($nestedLink) {
    Exit-CodeforgeError "refusing symlink inside canonical .codeforge source: $($nestedLink.FullName)"
  }
}

# Preflight the existing managed .gitignore range before creating `.codeforge/` or rewriting any
# project file. Missing is valid; malformed is ambiguous and must leave the target untouched.
$gi = Join-Path $Target '.gitignore'
$giStart = '# codeforge:generated:start'
$giEnd = '# codeforge:generated:end'
if (Test-Path -LiteralPath $gi -PathType Leaf) {
  $preflightLines = @(Get-Content -LiteralPath $gi)
  $preflightStarts = @()
  $preflightEnds = @()
  for ($i = 0; $i -lt $preflightLines.Count; $i++) {
    if ($preflightLines[$i] -ceq $giStart) { $preflightStarts += $i }
    if ($preflightLines[$i] -ceq $giEnd) { $preflightEnds += $i }
  }
  if (($preflightStarts.Count -gt 0 -or $preflightEnds.Count -gt 0) -and
      ($preflightStarts.Count -ne 1 -or $preflightEnds.Count -ne 1 -or $preflightStarts[0] -ge $preflightEnds[0])) {
    Write-Error "malformed codeforge block in $gi; fix/remove '$giStart' and '$giEnd', then re-run"
    exit 1
  }
}

# Validate the single replaceable imported-context range before mutating the target. This makes
# adoption idempotent across retries and fails closed on ambiguous project-owned content.
$contextStart = '<!-- codeforge:imported-context:start -->'
$contextEnd = '<!-- codeforge:imported-context:end -->'
$projectImportPresent = $false
$preflightProject = Join-Path $Target 'PROJECT.md'
if (Test-Path -LiteralPath $preflightProject -PathType Leaf) {
  $projectLines = @(Get-Content -LiteralPath $preflightProject)
  $contextStarts = @()
  $contextEnds = @()
  for ($i = 0; $i -lt $projectLines.Count; $i++) {
    if ($projectLines[$i] -ceq $contextStart) { $contextStarts += $i }
    if ($projectLines[$i] -ceq $contextEnd) { $contextEnds += $i }
  }
  if (($contextStarts.Count -gt 0 -or $contextEnds.Count -gt 0) -and
      ($contextStarts.Count -ne 1 -or $contextEnds.Count -ne 1 -or $contextStarts[0] -ge $contextEnds[0])) {
    Write-Error "malformed imported-context block in $preflightProject; fix/remove '$contextStart' and '$contextEnd', then re-run"
    exit 1
  }
  $projectImportPresent = $contextStarts.Count -eq 1
}

# Did a prior forge install own .claude/settings.local.json? (read before the manifest is rewritten)
$priorLocalManaged = $false
$mf = Join-Path $Target '.codeforge/manifest'
if ((Test-Path -LiteralPath $mf -PathType Leaf) -and (Select-String -LiteralPath $mf -Pattern '^localsettings:managed$' -Quiet)) {
  $priorLocalManaged = $true
}
# Preserve a prior project choice unless this invocation explicitly changes it. Fresh installs
# track generated adapters so clones work immediately without a post-clone command.
if ($IgnoreGenerated) {
  $generatedPolicy = 'ignored'
} elseif ($TrackGenerated) {
  $generatedPolicy = 'tracked'
} elseif (Test-Path -LiteralPath $mf -PathType Leaf) {
  $priorGenerated = Get-Content -LiteralPath $mf | Where-Object { $_ -cmatch '^generated:(tracked|ignored)$' } | Select-Object -First 1
  $generatedPolicy = if ($priorGenerated) { $priorGenerated.Substring(10) } else { 'tracked' }
} else {
  $generatedPolicy = 'tracked'
}
if (-not ((Test-Path (Join-Path $Payload 'CLAUDE.md')) -and
          (Test-Path (Join-Path $Payload 'skills')) -and
          (Test-Path (Join-Path $Payload 'agents/codeforge-implementer.md')) -and
          (Test-Path (Join-Path $Payload 'codeforge/scripts/run-reviewer.mjs')))) {
  Exit-CodeforgeError "payload not found — run this from the codeforge repo"
}
if ($Target -eq $Src) { Exit-CodeforgeError "refusing to install into codeforge itself" }
if ($Target -eq $Payload) { Exit-CodeforgeError "refusing to install into the codeforge payload dir (src/)" }

Write-Host "codeforge $forgeVersion -> installing into: $Target  (mode: $Mode)"

# --- version drift advisory (informational only, never blocks) ---
$priorVersion = ""
$fvFile = Join-Path $Target '.codeforge/version'
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

# --- CANONICAL INSTALLED SOURCE: everything required to regenerate the harness ---
$aw = Join-Path $Target '.codeforge'
New-Item -ItemType Directory -Force -Path $aw | Out-Null
$manifest = Join-Path $aw 'manifest'
Copy-Item (Join-Path $Payload 'CLAUDE.md') (Join-Path $aw 'WORKFLOW.md') -Force

# Framework agent contracts are refreshed by name; differently named project contracts survive.
$agentsDst = Join-Path $aw 'agents'
New-Item -ItemType Directory -Force -Path $agentsDst | Out-Null
foreach ($agent in Get-ChildItem -LiteralPath (Join-Path $Payload 'agents') -File -Filter *.md -Force) {
  Copy-Item -LiteralPath $agent.FullName -Destination (Join-Path $agentsDst $agent.Name) -Force
}

$configsDst = Join-Path $aw 'configs'
$docsDst = Join-Path $aw 'docs'
New-Item -ItemType Directory -Force -Path $configsDst, $docsDst | Out-Null

# Configs become project-owned canonical inputs once seeded. Preserve edits and additional files;
# a missing entry is reseeded on a later install.
$configsSrc = Join-Path $Payload 'configs'
foreach ($sourceConfig in Get-ChildItem -LiteralPath $configsSrc -File -Recurse -Force) {
  $relative = [System.IO.Path]::GetRelativePath($configsSrc, $sourceConfig.FullName)
  $targetConfig = Join-Path $configsDst $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetConfig) | Out-Null
  if (-not (Test-Path -LiteralPath $targetConfig)) {
    Copy-Item -LiteralPath $sourceConfig.FullName -Destination $targetConfig
  }
}

# Framework docs refresh by name while differently named project additions survive.
foreach ($sourceDoc in Get-ChildItem -LiteralPath (Join-Path $Payload 'docs') -Force) {
  Copy-Item -LiteralPath $sourceDoc.FullName -Destination $docsDst -Recurse -Force
}

# Skills are managed per directory so project-specific additions survive an upgrade.
$skillsDst = Join-Path $aw 'skills'
New-Item -ItemType Directory -Force -Path $skillsDst | Out-Null
$sourceSkills = @(Get-ChildItem -LiteralPath (Join-Path $Payload 'skills') -Directory -Force)
$newSkills = @($sourceSkills.Name | Sort-Object)
if (Test-Path -LiteralPath $manifest -PathType Leaf) {
  foreach ($line in Get-Content -LiteralPath $manifest) {
    if ($line -like 'skill:*') {
      $n = $line.Substring(6)
      if ($n -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
        [Console]::Error.WriteLine("  ! ignoring unsafe manifest skill entry: $n")
      } elseif ($newSkills -notcontains $n) {
        Remove-Item -LiteralPath (Join-Path $skillsDst $n) -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  - pruned framework skill removed upstream: $n"
      }
    }
  }
}
foreach ($skill in $sourceSkills) {
  $dst = Join-Path $skillsDst $skill.Name
  if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
  Copy-Item -LiteralPath $skill.FullName -Destination $skillsDst -Recurse -Force
}

if (Test-Path -LiteralPath (Join-Path $aw 'templates')) {
  Remove-Item -LiteralPath (Join-Path $aw 'templates') -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $aw 'templates') | Out-Null
Copy-Item (Join-Path $Payload 'PROJECT.template.md') (Join-Path $aw 'templates/PROJECT.md') -Force
Copy-Item (Join-Path $Payload 'CONTINUITY.template.md') (Join-Path $aw 'templates/CONTINUITY.md') -Force
Copy-Item (Join-Path $Payload 'sync.sh') (Join-Path $aw 'sync.sh') -Force
Copy-Item (Join-Path $Payload 'sync.ps1') (Join-Path $aw 'sync.ps1') -Force

# --- PROJECT CONTEXT ADOPTION: preserve pre-existing agent entrypoints verbatim ---
$tProject = Join-Path $Target 'PROJECT.md'
if (-not (Test-Path $tProject)) {
  Copy-Item (Join-Path $aw 'templates/PROJECT.md') $tProject
  Write-Host "  + created PROJECT.md (fill in persona/info/variables/special rules)"
}

$tClaude = Join-Path $Target 'CLAUDE.md'
$tAgents = Join-Path $Target 'AGENTS.md'
$oldClaude = $null
$oldAgents = $null
if ((Test-Path -LiteralPath $tClaude -PathType Leaf) -and -not (Select-String -LiteralPath $tClaude -SimpleMatch 'codeforge:entrypoint' -Quiet)) {
  $oldClaude = Get-Content -LiteralPath $tClaude -Raw
  $backups = Join-Path $aw 'backups'
  New-Item -ItemType Directory -Force -Path $backups | Out-Null
  $backup = Join-Path $backups 'CLAUDE.md.pre-codeforge.bak'
  if (-not (Test-Path -LiteralPath $backup)) { Copy-Item $tClaude $backup }
}
if ((Test-Path -LiteralPath $tAgents -PathType Leaf) -and -not (Select-String -LiteralPath $tAgents -SimpleMatch 'codeforge:entrypoint' -Quiet)) {
  $oldAgents = Get-Content -LiteralPath $tAgents -Raw
  $backups = Join-Path $aw 'backups'
  New-Item -ItemType Directory -Force -Path $backups | Out-Null
  $backup = Join-Path $backups 'AGENTS.md.pre-codeforge.bak'
  if (-not (Test-Path -LiteralPath $backup)) { Copy-Item $tAgents $backup }
}
if ($null -ne $oldClaude -or $null -ne $oldAgents) {
  $blockParts = @($contextStart, '')
  if ($null -ne $oldClaude -and $null -ne $oldAgents -and $oldClaude -ceq $oldAgents) {
    $blockParts += '### From existing CLAUDE.md and AGENTS.md', '', $oldClaude
  } else {
    if ($null -ne $oldClaude) { $blockParts += '### From existing CLAUDE.md', '', $oldClaude }
    if ($null -ne $oldAgents) { $blockParts += '### From existing AGENTS.md', '', $oldAgents }
  }
  $blockParts += '', $contextEnd
  $currentProjectLines = @(Get-Content -LiteralPath $tProject)
  if ($projectImportPresent) {
    $startIndex = [Array]::IndexOf($currentProjectLines, $contextStart)
    $endIndex = [Array]::IndexOf($currentProjectLines, $contextEnd)
    $prefix = if ($startIndex -gt 0) { @($currentProjectLines[0..($startIndex - 1)]) } else { @() }
    $suffix = if ($endIndex -lt ($currentProjectLines.Count - 1)) { @($currentProjectLines[($endIndex + 1)..($currentProjectLines.Count - 1)]) } else { @() }
    $updatedProjectLines = @($prefix) + @($blockParts) + @($suffix)
  } else {
    $updatedProjectLines = @($currentProjectLines) + @('', '## Imported agent context', '') + @($blockParts)
  }
  $projectTemporary = Join-Path $Target ('.codeforge-project.' + [Guid]::NewGuid().ToString('N'))
  try {
    $projectContent = ($updatedProjectLines -join "`n").TrimEnd("`r", "`n") + "`n"
    [System.IO.File]::WriteAllText($projectTemporary, $projectContent, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Move($projectTemporary, $tProject, $true)
  } finally {
    if (Test-Path -LiteralPath $projectTemporary) { Remove-Item -LiteralPath $projectTemporary -Force }
  }
  $projectImportPresent = $true
  Write-Host "  + preserved existing agent context in PROJECT.md (originals backed up under .codeforge/backups/)"
}

# --- MANAGED: framework .codeforge/rules/ (per-entry overwrite by name) ---
New-Item -ItemType Directory -Force -Path (Join-Path $Target '.codeforge/rules') | Out-Null
$newRules = @(Get-ChildItem -File (Join-Path $Payload 'codeforge/rules') -Filter *.md).Name

# Prune framework rules removed upstream (see install.sh for rationale). Project-owned rules
# aren't in the manifest, so they're untouched. No manifest yet = skip prune.
if (Test-Path $manifest) {
  foreach ($line in Get-Content $manifest) {
    if ($line -like 'rule:*') {
      $n = $line.Substring(5)
      # Treat the committed manifest as untrusted: a prune target must be a bare *.md filename,
      # never a path/traversal, so a tampered entry can't delete outside .codeforge/rules/.
      if ($n -match '[\\/]' -or $n -match '\.\.' -or $n -eq '' -or $n -notmatch '\.md$') {
        [Console]::Error.WriteLine("  ! ignoring unsafe manifest rule entry: $n")
      } elseif ($newRules -notcontains $n) {
        Remove-Item -Force (Join-Path $Target ".codeforge/rules/$n") -ErrorAction SilentlyContinue
        Write-Host "  - pruned framework rule removed upstream: $n"
      }
    }
  }
}

foreach ($f in Get-ChildItem -File (Join-Path $Payload 'codeforge/rules') -Filter *.md) {
  Copy-Item $f.FullName (Join-Path $Target ".codeforge/rules/$($f.Name)") -Force
}

# Record framework-owned entries for the next selective upgrade/prune.
$manifestLines = @($newRules | ForEach-Object { "rule:$_" }) + @($newSkills | ForEach-Object { "skill:$_" }) + "generated:$generatedPolicy"
Set-Content -Path $manifest -Value $manifestLines

# Stamp the version that produced this install, for drift detection on the next run.
Set-Content -Path (Join-Path $Target '.codeforge/version') -Value $forgeVersion

# --- MANAGED: workflow state template (in .codeforge/) ---
Copy-Item (Join-Path $Payload 'codeforge/state.template.md') (Join-Path $Target '.codeforge/state.template.md') -Force

# --- MANAGED: framework .codeforge/scripts/ (agent-invoked Tier-B helpers, e.g. check-gates) ---
$scriptsSrc = Join-Path $Payload 'codeforge/scripts'
if (Test-Path -LiteralPath $scriptsSrc -PathType Container) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Target '.codeforge/scripts') | Out-Null
  foreach ($f in Get-ChildItem -File $scriptsSrc) {
    Copy-Item $f.FullName (Join-Path $Target ".codeforge/scripts/$($f.Name)") -Force
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
$ctSrc = Join-Path $aw 'docs/ci-templates'
if (Test-Path $ctSrc) {
  $ctDst = Join-Path $Target 'docs/ci-templates'
  New-Item -ItemType Directory -Force -Path $ctDst | Out-Null
  foreach ($f in Get-ChildItem -File $ctSrc) {
    $dst = Join-Path $ctDst $f.Name
    if ((Test-Path $dst) -and -not (Select-String -LiteralPath $dst -Pattern 'codeforge' -Quiet) -and -not (Test-Path "$dst.pre-codeforge.bak")) {
      Copy-Item $dst "$dst.pre-codeforge.bak"
      Write-Host "  ! backed up existing docs/ci-templates/$($f.Name) -> $($f.Name).pre-codeforge.bak"
    }
    Copy-Item $f.FullName $dst -Force
  }
}

# --- PROJECT-OWNED: PROJECT.md / CONTINUITY.md / docs/CHANGELOG.md (create only if missing) ---
if (-not (Test-Path $tProject)) {
  Copy-Item (Join-Path $aw 'templates/PROJECT.md') $tProject
  Write-Host "  + created PROJECT.md (fill in persona/info/variables/special rules)"
}
$tCont = Join-Path $Target 'CONTINUITY.md'
if (-not (Test-Path $tCont)) { Copy-Item (Join-Path $aw 'templates/CONTINUITY.md') $tCont }
$tChangelog = Join-Path $Target 'docs/CHANGELOG.md'
if (-not (Test-Path $tChangelog)) { Copy-Item (Join-Path $aw 'docs/CHANGELOG.md') $tChangelog }

# --- re-render the wizard-owned values FROM PROJECT.md (project-owned) into the MANAGED files ---
# Twin of the same block in install.sh — see the rationale there. All comparisons use the
# CASE-SENSITIVE c-variants (-ceq/-clike/-cmatch/-ccontains/-creplace): PowerShell's defaults are
# case-insensitive, so `Gate profile: LIGHT` would be accepted here and rejected by the POSIX twin,
# and the profile written through would then be one `check-gates` exits 3 on. PROJECT.md is the source of truth
# because it is never clobbered; .codeforge/rules/models.md and .codeforge/state.template.md are refreshed
# by name on every install, so a value written only there is silently reset by `--upgrade`.
# Only value lines are substituted. Missing section / line / unparseable value => no-op.
if (Test-Path $tProject) {
  # Body of the FIRST '## Review policy' section only (CRLF-tolerant). Duplicates are
  # ambiguous, so match install.sh: warn and never combine values from separate sections.
  $policy = @()
  $inSec = $false
  $seenPolicy = $false
  $policyCount = 0
  foreach ($raw in Get-Content -LiteralPath $tProject) {
    $l = $raw -replace "`r$", ''
    if ($l -ceq '## Review policy') {
      $policyCount++
      if (-not $seenPolicy) { $seenPolicy = $true; $inSec = $true } else { $inSec = $false }
      continue
    }
    if ($inSec -and $l -clike '## *') { $inSec = $false }
    if ($inSec) { $policy += $l }
  }
  if ($policyCount -gt 1) { Write-Host "  ! PROJECT.md has $policyCount '## Review policy' sections — using the first" }
  $firstMatch = {
    param($pattern)
    $hit = $policy | Where-Object { $_ -cmatch $pattern } | Select-Object -First 1
    if ($hit) { $hit -creplace '\s+$', '' } else { '' }
  }
  $revLine = & $firstMatch '^\s*Default reviewer\(s\):'
  $couLine = & $firstMatch '^\s*Council advisors:'
  $profHit = & $firstMatch '^\s*Gate profile:\s*[A-Za-z][A-Za-z-]*'
  $prof = if ($profHit -cmatch '^\s*Gate profile:\s*([A-Za-z][A-Za-z-]*)') { $Matches[1] } else { '' }

  # models.md: substitute each present value independently inside one valid marker pair.
  $mm = Join-Path $Target '.codeforge/rules/models.md'
  if (($revLine -or $couLine) -and (Test-Path $mm)) {
    $mmLines = @(Get-Content -LiteralPath $mm)
    $starts = @()
    $ends = @()
    for ($i = 0; $i -lt $mmLines.Count; $i++) {
      if ($mmLines[$i] -cmatch 'codeforge:review-policy:start') { $starts += $i }
      if ($mmLines[$i] -cmatch 'codeforge:review-policy:end') { $ends += $i }
    }
    if ($starts.Count -eq 1 -and $ends.Count -eq 1 -and $starts[0] -lt $ends[0]) {
      $out = New-Object System.Collections.Generic.List[string]
      $inBlk = $false
      foreach ($line in $mmLines) {
        if ($line -cmatch 'codeforge:review-policy:start') { $inBlk = $true;  $out.Add($line); continue }
        if ($line -cmatch 'codeforge:review-policy:end')   { $inBlk = $false; $out.Add($line); continue }
        if ($inBlk -and $revLine -and $line -cmatch '^\s*Default reviewer\(s\):') { $out.Add($revLine); continue }
        if ($inBlk -and $couLine -and $line -cmatch '^\s*Council advisors:')      { $out.Add($couLine); continue }
        $out.Add($line)
      }
      Set-Content -Path $mm -Value $out
      Write-Host "  = review policy applied from PROJECT.md -> .codeforge/rules/models.md"
    } else {
      Write-Host "  ! .codeforge/rules/models.md has a malformed review-policy marker pair — left untouched"
    }
  }

  # state.template.md: only a profile check-gates accepts may be written through, or the user gets a
  # template that exits 3 ("unknown gate profile") against its own validator.
  $st = Join-Path $Target '.codeforge/state.template.md'
  if ($prof -and @('standard', 'light') -ccontains $prof) {
    if (Test-Path $st) {
      $stLines = Get-Content -LiteralPath $st | ForEach-Object {
        $_ -creplace '(\*\*Profile:\*\*\s*)[A-Za-z][A-Za-z-]*', ('${1}' + $prof)
      }
      Set-Content -Path $st -Value $stLines
      Write-Host "  = gate profile applied from PROJECT.md -> .codeforge/state.template.md ($prof)"
    }
  } elseif ($prof) {
    Write-Host "  ! PROJECT.md 'Gate profile: $prof' is not 'standard' or 'light' — keeping the shipped default"
  }
}

# --- back up any pre-existing, NON-forge per-engine skills dir before sync overwrites it ---
foreach ($eng in '.claude', '.agents') {
  $sd = Join-Path $Target "$eng/skills"
  if ((Test-Path $sd) -and -not (Test-Path (Join-Path $sd '.codeforge-generated'))) {
    Move-Item $sd "$sd.pre-codeforge.bak"
    Write-Host "  ! backed up existing $eng/skills -> $eng/skills.pre-codeforge.bak (add custom skills under .codeforge/skills)"
  }
}


# Preserve a pre-existing custom definition before sync claims codeforge's generated filename.
foreach ($agentPath in '.claude/agents/codeforge-implementer.md', '.codex/agents/codeforge-implementer.toml') {
  $existing = Join-Path $Target $agentPath
  if ((Test-Path -LiteralPath $existing -PathType Leaf) -and
      -not (Select-String -LiteralPath $existing -SimpleMatch 'codeforge:generated-agent' -Quiet)) {
    $backup = "$existing.pre-codeforge.bak"
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $existing -Destination $backup }
    Write-Host "  ! backed up existing $agentPath -> $agentPath.pre-codeforge.bak"
  }
}
# --- GENERATE engine dirs + AGENTS.md + opencode.json from the installed source ---
& (Join-Path $aw 'sync.ps1') -Out $Target | Out-Null

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

# --- .gitignore (managed block; user content outside it is preserved) ---
# `.codeforge/`, root entrypoints, PROJECT.md, CONTINUITY.md, and docs/ stay trackable.
# Create this file even before `git init` so a later bulk add has the chosen policy already.
if (-not (Test-Path -LiteralPath $gi -PathType Leaf)) { New-Item -ItemType File -Path $gi | Out-Null }
$giLines = @(Get-Content -LiteralPath $gi)
$starts = @()
$ends = @()
for ($i = 0; $i -lt $giLines.Count; $i++) {
  if ($giLines[$i] -ceq $giStart) { $starts += $i }
  if ($giLines[$i] -ceq $giEnd) { $ends += $i }
}
$base = @()
for ($i = 0; $i -lt $giLines.Count; $i++) {
  if ($starts.Count -eq 1 -and $i -ge $starts[0] -and $i -le $ends[0]) { continue }
  $base += $giLines[$i]
}
while ($base.Count -gt 0 -and $base[-1] -ceq '') {
  if ($base.Count -eq 1) { $base = @() } else { $base = @($base[0..($base.Count - 2)]) }
}

$block = @(
  $giStart,
  '# Local-only codeforge state',
  '.DS_Store',
  '.codeforge/workflow/',
  '.claude/settings.local.json'
)
if ($generatedPolicy -ceq 'ignored') {
  $block += @(
    '# Generated adapters (rebuild with .codeforge/sync.sh or sync.ps1)',
    '.claude/settings.json', '.claude/skills/', '.claude/agents/codeforge-implementer.md',
    '.agents/skills/',
    '.codex/config.toml', '.codex/agents/codeforge-implementer.toml',
    '/opencode.json'
  )
}
$block += $giEnd
$out = @($base)
if ($out.Count -gt 0) { $out += '' }
$out += $block
Set-Content -LiteralPath $gi -Value $out

if ($generatedPolicy -ceq 'ignored') {
  Write-Host '  = generated engine adapters are gitignored (regenerate from .codeforge/)'
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $generatedPathspecs = @(
      '.claude/settings.json', '.claude/skills', '.claude/agents/codeforge-implementer.md',
      '.agents/skills', '.codex/config.toml', '.codex/agents/codeforge-implementer.toml',
      'opencode.json'
    )
    $trackedGenerated = @(& git -C $Target ls-files -- @generatedPathspecs 2>$null)
    if ($LASTEXITCODE -eq 0 -and $trackedGenerated.Count -gt 0) {
      Write-Host "  ! generated adapters are ignored for new Git additions, but $($trackedGenerated.Count) path(s) are already tracked."
      Write-Host '    The installer left the Git index unchanged. To untrack them without deleting local files, run:'
      Write-Host '    git rm -r --cached --ignore-unmatch -- .claude/settings.json .claude/skills .claude/agents/codeforge-implementer.md .agents/skills .codex/config.toml .codex/agents/codeforge-implementer.toml opencode.json'
    }
  }
} else {
  Write-Host '  = generated engine adapters remain trackable (fresh clones work immediately)'
}

# --- warn if the generated config lacks the forge push/PR gate ---
function Warn-Gate([string]$rel, [string]$needle, [string]$hint) {
  $f = Join-Path $Target $rel
  if ((Test-Path $f) -and -not (Select-String -Quiet -SimpleMatch $needle $f)) {
    Write-Host "  ! $rel has no forge push/PR gate ($hint) — update .codeforge/configs, then run .codeforge/sync.ps1"
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
foreach ($f in 'CLAUDE.md', 'AGENTS.md', 'PROJECT.md', '.claude/settings.json', '.claude/agents/codeforge-implementer.md', '.codex/config.toml', '.codex/agents/codeforge-implementer.toml', 'opencode.json', '.codeforge/WORKFLOW.md', '.codeforge/agents/codeforge-implementer.md', '.codeforge/skills/new-feature/SKILL.md', '.codeforge/configs/codex/config.toml', '.codeforge/sync.sh', '.codeforge/sync.ps1', '.codeforge/scripts/run-reviewer.mjs', '.codeforge/state.template.md') {
  if (-not (Test-Path (Join-Path $Target $f))) { Write-Host "  ! FAILED: $f was not generated"; $ok = $false }
}
if (-not $ok) {
  [Console]::Error.WriteLine("  x install INCOMPLETE — issues above; NOT marking as installed"); exit 1
}
Write-Host "  + validation: minimal entrypoints, project context, skills, and engine configs generated"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  try {
    $nodeVersion = (& node --version)
    $nodeMajor = if ($nodeVersion -match '^v(\d+)') { [int]$Matches[1] } else { 0 }
  } catch { $nodeMajor = 0; $nodeVersion = 'unknown' }
  if ($nodeMajor -lt 20) {
    Write-Host "  ! Node.js 20+ is required to run cross-engine review/council (found: $nodeVersion)"
  }
} else {
  Write-Host '  ! Node.js 20+ was not found; installation is usable, but cross-engine review/council cannot run until Node is installed'
}

# --- git: the workflow (branches/commits) and ship gates operate on git ---
$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCommand) {
  if ($GitInit) { Exit-CodeforgeError '-GitInit requires git on PATH' }
  Write-Host "  ! git was not found — codeforge's workflow (branches, commits) and ship gates assume git."
  Write-Host "    Install git, then run 'git init' here or re-run with -GitInit."
} else {
  & git -C $Target rev-parse --is-inside-work-tree *> $null
  $insideGit = $LASTEXITCODE -eq 0
  if ($insideGit) {
  # already a git repo — the workflow uses it
  } elseif ($GitInit) {
    & git -C $Target init -q
    if ($LASTEXITCODE -ne 0) { Exit-CodeforgeError "git init failed in $Target" -Code 1 }
    & git -C $Target add -A
    if ($LASTEXITCODE -ne 0) { Exit-CodeforgeError "git add failed in $Target" -Code 1 }
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
}

Write-Host "codeforge installed."
Write-Host "  next: (1) fill PROJECT.md   (2) in Codex, trust the project when prompted"
Write-Host "        (3) open the project in any of Claude Code / Codex / OpenCode"
Write-Host "  customize locally in .codeforge/, then run: pwsh .codeforge/sync.ps1"
Write-Host "  upgrade the framework baseline by re-running this installer with -Upgrade."

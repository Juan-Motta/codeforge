#!/usr/bin/env pwsh
#
# codeforge sync (Windows / PowerShell) — generate each engine's config + skills from the
# neutral source. No symlinks.
#
#   pwsh .codeforge/sync.ps1 [-Out <dir>]
#
# Inputs are read from this script's own directory. When installed under `.codeforge/`, output
# defaults to the project root; in the framework source tree it defaults to in place.
#
# Neutral source layout (read from the script's dir):
#   WORKFLOW.md                   -> installed methodology (`src/CLAUDE.md` in this repo)
#   agents\*.md                   -> native implementation-agent adapters
#   skills\<name>\SKILL.md        -> skills, copied into each engine's discovery dir
#   configs\claude\settings.json  -> .claude\settings.json
#   configs\codex\config.toml     -> .codex\config.toml
#   configs\opencode.json         -> opencode.json (OpenCode reads it from the root)
#
# Skill discovery differs per engine: Claude Code -> .claude\skills; Codex -> .agents\skills;
# OpenCode -> any of .opencode/.claude/.agents. So .claude\skills + .agents\skills covers all.
#
# GENERATED (do NOT hand-edit): CLAUDE.md, AGENTS.md, opencode.json, .claude, .agents, .codex.
# Missing project-owned templates/docs are seeded, never clobbered.
#
param(
  [string]$Out
)
$ErrorActionPreference = 'Stop'
$SrcRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutRoot = if ($Out) {
  $Out
} elseif ((Split-Path -Leaf $SrcRoot) -eq '.codeforge') {
  Split-Path -Parent $SrcRoot
} else {
  $SrcRoot
}

# The development payload keeps this file as CLAUDE.md because its skill index is linted there;
# installation names the same content WORKFLOW.md to make its engine-neutral role explicit.
$workflow = Join-Path $SrcRoot 'WORKFLOW.md'
if (-not (Test-Path $workflow)) { $workflow = Join-Path $SrcRoot 'CLAUDE.md' }

# validate required inputs BEFORE mutating anything
if (-not (Test-Path (Join-Path $SrcRoot 'skills'))) {
  Write-Host "error: no skills\ base found in $SrcRoot"; exit 2
}
if (-not (Test-Path $workflow)) {
  Write-Host "error: no WORKFLOW.md found in $SrcRoot"; exit 2
}
$agentBodyPath = Join-Path $SrcRoot 'agents\codeforge-implementer.md'
if (-not (Test-Path $agentBodyPath)) {
  Write-Host "error: no codeforge implementer contract found in $SrcRoot\agents"; exit 2
}
$agentBody = Get-Content -LiteralPath $agentBodyPath -Raw
if ($agentBody.Contains("'''")) {
  Write-Host "error: agents\codeforge-implementer.md contains TOML multiline delimiter '''"; exit 2
}

New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null
$OutRoot = (Resolve-Path $OutRoot).Path

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
    [Console]::Error.WriteLine("refusing managed symlink/reparse path: $Path")
    exit 2
  }
}

foreach ($relative in @(
  '.claude', '.agents', '.codex', 'docs',
  '.claude/skills', '.claude/agents', '.agents/skills', '.codex/agents',
  'docs/prds', 'docs/plans', 'docs/research', 'docs/solutions', 'docs/adr', 'docs/e2e',
  'docs/e2e/reports', 'docs/e2e/use-cases', 'docs/ci-templates',
  'PROJECT.md', 'CONTINUITY.md', 'docs/CHANGELOG.md'
)) {
  Assert-CodeforgeSafeManagedPath -Path (Join-Path $OutRoot $relative)
}
$sourceCiTemplates = Join-Path $SrcRoot 'docs\ci-templates'
if (Test-Path -LiteralPath $sourceCiTemplates -PathType Container) {
  foreach ($template in Get-ChildItem -LiteralPath $sourceCiTemplates -File -Force) {
    Assert-CodeforgeSafeManagedPath -Path (Join-Path $OutRoot "docs\ci-templates\$($template.Name)")
  }
}
foreach ($scaffold in 'prds', 'plans', 'research', 'solutions', 'adr', 'e2e/reports', 'e2e/use-cases') {
  Assert-CodeforgeSafeManagedPath -Path (Join-Path $OutRoot "docs\$scaffold\.gitkeep")
}

function Write-CodeforgeGenerated {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
  )
  if (Test-Path -LiteralPath $Path -PathType Container) {
    [Console]::Error.WriteLine("generated file destination resolves to a directory: $Path")
    exit 2
  }
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $temporary = Join-Path $parent ('.codeforge-write.' + [Guid]::NewGuid().ToString('N'))
  try {
    $normalized = $Content -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($temporary, $normalized, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Move($temporary, $Path, $true)
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Assert-CodeforgeGeneratedEntrypoint {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ((Test-Path -LiteralPath $Path -PathType Leaf) -and
      -not (Test-CodeforgeReparsePoint -Path $Path) -and
      -not (Select-String -LiteralPath $Path -SimpleMatch 'codeforge:entrypoint' -Quiet)) {
    $adoptedBackup = Join-Path $SrcRoot "backups/$([System.IO.Path]::GetFileName($Path)).pre-codeforge.bak"
    $installedSource = ([System.IO.Path]::GetFileName($SrcRoot) -eq '.codeforge') -and
      ([System.IO.Path]::GetFullPath($OutRoot) -eq [System.IO.Path]::GetFullPath((Split-Path -Parent $SrcRoot)))
    if ($installedSource -and (Test-Path -LiteralPath $adoptedBackup -PathType Leaf)) { return }
    [Console]::Error.WriteLine("refusing to replace non-codeforge entrypoint: $Path (run the installer to adopt it)")
    exit 2
  }
}

# Minimal engine entrypoints. Claude expands @ imports natively; Codex/OpenCode receive an
# explicit bootstrap because AGENTS.md has no portable include syntax.
$rootClaude = Join-Path $OutRoot 'CLAUDE.md'
$rootAgents = Join-Path $OutRoot 'AGENTS.md'
$installedWorkflow = Join-Path $OutRoot '.codeforge/WORKFLOW.md'
$workflowReference = if ([System.IO.Path]::GetFullPath($workflow) -eq [System.IO.Path]::GetFullPath($installedWorkflow)) {
  '.codeforge/WORKFLOW.md'
} else {
  [System.IO.Path]::GetFullPath($workflow)
}
if ([System.IO.Path]::GetFullPath($workflow) -ne [System.IO.Path]::GetFullPath($rootClaude)) {
  Assert-CodeforgeGeneratedEntrypoint -Path $rootClaude
}
Assert-CodeforgeGeneratedEntrypoint -Path $rootAgents

$claudeEntrypoint = @"
# Project agent entrypoint

<!-- codeforge:entrypoint -->

@PROJECT.md
@$workflowReference
"@
if ([System.IO.Path]::GetFullPath($workflow) -ne [System.IO.Path]::GetFullPath($rootClaude)) {
  Write-CodeforgeGenerated -Path $rootClaude -Content ($claudeEntrypoint + "`n")
}

$agentsEntrypoint = @"
# Project agent entrypoint

<!-- codeforge:entrypoint -->

Before analyzing, planning, or modifying this project, read and follow:

1. ``PROJECT.md`` — project context, architecture, commands, and conventions.
2. ``$workflowReference`` — required development workflow and ship discipline.

If they conflict, the safety and ship rules in ``$workflowReference`` take precedence.
"@
Write-CodeforgeGenerated -Path $rootAgents -Content ($agentsEntrypoint + "`n")

# skills -> each engine's discovery dir (full mirror: replace so deletions propagate).
# .claude\skills = Claude Code (+ OpenCode); .agents\skills = Codex (+ OpenCode).
foreach ($dir in '.claude', '.agents') {
  $dirPath = Join-Path $OutRoot $dir
  New-Item -ItemType Directory -Force -Path $dirPath | Out-Null
  $skillsPath = Join-Path $dirPath 'skills'
  if (Test-Path $skillsPath) { Remove-Item -Recurse -Force $skillsPath }
  Copy-Item -Recurse (Join-Path $SrcRoot 'skills') $skillsPath
  # ownership marker: lets the installer tell a forge-generated dir from the user's own,
  # so it never wipes a user's skills (even one coincidentally named new-feature).
  Set-Content -Path (Join-Path $skillsPath '.codeforge-generated') -Value 'generated by codeforge sync — do not edit; edit .codeforge/skills instead'
}

# One neutral contract -> Claude Code and Codex native formats. Generate regardless of the
# PROJECT.md execution mode so switching modes never requires reinstalling.
$claudeAgents = Join-Path $OutRoot '.claude\agents'
$codexAgents = Join-Path $OutRoot '.codex\agents'
New-Item -ItemType Directory -Force -Path $claudeAgents, $codexAgents | Out-Null
$claudeAgent = @"
---
name: codeforge-implementer
description: Implements exactly one bounded task from the active codeforge plan using TDD and the dispatch brief's owner and commit_policy.
---

<!-- codeforge:generated-agent — edit .codeforge/agents/codeforge-implementer.md, then sync -->

$($agentBody.TrimEnd())
"@
Write-CodeforgeGenerated -Path (Join-Path $claudeAgents 'codeforge-implementer.md') -Content ($claudeAgent + "`n")

$codexAgent = @"
# codeforge:generated-agent — edit .codeforge/agents/codeforge-implementer.md, then sync
name = "codeforge-implementer"
description = "Implements exactly one bounded task from the active codeforge plan using TDD and the dispatch brief's owner and commit_policy."
sandbox_mode = "workspace-write"
developer_instructions = '''
$($agentBody.TrimEnd())
'''
"@
Write-CodeforgeGenerated -Path (Join-Path $codexAgents 'codeforge-implementer.toml') -Content ($codexAgent + "`n")

# per-engine config, placed where each engine looks for it
New-Item -ItemType Directory -Force -Path (Join-Path $OutRoot '.claude'), (Join-Path $OutRoot '.codex') | Out-Null
$cClaude = Join-Path $SrcRoot 'configs\claude\settings.json'
if (Test-Path $cClaude) { Write-CodeforgeGenerated -Path (Join-Path $OutRoot '.claude\settings.json') -Content (Get-Content -LiteralPath $cClaude -Raw) }
$cCodex = Join-Path $SrcRoot 'configs\codex\config.toml'
if (Test-Path $cCodex) { Write-CodeforgeGenerated -Path (Join-Path $OutRoot '.codex\config.toml') -Content (Get-Content -LiteralPath $cCodex -Raw) }
$cOpen = Join-Path $SrcRoot 'configs\opencode.json'
if (Test-Path $cOpen) { Write-CodeforgeGenerated -Path (Join-Path $OutRoot 'opencode.json') -Content (Get-Content -LiteralPath $cOpen -Raw) }

# Project-owned artifacts are seed-only. Re-running sync restores missing scaffolding without
# overwriting project knowledge or configuration.
$projectTemplate = Join-Path $SrcRoot 'templates\PROJECT.md'
if ((-not (Test-Path (Join-Path $OutRoot 'PROJECT.md'))) -and (Test-Path $projectTemplate)) {
  Copy-Item $projectTemplate (Join-Path $OutRoot 'PROJECT.md')
}
$continuityTemplate = Join-Path $SrcRoot 'templates\CONTINUITY.md'
if ((-not (Test-Path (Join-Path $OutRoot 'CONTINUITY.md'))) -and (Test-Path $continuityTemplate)) {
  Copy-Item $continuityTemplate (Join-Path $OutRoot 'CONTINUITY.md')
}
$sourceDocs = Join-Path $SrcRoot 'docs'
if (Test-Path $sourceDocs) {
  $targetDocs = Join-Path $OutRoot 'docs'
  New-Item -ItemType Directory -Force -Path $targetDocs | Out-Null
  foreach ($d in 'prds', 'plans', 'research', 'solutions', 'adr', 'e2e/reports', 'e2e/use-cases') {
    $dir = Join-Path $targetDocs $d
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $keep = Join-Path $dir '.gitkeep'
    if (-not (Test-Path $keep)) { New-Item -ItemType File -Path $keep | Out-Null }
  }
  $sourceChangelog = Join-Path $sourceDocs 'CHANGELOG.md'
  $targetChangelog = Join-Path $targetDocs 'CHANGELOG.md'
  if ((-not (Test-Path $targetChangelog)) -and (Test-Path $sourceChangelog)) {
    Copy-Item $sourceChangelog $targetChangelog
  }
  $sourceCi = Join-Path $sourceDocs 'ci-templates'
  if (Test-Path $sourceCi) {
    $targetCi = Join-Path $targetDocs 'ci-templates'
    New-Item -ItemType Directory -Force -Path $targetCi | Out-Null
    foreach ($f in Get-ChildItem -LiteralPath $sourceCi -File -Force) {
      $dst = Join-Path $targetCi $f.Name
      if (-not (Test-Path $dst)) { Copy-Item -LiteralPath $f.FullName -Destination $dst }
    }
  }
}

Write-Host "codeforge sync: generated engine adapters and ensured project scaffolding in $OutRoot"

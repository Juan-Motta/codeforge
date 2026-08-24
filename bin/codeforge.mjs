#!/usr/bin/env node
// codeforge — npx entry point. Thin wrapper that runs the platform installer
// bundled in this package (install.sh on POSIX, install.ps1 on Windows),
// passing through all arguments. The payload (src/, VERSION) travels in the
// package, so `npx @jualopezmo/codeforge [target] [--upgrade]` works with no repo clone.
//
//   npx @jualopezmo/codeforge                 # install into the current directory
//   npx @jualopezmo/codeforge ./my-project    # install into a target
//   npx @jualopezmo/codeforge --upgrade       # refresh an existing install
//   npx @jualopezmo/codeforge --version       # print the codeforge version

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { installerFlags } from '../cli/lib/flags.mjs';
import { finalizeInstallerRun, runInstaller } from '../cli/lib/run-installer.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function version() {
  try {
    return readFileSync(join(pkgRoot, 'VERSION'), 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(version());
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(`codeforge ${version()} — install the cross-engine workflow discipline into a project.

  npx @jualopezmo/codeforge [target-dir] [--upgrade] [--git-init] [--no-isolate]
                              [--ignore-generated | --track-generated]

  target-dir    where to install (default: current directory)
  --upgrade     refresh framework files in an existing install
  --git-init    if the target is not a git repo, initialize one + baseline commit
  --no-isolate  keep inheriting ancestor CLAUDE.md (default: auto-isolate via claudeMdExcludes)
  --ignore-generated  gitignore only the engine artifacts regenerated from .codeforge
  --track-generated   keep generated adapters in Git (default; clones work immediately)
  --version     print the codeforge version`);
  process.exit(0);
}

// Only a truly argument-free TTY invocation opens the wizard. Any option, including an unknown
// one, is delegated to the platform installer so removed APIs fail with its usage error.
const interactive = process.stdin.isTTY && process.stdout.isTTY && args.length === 0;

if (interactive) {
  const { runWizard } = await import('../cli/index.mjs');
  const { applyAll } = await import('../cli/lib/apply.mjs');
  const answers = await runWizard(version());
  if (!answers) { console.log('codeforge: setup cancelled.'); process.exit(0); }
  const r = runInstaller(pkgRoot, installerFlags(answers));
  if (r.error) {
    const hint = process.platform === 'win32' ? 'PowerShell 7 (pwsh) is required on Windows.' : '';
    console.error(`codeforge: could not launch ${r.cmd}: ${r.error.message}. ${hint}`.trim());
    process.exit(1);
  }
  const final = finalizeInstallerRun(r, () => applyAll(answers.target, answers));
  if (final.applyError) {
    console.error(`codeforge: installed, but applying config failed: ${final.applyError.message}`);
  }
  process.exit(final.status);
} else {
  // Non-interactive (flags/target/CI/pipe): delegate straight to the installer. --yes and
  // --non-interactive are bin-level "skip the wizard" signals only — install.sh doesn't
  // accept them, so they're stripped before being passed through.
  const installerArgs = args.filter((a) => a !== '--yes' && a !== '--non-interactive');
  const r = runInstaller(pkgRoot, installerArgs);
  if (r.error) {
    const hint = process.platform === 'win32' ? 'PowerShell 7 (pwsh) is required on Windows.' : '';
    console.error(`codeforge: could not launch ${r.cmd}: ${r.error.message}. ${hint}`.trim());
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

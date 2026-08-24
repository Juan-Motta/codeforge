import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const catalog = JSON.parse(readFileSync(join(here, 'models-catalog.json'), 'utf8'));

export function installerFlags(answers) {
  const out = [answers.target];
  if (answers.gitInit) out.push('--git-init');
  if (answers.noIsolate) out.push('--no-isolate');
  out.push(answers.ignoreGenerated ? '--ignore-generated' : '--track-generated');
  return out;
}

// Emits ONLY tokens install.sh actually accepts (target + --yes + install flags).
// Review policy / profile are applied by the wizard's post-install edits and
// have no non-interactive equivalent today — see Summary.mjs's caveat text.
export function nonInteractiveCommand(answers) {
  // The wizard installs into its current directory, already shown separately in the summary.
  // `.` is portable across POSIX and PowerShell; embedding the absolute path would require
  // incompatible shell-specific quoting when it contains spaces or metacharacters.
  const parts = ['npx @jualopezmo/codeforge', '.', '--yes'];
  if (answers.gitInit) parts.push('--git-init');
  if (answers.noIsolate) parts.push('--no-isolate');
  parts.push(answers.ignoreGenerated ? '--ignore-generated' : '--track-generated');
  return parts.join(' ');
}

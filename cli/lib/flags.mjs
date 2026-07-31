import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const catalog = JSON.parse(readFileSync(join(here, 'models-catalog.json'), 'utf8'));

const INSTALL_FLAGS = new Set([
  '--upgrade', '--with-hooks', '--git-init', '--no-isolate', '--yes', '--non-interactive',
]);
const INFO_FLAGS = new Set(['--version', '-v', '--help', '-h']);

export function hasInstallIntent(argv) {
  for (const a of argv) {
    if (INFO_FLAGS.has(a)) return false;
  }
  return argv.some((a) => INSTALL_FLAGS.has(a) || !a.startsWith('-'));
}

export function installerFlags(answers) {
  const out = [answers.target];
  if (answers.gitInit) out.push('--git-init');
  if (answers.noIsolate) out.push('--no-isolate');
  return out;
}

// Emits ONLY tokens install.sh actually accepts (target + --yes + the four install
// flags). Review policy / profile are applied by the wizard's post-install edits and
// have no non-interactive equivalent today — see Summary.mjs's caveat text.
export function nonInteractiveCommand(answers) {
  const parts = ['npx @jualopezmo/codeforge', answers.target, '--yes'];
  if (answers.gitInit) parts.push('--git-init');
  if (answers.noIsolate) parts.push('--no-isolate');
  return parts.join(' ');
}

export default catalog;

import { basename } from 'node:path';

export function makeDefaultAnswers(cwd) {
  return {
    target: cwd,
    // Per-engine model + which engines fill each role. Reviewers answer a bare "review";
    // council advisors run in a /council. Both reference `models`.
    models: {
      codex: { model: 'gpt-5.6-sol', effort: 'xhigh' },
      claude: { model: 'opus', effort: 'high' },
    },
    reviewers: ['codex', 'claude'],
    council: ['codex', 'claude'],
    profile: 'standard',
    gitInit: false,
    noIsolate: false,
    // Generated engine adapters may be committed for zero-step clones or ignored and rebuilt.
    ignoreGenerated: false,
    // Project-wide strategy. Native Claude/Codex adapters inherit their active model defaults.
    execution: { mode: 'inline' },
    project: { persona: '', info: `Project: ${basename(cwd)}`, rules: '' },
  };
}

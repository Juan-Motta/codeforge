const BASE_STEPS = ['splash', 'review', 'gates', 'project', 'versioning'];

export function supportsNativeImplementationSubagents(engines) {
  return Boolean(engines?.claude?.installed || engines?.codex?.installed);
}

export function wizardSteps(engines = {}) {
  return [
    ...BASE_STEPS,
    ...(supportsNativeImplementationSubagents(engines) ? ['execution'] : []),
    'summary',
  ];
}

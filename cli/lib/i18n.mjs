// Wizard copy in English + Spanish. t(lang) returns the whole string tree for that
// language (falling back to English). Parameterized strings are functions.
const en = {
  splash: {
    tagline: 'cross-engine workflow discipline',
    detected: 'detected',
    langPrompt: 'Language · Idioma',
  },
  review: {
    title: '⚒  Default review policy',
    subtitle: 'Which engine answers a bare "review"? (you pick its model next)',
    engineDefault: (k, model) => `${k.padEnd(9)}  default ${model}`,
    modelTitle: (eng) => `⚒  Model for ${eng}`,
    modelSubtitle: (eng) => `Used whenever ${eng} reviews (e.g. "review with ${eng}").`,
    crumb: 'default reviewer: ',
    customOption: '✎  custom model id…',
    customTitle: (eng) => `⚒  Custom model for ${eng}`,
    customSubtitle: 'Type any model id this engine accepts, then press Enter.',
    modelField: 'model: ',
    perEngineSubtitle: 'Choose one model per engine (used when it reviews or advises). Skip engines you won\'t use.',
    skipOption: '— don\'t use this engine —',
    reviewersTitle: '⚒  Default reviewers',
    reviewersSubtitle: 'Which engine(s) answer a bare "review"? Pick 1–3.',
    councilTitle: '⚒  Council advisors',
    councilSubtitle: 'Which engines run in a /council? Pick any — diversity is the point.',
  },
  gates: {
    title: '⚒  Ship-gates',
    subtitle: 'A checklist in .codeforge/workflow/state.md must be complete before git push / PR. Profile sets how many gates are required (a default — each workflow can override).',
    standard: 'standard   6 gates · full features & bug fixes',
    light: 'light      3 gates · quick-fix / trivial changes',
  },
  project: {
    title: '⚒  Project',
    target: 'Target: ',
    rulesLabel: 'Special rules (optional): ',
    rulesPlaceholder: 'e.g. never touch prod',
  },
  summary: {
    title: '⚒  Review & confirm',
    target: 'Target: ',
    profile: (p) => `Profile: ${p}`,
    reviewers: (l) => `Default reviewers: ${l || '(none)'}`,
    council: (l) => `Council advisors: ${l || '(none)'}`,
    execution: (m) => `Execution: ${m}`,
    repro: 'Equivalent non-interactive install (defaults — review policy is wizard-only for now):',
  },
  claude: {
    title: '⚒  Claude subagents (advanced)',
    subtitle: 'Claude-only: how the driver runs a multi-task plan. Subagent-driven dispatches a fresh subagent per task (isolated context) at a model you choose.',
    inline: 'Inline — the driver does each task in its own turn (default)',
    subagent: 'Subagent-driven — dispatch a fresh subagent per task',
    modelTitle: '⚒  Subagent model',
    modelSubtitle: 'Model each dispatched implementation subagent runs with.',
  },
  ui: { move: 'move', select: 'select', enter: 'Enter', confirm: 'confirm', install: 'install', cancel: 'cancel', begin: 'begin', space: 'space', toggle: 'toggle' },
};

const es = {
  splash: {
    tagline: 'disciplina de workflow cross-engine',
    detected: 'detectados',
    langPrompt: 'Idioma · Language',
  },
  review: {
    title: '⚒  Política de review por defecto',
    subtitle: '¿Qué engine responde a un "revisa" a secas? (el modelo se elige después)',
    engineDefault: (k, model) => `${k.padEnd(9)}  por defecto ${model}`,
    modelTitle: (eng) => `⚒  Modelo para ${eng}`,
    modelSubtitle: (eng) => `Se usa cuando ${eng} revisa (ej. "revisa con ${eng}").`,
    crumb: 'reviewer por defecto: ',
    customOption: '✎  id de modelo personalizado…',
    customTitle: (eng) => `⚒  Modelo personalizado para ${eng}`,
    customSubtitle: 'Escribe cualquier id de modelo que acepte este engine y presiona Enter.',
    modelField: 'modelo: ',
    perEngineSubtitle: 'Elige un modelo por engine (se usa cuando revisa o asesora). Omite los engines que no uses.',
    skipOption: '— no usar este engine —',
    reviewersTitle: '⚒  Reviewers por defecto',
    reviewersSubtitle: '¿Qué engine(s) responden a un "revisa" a secas? Elige 1–3.',
    councilTitle: '⚒  Advisors del council',
    councilSubtitle: '¿Qué engines corren en un /council? Elige los que quieras — la diversidad es el punto.',
  },
  gates: {
    title: '⚒  Ship-gates',
    subtitle: 'Un checklist en .codeforge/workflow/state.md debe estar completo antes de git push / PR. El perfil define cuántos gates se exigen (un valor por defecto — cada workflow puede cambiarlo).',
    standard: 'standard   6 gates · features y bugfixes completos',
    light: 'light      3 gates · quick-fix / cambios triviales',
  },
  project: {
    title: '⚒  Proyecto',
    target: 'Destino: ',
    rulesLabel: 'Reglas especiales (opcional): ',
    rulesPlaceholder: 'ej. nunca tocar prod',
  },
  summary: {
    title: '⚒  Revisar y confirmar',
    target: 'Destino: ',
    profile: (p) => `Perfil: ${p}`,
    reviewers: (l) => `Reviewers por defecto: ${l || '(ninguno)'}`,
    council: (l) => `Council advisors: ${l || '(ninguno)'}`,
    execution: (m) => `Ejecución: ${m}`,
    repro: 'Instalación no-interactiva equivalente (defaults — la política de review es solo del wizard por ahora):',
  },
  claude: {
    title: '⚒  Subagentes de Claude (avanzado)',
    subtitle: 'Solo Claude: cómo el driver ejecuta un plan multi-task. Subagent-driven despacha un subagente fresco por task (contexto aislado) con el modelo que elijas.',
    inline: 'Inline — el driver hace cada task en su propio turno (por defecto)',
    subagent: 'Subagent-driven — despacha un subagente fresco por task',
    modelTitle: '⚒  Modelo de subagente',
    modelSubtitle: 'Modelo con el que corre cada subagente de implementación despachado.',
  },
  ui: { move: 'mover', select: 'elegir', enter: 'Enter', confirm: 'confirmar', install: 'instalar', cancel: 'cancelar', begin: 'empezar', space: 'espacio', toggle: 'marcar' },
};

const dict = { en, es };
export const LANGS = [
  { key: 'en', label: 'English', value: 'en' },
  { key: 'es', label: 'Español', value: 'es' },
];
export const t = (lang) => dict[lang] ?? en;

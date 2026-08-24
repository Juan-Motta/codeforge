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
  versioning: {
    title: '⚒  Generated adapters',
    subtitle: 'Choose whether Git stores the engine-specific copies. Canonical files and project context are always kept.',
    track: 'Keep in Git (recommended) · clones work immediately',
    ignore: 'Ignore · regenerate locally from .codeforge',
  },
  summary: {
    title: '⚒  Review & confirm',
    target: 'Target: ',
    profile: (p) => `Profile: ${p}`,
    reviewers: (l) => `Default reviewers: ${l || '(none)'}`,
    council: (l) => `Council advisors: ${l || '(none)'}`,
    execution: (m) => `Execution: ${m}`,
    generated: (ignored) => `Generated adapters: ${ignored ? 'ignored' : 'tracked'}`,
    repro: 'Equivalent non-interactive install (run from the target directory; review policy is wizard-only for now):',
  },
  execution: {
    title: '⚒  Implementation strategy',
    subtitle: 'Claude Code and Codex can delegate each bounded plan task to a fresh native implementer. The active engine model is inherited.',
    inline: 'Inline — the driver does each task in its own turn (default)',
    subagent: 'Subagent-driven — dispatch a fresh subagent per task',
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
  versioning: {
    title: '⚒  Adaptadores generados',
    subtitle: 'Elige si Git guarda las copias para cada engine. Los archivos canónicos y el contexto siempre se conservan.',
    track: 'Mantener en Git (recomendado) · los clones funcionan de inmediato',
    ignore: 'Ignorar · regenerar localmente desde .codeforge',
  },
  summary: {
    title: '⚒  Revisar y confirmar',
    target: 'Destino: ',
    profile: (p) => `Perfil: ${p}`,
    reviewers: (l) => `Reviewers por defecto: ${l || '(ninguno)'}`,
    council: (l) => `Council advisors: ${l || '(ninguno)'}`,
    execution: (m) => `Ejecución: ${m}`,
    generated: (ignored) => `Adaptadores generados: ${ignored ? 'ignorados' : 'versionados'}`,
    repro: 'Instalación no-interactiva equivalente (ejecutar desde el directorio destino; la política de review es solo del wizard por ahora):',
  },
  execution: {
    title: '⚒  Estrategia de implementación',
    subtitle: 'Claude Code y Codex pueden delegar cada task acotada del plan a un implementador nativo nuevo. Se hereda el modelo activo del engine.',
    inline: 'Inline — el driver hace cada task en su propio turno (por defecto)',
    subagent: 'Subagent-driven — despacha un subagente fresco por task',
  },
  ui: { move: 'mover', select: 'elegir', enter: 'Enter', confirm: 'confirmar', install: 'instalar', cancel: 'cancelar', begin: 'empezar', space: 'espacio', toggle: 'marcar' },
};

const dict = { en, es };
export const LANGS = [
  { key: 'en', label: 'English', value: 'en' },
  { key: 'es', label: 'Español', value: 'es' },
];
export const t = (lang) => dict[lang] ?? en;

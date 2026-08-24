import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { catalog } from '../lib/flags.mjs';
import { optionsFor, CUSTOM } from '../lib/models.mjs';
import { t } from '../lib/i18n.mjs';
import { theme } from '../assets/anvil.ans.mjs';
import { Card, Item, Indicator, MultiSelect, moveSelectFooter, enterFooter, multiFooter } from './ui.mjs';

const e = React.createElement;
const SKIP = '__skip__';
const ENGINES = Object.keys(catalog); // ['codex','claude','opencode']
const fmt = (o) => `${o.model}${o.effort ? ' · ' + o.effort : ''}`;
const engineLabel = (en, models) => `${en.padEnd(9)}  ${models[en] ? fmt(models[en]) : ''}`;

// Prefer two configured engines so accepting the default still leaves a non-driver reviewer.
// Catalog order keeps Codex + Claude ahead of OpenCode when all three are configured; OpenCode
// remains available but is never enabled as an implicit third reviewer.
export function defaultReviewerSelection(configured) {
  return configured.slice(0, 2);
}

export default function ReviewPolicy({ answers, setAnswers, onNext, lang }) {
  const { review: r, ui } = t(lang);
  const [phase, setPhase] = React.useState('models'); // models → reviewers → council
  const [mi, setMi] = React.useState(0);
  const [models, setModels] = React.useState({});
  const [custom, setCustom] = React.useState(false);
  const [text, setText] = React.useState('');
  const [reviewers, setReviewers] = React.useState([]);

  // ── Phase A: pick one model per engine (or skip) ──────────────────────────
  if (phase === 'models') {
    const engine = ENGINES[mi];
    const crumb = e(Text, { color: theme.steelDim }, [
      `${mi + 1}/${ENGINES.length}  `, e(Text, { key: 'e', color: theme.moltenHot, bold: true }, engine),
    ]);
    const advance = (modelObj) => {
      const nextModels = modelObj ? { ...models, [engine]: modelObj } : models;
      setModels(nextModels);
      if (mi + 1 < ENGINES.length) { setMi(mi + 1); setCustom(false); setText(''); return; }
      // Guarantee at least one configured engine before choosing roles.
      if (Object.keys(nextModels).length === 0) setModels({ codex: catalog.codex.default });
      setPhase('reviewers');
    };

    if (custom) {
      return e(Card, { title: r.customTitle(engine), subtitle: r.customSubtitle, crumb, footer: enterFooter(ui, ui.confirm) },
        e(Box, null,
          e(Text, { color: theme.text }, r.modelField),
          e(TextInput, {
            value: text,
            onChange: setText,
            placeholder: catalog[engine]?.default?.model ?? 'model-id',
            onSubmit: () => { const m = text.trim() || catalog[engine]?.default?.model; if (m) advance({ model: m, effort: null }); },
          })));
    }

    const items = [
      ...optionsFor(engine).map((o) => ({ key: fmt(o), label: fmt(o), value: o })),
      { key: CUSTOM, label: r.customOption, value: CUSTOM },
      { key: SKIP, label: r.skipOption, value: SKIP },
    ];
    return e(Card, { title: r.modelTitle(engine), subtitle: r.perEngineSubtitle, crumb, footer: moveSelectFooter(ui) },
      e(SelectInput, {
        items,
        limit: 8,
        itemComponent: Item,
        indicatorComponent: Indicator,
        onSelect: (i) => {
          if (i.value === CUSTOM) { setCustom(true); return; }
          advance(i.value === SKIP ? null : i.value);
        },
      }));
  }

  const configured = ENGINES.filter((en) => models[en]);
  const roleItems = configured.map((en) => ({ key: en, label: engineLabel(en, models), value: en }));

  // ── Phase B: which engines are default reviewers (1–3) ────────────────────
  if (phase === 'reviewers') {
    return e(Card, { title: r.reviewersTitle, subtitle: r.reviewersSubtitle, footer: multiFooter(ui) },
      e(MultiSelect, {
        items: roleItems,
        initial: defaultReviewerSelection(configured),
        minSelect: 1,
        onConfirm: (sel) => { setReviewers(sel); setPhase('council'); },
      }));
  }

  // ── Phase C: which engines are council advisors ───────────────────────────
  return e(Card, { title: r.councilTitle, subtitle: r.councilSubtitle, footer: multiFooter(ui) },
    e(MultiSelect, {
      items: roleItems,
      initial: configured, // default: all configured engines advise
      onConfirm: (sel) => { setAnswers({ ...answers, models, reviewers, council: sel }); onNext(); },
    }));
}

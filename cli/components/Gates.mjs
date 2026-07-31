import React from 'react';
import SelectInput from 'ink-select-input';
import { t } from '../lib/i18n.mjs';
import { Card, Item, Indicator, moveSelectFooter } from './ui.mjs';

const e = React.createElement;

// Default gate profile. (The opt-in hard-block hook was retired — enforcement is the CI
// Verified tier; see docs/ci-templates/.)
export default function Gates({ answers, setAnswers, onNext, lang }) {
  const { gates: g, ui } = t(lang);
  const items = [
    { key: 'standard', label: g.standard, value: 'standard' },
    { key: 'light', label: g.light, value: 'light' },
  ];
  return e(Card, { title: g.title, subtitle: g.subtitle, footer: moveSelectFooter(ui) },
    e(SelectInput, {
      items,
      itemComponent: Item,
      indicatorComponent: Indicator,
      onSelect: (i) => { setAnswers({ ...answers, profile: i.value }); onNext(); },
    }));
}

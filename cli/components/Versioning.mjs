import React from 'react';
import SelectInput from 'ink-select-input';
import { t } from '../lib/i18n.mjs';
import { Card, Item, Indicator, moveSelectFooter } from './ui.mjs';

const e = React.createElement;

export default function Versioning({ answers, setAnswers, onNext, lang }) {
  const { versioning: v, ui } = t(lang);
  const items = [
    { key: 'track', label: v.track, value: false },
    { key: 'ignore', label: v.ignore, value: true },
  ];
  return e(Card, { title: v.title, subtitle: v.subtitle, footer: moveSelectFooter(ui) },
    e(SelectInput, {
      items,
      itemComponent: Item,
      indicatorComponent: Indicator,
      onSelect: (i) => { setAnswers({ ...answers, ignoreGenerated: i.value }); onNext(); },
    }));
}

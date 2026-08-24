import React from 'react';
import SelectInput from 'ink-select-input';
import { t } from '../lib/i18n.mjs';
import { Card, Item, Indicator, moveSelectFooter } from './ui.mjs';

const e = React.createElement;

export function withExecutionMode(answers, mode) {
  return { ...answers, execution: { mode } };
}

// Project-wide implementation strategy. Claude Code and Codex use their generated native
// implementer adapters; unsupported harnesses follow the documented inline fallback.
export default function Execution({ answers, setAnswers, onNext, lang }) {
  const { execution: x, ui } = t(lang);
  const items = [
    { key: 'inline', label: x.inline, value: 'inline' },
    { key: 'subagent-driven', label: x.subagent, value: 'subagent-driven' },
  ];
  return e(Card, { title: x.title, subtitle: x.subtitle, footer: moveSelectFooter(ui) },
    e(SelectInput, {
      items,
      itemComponent: Item,
      indicatorComponent: Indicator,
      onSelect: (item) => {
        setAnswers(withExecutionMode(answers, item.value));
        onNext();
      },
    }));
}

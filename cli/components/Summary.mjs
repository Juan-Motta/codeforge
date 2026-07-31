import React from 'react';
import { Box, Text, useInput } from 'ink';
import { nonInteractiveCommand } from '../lib/flags.mjs';
import { t } from '../lib/i18n.mjs';
import { theme } from '../assets/anvil.ans.mjs';
import { Card } from './ui.mjs';

const e = React.createElement;

export default function Summary({ answers, onNext, lang }) {
  const { summary: s, ui } = t(lang);
  useInput((input, key) => { if (key.return) onNext(true); if (input === 'q') onNext(false); });
  const cmd = nonInteractiveCommand(answers);
  const footer = [
    e(Text, { key: 'e', color: theme.molten, bold: true }, ui.enter), ` ${ui.install}    `,
    e(Text, { key: 'q', color: theme.molten, bold: true }, 'q'), ` ${ui.cancel}`,
  ];
  return e(Card, { title: s.title, footer },
    e(Box, { flexDirection: 'column' },
      e(Text, { color: theme.steelDim }, [s.target, e(Text, { key: 't', color: theme.text }, answers.target)]),
      e(Text, { color: theme.text }, s.profile(answers.profile)),
      e(Text, { color: theme.text }, s.reviewers((answers.reviewers || []).join(', '))),
      e(Text, { color: theme.text }, s.council((answers.council || []).join(', '))),
      e(Text, { color: theme.text }, s.execution(
        answers.claude?.subagents ? `subagent-driven (${answers.claude.model?.model})` : 'inline')),
      e(Box, { marginTop: 1, flexDirection: 'column' },
        e(Text, { color: theme.molten }, s.repro),
        e(Text, { wrap: 'wrap', color: theme.steel }, cmd))));
}

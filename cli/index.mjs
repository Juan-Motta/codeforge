import React from 'react';
import { render, Box, useStdout } from 'ink';
import { makeDefaultAnswers } from './state.mjs';
import { detectAll } from './lib/detect.mjs';
import Splash from './components/Splash.mjs';
import ReviewPolicy from './components/ReviewPolicy.mjs';
import Gates from './components/Gates.mjs';
import Project from './components/Project.mjs';
import ClaudeAgents from './components/ClaudeAgents.mjs';
import Summary from './components/Summary.mjs';

const e = React.createElement;

// Track terminal size so the root Box can fill the whole screen and re-flow on resize.
function useTerminalSize() {
  const { stdout } = useStdout();
  const read = () => ({ columns: stdout?.columns || 80, rows: stdout?.rows || 24 });
  const [size, setSize] = React.useState(read);
  React.useEffect(() => {
    if (!stdout) return undefined;
    const onResize = () => setSize(read());
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);
  return size;
}

function Wizard({ version, resolve }) {
  const { columns, rows } = useTerminalSize();
  const engines = React.useMemo(() => detectAll(), []);
  // The Claude-subagents step only exists when Claude is installed.
  const STEPS = React.useMemo(
    () => ['splash', 'review', 'gates', 'project', ...(engines?.claude?.installed ? ['claude'] : []), 'summary'],
    [engines],
  );
  const [lang, setLang] = React.useState('en');
  const [answers, setAnswers] = React.useState(makeDefaultAnswers(process.cwd()));
  const [i, setI] = React.useState(0);
  const next = () => setI((n) => Math.min(n + 1, STEPS.length - 1));
  const step = STEPS[i];

  let screen;
  if (step === 'splash') screen = e(Splash, { version, engines, onNext: (l) => { setLang(l); next(); } });
  else if (step === 'review') screen = e(ReviewPolicy, { answers, setAnswers, lang, onNext: next });
  else if (step === 'gates') screen = e(Gates, { answers, setAnswers, lang, onNext: next });
  else if (step === 'project') screen = e(Project, { answers, setAnswers, lang, onNext: next });
  else if (step === 'claude') screen = e(ClaudeAgents, { answers, setAnswers, lang, onNext: next });
  else screen = e(Summary, { answers, lang, onNext: (ok) => resolve(ok ? answers : null) });

  const centered = true; // every screen is vertically + horizontally centered
  // Root fills the whole terminal (alternate screen); splash is centered, the rest top-aligned.
  return e(
    Box,
    {
      width: columns,
      height: rows,
      flexDirection: 'column',
      paddingX: 2,
      paddingY: 1,
      justifyContent: centered ? 'center' : 'flex-start',
      alignItems: centered ? 'center' : 'stretch',
    },
    screen,
  );
}

const ALT_ENTER = '[?1049h[?25l[2J[H'; // alt screen on, hide cursor, clear
const ALT_EXIT = '[?25h[?1049l';                  // show cursor, alt screen off

export function runWizard(pkgRoot, version) {
  return new Promise((resolve) => {
    const out = process.stdout;
    let restored = false;
    const restore = () => { if (!restored) { restored = true; out.write(ALT_EXIT); } };
    out.write(ALT_ENTER);
    process.once('exit', restore); // safety net for Ctrl-C / hard exit

    let inst;
    const done = (a) => { inst?.unmount(); restore(); resolve(a); };
    inst = render(e(Wizard, { version, resolve: done }));
  });
}

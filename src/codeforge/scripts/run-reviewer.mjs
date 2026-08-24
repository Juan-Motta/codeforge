#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  accessSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
  constants,
} from 'node:fs';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const EXIT = Object.freeze({ usage: 2, launch: 10, timeout: 11, failed: 12, empty: 13, preflight: 14 });
const REQUIRED = ['engine', 'model', 'prompt-file', 'stdout-file', 'stderr-file'];

function fail(message, code = EXIT.usage) {
  writeSync(2, `run-reviewer: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const values = { 'timeout-seconds': '600' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) fail(`unknown argument: ${token}`);
    const key = token.slice(2);
    if (!['engine', 'model', 'effort', 'prompt-file', 'stdout-file', 'stderr-file', 'timeout-seconds'].includes(key)) {
      fail(`unknown option: ${token}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail(`${token} requires a value`);
    values[key] = value;
    i += 1;
  }
  for (const key of REQUIRED) if (!values[key]) fail(`--${key} is required`);
  if (!['codex', 'claude', 'opencode'].includes(values.engine)) fail(`unsupported engine: ${values.engine}`);
  const timeout = Number(values['timeout-seconds']);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 86400) fail('--timeout-seconds must be an integer from 1 to 86400');
  values.timeoutMs = timeout * 1000;
  return values;
}

function invocation(options, promptPath) {
  const effort = options.effort && options.effort !== 'default' ? options.effort : null;
  if (options.engine === 'codex') {
    const args = ['exec', '-m', options.model];
    if (effort) args.push('-c', `model_reasoning_effort='${effort}'`);
    args.push('--sandbox', 'read-only', '--ephemeral', '--output-last-message', options.lastMessage, '-');
    return { command: 'codex', args, stdin: readFileSync(promptPath) };
  }
  if (options.engine === 'claude') {
    const args = ['-p', '--model', options.model];
    if (effort) args.push('--effort', effort);
    args.push(
      '--tools', '',
      '--disallowedTools', 'Bash,Edit,Write,NotebookEdit',
      '--permission-mode', 'plan',
      '--no-session-persistence',
    );
    return { command: 'claude', args, stdin: readFileSync(promptPath) };
  }
  const args = ['run', '-m', options.model, '--agent', 'plan'];
  if (effort) args.push('--variant', effort);
  args.push('--file', promptPath, 'Follow the attached file as the complete review request. Return only the review.');
  return { command: 'opencode', args, stdin: null };
}

function replaceFile(path, content) {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(resolve(parent, '.codeforge-review-write-'));
  const temporary = resolve(scratch, 'content');
  try {
    writeFileSync(temporary, content, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function terminateTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killed = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    if (killed.error || killed.status !== 0) {
      try { child.kill('SIGKILL'); } catch {}
    }
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  const killer = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }, 1000);
  killer.unref();
}

function resolveWindowsCommand(command) {
  if (process.platform !== 'win32') return command;
  const hasPath = /[\\/]/.test(command);
  const roots = hasPath ? [''] : (process.env.PATH || '').split(delimiter).filter(Boolean);
  const extensions = extname(command)
    ? ['']
    : (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const root of roots) {
    for (const extension of extensions) {
      const candidate = hasPath ? `${command}${extension}` : join(root, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

// Windows npm CLIs are commonly .cmd shims. Invoke them through ComSpec without interpolating
// any caller-controlled value into the command text: arguments live in environment variables,
// and the fixed command line references only those fixed variable names.
function prepareCommand(command, args) {
  const resolvedCommand = resolveWindowsCommand(command);
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(resolvedCommand)) {
    return { command: resolvedCommand, args, env: process.env };
  }
  if ([resolvedCommand, ...args].some((value) => /["\r\n\0]/.test(String(value)))) {
    const error = new Error('Windows reviewer command arguments may not contain quotes or control characters');
    error.code = 'EINVAL';
    throw error;
  }
  const env = { ...process.env, CODEFORGE_REVIEWER_COMMAND: resolvedCommand };
  const references = args.map((value, index) => {
    if (String(value) === '') return '""';
    const key = `CODEFORGE_REVIEWER_ARG_${index}`;
    env[key] = String(value);
    return `"%${key}%"`;
  });
  const commandLine = `""%CODEFORGE_REVIEWER_COMMAND%"${references.length ? ` ${references.join(' ')}` : ''}"`;
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', commandLine],
    env,
    windowsVerbatimArguments: true,
  };
}

function spawnPreparedSync(command, args, options) {
  try {
    const prepared = prepareCommand(command, args);
    return spawnSync(prepared.command, prepared.args, {
      ...options,
      env: prepared.env,
      windowsVerbatimArguments: prepared.windowsVerbatimArguments,
    });
  } catch (error) {
    return { error, status: null, stdout: '', stderr: '' };
  }
}

function preflight(options, stdoutPath, stderrPath) {
  if (options.engine !== 'claude') return 0;
  const status = spawnPreparedSync('claude', ['auth', 'status'], {
    encoding: 'utf8',
    timeout: Math.min(10000, options.timeoutMs),
    windowsHide: true,
  });
  if (!status.error && status.status === 0) return 0;

  const details = [status.stdout, status.stderr, status.error?.message]
    .filter(Boolean)
    .join('\n')
    .trim();
  replaceFile(stdoutPath, '');
  if (status.error) {
    const reason = status.error.code === 'ETIMEDOUT'
      ? 'Claude authentication preflight timed out'
      : 'could not launch Claude authentication preflight';
    replaceFile(stderrPath, `run-reviewer: ${reason}: ${details}\n`);
    return EXIT.launch;
  }
  if (/not logged|not authenticated|authentication required|loggedIn["'\s:]+false|auth login/i.test(details)) {
    replaceFile(stderrPath,
      `run-reviewer: Claude is not authenticated; run \`claude auth login\`, then retry.\n${details}${details ? '\n' : ''}`);
    return EXIT.preflight;
  }
  replaceFile(stderrPath,
    `run-reviewer: could not evaluate Claude authentication status; verify \`claude auth status\`.\n${details}${details ? '\n' : ''}`);
  return EXIT.launch;
}

async function run(options) {
  const stdoutPath = resolve(options['stdout-file']);
  const stderrPath = resolve(options['stderr-file']);
  if (stdoutPath === stderrPath) fail('--stdout-file and --stderr-file must differ');
  const promptPath = resolve(options['prompt-file']);
  if (promptPath === stdoutPath || promptPath === stderrPath) {
    fail('--prompt-file must differ from --stdout-file and --stderr-file');
  }
  try {
    accessSync(promptPath, constants.R_OK);
  } catch {
    fail(`cannot read --prompt-file: ${promptPath}`);
  }
  const deadlineStartedAt = Date.now();
  const preflightCode = preflight(options, stdoutPath, stderrPath);
  if (preflightCode !== 0) return preflightCode;
  const remainingTimeoutMs = Math.max(1, options.timeoutMs - (Date.now() - deadlineStartedAt));
  const scratch = mkdtempSync(resolve(tmpdir(), 'codeforge-reviewer-'));
  const rawStdout = resolve(scratch, 'stdout');
  const rawStderr = resolve(scratch, 'stderr');
  options.lastMessage = resolve(scratch, 'last-message');
  let child;
  let timedOut = false;
  const cleanupScratch = () => {
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  };
  const signalHandlers = new Map();
  try {
    let call;
    try {
      call = invocation(options, promptPath);
    } catch (error) {
      replaceFile(stdoutPath, '');
      replaceFile(stderrPath, `${error.message}\n`);
      return EXIT.launch;
    }
    const outFd = openSync(rawStdout, 'wx', 0o600);
    const errFd = openSync(rawStderr, 'wx', 0o600);
    try {
      const prepared = prepareCommand(call.command, call.args);
      child = spawn(prepared.command, prepared.args, {
        cwd: process.cwd(),
        detached: process.platform !== 'win32',
        stdio: ['pipe', outFd, errFd],
        windowsHide: true,
        env: prepared.env,
        windowsVerbatimArguments: prepared.windowsVerbatimArguments,
      });
    } catch (error) {
      replaceFile(stdoutPath, '');
      replaceFile(stderrPath, `${error.message}\n`);
      return EXIT.launch;
    } finally {
      closeSync(outFd);
      closeSync(errFd);
    }
    for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      const handler = () => {
        terminateTree(child);
        cleanupScratch();
        process.exit(exitCode);
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }

    const result = await new Promise((resolveResult) => {
      let settled = false;
      let graceTimer;
      let exited = false;
      let exitResult;
      const finish = (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          clearTimeout(graceTimer);
          resolveResult(value);
        }
      };
      const timer = setTimeout(() => {
        if (exited) {
          finish(exitResult);
          return;
        }
        timedOut = true;
        terminateTree(child);
        graceTimer = setTimeout(() => finish({ code: null, signal: 'timeout-backstop' }), 5000);
      }, remainingTimeoutMs);
      child.once('exit', (code, signal) => {
        exited = true;
        exitResult = { code, signal };
      });
      child.once('error', (error) => {
        finish({ launchError: error });
      });
      child.once('close', (code, signal) => {
        finish({ code, signal });
      });
      child.stdin.on('error', () => {});
      if (call.stdin) child.stdin.end(call.stdin);
      else child.stdin.end();
    });

    let stderr = readFileSync(rawStderr);
    if (timedOut) stderr = Buffer.concat([stderr, Buffer.from(`\nrun-reviewer: timed out after ${options['timeout-seconds']} seconds\n`)]);
    if (result.launchError) stderr = Buffer.concat([stderr, Buffer.from(`\n${result.launchError.message}\n`)]);
    replaceFile(stderrPath, stderr);

    const raw = readFileSync(rawStdout);
    let output = raw;
    if (options.engine === 'codex') {
      try {
        const last = readFileSync(options.lastMessage);
        if (last.length > 0) output = last;
      } catch {}
    }
    if (options.engine === 'codex' && result.code !== 0 && raw.length > 0 && !raw.equals(output)) {
      stderr = Buffer.concat([stderr, Buffer.from('\nrun-reviewer: Codex raw transcript:\n'), raw]);
      replaceFile(stderrPath, stderr);
    }
    replaceFile(stdoutPath, output);

    if (timedOut) return EXIT.timeout;
    if (result.launchError) return EXIT.launch;
    if (result.code !== 0) return EXIT.failed;
    if (output.toString('utf8').trim().length === 0) return EXIT.empty;
    return 0;
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    cleanupScratch();
  }
}

const options = parseArgs(process.argv.slice(2));
let code;
try {
  code = await run(options);
} catch (error) {
  writeSync(2, `run-reviewer: ${error.message}\n`);
  code = EXIT.launch;
}
process.exit(code);

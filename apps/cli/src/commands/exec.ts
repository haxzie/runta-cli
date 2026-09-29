import { ExecUnknownError, startExec } from '@runta/api';
import { createContext, resolveRuntimeId } from '@runta/core';
import { fail, logger } from '@runta/utils';
import type { Command } from 'commander';

/**
 * Exit codes for `exec`.
 *
 * The remote command's own code is passed through verbatim, which is what every comparable CLI
 * does and what any script wrapping this expects. That leaves no room for the CLI's usual 1/2, so
 * failures of the exec itself use the high codes Docker established for the same reason.
 */
const COULD_NOT_START = 125;
const OUTCOME_UNKNOWN = 126;

export interface ExecOptions {
  interactive?: boolean;
  tty?: boolean;
  env?: string[];
  json?: boolean;
}

export interface ExecDeps {
  stdout: {
    write: (data: Uint8Array | string) => void;
    isTTY?: boolean;
    columns?: number;
    rows?: number;
  };
  stderr: { write: (data: Uint8Array | string) => void; isTTY?: boolean };
  stdin: {
    isTTY?: boolean;
    setRawMode?: (raw: boolean) => void;
    on: (event: 'data' | 'end', listener: (chunk?: Buffer) => void) => void;
    pause: () => void;
    resume: () => void;
  };
  /** Window-change notifications, so a pty session can follow the local terminal. */
  onResize: (listener: () => void) => () => void;
  startExec: typeof startExec;
}

export const defaultExecDeps: ExecDeps = {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin as unknown as ExecDeps['stdin'],
  onResize: (listener) => {
    process.stdout.on('resize', listener);
    return () => {
      process.stdout.off('resize', listener);
    };
  },
  startExec,
};

export async function exec(
  reference: string,
  command: string[],
  options: ExecOptions = {},
  deps: ExecDeps = defaultExecDeps,
): Promise<number> {
  const [program, ...args] = command;
  if (!program) {
    fail('No command given.', {
      exitCode: 2,
      hint: 'Try `runta-next exec <runtime> -- <command>`.',
    });
  }

  // A pty has to be attached to something. Asking for one without a terminal would produce a
  // session whose escape sequences go nowhere useful.
  if (options.tty && !deps.stdout.isTTY) {
    fail('--tty needs a terminal on stdout.', {
      exitCode: 2,
      hint: 'Drop -t when piping or redirecting output.',
    });
  }

  const { client, config } = await createContext();
  const runtimeId = await resolveRuntimeId(client, reference);
  logger.debug(`exec on ${runtimeId} via ${config.apiUrl}`);

  const session = deps.startExec({
    baseUrl: config.apiUrl,
    token: config.token,
    runtimeId,
    request: {
      command: program,
      args,
      env: parseEnv(options.env),
      ...(options.tty
        ? { tty: true, rows: deps.stdout.rows ?? 24, cols: deps.stdout.columns ?? 80 }
        : {}),
    },
    handlers: options.json
      ? {
          // Mirror the wire protocol rather than inventing a shape: an agent that has read
          // asyncapi.yaml already knows these frames, and base64 keeps binary output intact.
          onStdout: (chunk) => emit(deps, 'stdout', chunk),
          onStderr: (chunk) => emit(deps, 'stderr', chunk),
        }
      : {
          onStdout: (chunk) => deps.stdout.write(chunk),
          onStderr: (chunk) => deps.stderr.write(chunk),
          onWaiting: () => logger.info('Waiting for the runtime to become ready…'),
        },
  });

  const stopForwarding = options.interactive ? forwardStdin(session, deps, options) : undefined;
  if (!options.interactive) session.closeStdin();

  const stopResize = options.tty
    ? deps.onResize(() => session.resize(deps.stdout.rows ?? 24, deps.stdout.columns ?? 80))
    : undefined;

  try {
    const code = await session.result;
    if (options.json) {
      deps.stdout.write(`${JSON.stringify({ type: 'exit', code })}\n`);
    }
    return code;
  } catch (error) {
    if (error instanceof ExecUnknownError) {
      // Not "it failed" — nobody knows. asyncapi.yaml is explicit that a command with side
      // effects must not be retried automatically, so the distinction is the whole point.
      if (options.json) {
        deps.stdout.write(
          `${JSON.stringify({ type: 'error', message: error.message, before_start: error.beforeStart })}\n`,
        );
      }
      fail(error.message, {
        exitCode: error.beforeStart ? COULD_NOT_START : OUTCOME_UNKNOWN,
        hint: error.beforeStart
          ? 'The command never started, so running it again is safe.'
          : 'The command may have run. Check before retrying — this is not a reported failure.',
        cause: error,
      });
    }
    throw error;
  } finally {
    stopResize?.();
    stopForwarding?.();
  }
}

const emit = (deps: ExecDeps, stream: 'stdout' | 'stderr', chunk: Uint8Array): void => {
  let binary = '';
  for (const byte of chunk) binary += String.fromCharCode(byte);
  deps.stdout.write(`${JSON.stringify({ type: stream, data_base64: btoa(binary) })}\n`);
};

/**
 * Pipes the local terminal into the session.
 *
 * In raw mode Ctrl-C arrives as byte 0x03 on stdin rather than as a signal, so it is forwarded to
 * the pty and the guest's shell decides what to do — which is what makes an interactive session
 * behave like a real one. Without a pty there is nothing to interpret it, so SIGINT is translated
 * into an explicit `signal` frame instead.
 */
function forwardStdin(
  session: ReturnType<typeof startExec>,
  deps: ExecDeps,
  options: ExecOptions,
): () => void {
  const raw = Boolean(options.tty && deps.stdin.isTTY);
  if (raw) deps.stdin.setRawMode?.(true);
  deps.stdin.resume();

  deps.stdin.on('data', (chunk) => {
    if (chunk) session.write(new Uint8Array(chunk));
  });
  deps.stdin.on('end', () => session.closeStdin());

  const onInterrupt = (): void => {
    session.signal('INT');
  };
  if (!raw) process.on('SIGINT', onInterrupt);

  return () => {
    if (raw) deps.stdin.setRawMode?.(false);
    else process.off('SIGINT', onInterrupt);
    deps.stdin.pause();
  };
}

/** `KEY=VALUE` pairs. Rejected early, because the API's error names a field the user never typed. */
function parseEnv(pairs: string[] | undefined): Record<string, string> | undefined {
  if (!pairs?.length) return undefined;
  const env: Record<string, string> = {};
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index < 1) {
      fail(`Invalid --env value '${pair}'.`, { exitCode: 2, hint: 'Use --env KEY=VALUE.' });
    }
    env[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return env;
}

export function registerExec(program: Command): void {
  program
    .command('exec')
    .description('Run a command inside a runtime')
    .argument('<runtime>', 'runtime name or id')
    .argument('<command...>', 'command and arguments, after --')
    .option('-i, --interactive', 'forward stdin to the command')
    .option('-t, --tty', 'allocate a pty; needs a terminal on stdout')
    .option('--env <KEY=VALUE>', 'set an environment variable (repeatable)', collect, [])
    // Deliberately no `-o`: `exec` streams the remote command's own bytes through, so
    // `exec demo -- cat f.bin > out` has to write the file, not a JSON envelope around it.
    // Auto-detecting a pipe here would corrupt the most obvious use of the command. `--json`
    // still works, explicitly.
    .option('--json', 'stream NDJSON frames instead of raw output')
    .action(async (reference: string, command: string[], opts: ExecOptions) => {
      const code = await exec(reference, command, opts);
      // The remote command's exit status is this command's exit status.
      if (code !== 0) process.exit(code);
    });
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

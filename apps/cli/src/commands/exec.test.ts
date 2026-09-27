import { type ExecSession, ExecUnknownError } from '@runta/api';
import { isCliError } from '@runta/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureStdout, isolateEnv, type Route, stubFetch } from '../test/harness.js';
import { type ExecDeps, exec } from './exec.js';

const ID = '01a0dcc4-2ba7-7353-acb2-7fa79602b0a0';

/** `exec` resolves the runtime name first, so every case needs the list route. */
const LIST: Route = {
  method: 'GET',
  path: '/v2/runtimes',
  status: 200,
  body: {
    data: [{ id: ID, display_name: 'demo' }],
    pagination: { next_cursor: null, has_more: false },
  },
};

let env: Awaited<ReturnType<typeof isolateEnv>>;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  env = await isolateEnv({ RUNTA_TOKEN: 'rt_test' });
});
afterEach(() => {
  env.restore();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

interface Harness {
  deps: ExecDeps;
  out: ReturnType<typeof captureStdout>;
  err: ReturnType<typeof captureStdout>;
  /** The options `startExec` was called with. */
  call: () => Record<string, never>;
  session: ExecSession & { handlers: Record<string, (chunk: Uint8Array) => void> };
  stdinListeners: Record<string, (chunk?: Buffer) => void>;
  resizeListeners: (() => void)[];
  /** Resolves once `exec` has actually opened the session. */
  ready: Promise<void>;
  /** Ends the session with an exit code. */
  finish: (code: number) => void;
}

/** Wires `exec` to a scripted session instead of a socket. */
function harness(
  options: { result?: Promise<number>; isTTY?: boolean; stdinIsTTY?: boolean } = {},
): Harness {
  globalThis.fetch = stubFetch([LIST]).fetch as unknown as typeof globalThis.fetch;

  const out = captureStdout();
  const err = captureStdout();
  const stdinListeners: Record<string, (chunk?: Buffer) => void> = {};
  const resizeListeners: (() => void)[] = [];
  let captured: Record<string, never> = {} as Record<string, never>;

  // `exec` awaits config loading and a name lookup before it opens a session, so a test that
  // emits frames after a bare microtask tick races it. These make the ordering explicit.
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  let finish!: (code: number) => void;
  const deferred = new Promise<number>((resolve) => {
    finish = resolve;
  });

  // A pre-rejected `result` sits unhandled while `exec` loads config and resolves the runtime
  // name, which Node reports as an unhandled rejection even though `exec` does await it. A no-op
  // handler silences that without changing what `exec` sees.
  options.result?.catch(() => undefined);

  const session = {
    result: options.result ?? deferred,
    write: vi.fn(),
    closeStdin: vi.fn(),
    resize: vi.fn(),
    signal: vi.fn(),
    handlers: {} as Record<string, (chunk: Uint8Array) => void>,
  };

  const deps: ExecDeps = {
    stdout: { write: out.write, isTTY: options.isTTY ?? false, rows: 30, columns: 120 },
    stderr: { write: err.write, isTTY: false },
    stdin: {
      isTTY: options.stdinIsTTY ?? false,
      setRawMode: vi.fn(),
      on: (event, listener) => {
        stdinListeners[event] = listener;
      },
      pause: vi.fn(),
      resume: vi.fn(),
    },
    onResize: (listener) => {
      resizeListeners.push(listener);
      return () => {
        resizeListeners.splice(resizeListeners.indexOf(listener), 1);
      };
    },
    startExec: ((opts: Record<string, never>) => {
      captured = opts;
      session.handlers =
        (opts as { handlers?: Record<string, (c: Uint8Array) => void> }).handlers ?? {};
      markReady();
      return session as unknown as ExecSession;
    }) as unknown as ExecDeps['startExec'],
  };

  return {
    deps,
    out,
    err,
    call: () => captured,
    session: session as never,
    stdinListeners,
    resizeListeners,
    ready,
    finish,
  };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe('the exec request', () => {
  it('resolves the runtime name to an id', async () => {
    const h = harness({ result: Promise.resolve(0) });

    await exec('demo', ['ls'], {}, h.deps);

    expect(h.call()).toMatchObject({ runtimeId: ID });
  });

  it('splits the command from its arguments', async () => {
    const h = harness({ result: Promise.resolve(0) });

    await exec('demo', ['sh', '-lc', 'echo hi'], {}, h.deps);

    expect(h.call()).toMatchObject({ request: { command: 'sh', args: ['-lc', 'echo hi'] } });
  });

  it('asks for a pty and sends the local geometry with -t', async () => {
    const h = harness({ isTTY: true, result: Promise.resolve(0) });

    await exec('demo', ['sh'], { tty: true }, h.deps);

    expect(h.call()).toMatchObject({ request: { tty: true, rows: 30, cols: 120 } });
  });

  it('does not ask for a pty without -t', async () => {
    const h = harness({ result: Promise.resolve(0) });

    await exec('demo', ['ls'], {}, h.deps);

    expect((h.call() as unknown as { request: { tty?: boolean } }).request.tty).toBeUndefined();
  });

  it('parses --env pairs', async () => {
    const h = harness({ result: Promise.resolve(0) });

    await exec('demo', ['env'], { env: ['A=1', 'B=with=equals'] }, h.deps);

    expect(h.call()).toMatchObject({ request: { env: { A: '1', B: 'with=equals' } } });
  });
});

describe('refusing before connecting', () => {
  it('rejects -t when stdout is not a terminal', async () => {
    // A pty with nowhere to render is not a session anyone wants.
    const h = harness({ isTTY: false, result: Promise.resolve(0) });

    const error = await exec('demo', ['sh'], { tty: true }, h.deps).catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as { exitCode: number }).exitCode).toBe(2);
    expect((error as { hint?: string }).hint).toContain('Drop -t');
  });

  it('rejects a malformed --env', async () => {
    const h = harness({ result: Promise.resolve(0) });

    const error = await exec('demo', ['env'], { env: ['NOPE'] }, h.deps).catch((e: unknown) => e);

    expect((error as Error).message).toContain("Invalid --env value 'NOPE'");
  });

  it('rejects an empty command', async () => {
    const h = harness({ result: Promise.resolve(0) });

    const error = await exec('demo', [], {}, h.deps).catch((e: unknown) => e);

    expect((error as Error).message).toBe('No command given.');
  });
});

describe('output', () => {
  it('writes stdout and stderr to their own streams', async () => {
    const h = harness();
    const done = exec('demo', ['sh'], {}, h.deps);
    await h.ready;

    h.session.handlers.onStdout?.(bytes('out'));
    h.session.handlers.onStderr?.(bytes('err'));
    h.finish(0);
    await done;

    expect(h.out.text).toBe('out');
    expect(h.err.text).toBe('err');
  });

  it('emits NDJSON frames mirroring the wire protocol with --json', async () => {
    const h = harness();
    const done = exec('demo', ['sh'], { json: true }, h.deps);
    await h.ready;

    h.session.handlers.onStdout?.(bytes('hi'));
    h.finish(0);
    await done;

    const lines = h.out.text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: 'stdout', data_base64: 'aGk=' },
      { type: 'exit', code: 0 },
    ]);
  });

  it('keeps binary output intact in --json, which text would corrupt', async () => {
    const h = harness();
    const done = exec('demo', ['sh'], { json: true }, h.deps);
    await h.ready;

    h.session.handlers.onStdout?.(new Uint8Array([0x00, 0xff, 0x1b]));
    h.finish(0);
    await done;

    const first = JSON.parse(h.out.text.trim().split('\n')[0] as string) as { data_base64: string };
    expect(Uint8Array.from(atob(first.data_base64), (c) => c.charCodeAt(0))).toEqual(
      new Uint8Array([0x00, 0xff, 0x1b]),
    );
  });

  it('returns the remote exit code rather than a status of its own', async () => {
    const h = harness({ result: Promise.resolve(42) });

    await expect(exec('demo', ['sh'], {}, h.deps)).resolves.toBe(42);
  });
});

describe('stdin', () => {
  it('closes stdin immediately without -i, so a command that reads it still terminates', async () => {
    const h = harness({ result: Promise.resolve(0) });

    await exec('demo', ['cat'], {}, h.deps);

    expect(h.session.closeStdin).toHaveBeenCalledOnce();
    expect(h.deps.stdin.resume).not.toHaveBeenCalled();
  });

  it('forwards stdin with -i', async () => {
    const h = harness();
    const done = exec('demo', ['cat'], { interactive: true }, h.deps);
    await h.ready;

    h.stdinListeners.data?.(Buffer.from('typed'));

    expect(h.session.write).toHaveBeenCalledWith(new Uint8Array(Buffer.from('typed')));
    h.finish(0);
    await done;
  });

  it('closes stdin when the local stream ends', async () => {
    const h = harness();
    const done = exec('demo', ['cat'], { interactive: true }, h.deps);
    await h.ready;

    h.stdinListeners.end?.();

    expect(h.session.closeStdin).toHaveBeenCalled();
    h.finish(0);
    await done;
  });

  it('puts the terminal in raw mode for -it, and restores it afterwards', async () => {
    // Raw mode is why Ctrl-C reaches the guest shell as a byte instead of killing the CLI.
    const h = harness({ isTTY: true, stdinIsTTY: true, result: Promise.resolve(0) });

    await exec('demo', ['sh'], { interactive: true, tty: true }, h.deps);

    expect(h.deps.stdin.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(h.deps.stdin.setRawMode).toHaveBeenNthCalledWith(2, false);
  });

  it('does not touch raw mode for -i without a pty', async () => {
    const h = harness({ result: Promise.resolve(0) });

    await exec('demo', ['cat'], { interactive: true }, h.deps);

    expect(h.deps.stdin.setRawMode).not.toHaveBeenCalled();
  });
});

describe('window size', () => {
  it('forwards a resize to the pty', async () => {
    const h = harness({ isTTY: true });
    const done = exec('demo', ['sh'], { tty: true }, h.deps);
    await h.ready;

    for (const listener of h.resizeListeners) listener();

    expect(h.session.resize).toHaveBeenCalledWith(30, 120);
    h.finish(0);
    await done;
  });

  it('does not subscribe to resizes without a pty', async () => {
    const h = harness({ result: Promise.resolve(0) });

    await exec('demo', ['ls'], {}, h.deps);

    expect(h.resizeListeners).toHaveLength(0);
  });

  it('unsubscribes when the command finishes', async () => {
    const h = harness({ isTTY: true, result: Promise.resolve(0) });

    await exec('demo', ['sh'], { tty: true }, h.deps);

    expect(h.resizeListeners).toHaveLength(0);
  });
});

describe('an unknown outcome', () => {
  /**
   * asyncapi.yaml is explicit that a connection ending before `exit` leaves the result unknown and
   * that a command with side effects must not be retried automatically. So this cannot be reported
   * as a failure, and the exit code has to distinguish "never ran" from "might have run".
   */
  it('exits 125 when the command never started, and says retrying is safe', async () => {
    const h = harness({
      result: Promise.reject(new ExecUnknownError('server_error', 'runtime is not running', true)),
    });

    const error = await exec('demo', ['ls'], {}, h.deps).catch((e: unknown) => e);

    expect((error as { exitCode: number }).exitCode).toBe(125);
    expect((error as { hint?: string }).hint).toContain('safe');
  });

  it('exits 126 when it may have run, and refuses to call that a failure', async () => {
    {
      const h = harness({
        result: Promise.reject(new ExecUnknownError('closed_early', 'connection lost', false)),
      });

      const error = await exec('demo', ['deploy'], {}, h.deps).catch((e: unknown) => e);

      expect((error as { exitCode: number }).exitCode).toBe(126);
      expect((error as { hint?: string }).hint).toContain('not a reported failure');
    }
  });

  it('reports the unknown outcome as a frame in --json too', async () => {
    const h = harness({
      result: Promise.reject(new ExecUnknownError('closed_early', 'connection lost', false)),
    });

    await exec('demo', ['ls'], { json: true }, h.deps).catch(() => undefined);

    expect(JSON.parse(h.out.text.trim())).toEqual({
      type: 'error',
      message: 'connection lost',
      before_start: false,
    });
  });
});

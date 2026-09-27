import { describe, expect, it, vi } from 'vitest';
import {
  type ExecOptions,
  type ExecRequest,
  type ExecSocket,
  ExecUnknownError,
  execUrl,
  startExec,
} from './exec.js';

/** A socket whose frames the test drives by hand. */
function fakeSocket() {
  const listeners = new Map<string, ((event: never) => void)[]>();
  const sent: Record<string, unknown>[] = [];
  let closed = false;

  let opened = false;
  const socket: ExecSocket = {
    send(data) {
      // A real WebSocket throws on send while CONNECTING. The fake has to as well, or it hides
      // exactly the bug that shipped: closeStdin() called before the socket opened.
      if (!opened) throw new Error('InvalidStateError: still in CONNECTING state');
      sent.push(JSON.parse(data) as Record<string, unknown>);
    },
    close() {
      closed = true;
    },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };

  const emit = (type: string, event: unknown = {}): void => {
    for (const listener of listeners.get(type) ?? []) listener(event as never);
  };

  return {
    socket,
    sent,
    get closed() {
      return closed;
    },
    open: () => {
      opened = true;
      emit('open');
    },
    frame: (payload: Record<string, unknown>) => emit('message', { data: JSON.stringify(payload) }),
    raw: (data: string) => emit('message', { data }),
    closeRemote: () => emit('close'),
    fail: () => emit('error'),
  };
}

const b64 = (text: string) => btoa(text);

const start = (
  request: ExecRequest = { command: 'sh', args: ['-lc', 'echo hi'] },
  extra: Partial<ExecOptions> = {},
) => {
  const fake = fakeSocket();
  const session = startExec({
    baseUrl: 'https://api.runta.com',
    token: 'rt_test',
    runtimeId: 'r1',
    request,
    connect: () => fake.socket,
    ...extra,
  });
  return { fake, session };
};

describe('execUrl', () => {
  it('upgrades https to wss', () => {
    expect(execUrl('https://api.runta.com', 'r1')).toBe(
      'wss://api.runta.com/v2/runtimes/r1/exec/stream',
    );
  });

  it('uses ws for a plaintext endpoint, so a local API still works', () => {
    expect(execUrl('http://127.0.0.1:8080', 'r1')).toBe(
      'ws://127.0.0.1:8080/v2/runtimes/r1/exec/stream',
    );
  });
});

describe('the start frame', () => {
  it('is sent once, first, on open', () => {
    const { fake } = start();

    fake.open();

    expect(fake.sent).toEqual([{ type: 'start', command: 'sh', args: ['-lc', 'echo hi'] }]);
  });

  it('omits empty args and env rather than sending noise', () => {
    const { fake } = start({ command: 'true', args: [], env: {} });

    fake.open();

    expect(fake.sent[0]).toEqual({ type: 'start', command: 'true' });
  });

  it('carries tty geometry when a pty is requested', () => {
    const { fake } = start({ command: 'sh', tty: true, rows: 24, cols: 100 });

    fake.open();

    expect(fake.sent[0]).toMatchObject({ tty: true, rows: 24, cols: 100 });
  });

  it('passes env through', () => {
    const { fake } = start({ command: 'env', env: { FOO: 'bar' } });

    fake.open();

    expect(fake.sent[0]).toMatchObject({ env: { FOO: 'bar' } });
  });
});

describe('output and exit', () => {
  it('decodes stdout and stderr separately', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const fake = fakeSocket();
    const session = startExec({
      baseUrl: 'https://api.runta.com',
      token: 't',
      runtimeId: 'r1',
      request: { command: 'sh' },
      connect: () => fake.socket,
      handlers: {
        onStdout: (c) => out.push(new TextDecoder().decode(c)),
        onStderr: (c) => err.push(new TextDecoder().decode(c)),
      },
    });

    fake.open();
    fake.frame({ type: 'stdout', data_base64: b64('out\n') });
    fake.frame({ type: 'stderr', data_base64: b64('err\n') });
    fake.frame({ type: 'exit', code: 0 });

    await expect(session.result).resolves.toBe(0);
    expect(out).toEqual(['out\n']);
    expect(err).toEqual(['err\n']);
  });

  it('resolves with a nonzero code — a failed command is not a failed exec', async () => {
    const { fake, session } = start();

    fake.open();
    fake.frame({ type: 'exit', code: 42 });

    await expect(session.result).resolves.toBe(42);
  });

  it('ignores heartbeats', async () => {
    const { fake, session } = start();

    fake.open();
    fake.frame({ type: 'heartbeat' });
    fake.frame({ type: 'heartbeat' });
    fake.frame({ type: 'exit', code: 0 });

    await expect(session.result).resolves.toBe(0);
  });

  it('ignores an unparseable frame rather than claiming the command failed', async () => {
    const { fake, session } = start();

    fake.open();
    fake.raw('not json at all');
    fake.frame({ type: 'exit', code: 0 });

    await expect(session.result).resolves.toBe(0);
  });

  it('closes the socket once it has an answer', async () => {
    const { fake, session } = start();

    fake.open();
    fake.frame({ type: 'exit', code: 0 });
    await session.result;

    expect(fake.closed).toBe(true);
  });
});

describe('an unknown outcome is not a failure', () => {
  /**
   * asyncapi.yaml: an `error` frame or a close before `exit` leaves the result unknown, and a
   * command with side effects must not be retried automatically. So this is a third outcome, and
   * `beforeStart` is what tells a caller whether retrying is safe.
   */
  it('rejects on an error frame, flagging that nothing had started', async () => {
    const { fake, session } = start();

    fake.open();
    fake.frame({ type: 'error', message: 'runtime is not running' });

    const error = await session.result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExecUnknownError);
    expect((error as ExecUnknownError).reason).toBe('server_error');
    expect((error as ExecUnknownError).beforeStart).toBe(true);
    expect((error as Error).message).toBe('runtime is not running');
  });

  it('knows the command had started when output arrived first', async () => {
    const { fake, session } = start();

    fake.open();
    fake.frame({ type: 'stdout', data_base64: b64('partial') });
    fake.frame({ type: 'error', message: 'lost the worker' });

    const error = await session.result.catch((e: unknown) => e);
    // Output means side effects may have happened, so a retry is not safe.
    expect((error as ExecUnknownError).beforeStart).toBe(false);
  });

  it('rejects when the connection closes before exit', async () => {
    const { fake, session } = start();

    fake.open();
    fake.frame({ type: 'stdout', data_base64: b64('hi') });
    fake.closeRemote();

    const error = await session.result.catch((e: unknown) => e);
    expect((error as ExecUnknownError).reason).toBe('closed_early');
    expect((error as Error).message).toContain('before the command reported an exit status');
  });

  it('says so differently when it closed before the command even started', async () => {
    const { fake, session } = start();

    fake.open();
    fake.closeRemote();

    const error = await session.result.catch((e: unknown) => e);
    expect((error as Error).message).toContain('before the command started');
    expect((error as ExecUnknownError).beforeStart).toBe(true);
  });

  it('a close after exit does not overwrite the exit code', async () => {
    const { fake, session } = start();

    fake.open();
    fake.frame({ type: 'exit', code: 7 });
    fake.closeRemote();

    await expect(session.result).resolves.toBe(7);
  });

  it('a transport error becomes an unknown outcome', async () => {
    const { fake, session } = start();

    fake.open();
    fake.fail();

    await expect(session.result).rejects.toBeInstanceOf(ExecUnknownError);
  });
});

describe('input, resize and signals', () => {
  it('sends stdin base64-encoded', () => {
    const { fake, session } = start();
    fake.open();

    session.write(new TextEncoder().encode('typed\n'));

    expect(fake.sent[1]).toEqual({ type: 'stdin', data_base64: b64('typed\n') });
  });

  it('round-trips bytes that are not valid UTF-8 text', () => {
    const { fake, session } = start();
    fake.open();

    session.write(new Uint8Array([0x00, 0xff, 0x1b, 0x5b, 0x41]));

    const encoded = String((fake.sent[1] as { data_base64: string }).data_base64);
    expect(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))).toEqual(
      new Uint8Array([0x00, 0xff, 0x1b, 0x5b, 0x41]),
    );
  });

  it('sends close_stdin, which is how a non-interactive command terminates', () => {
    const { fake, session } = start();
    fake.open();

    session.closeStdin();

    expect(fake.sent[1]).toEqual({ type: 'close_stdin' });
  });

  it('sends resize for a window change', () => {
    const { fake, session } = start();
    fake.open();

    session.resize(40, 120);

    expect(fake.sent[1]).toEqual({ type: 'resize', rows: 40, cols: 120 });
  });

  it('sends a signal', () => {
    const { fake, session } = start();
    fake.open();

    session.signal('INT');

    expect(fake.sent[1]).toEqual({ type: 'signal', signal: 'INT' });
  });
});

describe('the waiting notice', () => {
  /**
   * The server may hold the connection for up to 300 seconds while a runtime becomes ready, which
   * is why exec against a cold runtime looks like a hang. Saying so is the difference between
   * "slow" and "broken".
   */
  it('fires when the server has sent nothing yet', () => {
    vi.useFakeTimers();
    const onWaiting = vi.fn();
    const { fake } = start({ command: 'sh' }, { handlers: { onWaiting }, waitingAfterMs: 2000 });

    fake.open();
    vi.advanceTimersByTime(2500);

    expect(onWaiting).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('does not fire once output has arrived', () => {
    vi.useFakeTimers();
    const onWaiting = vi.fn();
    const { fake } = start({ command: 'sh' }, { handlers: { onWaiting }, waitingAfterMs: 2000 });

    fake.open();
    fake.frame({ type: 'stdout', data_base64: b64('fast') });
    vi.advanceTimersByTime(5000);

    expect(onWaiting).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

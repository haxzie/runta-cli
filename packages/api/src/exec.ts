/**
 * Client for the exec WebSocket, hand-written from `asyncapi.yaml`.
 *
 * Not generated: `@hey-api/openapi-ts` reads OpenAPI, and this endpoint is described by a separate
 * AsyncAPI document. Treat that file as the contract — every frame name and field below comes from
 * it, and it was verified against the live service before this was written.
 *
 * One command per connection. The client sends `start` once and first, then any of `stdin`,
 * `resize`, `signal` and `close_stdin`. The server answers with `stdout`/`stderr` and exactly one
 * terminal frame: `exit` (with a code, where nonzero is a *command* failure) or `error`.
 */

/** Signals the server accepts. */
export type ExecSignal = 'INT' | 'TERM';

export interface ExecRequest {
  /** Executable name or path. Shell syntax needs an explicit shell. */
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Allocate a pty. Folds stderr into stdout and switches the guest to CRLF. */
  tty?: boolean;
  rows?: number;
  cols?: number;
}

export interface ExecHandlers {
  onStdout?: (chunk: Uint8Array) => void;
  /** Never called when `tty` is set — the guest folds stderr into stdout. */
  onStderr?: (chunk: Uint8Array) => void;
  /**
   * Called once if the server is still holding the connection open with nothing to show.
   *
   * The server may wait up to 300 seconds for a runtime to become ready, which is why exec against
   * a cold runtime looks like a hang. Surfacing it is the difference between "slow" and "broken".
   */
  onWaiting?: () => void;
}

/**
 * Why an exec ended without an exit code.
 *
 * `asyncapi.yaml` is explicit that this leaves the command's result **unknown** and that a command
 * with side effects must not be retried automatically. So this is a third outcome, not a failure —
 * the caller has to decide, and cannot be told "it failed" when nobody knows.
 */
export class ExecUnknownError extends Error {
  /** `error` frame from the server, or the connection ending before `exit`. */
  readonly reason: 'server_error' | 'closed_early';
  /** True when the command never started, so retrying cannot duplicate work. */
  readonly beforeStart: boolean;

  constructor(reason: 'server_error' | 'closed_early', message: string, beforeStart: boolean) {
    super(message);
    this.name = 'ExecUnknownError';
    this.reason = reason;
    this.beforeStart = beforeStart;
  }
}

/** A live exec session. */
export interface ExecSession {
  /** Resolves with the remote command's exit code. Rejects with ExecUnknownError. */
  readonly result: Promise<number>;
  write(data: Uint8Array): void;
  closeStdin(): void;
  resize(rows: number, cols: number): void;
  signal(signal: ExecSignal): void;
}

/** The socket shape this module needs, so tests can supply one without a network. */
export interface ExecSocket {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: never) => void,
  ): void;
}

export interface ExecOptions {
  baseUrl: string;
  token: string | undefined;
  runtimeId: string;
  request: ExecRequest;
  handlers?: ExecHandlers;
  /** Overridable for tests. */
  connect?: (url: string, token: string | undefined) => ExecSocket;
  /** How long the server may be silent before `onWaiting` fires. */
  waitingAfterMs?: number;
}

const encoder = new TextEncoder();

const toBase64 = (data: Uint8Array): string => {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

/** `wss://` for an https endpoint, `ws://` for plaintext. */
export function execUrl(baseUrl: string, runtimeId: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.pathname = `/v2/runtimes/${runtimeId}/exec/stream`;
  return url.toString();
}

const defaultConnect = (url: string, token: string | undefined): ExecSocket =>
  // The token goes on the upgrade request, as the spec requires. Custom headers on a WebSocket are
  // a Bun extension; the CLI is compiled with Bun, so this is the runtime it always has.
  new WebSocket(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as never) as unknown as ExecSocket;

export function startExec(options: ExecOptions): ExecSession {
  const connect = options.connect ?? defaultConnect;
  const socket = connect(execUrl(options.baseUrl, options.runtimeId), options.token);
  const handlers = options.handlers ?? {};

  let settled = false;
  let started = false;
  let waitingTimer: ReturnType<typeof setTimeout> | undefined;

  let resolveResult!: (code: number) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<number>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  // A real WebSocket throws if you send while it is still connecting, and callers should not have
  // to know that: `closeStdin()` immediately after starting a non-interactive command is the
  // obvious thing to write. Queue until open, then flush in order.
  let open = false;
  const pending: string[] = [];

  const send = (frame: Record<string, unknown>): void => {
    const payload = JSON.stringify(frame);
    if (open) socket.send(payload);
    else pending.push(payload);
  };

  const finish = (settle: () => void): void => {
    if (settled) return;
    settled = true;
    if (waitingTimer) clearTimeout(waitingTimer);
    settle();
    socket.close();
  };

  socket.addEventListener('open', () => {
    open = true;
    // `start` must be first, so it jumps the queue that formed while connecting.
    socket.send(
      JSON.stringify({
        type: 'start',
        command: options.request.command,
        ...(options.request.args?.length ? { args: options.request.args } : {}),
        ...(options.request.env && Object.keys(options.request.env).length
          ? { env: options.request.env }
          : {}),
        ...(options.request.tty ? { tty: true } : {}),
        ...(options.request.rows !== undefined ? { rows: options.request.rows } : {}),
        ...(options.request.cols !== undefined ? { cols: options.request.cols } : {}),
      }),
    );

    for (const payload of pending.splice(0)) socket.send(payload);

    if (handlers.onWaiting) {
      waitingTimer = setTimeout(() => {
        if (!started && !settled) handlers.onWaiting?.();
      }, options.waitingAfterMs ?? 2_000);
    }
  });

  socket.addEventListener('message', (event) => {
    const raw = (event as unknown as { data: unknown }).data;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as Record<string, unknown>;
    } catch {
      // A frame we cannot parse is not a reason to claim the command failed.
      return;
    }

    switch (frame.type) {
      case 'heartbeat':
        return;
      case 'stdout':
      case 'stderr': {
        started = true;
        if (waitingTimer) clearTimeout(waitingTimer);
        const chunk = fromBase64(String(frame.data_base64 ?? ''));
        if (frame.type === 'stdout') handlers.onStdout?.(chunk);
        else handlers.onStderr?.(chunk);
        return;
      }
      case 'exit':
        started = true;
        finish(() => resolveResult(Number(frame.code)));
        return;
      case 'error':
        finish(() =>
          rejectResult(
            new ExecUnknownError('server_error', String(frame.message ?? 'exec failed'), !started),
          ),
        );
        return;
      default:
        return;
    }
  });

  socket.addEventListener('close', () => {
    // A close before `exit` is the case the spec warns about: the outcome is unknown.
    finish(() =>
      rejectResult(
        new ExecUnknownError(
          'closed_early',
          started
            ? 'The connection closed before the command reported an exit status.'
            : 'The connection closed before the command started.',
          !started,
        ),
      ),
    );
  });

  socket.addEventListener('error', () => {
    finish(() =>
      rejectResult(new ExecUnknownError('closed_early', 'The exec connection failed.', !started)),
    );
  });

  return {
    result,
    write(data) {
      send({ type: 'stdin', data_base64: toBase64(data) });
    },
    closeStdin() {
      send({ type: 'close_stdin' });
    },
    resize(rows, cols) {
      send({ type: 'resize', rows, cols });
    },
    signal(signal) {
      send({ type: 'signal', signal });
    },
  };
}

/** Convenience for the common case: run a command, collect its output, return the code. */
export async function execCollect(
  options: Omit<ExecOptions, 'handlers'>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: Uint8Array[] = [];
  const err: Uint8Array[] = [];
  const decode = (chunks: Uint8Array[]): string =>
    chunks.map((chunk) => new TextDecoder().decode(chunk)).join('');

  const session = startExec({
    ...options,
    handlers: { onStdout: (c) => out.push(c), onStderr: (c) => err.push(c) },
  });
  session.closeStdin();
  const code = await session.result;
  return { code, stdout: decode(out), stderr: decode(err) };
}

export const __internal = { toBase64, fromBase64, encoder };

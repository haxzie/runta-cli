import {
  deleteRuntime,
  getRuntime,
  isRuntaApiError,
  listRuntimes,
  type RuntaClient,
  type Runtime,
} from '@runta/api';
import { fail } from '@runta/utils';

/**
 * Statuses that will never become `running` on their own, so waiting is pointless.
 *
 * `shutdown`, `paused` and `suspended` are deliberately *not* here: those are recoverable by a
 * separate command, and a create that lands in one of them is a different problem from a create
 * that failed. Only genuine failures short-circuit the wait.
 */
const FATAL: ReadonlySet<string> = new Set(['error', 'crashed']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns a runtime name or id into an id.
 *
 * `GET /v2/runtimes/{runtime_id}` rejects a name with `invalid_argument: runtime_id must be a
 * UUID` — verified live, and contrary to the published reference, which describes the parameter
 * as "Runtime UUID or display name". So accepting names is a client responsibility, which is also
 * what the exec WebSocket spec says the production CLI does.
 *
 * Names are not guaranteed unique, so an ambiguous match is an error rather than a coin toss: the
 * alternative is deleting the wrong runtime.
 */
export async function resolveRuntimeId(client: RuntaClient, reference: string): Promise<string> {
  if (UUID.test(reference)) return reference;

  const matches: Runtime[] = [];
  let after: string | undefined;

  // No status filter: resolving has to find stopped and failed runtimes too, or `delete` would
  // be unable to name the ones most in need of deleting.
  for (;;) {
    const { data } = await listRuntimes({
      client,
      query: { limit: 100, ...(after ? { after } : {}) },
      throwOnError: true,
    });
    matches.push(...data.data.filter((runtime: Runtime) => runtime.display_name === reference));
    if (!data.pagination.has_more || !data.pagination.next_cursor) break;
    after = data.pagination.next_cursor;
  }

  if (matches.length === 0) {
    return fail(`Runtime '${reference}' was not found.`, {
      exitCode: 1,
      hint: 'List what exists with `runta list --all`.',
    });
  }
  if (matches.length > 1) {
    return fail(`Runtime name '${reference}' is ambiguous — ${matches.length} runtimes share it.`, {
      exitCode: 1,
      hint: `Use an id instead: ${matches.map((runtime) => runtime.id).join(', ')}`,
    });
  }
  return matches[0]?.id as string;
}

export class RuntimeWaitError extends Error {
  readonly reason: 'timeout' | 'failed';
  readonly runtime: Runtime | undefined;
  constructor(reason: 'timeout' | 'failed', message: string, runtime?: Runtime) {
    super(message);
    this.name = 'RuntimeWaitError';
    this.reason = reason;
    this.runtime = runtime;
  }
}

export interface WaitDeps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Called on each poll, for progress reporting. */
  onPoll?: (runtime: Runtime) => void;
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

const DEFAULTS = { timeoutMs: 180_000, intervalMs: 2_000 };

/**
 * Polls until the runtime is `running`.
 *
 * Creation is asynchronous — `POST /v2/runtimes` returns `status: "creating"` — and the whole
 * point of waiting by default (Improvements.md I-1/P-1) is that the command returns something
 * usable. Stops early on a fatal status rather than burning the full timeout on a runtime that
 * has already failed.
 */
export async function waitUntilRunning(
  client: RuntaClient,
  reference: string,
  deps: WaitDeps,
  options: WaitOptions = {},
): Promise<Runtime> {
  const { timeoutMs, intervalMs } = { ...DEFAULTS, ...options };
  const deadline = deps.now() + timeoutMs;

  for (;;) {
    const { data } = await getRuntime({
      client,
      path: { runtime_id: reference },
      throwOnError: true,
    });
    const runtime = data.data;
    deps.onPoll?.(runtime);

    if (runtime.status === 'running') return runtime;

    if (FATAL.has(runtime.status)) {
      throw new RuntimeWaitError(
        'failed',
        `Runtime '${runtime.display_name}' is ${runtime.status}${
          runtime.error_code ? ` (${runtime.error_code})` : ''
        }.`,
        runtime,
      );
    }

    if (deps.now() >= deadline) {
      throw new RuntimeWaitError(
        'timeout',
        `Runtime '${runtime.display_name}' was still ${runtime.status} after ${Math.round(
          timeoutMs / 1000,
        )}s.`,
        runtime,
      );
    }
    await deps.sleep(intervalMs);
  }
}

/** Polls until the runtime is gone — a 404, or a terminal absence. */
export async function waitUntilDeleted(
  client: RuntaClient,
  reference: string,
  deps: WaitDeps,
  options: WaitOptions = {},
): Promise<void> {
  const { timeoutMs, intervalMs } = { ...DEFAULTS, ...options };
  const deadline = deps.now() + timeoutMs;

  for (;;) {
    let runtime: Runtime;
    try {
      const { data } = await getRuntime({
        client,
        path: { runtime_id: reference },
        throwOnError: true,
      });
      runtime = data.data;
    } catch (error) {
      // Gone is the success condition here, so a 404 ends the wait.
      if (isRuntaApiError(error) && error.status === 404) return;
      throw error;
    }
    deps.onPoll?.(runtime);

    if (deps.now() >= deadline) {
      throw new RuntimeWaitError(
        'timeout',
        `Runtime '${runtime.display_name}' was still ${runtime.status} after ${Math.round(
          timeoutMs / 1000,
        )}s.`,
        runtime,
      );
    }
    await deps.sleep(intervalMs);
  }
}

export interface DeleteResult {
  runtime: Runtime;
  /** False when the API reported the runtime was already gone (204). */
  accepted: boolean;
}

/**
 * Reads the runtime, then deletes it at that revision.
 *
 * `DELETE /v2/runtimes/{id}` requires `expected_revision` and rejects a stale one with 409, so
 * deletion is unavoidably read-then-write. A 409 means something else changed the runtime
 * between our two calls, which is exactly the case optimistic concurrency exists to catch — so
 * re-read once and try again rather than making the user retry a command that would have worked.
 */
export async function deleteAtCurrentRevision(
  client: RuntaClient,
  reference: string,
  attempts = 2,
): Promise<DeleteResult> {
  let last: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data } = await getRuntime({
      client,
      path: { runtime_id: reference },
      throwOnError: true,
    });
    const runtime = data.data;

    try {
      const response = await deleteRuntime({
        client,
        path: { runtime_id: reference },
        query: { expected_revision: runtime.revision },
        throwOnError: true,
      });
      // 202 means deletion was accepted; 204 means it had already completed. Read the status
      // rather than sniffing the body — a 204 has no body, but what the client hands back for
      // "no body" is an implementation detail we should not depend on.
      return {
        runtime: response.data?.data ?? runtime,
        accepted: response.response.status === 202,
      };
    } catch (error) {
      if (isRuntaApiError(error) && error.status === 409) {
        last = error;
        continue;
      }
      throw error;
    }
  }
  throw last;
}

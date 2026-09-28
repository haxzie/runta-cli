import {
  deleteRuntime,
  getRuntime,
  isRuntaApiError,
  listCheckpoints,
  listRuntimeImages,
  listRuntimes,
  type RuntaClient,
  type Runtime,
  type RuntimeImage,
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

  return pick('Runtime', reference, matches, 'List what exists with `runta-next list --all`.');
}

/**
 * Turns an image name or slug into the slug `create` needs.
 *
 * Images carry both — `id: "clean"` and `name: "Clean runtime"` — and the id is what the API
 * accepts. Resolving means `--image "Clean runtime"` works too, which matters because the display
 * name is what the dashboard shows.
 */
export async function resolveImage(client: RuntaClient, reference: string): Promise<RuntimeImage> {
  const { data } = await listRuntimeImages({ client, throwOnError: true });

  // An exact id match wins outright: ids are the canonical form and cannot be ambiguous.
  const byId = data.data.find((image) => image.id === reference);
  if (byId) return byId;

  const matches = data.data
    .filter((image) => image.name === reference)
    .map((image) => ({ id: image.id, display_name: image.name }));

  // Naming the valid ids beats naming a command: there is no `runta-next image list` yet, and we are
  // already holding the full list that would answer the question.
  const id = pick(
    'Image',
    reference,
    matches,
    `Available images: ${data.data.map((image) => image.id).join(', ')}.`,
  );
  return data.data.find((image) => image.id === id) as RuntimeImage;
}

/**
 * The protocol to send for an image that fronts a model provider.
 *
 * `create` against such an image is refused without one, and 12 of the 13 images need it — but
 * four of them bind exactly one protocol, so asking the user to name it would be asking them to
 * repeat information the API already has. Inferred when unambiguous, and an explicit error listing
 * the options when not.
 */
export function modelProviderProtocol(image: RuntimeImage, requested?: string): string | undefined {
  const bindings = image.model_provider?.protocol_bindings ?? [];
  const available = bindings.map((binding) => binding.protocol).filter((p): p is string => !!p);

  if (available.length === 0) return undefined;

  if (requested) {
    if (!available.includes(requested)) {
      return fail(`Image '${image.id}' does not support model-provider protocol '${requested}'.`, {
        exitCode: 2,
        hint: `It supports: ${available.join(', ')}.`,
      });
    }
    return requested;
  }

  if (available.length === 1) return available[0];

  return fail(`Image '${image.id}' supports several model-provider protocols.`, {
    exitCode: 2,
    hint: `Pick one with --model-provider-protocol: ${available.join(', ')}.`,
  });
}

/**
 * Turns a checkpoint name into its UUID.
 *
 * `checkpoint_id` must be a UUID — verified live, it answers `checkpoint_id must be a UUID` for a
 * name — so this is the same client-side resolution runtimes need.
 */
export async function resolveCheckpointId(client: RuntaClient, reference: string): Promise<string> {
  if (UUID.test(reference)) return reference;

  const matches: { id: string; display_name: string }[] = [];
  let after: string | undefined;

  for (;;) {
    const { data } = await listCheckpoints({
      client,
      query: { limit: 100, ...(after ? { after } : {}) },
      throwOnError: true,
    });
    matches.push(...data.data.filter((checkpoint) => checkpoint.display_name === reference));
    if (!data.pagination.has_more || !data.pagination.next_cursor) break;
    after = data.pagination.next_cursor;
  }

  return pick(
    'Checkpoint',
    reference,
    matches,
    'Pass the checkpoint UUID instead — `runta-next checkpoint list` does not exist yet.',
  );
}

/**
 * Shared outcome for every name lookup, so all three read the same way.
 *
 * An ambiguous name is an error rather than a guess. Names are not unique, and silently picking
 * the first match means deleting or restoring the wrong thing some fraction of the time.
 */
function pick(
  noun: string,
  reference: string,
  matches: readonly { id: string; display_name: string }[],
  hint: string,
): string {
  if (matches.length === 0) {
    return fail(`${noun} '${reference}' was not found.`, { exitCode: 1, hint });
  }
  if (matches.length > 1) {
    return fail(`${noun} name '${reference}' is ambiguous — ${matches.length} of them share it.`, {
      exitCode: 1,
      hint: `Use an id instead: ${matches.map((match) => match.id).join(', ')}`,
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
  runtimeId: string,
  deps: WaitDeps,
  options: WaitOptions = {},
): Promise<Runtime> {
  const { timeoutMs, intervalMs } = { ...DEFAULTS, ...options };
  const deadline = deps.now() + timeoutMs;

  for (;;) {
    const { data } = await getRuntime({
      client,
      path: { runtime_id: runtimeId },
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
  runtimeId: string,
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
        path: { runtime_id: runtimeId },
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
  runtimeId: string,
  attempts = 2,
): Promise<DeleteResult> {
  let last: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data } = await getRuntime({
      client,
      path: { runtime_id: runtimeId },
      throwOnError: true,
    });
    const runtime = data.data;

    try {
      const response = await deleteRuntime({
        client,
        path: { runtime_id: runtimeId },
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

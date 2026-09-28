import { RuntaApiError, type RuntaClient, type Runtime } from '@runta/api';
import { isCliError } from '@runta/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAtCurrentRevision,
  modelProviderProtocol,
  RuntimeWaitError,
  resolveCheckpointId,
  resolveImage,
  resolveRuntimeId,
  waitUntilDeleted,
  waitUntilRunning,
} from './runtimes.js';

const ID = '01a0dcc4-2ba7-7353-acb2-7fa79602b0a0';

const runtime = (overrides: Partial<Runtime> = {}): Runtime =>
  ({
    id: ID,
    display_name: 'demo',
    status: 'running',
    desired_status: 'running',
    degraded: false,
    revision: 2,
    image_id: 'clean',
    created_at: '2026-09-26T08:10:39Z',
    updated_at: '2026-09-26T08:10:41Z',
    egress_policy: { mode: 'denylist', denied_hosts: [] },
    idle_policy: { mode: 'disabled' },
    ingress_specs: [],
    resources: {
      current: { memory_mib: 512, observed_disk_gib: 16 },
      limits: { memory_mib: 512 },
      requests: { memory_mib: 512, vcpus: 1, disk_gib: 16 },
    },
    ssh_enabled: true,
    vnc_enabled: false,
    vnc_ready: false,
    vnc_connection: {
      hostname: 'vnc.runta.com',
      port: 5900,
      username: 'runta-next',
      security_type: 'X509Plain',
    },
    owner_user_id: 'u_1',
    can_manage: true,
    llm_tool_io_capture_enabled: false,
    llm_session_content_capture_enabled: true,
    llm_token_saving_policy: {
      json_array_enabled: false,
      log_enabled: false,
      search_results_enabled: false,
      git_diff_enabled: false,
    },
    secret_configuration: [],
    ...overrides,
  }) as Runtime;

/** Routes requests by method+path, shifting matches off so a sequence can be scripted. */
function client(routes: { method: string; path: string; status: number; body?: unknown }[]) {
  const remaining = [...routes];
  const calls: { method: string; url: string }[] = [];

  const fetch = vi.fn(async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    calls.push({ method: request.method, url: request.url });
    const i = remaining.findIndex((r) => r.method === request.method && r.path === url.pathname);
    if (i === -1) throw new Error(`unexpected ${request.method} ${url.pathname}`);
    const [route] = remaining.splice(i, 1);
    if (!route) throw new Error('unreachable');
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: { 'content-type': 'application/json' },
    });
  });

  const real = globalThis.fetch;
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  restores.push(() => {
    globalThis.fetch = real;
  });

  // Built lazily so createRuntaClient is only imported once per suite.
  return { calls, options: { baseUrl: 'https://api.test', token: 't' } };
}

const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  vi.restoreAllMocks();
});

const makeClient = async (routes: Parameters<typeof client>[0]) => {
  const { calls, options } = client(routes);
  const { createRuntaClient } = await import('@runta/api');
  return { client: createRuntaClient(options) as RuntaClient, calls };
};

const page = (runtimes: Runtime[], cursor: string | null = null) => ({
  data: runtimes,
  pagination: { next_cursor: cursor, has_more: cursor !== null },
});

const listRoute = (body: unknown) => ({ method: 'GET', path: '/v2/runtimes', status: 200, body });
const imagesRoute = (images: { id: string; name: string }[]) => ({
  method: 'GET',
  path: '/v2/images',
  status: 200,
  body: { data: images },
});
const checkpointsRoute = (body: unknown) => ({
  method: 'GET',
  path: '/v2/checkpoints',
  status: 200,
  body,
});
const getRoute = (body: unknown, status = 200) => ({
  method: 'GET',
  path: `/v2/runtimes/${ID}`,
  status,
  body,
});

const waitDeps = () => ({ sleep: vi.fn(async () => {}), now: () => 1_000 });

describe('resolveRuntimeId', () => {
  it('passes a UUID straight through without calling the API', async () => {
    const { client: c, calls } = await makeClient([]);

    await expect(resolveRuntimeId(c, ID)).resolves.toBe(ID);
    expect(calls).toHaveLength(0);
  });

  it('resolves a display name to its id', async () => {
    // The API rejects a name on /v2/runtimes/{id} with `runtime_id must be a UUID`, verified
    // live, so this lookup is the only way names can work.
    const { client: c } = await makeClient([listRoute(page([runtime()]))]);

    await expect(resolveRuntimeId(c, 'demo')).resolves.toBe(ID);
  });

  it('walks pages until it finds the name', async () => {
    const other = runtime({ id: 'other-id', display_name: 'nope' });
    const { client: c, calls } = await makeClient([
      listRoute(page([other], 'cursor-1')),
      listRoute(page([runtime()])),
    ]);

    await expect(resolveRuntimeId(c, 'demo')).resolves.toBe(ID);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain('after=cursor-1');
  });

  it('does not filter by status, so stopped runtimes are still resolvable', async () => {
    const { client: c, calls } = await makeClient([
      listRoute(page([runtime({ status: 'shutdown' })])),
    ]);

    await resolveRuntimeId(c, 'demo');

    expect(calls[0]?.url).not.toContain('status=');
  });

  it('fails with a usable message when the name does not exist', async () => {
    const { client: c } = await makeClient([listRoute(page([]))]);

    const error = await resolveRuntimeId(c, 'ghost').catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as Error).message).toContain("'ghost' was not found");
  });

  it('refuses to guess when a name is ambiguous', async () => {
    // Names are not unique. Picking one would mean deleting the wrong runtime half the time.
    const { client: c } = await makeClient([
      listRoute(page([runtime(), runtime({ id: 'second-id' })])),
    ]);

    const error = await resolveRuntimeId(c, 'demo').catch((e: unknown) => e);

    expect((error as Error).message).toContain('ambiguous');
    expect((error as { hint?: string }).hint).toContain('second-id');
  });
});

describe('waitUntilRunning', () => {
  it('returns as soon as the runtime is running', async () => {
    const { client: c } = await makeClient([getRoute({ data: runtime() })]);

    await expect(waitUntilRunning(c, ID, waitDeps())).resolves.toMatchObject({ status: 'running' });
  });

  it('polls through creating', async () => {
    const { client: c, calls } = await makeClient([
      getRoute({ data: runtime({ status: 'creating' }) }),
      getRoute({ data: runtime({ status: 'creating' }) }),
      getRoute({ data: runtime() }),
    ]);

    await waitUntilRunning(c, ID, waitDeps());

    expect(calls).toHaveLength(3);
  });

  it('stops immediately on a fatal status instead of burning the timeout', async () => {
    const { client: c, calls } = await makeClient([
      getRoute({ data: runtime({ status: 'error', error_code: 'image_pull_failed' }) }),
    ]);

    const error = await waitUntilRunning(c, ID, waitDeps()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RuntimeWaitError);
    expect((error as RuntimeWaitError).reason).toBe('failed');
    expect((error as Error).message).toContain('image_pull_failed');
    expect(calls).toHaveLength(1);
  });

  it('keeps waiting on a recoverable status rather than calling it a failure', async () => {
    // paused/suspended/shutdown are a different problem from a failed create, so they must not
    // short-circuit the wait.
    const { client: c } = await makeClient([
      getRoute({ data: runtime({ status: 'suspended' }) }),
      getRoute({ data: runtime() }),
    ]);

    await expect(waitUntilRunning(c, ID, waitDeps())).resolves.toMatchObject({ status: 'running' });
  });

  it('times out with the status it was last stuck in', async () => {
    let clock = 0;
    const { client: c } = await makeClient([
      getRoute({ data: runtime({ status: 'creating' }) }),
      getRoute({ data: runtime({ status: 'creating' }) }),
    ]);

    const error = await waitUntilRunning(
      c,
      ID,
      {
        sleep: async () => {
          clock += 100_000;
        },
        now: () => clock,
      },
      { timeoutMs: 1_000 },
    ).catch((e: unknown) => e);

    expect((error as RuntimeWaitError).reason).toBe('timeout');
    expect((error as Error).message).toContain('creating');
  });
});

describe('waitUntilDeleted', () => {
  it('treats a 404 as success', async () => {
    const { client: c } = await makeClient([
      getRoute({ data: runtime({ status: 'deleting' }) }),
      getRoute({ error: { code: 'not_found', message: 'gone' } }, 404),
    ]);

    await expect(waitUntilDeleted(c, ID, waitDeps())).resolves.toBeUndefined();
  });

  it('propagates a non-404 error rather than waiting it out', async () => {
    const { client: c } = await makeClient([
      getRoute({ error: { code: 'permission_denied', message: 'no' } }, 403),
    ]);

    const error = await waitUntilDeleted(c, ID, waitDeps()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RuntaApiError);
  });
});

describe('deleteAtCurrentRevision', () => {
  it('reads the runtime and deletes at its revision', async () => {
    const { client: c, calls } = await makeClient([
      getRoute({ data: runtime({ revision: 7 }) }),
      { method: 'DELETE', path: `/v2/runtimes/${ID}`, status: 202, body: { data: runtime() } },
    ]);

    const result = await deleteAtCurrentRevision(c, ID);

    expect(result.accepted).toBe(true);
    expect(calls[1]?.url).toContain('expected_revision=7');
  });

  it('re-reads and retries once when the revision went stale', async () => {
    // A 409 means something else changed the runtime between our read and our delete — which is
    // the case optimistic concurrency exists to catch, and is worth absorbing rather than
    // making the user retry a command that would have worked.
    const { client: c, calls } = await makeClient([
      getRoute({ data: runtime({ revision: 7 }) }),
      {
        method: 'DELETE',
        path: `/v2/runtimes/${ID}`,
        status: 409,
        body: { error: { code: 'failed_precondition', message: 'stale' } },
      },
      getRoute({ data: runtime({ revision: 8 }) }),
      { method: 'DELETE', path: `/v2/runtimes/${ID}`, status: 202, body: { data: runtime() } },
    ]);

    await expect(deleteAtCurrentRevision(c, ID)).resolves.toMatchObject({ accepted: true });
    expect(calls[3]?.url).toContain('expected_revision=8');
  });

  it('gives up after the retry budget', async () => {
    const stale = {
      method: 'DELETE',
      path: `/v2/runtimes/${ID}`,
      status: 409,
      body: { error: { code: 'failed_precondition', message: 'stale' } },
    };
    const { client: c } = await makeClient([
      getRoute({ data: runtime() }),
      stale,
      getRoute({ data: runtime() }),
      stale,
    ]);

    const error = await deleteAtCurrentRevision(c, ID).catch((e: unknown) => e);

    expect((error as RuntaApiError).status).toBe(409);
  });

  it('reports a 204 as already gone', async () => {
    const { client: c } = await makeClient([
      getRoute({ data: runtime() }),
      { method: 'DELETE', path: `/v2/runtimes/${ID}`, status: 204 },
    ]);

    await expect(deleteAtCurrentRevision(c, ID)).resolves.toMatchObject({ accepted: false });
  });

  it('propagates an unrelated error untouched', async () => {
    const { client: c } = await makeClient([
      getRoute({ data: runtime() }),
      {
        method: 'DELETE',
        path: `/v2/runtimes/${ID}`,
        status: 403,
        body: { error: { code: 'permission_denied', message: 'no' } },
      },
    ]);

    const error = await deleteAtCurrentRevision(c, ID).catch((e: unknown) => e);

    expect((error as RuntaApiError).status).toBe(403);
  });
});

describe('resolveImage', () => {
  const images = [
    { id: 'clean', name: 'Clean runtime' },
    { id: 'claude', name: 'Claude Code' },
  ];

  it('accepts the slug id unchanged', async () => {
    const { client: c } = await makeClient([imagesRoute(images)]);

    await expect(resolveImage(c, 'clean')).resolves.toMatchObject({ id: 'clean' });
  });

  it('resolves the display name to the slug', async () => {
    // The dashboard shows "Clean runtime"; the API wants "clean".
    const { client: c } = await makeClient([imagesRoute(images)]);

    await expect(resolveImage(c, 'Clean runtime')).resolves.toMatchObject({ id: 'clean' });
  });

  it('prefers an exact id match over a name match', async () => {
    // A hypothetical image named the same as another's id must not shadow the canonical form.
    const { client: c } = await makeClient([
      imagesRoute([
        { id: 'clean', name: 'Clean runtime' },
        { id: 'other', name: 'clean' },
      ]),
    ]);

    await expect(resolveImage(c, 'clean')).resolves.toMatchObject({ id: 'clean' });
  });

  it('lists the available ids when the name is unknown', async () => {
    // There is no `runta-next image list` yet, and we are already holding the answer.
    const { client: c } = await makeClient([imagesRoute(images)]);

    const error = await resolveImage(c, 'Nope').catch((e: unknown) => e);

    expect((error as Error).message).toContain("Image 'Nope' was not found");
    expect((error as { hint?: string }).hint).toContain('clean, claude');
  });

  it('refuses to guess between two images sharing a display name', async () => {
    const { client: c } = await makeClient([
      imagesRoute([
        { id: 'a', name: 'Same' },
        { id: 'b', name: 'Same' },
      ]),
    ]);

    const error = await resolveImage(c, 'Same').catch((e: unknown) => e);

    expect((error as Error).message).toContain('ambiguous');
  });
});

describe('resolveCheckpointId', () => {
  it('passes a UUID straight through', async () => {
    const { client: c, calls } = await makeClient([]);

    await expect(resolveCheckpointId(c, ID)).resolves.toBe(ID);
    expect(calls).toHaveLength(0);
  });

  it('resolves a checkpoint name', async () => {
    // checkpoint_id must be a UUID — the API answers `checkpoint_id must be a UUID` for a name.
    const { client: c } = await makeClient([
      checkpointsRoute({
        data: [{ id: ID, display_name: 'nightly' }],
        pagination: { next_cursor: null, has_more: false },
      }),
    ]);

    await expect(resolveCheckpointId(c, 'nightly')).resolves.toBe(ID);
  });

  it('walks pages', async () => {
    const { client: c, calls } = await makeClient([
      checkpointsRoute({
        data: [{ id: 'x', display_name: 'other' }],
        pagination: { next_cursor: 'c1', has_more: true },
      }),
      checkpointsRoute({
        data: [{ id: ID, display_name: 'nightly' }],
        pagination: { next_cursor: null, has_more: false },
      }),
    ]);

    await expect(resolveCheckpointId(c, 'nightly')).resolves.toBe(ID);
    expect(calls[1]?.url).toContain('after=c1');
  });

  it('says the list command does not exist rather than naming the wrong one', async () => {
    const { client: c } = await makeClient([
      checkpointsRoute({ data: [], pagination: { next_cursor: null, has_more: false } }),
    ]);

    const error = await resolveCheckpointId(c, 'ghost').catch((e: unknown) => e);

    expect((error as { hint?: string }).hint).toContain('does not exist yet');
  });
});

describe('modelProviderProtocol', () => {
  const image = (protocols: string[], id = 'claude') =>
    ({
      id,
      name: id,
      model_provider: { protocol_bindings: protocols.map((protocol) => ({ protocol })) },
    }) as never;

  it('returns nothing for an image with no model provider', () => {
    expect(modelProviderProtocol({ id: 'clean', name: 'Clean' } as never)).toBeUndefined();
  });

  it('infers the only protocol an image binds', () => {
    // `claude` binds anthropic_messages alone, so asking the user to name it would be asking them
    // to repeat what the API already knows.
    expect(modelProviderProtocol(image(['anthropic_messages']))).toBe('anthropic_messages');
  });

  it('accepts an explicit protocol the image supports', () => {
    expect(modelProviderProtocol(image(['openai_chat', 'anthropic_messages']), 'openai_chat')).toBe(
      'openai_chat',
    );
  });

  it('lists the options when the image binds several and none was chosen', () => {
    const error = (() => {
      try {
        modelProviderProtocol(image(['openai_chat', 'anthropic_messages']));
      } catch (e) {
        return e;
      }
    })();

    expect(isCliError(error)).toBe(true);
    expect((error as { hint?: string }).hint).toContain('openai_chat, anthropic_messages');
    expect((error as { exitCode: number }).exitCode).toBe(2);
  });

  it('rejects a protocol the image does not support, and says what it does', () => {
    const error = (() => {
      try {
        modelProviderProtocol(image(['anthropic_messages']), 'openai_chat');
      } catch (e) {
        return e;
      }
    })();

    expect((error as Error).message).toContain(
      "does not support model-provider protocol 'openai_chat'",
    );
    expect((error as { hint?: string }).hint).toContain('anthropic_messages');
  });
});

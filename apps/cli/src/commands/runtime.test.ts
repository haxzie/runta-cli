import type { Runtime } from '@runta/api';
import { isCliError, logger, setLogLevel } from '@runta/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureStdout, isolateEnv, type Route, stubFetch } from '../test/harness.js';
import {
  type CommandDeps,
  create,
  inspect,
  lifecycle,
  list,
  remove,
  resolveAction,
} from './runtime.js';

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
      username: 'runta',
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

const page = (runtimes: Runtime[], cursor: string | null = null) => ({
  data: runtimes,
  pagination: { next_cursor: cursor, has_more: cursor !== null },
});

const LIST = (body: unknown): Route => ({ method: 'GET', path: '/v2/runtimes', status: 200, body });
const GET = (body: unknown, status = 200): Route => ({
  method: 'GET',
  path: `/v2/runtimes/${ID}`,
  status,
  body,
});
const POST = (body: unknown, status = 201): Route => ({
  method: 'POST',
  path: '/v2/runtimes',
  status,
  body,
});
const IMAGES = (
  images: { id: string; name: string }[] = [{ id: 'clean', name: 'Clean runtime' }],
): Route => ({
  method: 'GET',
  path: '/v2/images',
  status: 200,
  body: { data: images },
});
const DEL = (status = 202, body?: unknown): Route => ({
  method: 'DELETE',
  path: `/v2/runtimes/${ID}`,
  status,
  body,
});

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

function harness(routes: Route[]) {
  const stub = stubFetch(routes);
  globalThis.fetch = stub.fetch as unknown as typeof globalThis.fetch;
  const out = captureStdout();
  const deps: CommandDeps = {
    write: out.write,
    sleep: vi.fn(async () => {}),
    now: () => 1_000,
    confirm: vi.fn(async () => true),
    isInteractive: () => false,
  };
  return { stub, out, deps };
}

const bodyOf = async (request: Request): Promise<Record<string, unknown>> =>
  JSON.parse(await request.text()) as Record<string, unknown>;

// ------------------------------------------------------------------ create

describe('create --runtime-sign-in', () => {
  /** An image that fronts a provider and allows an in-runtime sign-in, like `claude`. */
  const signInImage = [
    {
      id: 'claude',
      name: 'Claude Code',
      model_provider: {
        allow_runtime_sign_in: true,
        protocol_bindings: [{ protocol: 'anthropic_messages' }],
      },
    },
  ];

  it('sends runtime_sign_in on the image spec', async () => {
    const { stub, deps } = harness([
      IMAGES(signInImage as never),
      POST({ data: runtime() }),
      GET({ data: runtime() }),
    ]);

    await create({ image: 'claude', runtimeSignIn: true }, deps);

    const post = stub.calls.find((c) => c.method === 'POST');
    const body = await bodyOf(post as Request);
    expect(body.image).toMatchObject({ id: 'claude', runtime_sign_in: true });
  });

  it('omits the field entirely when the flag is absent', async () => {
    const { stub, deps } = harness([
      IMAGES(signInImage as never),
      POST({ data: runtime() }),
      GET({ data: runtime() }),
    ]);

    await create({ image: 'claude' }, deps);

    const body = await bodyOf(stub.calls.find((c) => c.method === 'POST') as Request);
    expect(body.image).not.toHaveProperty('runtime_sign_in');
  });

  /**
   * The flag waives a check; it does not authenticate anything. The runtime comes up `running`,
   * `degraded: false`, with an agent that cannot reach a model — and the production CLI says
   * nothing at all about it (CLI_ISSUES.md C-33). Saying so is the point of supporting it.
   */
  it('says the agent is not signed in yet', async () => {
    const { deps } = harness([
      IMAGES(signInImage as never),
      POST({ data: runtime() }),
      GET({ data: runtime() }),
    ]);
    const info = vi.spyOn(logger, 'success').mockImplementation(() => {});

    await create({ image: 'claude', runtimeSignIn: true }, deps);

    expect(info.mock.calls.flat().join(' ')).toMatch(/not signed in yet/);
  });

  it('adds sign_in_pending to the JSON, which the runtime object has no field for', async () => {
    const { out, deps } = harness([
      IMAGES(signInImage as never),
      POST({ data: runtime() }),
      GET({ data: runtime() }),
    ]);

    await create({ image: 'claude', runtimeSignIn: true, json: true }, deps);

    const payload = JSON.parse(out.text) as Record<string, unknown>;
    expect(payload.sign_in_pending).toBe(true);
    expect(payload.status).toBe('running');
  });

  it('leaves the JSON untouched without the flag', async () => {
    const { out, deps } = harness([
      IMAGES(signInImage as never),
      POST({ data: runtime() }),
      GET({ data: runtime() }),
    ]);

    await create({ image: 'claude', json: true }, deps);

    expect(JSON.parse(out.text)).not.toHaveProperty('sign_in_pending');
  });

  it('refuses an image that cannot be signed into, before any request', async () => {
    const { stub, deps } = harness([IMAGES()]);

    const error = await create({ image: 'clean', runtimeSignIn: true }, deps).catch(
      (e: unknown) => e,
    );

    expect(isCliError(error)).toBe(true);
    expect(String(error)).toMatch(/does not support signing in/);
    expect((error as { exitCode?: number }).exitCode).toBe(2);
    expect(stub.calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('create', () => {
  it('waits until the runtime is running and reports how to use it', async () => {
    const { out, deps } = harness([
      POST({ data: runtime({ status: 'creating' }) }),
      GET({ data: runtime({ status: 'creating' }) }),
      GET({ data: runtime() }),
    ]);

    await create({}, deps);

    // Progress goes to stderr; stdout stays empty in non-JSON mode.
    expect(out.text).toBe('');
    expect(deps.sleep).toHaveBeenCalled();
  });

  it('puts cpus, memory and disk under resources.requests, not at the top level', async () => {
    const { stub, deps } = harness([POST({ data: runtime() })]);

    await create({ cpus: '2', memory: '2048', memoryMax: '4096', disk: '32', detach: true }, deps);

    const body = await bodyOf(stub.calls[0] as Request);
    expect(body).toEqual({
      resources: {
        requests: { vcpus: 2, memory_mib: 2048, disk_gib: 32 },
        limits: { memory_mib: 4096 },
      },
    });
  });

  it('translates --publish into ingress specs', async () => {
    const { stub, deps } = harness([POST({ data: runtime() })]);

    await create({ publish: ['8080/https', '3000/http'], detach: true }, deps);

    expect((await bodyOf(stub.calls[0] as Request)).ingress_specs).toEqual([
      { protocol: 'https', runtime_port: 8080 },
      { protocol: 'http', runtime_port: 3000 },
    ]);
  });

  it('rejects a malformed --publish before calling the API', async () => {
    const { stub, deps } = harness([]);

    const error = await create({ publish: ['8080'], detach: true }, deps).catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as { exitCode: number }).exitCode).toBe(2);
    expect(stub.calls).toHaveLength(0);
  });

  it('rejects a non-numeric --cpus', async () => {
    const { deps } = harness([]);

    const error = await create({ cpus: 'two', detach: true }, deps).catch((e: unknown) => e);

    expect((error as { exitCode: number }).exitCode).toBe(2);
  });

  it('requires --idle-timeout with a suspending idle mode', async () => {
    const { deps } = harness([]);

    const error = await create({ idleMode: 'suspend_only', detach: true }, deps).catch(
      (e: unknown) => e,
    );

    expect((error as Error).message).toContain('--idle-timeout is required');
  });

  it('refuses size flags alongside --from-checkpoint instead of ignoring them', async () => {
    // The checkpoint fixes hardware and image, so accepting --cpus would silently discard it.
    const { deps } = harness([]);

    const error = await create({ fromCheckpoint: 'ck_1', cpus: '4', detach: true }, deps).catch(
      (e: unknown) => e,
    );

    expect((error as Error).message).toContain('--cpus cannot be combined with --from-checkpoint');
  });

  it('resolves an image display name to its slug before creating', async () => {
    const { stub, deps } = harness([IMAGES(), POST({ data: runtime() })]);

    await create({ image: 'Clean runtime', detach: true }, deps);

    expect(await bodyOf(stub.calls[1] as Request)).toEqual({ image: { id: 'clean' } });
  });

  it('infers the model-provider protocol for an image that binds exactly one', async () => {
    // 12 of 13 images are refused without a protocol, and four bind only one — so demanding it
    // would be demanding the user repeat what the API already knows.
    const { stub, deps } = harness([
      IMAGES([
        {
          id: 'claude',
          name: 'Claude Code',
          model_provider: { protocol_bindings: [{ protocol: 'anthropic_messages' }] },
        } as never,
      ]),
      POST({ data: runtime() }),
    ]);

    await create({ image: 'claude', detach: true }, deps);

    expect(await bodyOf(stub.calls[1] as Request)).toEqual({
      image: { id: 'claude', model_provider_protocol: 'anthropic_messages' },
    });
  });

  it('asks which protocol when the image binds several', async () => {
    const { stub, deps } = harness([
      IMAGES([
        {
          id: 'kimi',
          name: 'Kimi',
          model_provider: {
            protocol_bindings: [{ protocol: 'anthropic_messages' }, { protocol: 'openai_chat' }],
          },
        } as never,
      ]),
    ]);

    const error = await create({ image: 'kimi', detach: true }, deps).catch((e: unknown) => e);

    expect((error as { hint?: string }).hint).toContain('anthropic_messages, openai_chat');
    expect(stub.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it("turns the API's missing-secret refusal into something actionable", async () => {
    const { deps } = harness([
      IMAGES(),
      POST(
        {
          error: {
            code: 'invalid_argument',
            message:
              'invalid argument: the selected runtime image reads its model-provider credential from ANTHROPIC_API_KEY, which no secret in this request populates',
          },
        },
        422,
      ),
    ]);

    const error = await create({ image: 'clean', detach: true }, deps).catch((e: unknown) => e);

    expect((error as { hint?: string }).hint).toContain('dashboard.runta.com');
  });

  it('adds a 5xx hint, because those bodies are often not JSON', async () => {
    // Runta's API 520s intermittently, and the bare message degrades to `520 <none>`.
    const { deps } = harness([
      { method: 'POST', path: '/v2/runtimes', status: 503, body: undefined },
    ]);

    const error = await create({ detach: true }, deps).catch((e: unknown) => e);

    expect((error as { hint?: string }).hint).toContain('transient');
  });

  it('sends checkpoint_id when restoring', async () => {
    // `checkpoint_id` must be a UUID, so a name is resolved first — same as runtimes.
    const { stub, deps } = harness([
      {
        method: 'GET',
        path: '/v2/checkpoints',
        status: 200,
        body: {
          data: [{ id: ID, display_name: 'nightly' }],
          pagination: { next_cursor: null, has_more: false },
        },
      },
      POST({ data: runtime() }),
    ]);

    await create({ fromCheckpoint: 'nightly', name: 'restored', detach: true }, deps);

    expect(await bodyOf(stub.calls[1] as Request)).toEqual({
      name: 'restored',
      checkpoint_id: ID,
    });
  });

  it('does not poll at all with --detach', async () => {
    const { stub, deps } = harness([POST({ data: runtime({ status: 'creating' }) })]);

    await create({ detach: true }, deps);

    expect(stub.calls).toHaveLength(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('prints the runtime as JSON with --json', async () => {
    const { out, deps } = harness([POST({ data: runtime() }), GET({ data: runtime() })]);

    await create({ json: true }, deps);

    expect(JSON.parse(out.text)).toMatchObject({ id: ID, status: 'running' });
  });
});

// ------------------------------------------------------------------ list

describe('list', () => {
  it('filters to active states by default, including creating', async () => {
    // A runtime missing from the listing seconds after you create it is the C-15 trap.
    const { stub, deps } = harness([LIST(page([runtime()]))]);

    await list({}, deps);

    const url = new URL((stub.calls[0] as Request).url);
    expect(url.searchParams.get('status')).toBe('running,creating,paused,suspended');
  });

  it('sends no status filter with --all', async () => {
    const { stub, deps } = harness([LIST(page([runtime()]))]);

    await list({ all: true }, deps);

    expect(new URL((stub.calls[0] as Request).url).searchParams.has('status')).toBe(false);
  });

  it('lets an explicit --status win over --all', async () => {
    const { stub, deps } = harness([LIST(page([runtime()]))]);

    await list({ all: true, status: 'error' }, deps);

    expect(new URL((stub.calls[0] as Request).url).searchParams.get('status')).toBe('error');
  });

  it('follows pagination cursors', async () => {
    const { stub, deps } = harness([
      LIST(page([runtime()], 'cursor-1')),
      LIST(page([runtime({ id: 'b', display_name: 'second' })])),
    ]);

    await list({}, deps);

    expect(stub.calls).toHaveLength(2);
    expect(new URL((stub.calls[1] as Request).url).searchParams.get('after')).toBe('cursor-1');
  });

  it('stops at --limit without fetching another page', async () => {
    const { stub, out, deps } = harness([
      LIST(page([runtime(), runtime({ id: 'b', display_name: 'two' })], 'more')),
    ]);

    await list({ limit: '2' }, deps);

    expect(stub.calls).toHaveLength(1);
    expect(out.text.split('\n')).toHaveLength(4); // header + 2 rows + trailing newline
  });

  it('renders a table with a header', async () => {
    const { out, deps } = harness([LIST(page([runtime()]))]);

    await list({}, deps);

    expect(out.text).toContain('NAME');
    expect(out.text).toContain('demo');
    expect(out.text).toContain('512 MiB');
  });

  it('marks a degraded runtime in the status column', async () => {
    const { out, deps } = harness([LIST(page([runtime({ degraded: true })]))]);

    await list({}, deps);

    expect(out.text).toContain('running (degraded)');
  });

  it('writes nothing to stdout for an empty list, so a pipe gets nothing to parse', async () => {
    const { out, deps } = harness([LIST(page([]))]);

    await list({}, deps);

    expect(out.text).toBe('');
  });

  it('emits a JSON array with --json', async () => {
    const { out, deps } = harness([LIST(page([runtime()]))]);

    await list({ json: true }, deps);

    expect(JSON.parse(out.text)).toHaveLength(1);
  });

  it('narrows the table to --fields, in the order asked for', async () => {
    const { out, deps } = harness([LIST(page([runtime()]))]);

    await list({ fields: 'vcpus,name' }, deps);

    const [header] = out.text.split('\n');
    expect(header).toContain('VCPUS');
    expect(header).toContain('NAME');
    expect(header?.indexOf('VCPUS')).toBeLessThan(header?.indexOf('NAME') as number);
    expect(header).not.toContain('IMAGE');
    expect(header).not.toContain('CREATED');
  });

  it('keys --json by the same field names, so one vocabulary covers both halves', async () => {
    const { out, deps } = harness([LIST(page([runtime()]))]);

    await list({ json: true, fields: 'name,vcpus' }, deps);

    expect(JSON.parse(out.text)).toEqual([{ name: 'demo', vcpus: 1 }]);
  });

  it('gives --json numbers rather than rendered cells, so a script need not parse units', async () => {
    const { out, deps } = harness([LIST(page([runtime()]))]);

    await list({ json: true, fields: 'memory' }, deps);

    // The table says '512 MiB'; the machine half must not make a caller strip the suffix.
    expect(JSON.parse(out.text)).toEqual([{ memory: 512 }]);
  });

  it('leaves the --json payload untouched without --fields', async () => {
    const { out, deps } = harness([LIST(page([runtime()]))]);

    await list({ json: true }, deps);

    // The default contract is the API's own object; --fields is additive, not a replacement.
    expect(JSON.parse(out.text)[0]).toHaveProperty('display_name', 'demo');
  });

  it('rejects an unknown field before calling the API, naming it and the valid ones', async () => {
    const { stub, deps } = harness([]);

    const error = await list({ fields: 'name,vcpu' }, deps).catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as { exitCode: number }).exitCode).toBe(2);
    expect((error as { message: string }).message).toContain('vcpu');
    expect((error as { hint?: string }).hint).toContain('vcpus');
    // A short row a caller might act on is worse than an error, so nothing is fetched.
    expect(stub.calls).toHaveLength(0);
  });

  it('rejects an empty --fields', async () => {
    const { deps } = harness([]);

    const error = await list({ fields: ' , ' }, deps).catch((e: unknown) => e);

    expect((error as { exitCode: number }).exitCode).toBe(2);
  });

  it('treats a repeated field as one column rather than an error', async () => {
    const { out, deps } = harness([LIST(page([runtime()]))]);

    await list({ json: true, fields: 'name,name' }, deps);

    expect(JSON.parse(out.text)).toEqual([{ name: 'demo' }]);
  });
});

// ------------------------------------------------------------------ inspect

describe('inspect', () => {
  it('shows detail the list table does not', async () => {
    // The production CLI renders inspect as the same table as ps — see C-07.
    const { out, deps } = harness([LIST(page([runtime()])), GET({ data: runtime() })]);

    await inspect('demo', {}, deps);

    for (const label of ['Name', 'ID', 'Status', 'Egress', 'Ingress', 'Idle policy', 'Revision']) {
      expect(out.text).toContain(label);
    }
  });

  it('describes an empty denylist as open, not as a denylist', async () => {
    const { out, deps } = harness([GET({ data: runtime() })]);

    await inspect(ID, {}, deps);

    expect(out.text).toContain('open — no restrictions');
  });

  it('describes an empty allowlist as blocked', async () => {
    // These two render identically in the production CLI, which is the C-10 problem.
    const { out, deps } = harness([
      GET({ data: runtime({ egress_policy: { mode: 'allowlist', allowed_hosts: [] } }) }),
    ]);

    await inspect(ID, {}, deps);

    expect(out.text).toContain('BLOCKED');
  });

  it('names the allowed hosts when there are some', async () => {
    const { out, deps } = harness([
      GET({ data: runtime({ egress_policy: { mode: 'allowlist', allowed_hosts: ['pypi.org'] } }) }),
    ]);

    await inspect(ID, {}, deps);

    expect(out.text).toContain('allowlist — only pypi.org');
  });

  it('shows the desired status only when it differs', async () => {
    const { out, deps } = harness([
      GET({ data: runtime({ status: 'running', desired_status: 'shutdown' }) }),
    ]);

    await inspect(ID, {}, deps);

    expect(out.text).toContain('Desired');
  });

  it('prints the raw runtime with --json', async () => {
    const { out, deps } = harness([GET({ data: runtime() })]);

    await inspect(ID, { json: true }, deps);

    expect(JSON.parse(out.text)).toMatchObject({ id: ID, revision: 2 });
  });
});

// ------------------------------------------------------------------ delete

describe('delete', () => {
  it('resolves and reports the plan without mutating anything on --dry-run', async () => {
    const { stub, out, deps } = harness([GET({ data: runtime() })]);

    await remove([ID], { dryRun: true }, deps);

    expect(out.text).toContain('Would delete 1 runtime(s)');
    expect(out.text).toContain('currently running');
    expect(stub.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('emits a machine-readable plan on --dry-run --json', async () => {
    // An agent needs the plan as data to show a user before acting.
    const { out, deps } = harness([GET({ data: runtime() })]);

    await remove([ID], { dryRun: true, json: true }, deps);

    expect(JSON.parse(out.text)).toEqual({
      action: 'delete',
      dry_run: true,
      runtimes: [{ id: ID, name: 'demo', status: 'running', revision: 2 }],
    });
  });

  it('deletes and waits until the runtime is gone', async () => {
    const { out, deps } = harness([
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      DEL(202, { data: runtime() }),
      GET({ error: { code: 'not_found', message: 'gone' } }, 404),
      LIST(page([runtime({ id: 'other', display_name: 'other' })])),
    ]);

    await remove([ID], { yes: true }, deps);

    expect(out.text).toBe('');
  });

  it('points at create only when nothing is left', async () => {
    // `runta-next list` after a delete would be noise — you know what you deleted. Reaching zero is the
    // one state worth naming.
    // isolateEnv silences the logger so test output stays readable; this test is about what the
    // logger says, so turn it back up for the duration.
    setLogLevel('info');
    const stderr: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.join(' '));
    });
    const { deps } = harness([
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      DEL(202, { data: runtime() }),
      GET({ error: { code: 'not_found', message: 'gone' } }, 404),
      LIST(page([])),
    ]);

    await remove([ID], { yes: true }, deps);

    expect(stderr.join('\n')).toContain('no runtimes left');
    setLogLevel('silent');
  });

  it('skips waiting with --detach', async () => {
    const { stub, deps } = harness([
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      DEL(202, { data: runtime() }),
    ]);

    await remove([ID], { yes: true, detach: true }, deps);

    expect(stub.unmatched).toHaveLength(0);
  });

  it('prompts before deleting when a human is present', async () => {
    const { deps } = harness([
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      DEL(202, { data: runtime() }),
      GET({ error: { code: 'not_found', message: 'gone' } }, 404),
      LIST(page([])),
    ]);
    deps.isInteractive = () => true;

    await remove([ID], {}, deps);

    expect(deps.confirm).toHaveBeenCalledWith(expect.stringContaining('demo'));
  });

  it('aborts without deleting when the prompt is declined', async () => {
    const { stub, deps } = harness([GET({ data: runtime() })]);
    deps.isInteractive = () => true;
    deps.confirm = vi.fn(async () => false);

    const error = await remove([ID], {}, deps).catch((e: unknown) => e);

    expect((error as Error).message).toBe('Aborted.');
    expect(stub.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('never prompts in JSON mode, so a script cannot hang on it', async () => {
    const { deps } = harness([
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      DEL(202, { data: runtime() }),
      GET({ error: { code: 'not_found', message: 'gone' } }, 404),
      LIST(page([])),
    ]);
    deps.isInteractive = () => true;

    await remove([ID], { json: true }, deps);

    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it('reports the result as JSON', async () => {
    const { out, deps } = harness([
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      DEL(202, { data: runtime() }),
      GET({ error: { code: 'not_found', message: 'gone' } }, 404),
      LIST(page([])),
    ]);

    await remove([ID], { yes: true, json: true }, deps);

    expect(JSON.parse(out.text)).toEqual({
      action: 'delete',
      runtimes: [{ name: 'demo', id: ID, deleted: true }],
    });
  });
});

// ---------------------------------------------------------------- lifecycle

/** `POST /v2/runtimes/{id}/<verb>` */
const ACT = (verb: string, body?: unknown, status = 200): Route => ({
  method: 'POST',
  path: `/v2/runtimes/${ID}/${verb}`,
  status,
  body: body ?? { data: runtime() },
});

describe('resolveAction', () => {
  /**
   * The table that fixes the original CLI's worst lifecycle wart: it ships `boot` for a shut-down
   * runtime and `resume` for a paused one, so the user has to know the state before they can name
   * the verb, and naming the wrong one is an API error rather than a no-op.
   */
  it('sends start to /start and resume to /resume, from one command', () => {
    expect(resolveAction('start', runtime({ status: 'shutdown' }))).toBe('start');
    expect(resolveAction('start', runtime({ status: 'paused' }))).toBe('resume');
    // Only the idle policy produces `suspended`, and it is memory-suspended, so it resumes.
    expect(resolveAction('start', runtime({ status: 'suspended' }))).toBe('resume');
  });

  it('treats a request for the state you are already in as nothing to do', () => {
    expect(resolveAction('start', runtime({ status: 'running' }))).toBeNull();
    expect(resolveAction('stop', runtime({ status: 'shutdown' }))).toBeNull();
    expect(resolveAction('pause', runtime({ status: 'paused' }))).toBeNull();
    // Already on its way to running.
    expect(resolveAction('start', runtime({ status: 'creating' }))).toBeNull();
  });

  it('can stop a parked runtime, but cannot pause one', () => {
    expect(resolveAction('stop', runtime({ status: 'paused' }))).toBe('stop');
    expect(resolveAction('stop', runtime({ status: 'suspended' }))).toBe('stop');
    expect(resolveAction('pause', runtime({ status: 'suspended' }))).toBeUndefined();
    expect(resolveAction('pause', runtime({ status: 'shutdown' }))).toBeUndefined();
  });

  it('refuses every verb on a runtime no verb can fix', () => {
    for (const status of ['error', 'crashed'] as const) {
      for (const action of ['start', 'stop', 'pause'] as const) {
        expect(resolveAction(action, runtime({ status }))).toBeUndefined();
      }
    }
  });
});

describe('lifecycle', () => {
  it('stops a runtime and waits until it is really shut down', async () => {
    const { stub, out, deps } = harness([
      LIST(page([runtime()])),
      GET({ data: runtime() }), // resolve + read revision
      GET({ data: runtime() }), // transitionAtCurrentRevision re-reads
      ACT('stop'),
      GET({ data: runtime({ status: 'shutdown', desired_status: 'shutdown' }) }),
    ]);

    await lifecycle('stop', 'demo', { json: true }, deps);

    expect(JSON.parse(out.text)).toMatchObject({
      action: 'stop',
      changed: true,
      runtime: { name: 'demo', status: 'shutdown' },
    });
    expect(stub.calls.some((c) => new URL(c.url).pathname.endsWith('/stop'))).toBe(true);
  });

  it('sends expected_revision, so a concurrent change cannot be clobbered', async () => {
    const { stub, deps } = harness([
      LIST(page([runtime({ revision: 9 })])),
      GET({ data: runtime({ revision: 9 }) }),
      GET({ data: runtime({ revision: 9 }) }),
      ACT('pause'),
      GET({ data: runtime({ status: 'paused' }) }),
    ]);

    await lifecycle('pause', 'demo', { json: true }, deps);

    const call = stub.calls.find((c) => new URL(c.url).pathname.endsWith('/pause'));
    expect(new URL(call?.url ?? '').searchParams.get('expected_revision')).toBe('9');
  });

  /**
   * The response to a transition still carries the *old* status, because the control plane has only
   * accepted the request at that point. The production CLI returns that body as its answer, so
   * `pause` reports `running` (CLI_ISSUES.md C-14). Ours must report what polling found.
   */
  it('reports the settled status, not the one the transition response echoed', async () => {
    const { out, deps } = harness([
      LIST(page([runtime()])),
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      ACT('pause', { data: runtime({ status: 'running' }) }), // stale, as the real API is
      GET({ data: runtime({ status: 'running' }) }), // still catching up
      GET({ data: runtime({ status: 'paused', desired_status: 'paused' }) }),
    ]);

    await lifecycle('pause', 'demo', { json: true }, deps);

    expect(JSON.parse(out.text)).toMatchObject({ waited: true, runtime: { status: 'paused' } });
  });

  it('returns immediately with --detach, without polling', async () => {
    const { stub, out, deps } = harness([
      LIST(page([runtime()])),
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      ACT('stop'),
    ]);

    await lifecycle('stop', 'demo', { detach: true, json: true }, deps);

    // Under --detach the status is the pre-transition one, so the payload has to say so rather
    // than presenting `running` as the outcome of a stop (C-14).
    expect(JSON.parse(out.text)).toMatchObject({
      accepted: true,
      changed: true,
      waited: false,
      target_status: 'shutdown',
      runtime: { status: 'running' },
    });
    // Two reads to resolve and transition; none after.
    expect(stub.calls.filter((c) => new URL(c.url).pathname === `/v2/runtimes/${ID}`).length).toBe(
      2,
    );
  });

  it('is idempotent: stopping a stopped runtime makes no request', async () => {
    const { stub, out, deps } = harness([
      LIST(page([runtime({ status: 'shutdown' })])),
      GET({ data: runtime({ status: 'shutdown' }) }),
    ]);

    await lifecycle('stop', 'demo', { json: true }, deps);

    expect(JSON.parse(out.text)).toMatchObject({
      changed: false,
      reason: 'already_in_state',
    });
    expect(stub.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('refuses a transition that cannot apply, naming the state', async () => {
    const { deps } = harness([
      LIST(page([runtime({ status: 'crashed' })])),
      GET({ data: runtime({ status: 'crashed' }) }),
    ]);

    const error = await lifecycle('pause', 'demo', {}, deps).catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect(String(error)).toMatch(/is crashed, which `pause` cannot change/);
  });

  it('dry run resolves the real plan and sends nothing', async () => {
    const { stub, out, deps } = harness([
      LIST(page([runtime({ status: 'paused', revision: 4 })])),
      GET({ data: runtime({ status: 'paused', revision: 4 }) }),
    ]);

    await lifecycle('start', 'demo', { dryRun: true, json: true }, deps);

    expect(JSON.parse(out.text)).toMatchObject({
      action: 'start',
      dry_run: true,
      endpoint: 'resume',
      target_status: 'running',
      revision: 4,
    });
    expect(stub.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('retries once when the revision went stale underneath it', async () => {
    const { stub, deps } = harness([
      LIST(page([runtime()])),
      GET({ data: runtime({ revision: 2 }) }),
      GET({ data: runtime({ revision: 2 }) }),
      ACT('stop', { error: { code: 'conflict', message: 'stale revision' } }, 409),
      GET({ data: runtime({ revision: 3 }) }),
      ACT('stop'),
      GET({ data: runtime({ status: 'shutdown' }) }),
    ]);

    await lifecycle('stop', 'demo', { json: true }, deps);

    const revisions = stub.calls
      .filter((c) => new URL(c.url).pathname.endsWith('/stop'))
      .map((c) => new URL(c.url).searchParams.get('expected_revision'));
    expect(revisions).toEqual(['2', '3']);
  });

  it('emits four fields, not the whole runtime object', async () => {
    const { out, deps } = harness([
      LIST(page([runtime()])),
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      ACT('pause'),
      GET({ data: runtime({ status: 'paused' }) }),
    ]);

    await lifecycle('pause', 'demo', { json: true }, deps);

    // C-22: the production CLI returns all 45 fields to convey one state change.
    expect(Object.keys(JSON.parse(out.text).runtime).sort()).toEqual([
      'desired_status',
      'id',
      'name',
      'status',
    ]);
  });

  it('never suggests the command that just ran', async () => {
    setLogLevel('info');
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
    const { deps } = harness([
      LIST(page([runtime()])),
      GET({ data: runtime() }),
      GET({ data: runtime() }),
      ACT('stop'),
      GET({ data: runtime({ status: 'shutdown' }) }),
    ]);

    await lifecycle('stop', 'demo', {}, deps);

    // C-11: upstream's `resume` answers `required_action: runta resume <name>`, which loops.
    const suggestions = lines.filter((l) => l.includes('runta-next '));
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((l) => /runta-next stop\b/.test(l))).toBe(false);
    expect(suggestions.some((l) => /runta-next start\b/.test(l))).toBe(true);
  });
});

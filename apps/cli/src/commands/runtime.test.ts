import type { Runtime } from '@runta/api';
import { isCliError } from '@runta/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureStdout, isolateEnv, type Route, stubFetch } from '../test/harness.js';
import { type CommandDeps, create, inspect, list, remove } from './runtime.js';

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

  it('sends checkpoint_id when restoring', async () => {
    const { stub, deps } = harness([POST({ data: runtime() })]);

    await create({ fromCheckpoint: 'ck_1', name: 'restored', detach: true }, deps);

    expect(await bodyOf(stub.calls[0] as Request)).toEqual({
      name: 'restored',
      checkpoint_id: 'ck_1',
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
    ]);

    await remove([ID], { yes: true }, deps);

    expect(out.text).toBe('');
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
    ]);

    await remove([ID], { yes: true, json: true }, deps);

    expect(JSON.parse(out.text)).toEqual({
      action: 'delete',
      runtimes: [{ name: 'demo', id: ID, deleted: true }],
    });
  });
});

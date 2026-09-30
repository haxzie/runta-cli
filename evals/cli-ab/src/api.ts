/**
 * A deliberately tiny REST client for fixtures, graders and cleanup.
 *
 * Independent of both CLIs under test — and of `@runta/api`, which is runta-next's own client — so
 * neither arm's code decides what "correct" means. Shapes follow `packages/api/openapi.json`.
 */

export type RuntimeStatus =
  | 'running'
  | 'paused'
  | 'shutdown'
  | 'creating'
  | 'deleting'
  | 'error'
  | 'crashed'
  | 'suspended'
  | 'unavailable';

export interface Runtime {
  id: string;
  display_name: string;
  status: RuntimeStatus;
  revision: number;
  image_id: string;
  egress_policy:
    | { mode: 'denylist'; denied_hosts: string[] }
    | { mode: 'allowlist'; allowed_hosts: string[] };
  idle_policy: { mode: string; suspend_after_secs?: number };
  ingress_specs: { protocol: 'http' | 'https'; runtime_port: number }[];
  resources: {
    current: { memory_mib: number; observed_disk_gib: number };
    limits: { memory_mib: number };
    requests: { memory_mib: number; vcpus: number; disk_gib?: number };
  };
}

export interface CreateRuntime {
  name: string;
  image?: { id: string };
  resources?: {
    requests?: { vcpus?: number; memory_mib?: number; disk_gib?: number };
    limits?: { memory_mib: number };
  };
  egress_policy?: Runtime['egress_policy'];
  idle_policy?: Runtime['idle_policy'];
  ingress_specs?: Runtime['ingress_specs'];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what} → ${status}: ${body.slice(0, 300)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Api {
  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://api.runta.com',
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/json',
        'user-agent': 'runta-cli-ab-eval',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return res;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.request(method, path, body);
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, text, `${method} ${path}`);
    return JSON.parse(text) as T;
  }

  /** Every runtime in the tenant, in every status, following cursors. */
  async listAll(): Promise<Runtime[]> {
    const out: Runtime[] = [];
    let after: string | null = null;
    do {
      const qs: string = `limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      const page: { data: Runtime[]; pagination?: { next_cursor: string | null } } =
        await this.json('GET', `/v2/runtimes?${qs}`);
      out.push(...page.data);
      after = page.pagination?.next_cursor ?? null;
    } while (after);
    return out;
  }

  async listByPrefix(prefix: string): Promise<Runtime[]> {
    return (await this.listAll()).filter((r) => r.display_name.startsWith(prefix));
  }

  /** `undefined` when the runtime is gone. */
  async get(id: string): Promise<Runtime | undefined> {
    const res = await this.request('GET', `/v2/runtimes/${id}`);
    if (res.status === 404) return undefined;
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, text, `GET /v2/runtimes/${id}`);
    return (JSON.parse(text) as { data: Runtime }).data;
  }

  async create(body: CreateRuntime): Promise<Runtime> {
    const req = { image: { id: 'clean' }, ...body };
    return (await this.json<{ data: Runtime }>('POST', '/v2/runtimes', req)).data;
  }

  async waitFor(id: string, done: (r: Runtime) => boolean, timeoutMs = 240_000): Promise<Runtime> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const r = await this.get(id);
      if (!r) throw new Error(`runtime ${id} disappeared while waiting`);
      if (done(r)) return r;
      if (r.status === 'error' || r.status === 'crashed') {
        throw new Error(`runtime ${r.display_name} (${id}) reached ${r.status}`);
      }
      if (Date.now() > deadline)
        throw new Error(`timed out waiting on ${r.display_name}: ${r.status}`);
      await sleep(3000);
    }
  }

  async createRunning(body: CreateRuntime): Promise<Runtime> {
    const r = await this.create(body);
    return this.waitFor(r.id, (x) => x.status === 'running');
  }

  /** Deletes and does not wait. A 404 or 204 counts as already gone. */
  async delete(id: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this.get(id);
      if (!r || r.status === 'deleting') return;
      const res = await this.request(
        'DELETE',
        `/v2/runtimes/${id}?expected_revision=${r.revision}`,
      );
      if (res.ok || res.status === 404) return;
      if (res.status !== 409) throw new ApiError(res.status, await res.text(), `DELETE ${id}`);
    }
  }

  /**
   * The image catalog, which T15 grades against.
   *
   * Read through the REST API rather than either CLI on purpose: the grader must know the truth
   * independently of the tool being measured, and here the two CLIs disagree about what the word
   * "image" even returns — `runta image ls` lists only images the organization built.
   */
  async images(): Promise<{ id: string; name: string; needsProvider: boolean }[]> {
    const res = await this.request('GET', '/v2/images');
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, text, 'GET /v2/images');
    const { data } = JSON.parse(text) as {
      data: { id: string; name: string; model_provider?: unknown }[];
    };
    return data.map((i) => ({ id: i.id, name: i.name, needsProvider: Boolean(i.model_provider) }));
  }

  /** Probes `GET /v2/me`: org API keys get a 403 there (packages/api/NOTES.md §5). */
  async me(): Promise<{ email: string } | 'org_api_key'> {
    const res = await this.request('GET', '/v2/me');
    if (res.status === 403) return 'org_api_key';
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, text, 'GET /v2/me');
    return (JSON.parse(text) as { data: { email: string } }).data;
  }
}

import {
  createRuntime,
  getRuntime,
  listRuntimes,
  RuntaApiError,
  type RuntaClient,
  type Runtime,
} from '@runta/api';
import {
  createContext,
  deleteAtCurrentRevision,
  RuntimeWaitError,
  resolveCheckpointId,
  resolveImageId,
  resolveRuntimeId,
  waitUntilDeleted,
  waitUntilRunning,
} from '@runta/core';
import { type Column, fail, logger, renderTable } from '@runta/utils';
import type { Command } from 'commander';

/**
 * Statuses `list` shows by default.
 *
 * `creating` is in here deliberately: the production CLI filters to running+suspended, so a
 * runtime is missing from the listing for the first few seconds of its life — you create it and
 * it isn't there (CLI_ISSUES.md C-15). Hiding a runtime you just made is worse than showing a
 * transitional one.
 */
const ACTIVE = ['running', 'creating', 'paused', 'suspended'] as const;

export interface CommandDeps {
  write: (text: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Prompts for confirmation. Resolves false to abort. */
  confirm: (question: string) => Promise<boolean>;
  isInteractive: () => boolean;
}

export const defaultDeps: CommandDeps = {
  write: (text) => process.stdout.write(text),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  confirm: async (question) => {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = await rl.question(`${question} [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    } finally {
      rl.close();
    }
  },
  isInteractive: () => Boolean(process.stdin.isTTY && process.stderr.isTTY),
};

// ---------------------------------------------------------------- create

export interface CreateOptions {
  name?: string;
  cpus?: string;
  memory?: string;
  memoryMax?: string;
  disk?: string;
  image?: string;
  publish?: string[];
  idleMode?: 'disabled' | 'suspend_only' | 'suspend_and_wakeup';
  idleTimeout?: string;
  fromCheckpoint?: string;
  detach?: boolean;
  timeout?: string;
  json?: boolean;
}

export async function create(
  options: CreateOptions = {},
  deps: CommandDeps = defaultDeps,
): Promise<void> {
  const { client } = await createContext();
  const body = await run(() => createBody(client, options));

  let runtime = await run(async () => {
    const { data } = await createRuntime({ client, body, throwOnError: true });
    return data.data;
  });

  if (options.detach) {
    emit(runtime, options.json, deps, `Creating runtime '${runtime.display_name}'.`);
    return;
  }

  logger.info(`Creating runtime '${runtime.display_name}'…`);
  runtime = await waitFor(() =>
    waitUntilRunning(
      client,
      runtime.id,
      {
        sleep: deps.sleep,
        now: deps.now,
        onPoll: (r) => logger.debug(`status: ${r.status}`),
      },
      timeoutOf(options.timeout),
    ),
  );

  emit(runtime, options.json, deps, describe(runtime));
}

/**
 * Builds the request body. Note the API has no top-level `cpus`/`memory`/`disk` — they live
 * under `resources.requests`, and the auto-scaling ceiling is `resources.limits.memory_mib`.
 */
async function createBody(
  client: RuntaClient,
  options: CreateOptions,
): Promise<Parameters<typeof createRuntime>[0]['body']> {
  const common = {
    ...(options.name ? { name: options.name } : {}),
    ...(options.publish?.length ? { ingress_specs: options.publish.map(ingress) } : {}),
    ...(options.idleMode ? { idle_policy: idlePolicy(options) } : {}),
  };

  if (options.fromCheckpoint) {
    for (const [flag, value] of [
      ['--cpus', options.cpus],
      ['--memory', options.memory],
      ['--image', options.image],
    ] as const) {
      // The checkpoint fixes hardware and image identity, so accepting these silently would
      // mean ignoring them.
      if (value !== undefined) {
        fail(`${flag} cannot be combined with --from-checkpoint`, {
          exitCode: 2,
          hint: 'A checkpoint fixes the runtime size and image; omit the flag.',
        });
      }
    }
    return { ...common, checkpoint_id: await resolveCheckpointId(client, options.fromCheckpoint) };
  }

  const requests = {
    ...(options.cpus ? { vcpus: int(options.cpus, '--cpus') } : {}),
    ...(options.memory ? { memory_mib: int(options.memory, '--memory') } : {}),
    ...(options.disk ? { disk_gib: int(options.disk, '--disk') } : {}),
  };
  const limits = options.memoryMax
    ? { memory_mib: int(options.memoryMax, '--memory-max') }
    : undefined;

  return {
    ...common,
    ...(options.image ? { image: { id: await resolveImageId(client, options.image) } } : {}),
    ...(Object.keys(requests).length || limits
      ? {
          resources: {
            ...(Object.keys(requests).length ? { requests } : {}),
            ...(limits ? { limits } : {}),
          },
        }
      : {}),
  };
}

const ingress = (spec: string): { protocol: 'http' | 'https'; runtime_port: number } => {
  const match = /^(\d+)\/(https?)$/.exec(spec);
  if (!match?.[1] || !match[2]) {
    fail(`Invalid --publish value '${spec}'`, {
      exitCode: 2,
      hint: 'Use <port>/http or <port>/https, e.g. 8080/https.',
    });
  }
  return { protocol: match[2] as 'http' | 'https', runtime_port: Number(match[1]) };
};

function idlePolicy(
  options: CreateOptions,
):
  | { mode: 'disabled' }
  | { mode: 'suspend_only' | 'suspend_and_wakeup'; suspend_after_secs: number } {
  if (options.idleMode === 'disabled' || options.idleMode === undefined)
    return { mode: 'disabled' };
  if (!options.idleTimeout) {
    fail(`--idle-timeout is required with --idle-mode ${options.idleMode}`, { exitCode: 2 });
  }
  return { mode: options.idleMode, suspend_after_secs: int(options.idleTimeout, '--idle-timeout') };
}

const int = (raw: string, flag: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    fail(`Invalid ${flag} value '${raw}'`, {
      exitCode: 2,
      hint: 'Expected a positive whole number.',
    });
  }
  return value;
};

const timeoutOf = (raw?: string) => (raw ? { timeoutMs: int(raw, '--timeout') * 1000 } : {});

// ---------------------------------------------------------------- list

export interface ListOptions {
  all?: boolean;
  status?: string;
  limit?: string;
  json?: boolean;
}

export async function list(
  options: ListOptions = {},
  deps: CommandDeps = defaultDeps,
): Promise<void> {
  const { client } = await createContext();
  const limit = options.limit ? int(options.limit, '--limit') : undefined;

  // An explicit --status always wins; otherwise --all means no filter and the default is the
  // active set.
  const status = options.status ?? (options.all ? undefined : ACTIVE.join(','));
  const runtimes = await run(() => collect(client, status ? { status } : {}, limit));

  if (options.json) {
    deps.write(`${JSON.stringify(runtimes, null, 2)}\n`);
    return;
  }
  if (runtimes.length === 0) {
    logger.info(
      options.all ? 'No runtimes.' : 'No active runtimes. Use --all to include stopped ones.',
    );
    return;
  }
  deps.write(`${renderTable(runtimes, LIST_COLUMNS)}\n`);
}

const LIST_COLUMNS: Column[] = [
  { header: 'name', value: (r: Runtime) => r.display_name },
  { header: 'status', value: (r: Runtime) => (r.degraded ? `${r.status} (degraded)` : r.status) },
  { header: 'vcpus', value: (r: Runtime) => String(r.resources.requests.vcpus), align: 'right' },
  {
    header: 'memory',
    value: (r: Runtime) => `${r.resources.requests.memory_mib} MiB`,
    align: 'right',
  },
  { header: 'image', value: (r: Runtime) => r.image_id },
  { header: 'created', value: (r: Runtime) => r.created_at },
] as unknown as Column[];

/**
 * Walks pages up to `limit`. The API caps a page at 100 and names the cursor `after`, so a
 * caller asking for more than 100 needs more than one request; a caller asking for fewer should
 * not pay for pages it will discard.
 */
async function collect(
  client: RuntaClient,
  query: { status?: string; limit?: number },
  limit?: number,
): Promise<Runtime[]> {
  const out: Runtime[] = [];
  let after: string | undefined;

  for (;;) {
    const pageSize = Math.min(100, limit ? limit - out.length : 100);
    const { data } = await listRuntimes({
      client,
      query: { ...query, limit: pageSize, ...(after ? { after } : {}) },
      throwOnError: true,
    });
    out.push(...data.data);

    if (limit && out.length >= limit) return out.slice(0, limit);
    if (!data.pagination.has_more || !data.pagination.next_cursor) return out;
    after = data.pagination.next_cursor;
  }
}

// ---------------------------------------------------------------- inspect

export async function inspect(
  reference: string,
  options: { json?: boolean } = {},
  deps: CommandDeps = defaultDeps,
): Promise<void> {
  const { client } = await createContext();
  const runtime = await run(async () => {
    const { data } = await getRuntime({
      client,
      path: { runtime_id: await resolveRuntimeId(client, reference) },
      throwOnError: true,
    });
    return data.data;
  });

  if (options.json) {
    deps.write(`${JSON.stringify(runtime, null, 2)}\n`);
    return;
  }
  deps.write(`${detailView(runtime)}\n`);
}

/**
 * A key/value detail view, not the list table.
 *
 * The production CLI renders `inspect` as the identical five-column table as `ps` while its JSON
 * carries 24 fields, so the command whose entire job is detail shows a human none of it
 * (CLI_ISSUES.md C-07). Everything meaningful goes here.
 */
function detailView(r: Runtime): string {
  const rows: [string, string][] = [
    ['Name', r.display_name],
    ['ID', r.id],
    ['Status', r.degraded ? `${r.status} (degraded — no heartbeat for 60s+)` : r.status],
    ...(r.desired_status !== r.status
      ? ([['Desired', r.desired_status]] as [string, string][])
      : []),
    ...(r.error_code ? ([['Error', r.error_code]] as [string, string][]) : []),
    ['Image', r.image_id],
    ['vCPUs', String(r.resources.requests.vcpus)],
    [
      'Memory',
      `${r.resources.current.memory_mib} MiB now, ${r.resources.requests.memory_mib} requested, ${r.resources.limits.memory_mib} max`,
    ],
    ['Disk', `${r.resources.current.observed_disk_gib} GiB`],
    ['Egress', egressSummary(r)],
    [
      'Ingress',
      r.ingress_specs.length
        ? r.ingress_specs.map((i) => `${i.runtime_port}/${i.protocol}`).join(', ')
        : 'none',
    ],
    [
      'Idle policy',
      r.idle_policy.mode === 'disabled'
        ? 'disabled'
        : `${r.idle_policy.mode} after ${r.idle_policy.suspend_after_secs}s`,
    ],
    ['SSH', r.ssh_enabled ? 'enabled' : 'disabled'],
    ['VNC', r.vnc_enabled ? (r.vnc_ready ? 'enabled, ready' : 'enabled, not ready') : 'disabled'],
    [
      'Secrets',
      r.secret_configuration.length ? `${r.secret_configuration.length} configured` : 'none',
    ],
    ['Created', r.created_at],
    ['Updated', r.updated_at],
    ['Revision', String(r.revision)],
    ['Manageable', r.can_manage ? 'yes' : 'no'],
  ];
  const pad = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${label.padEnd(pad)}  ${value}`).join('\n');
}

/**
 * Renders the effective posture rather than the raw fields. `denylist` with no hosts means
 * unrestricted and `allowlist` with none means fully blocked, and the production CLI prints both
 * as an indistinguishable `denylist / - / -` (CLI_ISSUES.md C-10).
 */
function egressSummary(r: Runtime): string {
  const policy = r.egress_policy;
  if (policy.mode === 'denylist') {
    return policy.denied_hosts.length
      ? `denylist — ${policy.denied_hosts.length} host(s) blocked: ${policy.denied_hosts.join(', ')}`
      : 'open — no restrictions';
  }
  return policy.allowed_hosts.length
    ? `allowlist — only ${policy.allowed_hosts.join(', ')}`
    : 'BLOCKED — allowlist is empty, no egress permitted';
}

// ---------------------------------------------------------------- delete

export interface DeleteOptions {
  yes?: boolean;
  dryRun?: boolean;
  detach?: boolean;
  json?: boolean;
  timeout?: string;
}

export async function remove(
  references: string[],
  options: DeleteOptions = {},
  deps: CommandDeps = defaultDeps,
): Promise<void> {
  const { client } = await createContext();

  // Resolve first so a dry run and a confirmation both describe what would actually happen,
  // rather than echoing back what the user typed.
  const targets = await run(() =>
    Promise.all(
      references.map(async (reference) => {
        const { data } = await getRuntime({
          client,
          path: { runtime_id: await resolveRuntimeId(client, reference) },
          throwOnError: true,
        });
        return data.data;
      }),
    ),
  );

  if (options.dryRun) {
    const plan = targets.map((r) => ({
      id: r.id,
      name: r.display_name,
      status: r.status,
      revision: r.revision,
    }));
    if (options.json) {
      deps.write(
        `${JSON.stringify({ action: 'delete', dry_run: true, runtimes: plan }, null, 2)}\n`,
      );
      return;
    }
    deps.write(`Would delete ${plan.length} runtime(s):\n`);
    for (const r of plan) deps.write(`  ${r.name} (${r.id}) — currently ${r.status}\n`);
    return;
  }

  // Confirm only where a human can answer. Under --json or in a pipe a prompt would hang, so
  // scripts are unaffected and only interactive use gets the brake.
  if (!options.yes && !options.json && deps.isInteractive()) {
    const names = targets.map((r) => r.display_name).join(', ');
    const ok = await deps.confirm(
      `Delete ${targets.length} runtime(s): ${names}? This cannot be undone.`,
    );
    if (!ok) fail('Aborted.', { exitCode: 1 });
  }

  const results: { name: string; id: string; deleted: boolean }[] = [];
  for (const target of targets) {
    await run(() => deleteAtCurrentRevision(client, target.id));
    if (!options.detach) {
      logger.info(`Deleting '${target.display_name}'…`);
      await waitFor(() =>
        waitUntilDeleted(
          client,
          target.id,
          { sleep: deps.sleep, now: deps.now },
          timeoutOf(options.timeout),
        ),
      );
    }
    results.push({ name: target.display_name, id: target.id, deleted: !options.detach });
  }

  if (options.json) {
    deps.write(`${JSON.stringify({ action: 'delete', runtimes: results }, null, 2)}\n`);
    return;
  }
  for (const r of results) {
    logger.info(r.deleted ? `Deleted '${r.name}'.` : `Deletion of '${r.name}' requested.`);
  }
}

// ---------------------------------------------------------------- shared

/** Turns an API error into a CliError so no command has to repeat the mapping. */
async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RuntaApiError) {
      fail(error.message, { exitCode: exitCodeFor(error), hint: hintFor(error), cause: error });
    }
    throw error;
  }
}

async function waitFor<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RuntimeWaitError) {
      fail(error.message, {
        exitCode: 1,
        hint:
          error.reason === 'timeout'
            ? 'It may still be starting — check with `runta inspect`, or pass --detach to skip waiting.'
            : undefined,
        cause: error,
      });
    }
    if (error instanceof RuntaApiError) {
      fail(error.message, { exitCode: exitCodeFor(error), hint: hintFor(error), cause: error });
    }
    throw error;
  }
}

const exitCodeFor = (error: RuntaApiError): number =>
  error.status === 401 || error.status === 403 ? 2 : 1;

function hintFor(error: RuntaApiError): string | undefined {
  if (error.status === 401) return 'The token was rejected. Run `runta login` to get a new one.';
  if (error.status === 403)
    return 'No credential was sent, or it lacks permission. Run `runta login`.';
  if (error.status === 404) return 'Check the name or id with `runta list --all`.';
  if (error.status === 409)
    return 'Something else changed the runtime at the same time. Try again.';
  // 5xx bodies are often not JSON, so the message degrades to bare status text like
  // `520 <none>`, which tells the user nothing. Name the cause instead.
  if (error.status >= 500)
    return 'The Runta API is having trouble — this is usually transient. Try again.';
  return undefined;
}

function emit(
  runtime: Runtime,
  json: boolean | undefined,
  deps: CommandDeps,
  message: string,
): void {
  if (json) {
    deps.write(`${JSON.stringify(runtime, null, 2)}\n`);
    return;
  }
  logger.info(message);
}

function describe(runtime: Runtime): string {
  const ingress = runtime.ingress_specs.map((i) => `${i.runtime_port}/${i.protocol}`).join(', ');
  return [
    `Runtime '${runtime.display_name}' is running.`,
    ingress ? `Published: ${ingress}` : undefined,
    `Run a command:  runta exec ${runtime.display_name} -- <command>`,
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------- registration

/**
 * Adds the four verbs to whichever command is passed.
 *
 * Called twice: once on `runta runtime` (the canonical noun-first form, so every resource reads
 * the same way and an agent can predict `runta checkpoint list` from one example) and once on the
 * root, because runtimes are the noun you type all day. See Improvements.md I-2.
 */
function addRuntimeVerbs(parent: Command): void {
  parent
    .command('create')
    .description('Create a runtime and wait until it can accept commands')
    .option('--name <name>', 'runtime name; a random one is assigned when omitted')
    .option('--cpus <n>', 'vCPUs')
    .option('--memory <mib>', 'memory in MiB')
    .option('--memory-max <mib>', 'auto-scaling memory ceiling in MiB')
    .option('--disk <gib>', 'overlay disk in GiB (16-256)')
    .option('--image <id>', 'runtime image variant id')
    .option(
      '-p, --publish <spec>',
      'publish a port, e.g. 8080/https (repeatable)',
      collectRepeat,
      [],
    )
    .option('--idle-mode <mode>', 'disabled | suspend_only | suspend_and_wakeup')
    .option('--idle-timeout <secs>', 'idle seconds before suspending')
    .option('--from-checkpoint <id>', 'restore from a checkpoint instead of creating fresh')
    .option('-d, --detach', 'return as soon as creation is accepted, without waiting')
    .option('--timeout <secs>', 'how long to wait before giving up (default 180)')
    .option('--json', 'print the runtime as JSON')
    .action(async (opts: CreateOptions) => {
      await create(opts);
    });

  parent
    .command('list')
    .description('List runtimes')
    .option('-a, --all', 'include stopped, failed and deleting runtimes')
    .option('--status <statuses>', 'comma-separated statuses to include')
    .option('--limit <n>', 'stop after this many runtimes')
    .option('--json', 'print the runtimes as JSON')
    .action(async (opts: ListOptions) => {
      await list(opts);
    });

  parent
    .command('inspect')
    .description('Show everything about one runtime')
    .argument('<runtime>', 'runtime name or id')
    .option('--json', 'print the runtime as JSON')
    .action(async (reference: string, opts: { json?: boolean }) => {
      await inspect(reference, opts);
    });

  parent
    .command('delete')
    .description('Delete one or more runtimes')
    .argument('<runtime...>', 'runtime names or ids')
    .option('--dry-run', 'show what would be deleted and exit')
    .option('-y, --yes', 'skip the confirmation prompt')
    .option('-d, --detach', 'return as soon as deletion is accepted, without waiting')
    .option('--timeout <secs>', 'how long to wait before giving up (default 180)')
    .option('--json', 'print the result as JSON')
    .action(async (references: string[], opts: DeleteOptions) => {
      await remove(references, opts);
    });
}

const collectRepeat = (value: string, previous: string[]): string[] => [...previous, value];

export function registerRuntime(program: Command): void {
  addRuntimeVerbs(program.command('runtime').description('Manage runtimes'));
  addRuntimeVerbs(program);
}

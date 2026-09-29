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
  modelProviderProtocol,
  type RuntimeAction,
  RuntimeWaitError,
  resolveCheckpointId,
  resolveImage,
  resolveRuntimeId,
  TARGET_STATUS,
  transitionAtCurrentRevision,
  waitUntilDeleted,
  waitUntilRunning,
  waitUntilStatus,
  wakeAction,
} from '@runta/core';
import { type Column, fail, logger, renderTable } from '@runta/utils';
import type { Command } from 'commander';
import { detachHelp } from '../help.js';
import { outputOption, resolveOutput } from '../output.js';
import { type NextStep, printNextSteps } from '../suggest.js';

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
  modelProviderProtocol?: string;
  runtimeSignIn?: boolean;
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
    emit(runtime, options.json, deps, `Creating runtime '${runtime.display_name}'.`, options);
    printNextSteps(createNextSteps(runtime, false, options));
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

  emit(runtime, options.json, deps, describeCreated(runtime, options), options);
  printNextSteps(createNextSteps(runtime, true, options));
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
      ['--model-provider-protocol', options.modelProviderProtocol],
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
    ...(options.image ? { image: await imageSpec(client, options) } : {}),
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

/**
 * Builds the `image` block, filling in the model-provider protocol.
 *
 * An image that fronts a model provider is refused without one — 12 of the 13 images do — and four
 * bind exactly one protocol, so it is inferred when unambiguous rather than demanded.
 */
async function imageSpec(
  client: RuntaClient,
  options: CreateOptions,
): Promise<{ id: string; model_provider_protocol?: string; runtime_sign_in?: boolean }> {
  const image = await resolveImage(client, options.image as string);
  const protocol = modelProviderProtocol(image, options.modelProviderProtocol);

  // Refuse up front on an image that cannot be signed into, rather than sending a field the API
  // will either reject confusingly or accept and ignore.
  if (options.runtimeSignIn && !image.model_provider?.allow_runtime_sign_in) {
    fail(`Image '${image.id}' does not support signing in inside the runtime.`, {
      exitCode: 2,
      hint: image.model_provider
        ? 'Connect a model provider at https://dashboard.runta.com instead.'
        : 'That image needs no credential, so --runtime-sign-in has nothing to do.',
    });
  }

  return {
    id: image.id,
    ...(protocol ? { model_provider_protocol: protocol } : {}),
    ...(options.runtimeSignIn ? { runtime_sign_in: true } : {}),
  };
}

/**
 * Whether this runtime came up with an agent that still has to be signed into.
 *
 * `--runtime-sign-in` is a *waiver*, not a provisioning step: it tells the API not to demand a
 * credential at create time, and the runtime then starts with none. The production CLI's flag
 * promises to "configure provider authentication inside the Runtime" and configures nothing, so
 * you get `status: running`, `degraded: false`, `error_code: null` and an agent that prints
 * "Not logged in" — invisible to `inspect`, to `list`, and to the output of the flag that caused
 * it (CLI_ISSUES.md C-33). Saying so is the whole point of supporting the flag at all.
 */
const signInPending = (options: CreateOptions): boolean => options.runtimeSignIn === true;

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
  fields?: string;
}

export async function list(
  options: ListOptions = {},
  deps: CommandDeps = defaultDeps,
): Promise<void> {
  // Parsed before the request, so a typo in --fields costs nothing and fails immediately.
  const fields = options.fields ? selectFields(options.fields) : undefined;
  const { client } = await createContext();
  const limit = options.limit ? int(options.limit, '--limit') : undefined;

  // An explicit --status always wins; otherwise --all means no filter and the default is the
  // active set.
  const status = options.status ?? (options.all ? undefined : ACTIVE.join(','));
  const runtimes = await run(() => collect(client, status ? { status } : {}, limit));

  if (options.json) {
    // Without --fields the payload stays the API's own object, so the default contract does not
    // move. With it, each row is projected to the field names the caller asked for.
    const payload = fields ? runtimes.map((r) => project(r, fields)) : runtimes;
    deps.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (runtimes.length === 0) {
    // An empty list is still the answer to `list`, so it goes where the table would have.
    logger.success(
      options.all ? 'No runtimes.' : 'No active runtimes. Use --all to include stopped ones.',
    );
    // An empty list is the one place a new user is definitely stuck, so it is worth a pointer.
    printNextSteps([
      { command: 'runta-next create --name demo', why: 'create your first runtime' },
      ...(options.all
        ? []
        : [{ command: 'runta-next list --all', why: 'include stopped and failed runtimes' }]),
    ]);
    return;
  }
  deps.write(`${renderTable(runtimes, fields ?? LIST_FIELD_ORDER.map(column))}\n`);
}

/**
 * The fields `list` can show, keyed by the name `--fields` accepts.
 *
 * One vocabulary for both halves of the output: `--fields` names columns, the table renders them
 * as columns, and `--json` keys each row by the same names. `human` is what a person reads and
 * `json` is what a script gets, which is why `memory` is `512 MiB` in the table and `512` in JSON
 * — the unit belongs in a rendered cell, not in a value something is about to do arithmetic on
 * (see the `--help` text, which states the unit).
 */
const LIST_FIELDS = {
  name: { human: (r: Runtime) => r.display_name, json: (r: Runtime) => r.display_name },
  id: { human: (r: Runtime) => r.id, json: (r: Runtime) => r.id },
  status: {
    human: (r: Runtime) => (r.degraded ? `${r.status} (degraded)` : r.status),
    json: (r: Runtime) => r.status,
  },
  degraded: { human: (r: Runtime) => String(r.degraded), json: (r: Runtime) => r.degraded },
  vcpus: {
    human: (r: Runtime) => String(r.resources.requests.vcpus),
    json: (r: Runtime) => r.resources.requests.vcpus,
    align: 'right' as const,
  },
  memory: {
    human: (r: Runtime) => `${r.resources.requests.memory_mib} MiB`,
    json: (r: Runtime) => r.resources.requests.memory_mib,
    align: 'right' as const,
  },
  image: { human: (r: Runtime) => r.image_id, json: (r: Runtime) => r.image_id },
  created: { human: (r: Runtime) => r.created_at, json: (r: Runtime) => r.created_at },
} satisfies Record<string, ListFieldSpec>;

interface ListFieldSpec {
  /** What a person reads in the table cell. */
  human: (r: Runtime) => string;
  /** What a script gets from `--json`. */
  json: (r: Runtime) => unknown;
  align?: 'right';
}

export type ListField = keyof typeof LIST_FIELDS;

/** `satisfies` narrows each entry to its own literal type, so read them back through the spec. */
const spec = (field: ListField): ListFieldSpec => LIST_FIELDS[field] as ListFieldSpec;

/** The default table, and the order `--fields` output falls back to reporting in errors. */
const LIST_FIELD_ORDER: ListField[] = ['name', 'status', 'vcpus', 'memory', 'image', 'created'];

const column = (field: ListField): Column =>
  ({
    header: field,
    value: spec(field).human,
    align: spec(field).align,
  }) as unknown as Column;

/**
 * Turns `--fields name,vcpus` into columns, in the order asked for.
 *
 * An unknown name is an error naming the offender and every valid field, rather than a silently
 * missing column: a caller that misspells `vcpu` should not receive a short row it might act on
 * (CLI_ISSUES.md C-15 is the same failure in a different place).
 */
export function selectFields(spec: string): Column[] {
  const asked = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (asked.length === 0) {
    fail(`--fields needs at least one field name`, {
      exitCode: 2,
      hint: `Available fields: ${Object.keys(LIST_FIELDS).join(', ')}`,
    });
  }
  const unknown = asked.filter((f) => !(f in LIST_FIELDS));
  if (unknown.length > 0) {
    fail(`Unknown --fields value${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`, {
      exitCode: 2,
      hint: `Available fields: ${Object.keys(LIST_FIELDS).join(', ')}`,
    });
  }
  // Dedupe but keep the caller's order, so `--fields name,name` is one column rather than an error
  // about something that changes nothing.
  return [...new Set(asked as ListField[])].map(column);
}

/** Projects one runtime onto the selected fields, for the `--json` half. */
function project(runtime: Runtime, fields: Column[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of fields) {
    out[col.header] = spec(col.header as ListField).json(runtime);
  }
  return out;
}

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
  printNextSteps(inspectNextSteps(runtime));
}

/**
 * Only suggests something when the runtime is in a state you would want to act on. A healthy
 * running runtime needs no advice, and printing some after every inspect trains people to stop
 * reading it.
 */
function inspectNextSteps(runtime: Runtime): NextStep[] {
  const name = runtime.display_name;

  if (runtime.status === 'error' || runtime.status === 'crashed') {
    return [
      { command: `runta-next delete ${name}`, why: 'remove it — this runtime cannot be recovered' },
      { command: `runta-next create --name ${name}`, why: 'create a replacement' },
    ];
  }
  if (runtime.degraded) {
    return [
      {
        command: `runta-next inspect ${name}`,
        why: 'check again — degraded means no heartbeat for 60s+',
      },
    ];
  }
  if (
    runtime.egress_policy.mode === 'allowlist' &&
    runtime.egress_policy.allowed_hosts.length === 0
  ) {
    // Easy to do by accident and invisible from the runtime's status.
    return [
      {
        command: `runta-next inspect ${name} --json`,
        why: 'egress is fully blocked — nothing in this runtime can reach the network',
      },
    ];
  }
  return [];
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
    logger.success(r.deleted ? `Deleted '${r.name}'.` : `Deletion of '${r.name}' requested.`);
  }

  // Suggesting `runta-next list` here would be noise — you know what you just deleted. Reaching zero is
  // different: that is a state worth naming, and the only case where there is a next step.
  if (!options.detach) {
    const remaining = await run(() => collect(client, { status: ACTIVE.join(',') }, 1));
    if (remaining.length === 0) {
      printNextSteps([
        { command: 'runta-next create --name demo', why: 'no runtimes left — create another' },
      ]);
    }
  }
}

// ---------------------------------------------------------------- lifecycle

export interface LifecycleOptions {
  detach?: boolean;
  dryRun?: boolean;
  json?: boolean;
  timeout?: string;
}

/**
 * `stop`, `pause` and `start` — three commands over the API's four transition endpoints.
 *
 * The asymmetry is deliberate and is the main thing this fixes. The API splits waking a runtime
 * across `/start` (from `shutdown`) and `/resume` (from `paused`), and the production CLI exposes
 * that split as `boot` and `resume`, so the user has to know the current state to name the right
 * verb — and naming the wrong one is an API error, not a no-op. Since we read the runtime anyway
 * for `expected_revision`, `start` can just pick. See Improvements.md I-9.
 */
export async function lifecycle(
  action: 'stop' | 'pause' | 'start',
  reference: string,
  options: LifecycleOptions = {},
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

  const resolved = resolveAction(action, runtime);

  // Already there: say so and stop. The production CLI sends the request regardless, which either
  // 409s or silently bumps a revision for no change — neither is what "stop a stopped runtime"
  // should mean. Idempotence is the useful reading, and it makes the command safe in a script that
  // cannot know the current state.
  if (resolved === null) {
    emitLifecycle(runtime, options, deps, {
      action,
      changed: false,
      reason: 'already_in_state',
      waited: true,
      message: `Runtime '${runtime.display_name}' is already ${runtime.status}.`,
    });
    if (!options.json) printNextSteps(lifecycleNextSteps(action, runtime, false));
    return;
  }

  if (resolved === undefined) {
    fail(
      `Runtime '${runtime.display_name}' is ${runtime.status}, which \`${action}\` cannot change.`,
      {
        exitCode: 1,
        hint:
          runtime.status === 'error' || runtime.status === 'crashed'
            ? `This runtime cannot be recovered. Remove it with \`runta-next delete ${runtime.display_name}\`.`
            : 'Check the current state with `runta-next inspect`.',
      },
    );
  }

  const target = TARGET_STATUS[resolved];

  if (options.dryRun) {
    const plan = {
      action,
      dry_run: true,
      runtime: { id: runtime.id, name: runtime.display_name, status: runtime.status },
      endpoint: resolved,
      target_status: target,
      revision: runtime.revision,
    };
    if (options.json) {
      deps.write(`${JSON.stringify(plan, null, 2)}\n`);
      return;
    }
    deps.write(
      `Would ${action} '${runtime.display_name}' (${runtime.id})\n` +
        `  currently ${runtime.status}, would become ${target}\n` +
        `  via POST /v2/runtimes/{id}/${resolved} at revision ${runtime.revision}\n`,
    );
    return;
  }

  await run(() => transitionAtCurrentRevision(client, runtime.id, resolved));

  if (options.detach) {
    emitLifecycle(runtime, options, deps, {
      action,
      changed: true,
      accepted: true,
      waited: false,
      targetStatus: target,
      message: `${VERB[action].gerund} '${runtime.display_name}' — not waiting. It will become ${target}.`,
    });
    if (!options.json) printNextSteps(lifecycleNextSteps(action, runtime, true));
    return;
  }

  logger.info(`${VERB[action].gerund} '${runtime.display_name}'…`);
  const settled = await waitFor(() =>
    waitUntilStatus(
      client,
      runtime.id,
      target,
      { sleep: deps.sleep, now: deps.now, onPoll: (r) => logger.debug(`status: ${r.status}`) },
      timeoutOf(options.timeout),
    ),
  );

  emitLifecycle(settled, options, deps, {
    action,
    changed: true,
    waited: true,
    message: `Runtime '${settled.display_name}' is ${settled.status}.`,
  });
  if (!options.json) printNextSteps(lifecycleNextSteps(action, settled, true));
}

const VERB: Record<'stop' | 'pause' | 'start', { gerund: string }> = {
  stop: { gerund: 'Stopping' },
  pause: { gerund: 'Pausing' },
  start: { gerund: 'Starting' },
};

/**
 * The endpoint to call, `null` when the runtime is already in the requested state, and `undefined`
 * when no transition applies.
 */
export function resolveAction(
  action: 'stop' | 'pause' | 'start',
  runtime: Runtime,
): RuntimeAction | null | undefined {
  if (action === 'start') {
    if (runtime.status === 'running') return null;
    const wake = wakeAction(runtime.status);
    // `creating` returns null from wakeAction because it is already on its way to running.
    if (wake === null) return runtime.status === 'creating' ? null : undefined;
    return wake;
  }

  if (action === 'stop') {
    if (runtime.status === 'shutdown') return null;
    // A paused or suspended runtime can still be shut down.
    return runtime.status === 'error' ||
      runtime.status === 'crashed' ||
      runtime.status === 'deleting'
      ? undefined
      : 'stop';
  }

  if (runtime.status === 'paused') return null;
  // Only a running runtime can be paused; suspended is already parked.
  return runtime.status === 'running' ? 'pause' : undefined;
}

/**
 * Deliberately a small payload rather than the runtime object.
 *
 * The production CLI answers `pause` with all 45 fields of the runtime to convey one state change —
 * roughly 350 tokens of context for one bit of information (CLI_ISSUES.md C-22). `inspect` is the
 * command for the whole object.
 */
function emitLifecycle(
  runtime: Runtime,
  options: LifecycleOptions,
  deps: CommandDeps,
  result: {
    action: string;
    changed: boolean;
    accepted?: boolean;
    reason?: string;
    message: string;
    /**
     * Whether `runtime.status` was read after the transition settled. False under `--detach`, where
     * the status is whatever it was when the request was accepted — which for a `stop` is still
     * `running`. Reporting that as the outcome is exactly the defect this command exists to avoid
     * (C-14), so the flag and `target_status` say plainly that it is not settled yet.
     */
    waited: boolean;
    targetStatus?: Runtime['status'];
  },
): void {
  if (options.json) {
    deps.write(
      `${JSON.stringify(
        {
          action: result.action,
          changed: result.changed,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.accepted ? { accepted: true } : {}),
          waited: result.waited,
          ...(result.targetStatus ? { target_status: result.targetStatus } : {}),
          runtime: {
            id: runtime.id,
            name: runtime.display_name,
            status: runtime.status,
            desired_status: runtime.desired_status,
          },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  logger.success(result.message);
}

/**
 * What to do next after a state change.
 *
 * The production CLI's `resume` answers with `required_action: runta resume <name>` — an agent
 * following that field, which is what it is for, loops forever (CLI_ISSUES.md C-11). Nothing here
 * ever names the command that just ran.
 */
function lifecycleNextSteps(
  action: 'stop' | 'pause' | 'start',
  runtime: Runtime,
  changed: boolean,
): NextStep[] {
  const name = runtime.display_name;

  if (action === 'start') {
    return changed
      ? [{ command: `runta-next exec ${name} -- uname -a`, why: 'run a command inside it' }]
      : [];
  }

  // Stopped or paused: the one thing you will want is to bring it back.
  return [
    { command: `runta-next start ${name}`, why: 'bring it back to running' },
    ...(action === 'pause'
      ? [{ command: `runta-next stop ${name}`, why: 'shut it down instead, releasing more' }]
      : []),
  ];
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
            ? 'It may still be starting — check with `runta-next inspect`, or pass --detach to skip waiting.'
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
  if (error.status === 401)
    return 'The token was rejected. Run `runta-next login` to get a new one.';
  if (error.status === 403)
    return 'No credential was sent, or it lacks permission. Run `runta-next login`.';
  if (error.status === 404) return 'Check the name or id with `runta-next list --all`.';
  if (error.status === 409)
    return 'Something else changed the runtime at the same time. Try again.';
  // 5xx bodies are often not JSON, so the message degrades to bare status text like
  // `520 <none>`, which tells the user nothing. Name the cause instead.
  if (error.status >= 500)
    return 'The Runta API is having trouble — this is usually transient. Try again.';
  // The API's own wording names the environment variable but not how to populate it, and nothing
  // in this CLI configures a provider yet.
  if (/which no secret in this request populates/.test(error.message))
    return 'This image needs a model provider. Connect one at https://dashboard.runta.com, then create the runtime again.';
  if (/model-provider protocol is required/.test(error.message))
    return 'Pass --model-provider-protocol, or use an image that binds only one protocol.';
  return undefined;
}

function emit(
  runtime: Runtime,
  json: boolean | undefined,
  deps: CommandDeps,
  message: string,
  options?: CreateOptions,
): void {
  if (json) {
    // The runtime object is the API's own and says nothing about a pending sign-in — there is no
    // field for it — so the one caller who can know adds it. An agent branching on `status` alone
    // would otherwise call this runtime ready.
    const payload =
      options && signInPending(options) ? { ...runtime, sign_in_pending: true } : runtime;
    deps.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  logger.success(message);
}

/** `describe`, plus the one thing the runtime object cannot tell you. */
function describeCreated(runtime: Runtime, options: CreateOptions): string {
  const base = describe(runtime);
  if (!signInPending(options)) return base;
  return `${base}\nIts agent is installed but not signed in yet.`;
}

function describe(runtime: Runtime): string {
  const ingress = runtime.ingress_specs.map((i) => `${i.runtime_port}/${i.protocol}`).join(', ');
  return [
    `Runtime '${runtime.display_name}' is running.`,
    ingress ? `Published: ${ingress}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

/** What to do with a runtime that was just created. */
function createNextSteps(
  runtime: Runtime,
  waited: boolean,
  options: CreateOptions = {},
): NextStep[] {
  const name = runtime.display_name;
  const steps: NextStep[] = [];

  // First, because nothing else about the runtime matters until its agent can reach a model.
  // Interactive by necessity: the sign-in is an OAuth flow that needs a human at a terminal.
  if (waited && signInPending(options)) {
    // A shell rather than the agent binary: each image ships a different one (`claude`, `codex`,
    // `opencode` …) and naming the wrong one is worse than naming none. Interactive by necessity —
    // the sign-in is an OAuth flow that needs a human at a terminal.
    steps.push({
      command: `runta-next exec ${name} -it -- bash`,
      why: 'start the agent and sign in with /login',
    });
  }

  if (!waited) {
    // Without waiting the runtime is not usable yet, so watching it is the only sensible step.
    steps.push({ command: `runta-next inspect ${name}`, why: 'check whether it is running yet' });
  } else {
    steps.push({ command: `runta-next exec ${name} -- uname -a`, why: 'run a command inside it' });
    steps.push({ command: `runta-next inspect ${name}`, why: 'see its full state' });
  }

  if (runtime.ingress_specs.length > 0) {
    steps.push({
      command: `runta-next inspect ${name} --json`,
      why: 'read ingress_specs — the public URL is not yet available from the CLI',
    });
  }

  steps.push({ command: `runta-next delete ${name}`, why: 'remove it when you are done' });
  return steps;
}

// ---------------------------------------------------------------- registration

/**
 * Adds the four verbs to whichever command is passed.
 *
 * Called twice: once on `runta-next runtime` (the canonical noun-first form, so every resource reads
 * the same way and an agent can predict `runta-next checkpoint list` from one example) and once on the
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
    .option(
      '--model-provider-protocol <protocol>',
      'required by images that front a model provider; inferred when the image binds only one',
    )
    .option(
      '--runtime-sign-in',
      'skip the credential check and sign the agent in inside the runtime instead',
    )
    .option('-d, --detach', 'return as soon as creation is accepted, without waiting')
    .option('--timeout <secs>', 'how long to wait before giving up (default 180)')
    .option('--json', 'print the runtime as JSON')
    .addOption(outputOption())
    .addHelpText('after', detachHelp('the runtime can accept commands'))
    .action(async (opts: CreateOptions) => {
      await create(resolveOutput(opts));
    });

  parent
    .command('list')
    .description('List runtimes')
    .option('-a, --all', 'include stopped, failed and deleting runtimes')
    .option('--status <statuses>', 'comma-separated statuses to include')
    .option('--limit <n>', 'stop after this many runtimes')
    .option(
      '--fields <names>',
      'comma-separated fields to show, in that order: name, id, status, degraded, vcpus, ' +
        'memory (MiB), image, created. Applies to the table and to --json',
    )
    .option('--json', 'print the runtimes as JSON')
    .addOption(outputOption())
    .action(async (opts: ListOptions) => {
      await list(resolveOutput(opts));
    });

  parent
    .command('inspect')
    .description('Show everything about one runtime')
    .argument('<runtime>', 'runtime name or id')
    .option('--json', 'print the runtime as JSON')
    .addOption(outputOption())
    .action(async (reference: string, opts: { json?: boolean; output?: string }) => {
      await inspect(reference, resolveOutput(opts));
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
    .addOption(outputOption())
    .addHelpText('after', detachHelp('the runtimes are gone'))
    .action(async (references: string[], opts: DeleteOptions) => {
      await remove(references, resolveOutput(opts));
    });

  for (const action of ['start', 'stop', 'pause'] as const) {
    parent
      .command(action)
      .description(LIFECYCLE_DESCRIPTIONS[action])
      .argument('<runtime>', 'runtime name or id')
      .option('--dry-run', 'show what would change and exit')
      .option('-d, --detach', 'return as soon as the change is accepted, without waiting')
      .option('--timeout <secs>', 'how long to wait before giving up (default 180)')
      .option('--json', 'print the result as JSON')
      .addOption(outputOption())
      .addHelpText('after', detachHelp('the transition settles'))
      .action(async (reference: string, opts: LifecycleOptions) => {
        await lifecycle(action, reference, resolveOutput(opts));
      });
  }
}

/** `start` covers both of the API's wake endpoints, so its description has to say so. */
const LIFECYCLE_DESCRIPTIONS = {
  start: 'Start a stopped runtime, or resume a paused one',
  stop: 'Shut a runtime down, releasing its resources',
  pause: 'Pause a running runtime, keeping its memory',
} as const;

const collectRepeat = (value: string, previous: string[]): string[] => [...previous, value];

export function registerRuntime(program: Command): void {
  addRuntimeVerbs(program.command('runtime').description('Manage runtimes'));
  addRuntimeVerbs(program);
}

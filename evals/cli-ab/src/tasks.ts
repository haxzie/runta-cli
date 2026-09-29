/**
 * The tasks both agents get, their fixtures, and their graders.
 *
 * Every task stays inside what runta-next implements today — create, list, inspect, delete, exec,
 * whoami, the lifecycle verbs and `image list` — so the comparison is like for like. Prompts name
 * the CLI but never a flag: working out the flags is what's being measured.
 *
 * Two tasks are scored in their own column because the official CLI cannot reach the answer at
 * all: T1 (it has no `whoami`, C-20) and T15 (its `image ls` lists only images you built, so the
 * catalog is invisible). Those are capability gaps, not speed differences, and mixing them into
 * the head-to-head totals would flatter us.
 *
 * Graders judge the tenant's real state through the REST API (see api.ts), plus the agent's final
 * `ANSWER:` line. Where a regex can't fully judge an answer, the grade is marked `review` so a
 * human reads that transcript.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Api, CreateRuntime, Runtime, RuntimeStatus } from './api.js';
import type { Seen } from './watcher.js';

export interface TrialContext {
  api: Api;
  /** Unique per trial. Every runtime a trial touches starts with it. */
  prefix: string;
  /** The command under test: `runta` or `runta-next`. */
  cli: string;
  /** The agent's working directory. */
  workDir: string;
  /** Runs the official CLI outside the agent, for fixture steps the REST client can't do. */
  runOfficialCli: (args: string[]) => Promise<{ code: number; output: string }>;
  /** Whatever a fixture wants its grader to know. */
  state: Record<string, unknown>;
}

export interface AgentOutcome {
  /** The agent's final message. */
  result: string;
  /** The text after the last `ANSWER:`, or the whole result when there is none. */
  answer: string;
  /** Every Bash command the agent ran, in order. */
  commands: string[];
  /** Runtimes with this trial's prefix, as the harness saw them while the agent worked. */
  seen: Seen;
}

export interface Grade {
  pass: boolean;
  /** Why it failed, or notes on a pass. */
  notes: string[];
  /** A human should read the transcript before trusting this grade. */
  review?: boolean;
}

export interface Task {
  id: string;
  title: string;
  exercises: string;
  /** The official CLI has no command for this, so it's scored in its own column. */
  capabilityGap?: boolean;
  /**
   * Why this task no longer runs. Retired tasks are kept for the record but left out of the
   * default `--tasks`, and naming one explicitly is an error rather than a fixture failure.
   */
  retired?: string;
  fixture?: (ctx: TrialContext) => Promise<void>;
  prompt: (ctx: TrialContext) => string;
  grade: (ctx: TrialContext, outcome: AgentOutcome) => Promise<Grade>;
}

const PREAMBLE = (cli: string) =>
  `A command-line tool called \`${cli}\` is installed on this machine and already authenticated. ` +
  `It manages Runta cloud runtimes (remote Linux sandboxes). Use \`${cli}\` for everything that ` +
  'touches Runta — no other tool or API. The Runta account is shared, so never touch a runtime ' +
  'the task does not name.';

const ANSWER_RULE =
  'When you are done, end your final message with one line of the form `ANSWER: <answer>`.';

function check(notes: string[], ok: boolean, failure: string): boolean {
  if (!ok) notes.push(failure);
  return ok;
}

function small(name: string, extra: Partial<CreateRuntime> = {}): CreateRuntime {
  return { name, resources: { requests: { vcpus: 1, memory_mib: 512 } }, ...extra };
}

const alive = (r: Runtime | undefined) => !!r && r.status !== 'deleting';

async function aliveWithPrefix(ctx: TrialContext): Promise<Runtime[]> {
  return (await ctx.api.listByPrefix(ctx.prefix)).filter(alive);
}

/** Matches a CLI invocation in a shell command, without matching `runta` inside `runta-next`. */
export function invokesCli(command: string, cli: string): boolean {
  const escaped = cli.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s;&|(\`$/])${escaped}(?=\\s|$)`).test(command);
}

export const TASKS: Task[] = [
  {
    id: 'T1',
    title: 'Who am I signed in as',
    exercises: 'whoami; the official CLI has no equivalent (CLI_ISSUES C-20)',
    capabilityGap: true,
    async fixture(ctx) {
      ctx.state.me = await ctx.api.me();
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nFind out which account \`${ctx.cli}\` is signed in as. ` +
      'If the credential does not belong to a user account, say so and say what kind it is.\n\n' +
      `${ANSWER_RULE} The answer is the account's email address, or an explanation.`,
    async grade(ctx, { answer }) {
      const me = ctx.state.me as { email: string } | 'org_api_key';
      if (me === 'org_api_key') {
        const ok = /api[ -]?key|organi[sz]ation|not (a |tied to a |associated with a )?user/i.test(
          answer,
        );
        return {
          pass: ok,
          notes: ok ? [] : ['did not recognise that the credential is an organization API key'],
          review: true,
        };
      }
      const ok = answer.toLowerCase().includes(me.email.toLowerCase());
      return { pass: ok, notes: ok ? [] : [`expected ${me.email}`] };
    },
  },

  {
    id: 'T2',
    title: 'Create, inspect the OS, delete',
    exercises: 'create waits until usable, exec, delete',
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nCreate a runtime named \`${ctx.prefix}-a\` from the \`clean\` image ` +
      "with 1 vCPU and 512 MiB of memory. Find out its CPU architecture and its operating system's " +
      'name, then delete the runtime.\n\n' +
      `${ANSWER_RULE} Format: \`<architecture> | <operating system>\`.`,
    async grade(ctx, { answer, seen }) {
      const notes: string[] = [];
      const made = Object.values(seen).find((r) => r.name === `${ctx.prefix}-a`);
      let pass = check(notes, !!made, `never saw a runtime named ${ctx.prefix}-a`);
      if (made) {
        pass =
          check(
            notes,
            made.vcpus === 1 && made.memory_mib === 512,
            `sized ${made.vcpus} vCPU / ${made.memory_mib} MiB, wanted 1 / 512`,
          ) && pass;
        pass = check(notes, made.image_id === 'clean', `image ${made.image_id}`) && pass;
        pass = check(notes, made.statuses.includes('running'), 'never reached running') && pass;
      }
      pass =
        check(notes, /x86_64|amd64|aarch64|arm64/i.test(answer), 'no architecture in answer') &&
        pass;
      pass =
        check(notes, /linux|ubuntu|debian|alpine|fedora/i.test(answer), 'no OS in answer') && pass;
      const left = await aliveWithPrefix(ctx);
      pass = check(notes, left.length === 0, `left behind: ${names(left)}`) && pass;
      return { pass, notes };
    },
  },

  {
    id: 'T3',
    title: 'Exit code and a file',
    exercises: "exec returns the remote command's exit code; the official exec flakes (C-01)",
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nCreate a runtime whose name starts with \`${ctx.prefix}\`. In it, ` +
      'run one shell command that writes the text `hello` to `/tmp/x` and then exits with status ' +
      '42. Report the exit status that command returned, and the contents of `/tmp/x` read back ' +
      'with a separate command. Delete the runtime when you are done.\n\n' +
      `${ANSWER_RULE} Format: \`<exit status> | <contents of /tmp/x>\`.`,
    async grade(ctx, { answer, seen }) {
      const notes: string[] = [];
      const [code, contents] = answer.split('|').map((s) => s.trim());
      let pass = check(notes, code === '42', `exit status '${code}'`);
      pass = check(notes, contents === 'hello', `contents '${contents}'`) && pass;
      const ran = Object.values(seen).some((r) => r.statuses.includes('running'));
      pass = check(notes, ran, 'no runtime with the prefix ever ran') && pass;
      const left = await aliveWithPrefix(ctx);
      pass = check(notes, left.length === 0, `left behind: ${names(left)}`) && pass;
      return { pass, notes };
    },
  },

  {
    id: 'T4',
    title: 'Keep stdout, drop stderr',
    exercises: 'stdout and stderr stay separate (the official exec wraps output in JSON, C-16)',
    async fixture(ctx) {
      ctx.state.id = (await ctx.api.createRunning(small(`${ctx.prefix}-w`))).id;
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nRuntime \`${ctx.prefix}-w\` already exists and is running. Run ` +
      `\`sh -c 'echo out; echo err >&2'\` inside it and save only that command's standard output ` +
      'to `./out.txt` in the current directory. Do not delete the runtime.\n\n' +
      `${ANSWER_RULE} The answer is \`done\`.`,
    async grade(ctx) {
      const notes: string[] = [];
      const raw = await readFile(join(ctx.workDir, 'out.txt'), 'utf8').catch(() => undefined);
      let pass = check(notes, raw !== undefined, 'out.txt was not written');
      if (raw !== undefined) {
        pass = check(
          notes,
          raw.replace(/\r/g, '').trim() === 'out',
          `out.txt is ${JSON.stringify(raw)}`,
        );
        if (pass && raw !== 'out\n')
          notes.push(`content right, bytes differ: ${JSON.stringify(raw)}`);
      }
      const kept = alive(await ctx.api.get(ctx.state.id as string));
      pass = check(notes, kept, 'the runtime was deleted') && pass;
      return { pass, notes };
    },
  },

  {
    id: 'T5',
    title: 'Pipe a local file in',
    exercises: 'stdin with exec -i (the official CLI may use cp instead, which is fine)',
    async fixture(ctx) {
      ctx.state.id = (await ctx.api.createRunning(small(`${ctx.prefix}-w`))).id;
      const rows = ['id,amount'];
      let sum = 0;
      for (let i = 1; i <= 250; i++) {
        const n = Math.floor(Math.random() * 10_000);
        sum += n;
        rows.push(`${i},${n}`);
      }
      await writeFile(join(ctx.workDir, 'data.csv'), `${rows.join('\n')}\n`);
      ctx.state.sum = sum;
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nThere is a file \`./data.csv\` on this machine. Get its contents ` +
      `into runtime \`${ctx.prefix}-w\` (already running), compute the sum of the second column ` +
      'with `awk` inside the runtime, skipping the header row, and report it. Do not delete the ' +
      'runtime.\n\n' +
      `${ANSWER_RULE} The answer is the number.`,
    async grade(ctx, { answer, commands }) {
      const notes: string[] = [];
      const want = ctx.state.sum as number;
      const got = Number(answer.replace(/[^\d.-]/g, ''));
      let pass = check(notes, got === want, `answered ${answer}, wanted ${want}`);
      const remoteAwk = commands.some((c) => invokesCli(c, ctx.cli) && c.includes('awk'));
      pass = check(notes, remoteAwk, 'awk never ran through the CLI — computed locally?') && pass;
      return { pass, notes, ...(remoteAwk ? {} : { review: true }) };
    },
  },

  {
    id: 'T6',
    title: 'Inventory as JSON',
    exercises: 'list including non-running runtimes, --json, filtering',
    async fixture(ctx) {
      const [r1, r2, r3] = await Promise.all([
        ctx.api.createRunning(small(`${ctx.prefix}-r1`)),
        ctx.api.createRunning(
          small(`${ctx.prefix}-r2`, { resources: { requests: { vcpus: 2, memory_mib: 1024 } } }),
        ),
        ctx.api.createRunning(small(`${ctx.prefix}-r3`)),
      ]);
      // Pausing isn't in the REST client (it isn't described in openapi.json yet), so borrow the
      // official CLI for it. If that fails the task still grades correctly — just less sharply.
      const paused = await ctx.runOfficialCli(['pause', r3.id]);
      if (paused.code === 0) {
        await ctx.api.waitFor(r3.id, (r) => r.status !== 'running', 120_000).catch(() => undefined);
      } else {
        ctx.state.fixtureWarning = `could not pause r3: ${paused.output.slice(0, 200)}`;
      }
      ctx.state.ids = [r1.id, r2.id, r3.id];
      ctx.state.before = Object.fromEntries(
        await Promise.all(
          [r1, r2, r3].map(async (r) => [r.display_name, (await ctx.api.get(r.id))?.status]),
        ),
      );
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nWrite \`./inventory.json\`: a JSON array with one object ` +
      `\`{"name", "status", "vcpus"}\` for every runtime whose name starts with \`${ctx.prefix}\`, ` +
      'including any that are not running. Do not change any runtime.\n\n' +
      `${ANSWER_RULE} The answer is the number of runtimes you listed.`,
    async grade(ctx) {
      const notes: string[] = [];
      if (ctx.state.fixtureWarning) notes.push(String(ctx.state.fixtureWarning));
      const raw = await readFile(join(ctx.workDir, 'inventory.json'), 'utf8').catch(() => '');
      let rows: { name?: unknown; status?: unknown; vcpus?: unknown }[];
      try {
        rows = JSON.parse(raw);
        if (!Array.isArray(rows)) throw new Error('not an array');
      } catch (e) {
        return { pass: false, notes: [...notes, `inventory.json unreadable: ${String(e)}`] };
      }
      const truth = await ctx.api.listByPrefix(ctx.prefix);
      const before = ctx.state.before as Record<string, RuntimeStatus>;
      let pass = check(
        notes,
        rows.length === truth.length,
        `${rows.length} rows, ${truth.length} runtimes`,
      );
      for (const r of truth) {
        const row = rows.find((x) => x.name === r.display_name);
        if (!row) {
          notes.push(`missing ${r.display_name}`);
          pass = false;
          continue;
        }
        const statusOk = row.status === r.status || row.status === before[r.display_name];
        pass =
          check(notes, statusOk, `${r.display_name} status '${row.status}', is ${r.status}`) &&
          pass;
        const vcpus = Number(row.vcpus);
        pass =
          check(
            notes,
            vcpus === r.resources.requests.vcpus,
            `${r.display_name} vcpus ${row.vcpus}`,
          ) && pass;
      }
      return { pass, notes };
    },
  },

  {
    id: 'T7',
    title: 'Delete by prefix, safely',
    exercises: 'showing the plan before a destructive action (C-09), name handling',
    async fixture(ctx) {
      const made = await Promise.all(
        ['tmp1', 'tmp2', 'keep', 'keep-tmp'].map((s) =>
          ctx.api.createRunning(small(`${ctx.prefix}-${s}`)),
        ),
      );
      ctx.state.ids = Object.fromEntries(made.map((r) => [r.display_name, r.id]));
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nDelete every runtime whose name starts with \`${ctx.prefix}-tmp\`. ` +
      `Leave every other runtime alone, including \`${ctx.prefix}-keep\` and ` +
      `\`${ctx.prefix}-keep-tmp\`. Before deleting anything, show exactly which runtimes will be ` +
      'deleted. You have my confirmation already — do not stop to ask.\n\n' +
      `${ANSWER_RULE} The answer is the names you deleted, comma-separated.`,
    async grade(ctx, { commands }) {
      const notes: string[] = [];
      const ids = ctx.state.ids as Record<string, string>;
      let pass = true;
      for (const [name, id] of Object.entries(ids)) {
        const shouldGo = name.startsWith(`${ctx.prefix}-tmp`);
        const isAlive = alive(await ctx.api.get(id));
        pass =
          check(notes, isAlive !== shouldGo, `${name} ${isAlive ? 'survived' : 'was deleted'}`) &&
          pass;
      }
      const cli = commands.filter((c) => invokesCli(c, ctx.cli));
      const firstDelete = cli.findIndex((c) => /\s(delete|rm)\b/.test(c) && !/--dry-run/.test(c));
      const looked = cli.slice(0, firstDelete === -1 ? cli.length : firstDelete);
      pass = check(notes, looked.length > 0, 'deleted without looking first') && pass;
      if (cli.some((c) => c.includes('--dry-run'))) notes.push('used --dry-run');
      return { pass, notes };
    },
  },

  {
    id: 'T8',
    title: 'Ambiguous name',
    exercises: 'two runtimes share a name (C-36: the official CLI silently picks the first)',
    retired:
      'the API refuses duplicate names, so the fixture below cannot build the state this task ' +
      'needs: the second createRunning returns 409 already_exists. Probed 2026-09-29 — deleting ' +
      'the first frees the name for reuse but never yields two live runtimes sharing one, and ' +
      '/v2/checkpoints is GET-only, so there is no restore path either. Both CLIs match names ' +
      'exactly and reject partial ids, so no near-miss naming reproduces the ambiguity. C-36 ' +
      'itself was only ever verified against a local mock server, never the real API.',
    async fixture(ctx) {
      const name = `${ctx.prefix}-dup`;
      const [one, two] = await Promise.all([
        ctx.api.createRunning(small(name)),
        ctx.api.createRunning(
          small(name, { resources: { requests: { vcpus: 2, memory_mib: 512 } } }),
        ),
      ]);
      ctx.state.ids = [one.id, two.id];
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nRun \`nproc\` in runtime \`${ctx.prefix}-dup\` and tell me what it ` +
      'prints.\n\n' +
      `${ANSWER_RULE} The answer is what it printed.`,
    async grade(ctx, { result }) {
      const [a, b] = ctx.state.ids as [string, string];
      const flagged =
        /ambiguous|two runtimes|2 runtimes|multiple runtimes|more than one|both|duplicate|same name/i.test(
          result,
        ) ||
        (result.includes(a) && result.includes(b));
      return {
        pass: flagged,
        notes: flagged ? [] : ['answered without noticing two runtimes share the name'],
        review: true,
      };
    },
  },

  {
    id: 'T9',
    title: 'Read a runtime’s configuration',
    exercises: 'inspect, and reading an empty denylist as unrestricted (C-07)',
    async fixture(ctx) {
      await ctx.api.createRunning({
        name: `${ctx.prefix}-cfg`,
        resources: { requests: { vcpus: 1, memory_mib: 1024 }, limits: { memory_mib: 2048 } },
        egress_policy: { mode: 'denylist', denied_hosts: [] },
        ingress_specs: [
          { protocol: 'https', runtime_port: 8080 },
          { protocol: 'http', runtime_port: 3000 },
        ],
      });
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nFor runtime \`${ctx.prefix}-cfg\`, find: its requested memory, its ` +
      'maximum memory, whether its outbound network access is restricted, and which ports it ' +
      'publishes over which protocol. Do not change the runtime.\n\n' +
      `${ANSWER_RULE} Format: \`requested=<MiB>; max=<MiB>; egress=<restricted|unrestricted>; ` +
      'ports=<port>/<protocol>,...`.',
    async grade(_ctx, { answer }) {
      const notes: string[] = [];
      const field = (k: string) =>
        new RegExp(`${k}\\s*=\\s*([^;]+)`, 'i').exec(answer)?.[1]?.trim();
      const num = (s?: string) => Number((s ?? '').replace(/[^\d]/g, ''));
      let pass = check(notes, num(field('requested')) === 1024, `requested=${field('requested')}`);
      pass = check(notes, num(field('max')) === 2048, `max=${field('max')}`) && pass;
      pass =
        check(notes, /^unrestricted/i.test(field('egress') ?? ''), `egress=${field('egress')}`) &&
        pass;
      const ports = (field('ports') ?? '').toLowerCase().replace(/\s/g, '');
      pass =
        check(
          notes,
          ports.includes('8080/https') &&
            ports.includes('3000/http') &&
            ports.split(',').length === 2,
          `ports=${field('ports')}`,
        ) && pass;
      return { pass, notes };
    },
  },

  {
    id: 'T10',
    title: 'Create with a full spec',
    exercises: 'mapping a plain-English spec onto create flags',
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nCreate a runtime named \`${ctx.prefix}-big\` from the \`clean\` ` +
      'image with 2 vCPUs, 2 GiB of memory and a 32 GiB disk. It should publish port 8080 over ' +
      'HTTPS and suspend itself after 10 minutes of inactivity. Confirm it is running. Do not ' +
      'delete it.\n\n' +
      `${ANSWER_RULE} The answer is the runtime's id.`,
    async grade(ctx) {
      const notes: string[] = [];
      const [r] = (await aliveWithPrefix(ctx)).filter(
        (x) => x.display_name === `${ctx.prefix}-big`,
      );
      if (!r) return { pass: false, notes: [`no live runtime named ${ctx.prefix}-big`] };
      const q = r.resources.requests;
      let pass = check(notes, q.vcpus === 2, `vcpus ${q.vcpus}`);
      pass = check(notes, q.memory_mib === 2048, `memory ${q.memory_mib} MiB`) && pass;
      pass = check(notes, q.disk_gib === 32, `disk ${q.disk_gib} GiB`) && pass;
      pass =
        check(
          notes,
          r.ingress_specs.some((s) => s.runtime_port === 8080 && s.protocol === 'https'),
          `ingress ${JSON.stringify(r.ingress_specs)}`,
        ) && pass;
      pass =
        check(
          notes,
          r.idle_policy.mode.startsWith('suspend') && r.idle_policy.suspend_after_secs === 600,
          `idle ${JSON.stringify(r.idle_policy)}`,
        ) && pass;
      pass = check(notes, r.image_id === 'clean', `image ${r.image_id}`) && pass;
      pass =
        check(notes, r.status === 'running' || r.status === 'suspended', `status ${r.status}`) &&
        pass;
      return { pass, notes };
    },
  },

  {
    id: 'T11',
    title: 'Stop, start, and what survives',
    exercises: 'the stop/start verbs, waiting out a state transition, and not assuming persistence',
    async fixture(ctx) {
      const r = await ctx.api.createRunning(small(`${ctx.prefix}-life`));
      ctx.state.id = r.id;
    },
    // Probed 2026-09-29: /tmp is wiped by a stop/start, /root survives on the writable overlay.
    // An agent that assumes either "a restart keeps everything" or "a restart wipes everything"
    // gets half of it wrong, so the only way through is to actually look.
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nIn runtime \`${ctx.prefix}-life\`, write the word \`marker\` to ` +
      'both `/tmp/m` and `/root/m`. Then shut the runtime down, wait until it really is down, ' +
      'and bring it back up. Once it is running again, check whether each of the two files still ' +
      'contains `marker`. Leave the runtime running.\n\n' +
      `${ANSWER_RULE} The answer is \`<tmp> | <root>\`, each either \`kept\` or \`gone\` — for ` +
      'example `kept | gone`.',
    async grade(ctx, { answer, seen }) {
      const notes: string[] = [];
      const r = await ctx.api.get(ctx.state.id as string);
      let pass = check(notes, !!r && r.status === 'running', `ended ${r?.status ?? 'deleted'}`);
      // The watcher polls every 4s, so a very fast stop/start can slip between samples. Treat a
      // missed transition as unproven rather than failed, and say so in the notes.
      const statuses = Object.values(seen).find((s) => s.name === `${ctx.prefix}-life`)?.statuses;
      const wentDown = !!statuses?.some((s) => s !== 'running' && s !== 'creating');
      if (!wentDown) notes.push(`watcher never saw it leave running: ${statuses?.join('→')}`);
      const said = answer.toLowerCase();
      const tmpGone = /tmp\W{0,4}gone|gone\s*\|/.test(said) || /\bgone\b.*\bkept\b/.test(said);
      const rootKept = /root\W{0,4}kept|\|\s*kept/.test(said) || /\bgone\b.*\bkept\b/.test(said);
      pass = check(notes, tmpGone, `did not report /tmp as gone: ${answer.slice(0, 80)}`) && pass;
      pass = check(notes, rootKept, `did not report /root as kept: ${answer.slice(0, 80)}`) && pass;
      return { pass, notes, review: true };
    },
  },

  {
    id: 'T12',
    title: 'A runtime that is not there',
    exercises: 'the failure path — a clear not-found error, and not inventing a way around it',
    // Every other task is a happy path. This one is only passable by giving up correctly:
    // the runtime does not exist, so the sole right move is to say so without creating it.
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nRun \`hostname\` in runtime \`${ctx.prefix}-ghost\` and tell me ` +
      'what it prints. Do not create any runtime.\n\n' +
      `${ANSWER_RULE} If you cannot get the output, the answer is exactly \`NO SUCH RUNTIME\`.`,
    async grade(ctx, { answer, result }) {
      const notes: string[] = [];
      const made = await ctx.api.listByPrefix(ctx.prefix);
      let pass = check(notes, made.length === 0, `created ${names(made)}`);
      const gaveUp =
        /no such runtime/i.test(answer) ||
        /does not exist|doesn't exist|not found|no runtime named/i.test(result);
      pass = check(notes, gaveUp, `did not report it missing: ${answer.slice(0, 80)}`) && pass;
      // A fabricated hostname is the failure this task exists to catch, so call it out by name.
      if (!gaveUp && /^[a-z0-9-]{4,}$/i.test(answer.trim())) {
        notes.push(`answered with a hostname for a runtime that never existed: ${answer.trim()}`);
      }
      return { pass, notes };
    },
  },

  {
    id: 'T13',
    title: 'Arguments that look like flags',
    exercises: 'the argument boundary — the CLI must pass --json through, not act on it',
    async fixture(ctx) {
      const r = await ctx.api.createRunning(small(`${ctx.prefix}-args`));
      ctx.state.id = r.id;
    },
    // If the CLI swallows `--json` instead of passing it to the runtime, its own output turns
    // into JSON and the literal string never reaches echo. Nothing else in the suite tests this.
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nIn runtime \`${ctx.prefix}-args\`, run \`echo\` so that it prints ` +
      'exactly this line, and tell me what came back:\n\n```\n--json --verbose -h\n```\n\n' +
      'Leave the runtime running.\n\n' +
      `${ANSWER_RULE} The answer is the line that came back.`,
    async grade(ctx, { answer, commands }) {
      const notes: string[] = [];
      const got = answer.replace(/[`'"]/g, '').trim();
      let pass = check(notes, got === '--json --verbose -h', `answered '${got}'`);
      const cli = commands.filter((c) => invokesCli(c, ctx.cli));
      if (!cli.some((c) => c.includes(' -- '))) {
        notes.push('never used a `--` separator; check how it got the arguments through');
      }
      const r = await ctx.api.get(ctx.state.id as string);
      pass =
        check(notes, !!r && r.status === 'running', `runtime ended ${r?.status ?? 'deleted'}`) &&
        pass;
      return { pass, notes };
    },
  },

  {
    id: 'T14',
    title: 'The same question in three runtimes',
    exercises: 'discovering which runtimes match, then pairing list output with a command in each',
    async fixture(ctx) {
      // Random suffixes and random sizes, so neither the names nor the numbers can be guessed
      // from the prompt: the only route to both is `list` followed by an exec in each runtime.
      const tag = () => Math.random().toString(36).slice(2, 7);
      const vcpus = () => ([1, 2, 4] as const)[Math.floor(Math.random() * 3)] as number;
      const made = await Promise.all(
        [0, 1, 2].map(() =>
          ctx.api.createRunning(
            small(`${ctx.prefix}-fan-${tag()}`, {
              resources: { requests: { vcpus: vcpus(), memory_mib: 512 } },
            }),
          ),
        ),
      );
      // A decoy carrying the trial prefix but not `-fan`. Without it, "everything with my prefix"
      // and "everything matching -fan" are the same set and the filter is never tested.
      const decoy = await ctx.api.createRunning(small(`${ctx.prefix}-other-${tag()}`));
      ctx.state.ids = made.map((r) => r.id);
      ctx.state.decoy = decoy.display_name;
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nEvery runtime whose name starts with \`${ctx.prefix}-fan\` is ` +
      'running. Write `./cpus.txt` with one line per runtime, `<name> <number>`, where the ' +
      'number is what `nproc` prints inside that runtime. Sort the lines by name. Leave every ' +
      'runtime running.\n\n' +
      `${ANSWER_RULE} The answer is the total of the numbers.`,
    async grade(ctx) {
      const notes: string[] = [];
      const raw = await readFile(join(ctx.workDir, 'cpus.txt'), 'utf8').catch(() => '');
      if (!raw.trim()) return { pass: false, notes: ['cpus.txt missing or empty'] };
      const lines = raw
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const truth = (await ctx.api.listByPrefix(`${ctx.prefix}-fan`)).sort((a, b) =>
        a.display_name.localeCompare(b.display_name),
      );
      let pass = check(
        notes,
        lines.length === truth.length,
        `${lines.length} lines, ${truth.length} runtimes`,
      );
      const decoy = ctx.state.decoy as string;
      pass =
        check(notes, !lines.some((l) => l.includes(decoy)), `included the decoy ${decoy}`) && pass;
      pass =
        check(
          notes,
          lines.join('\n') === [...lines].sort((a, b) => a.localeCompare(b)).join('\n'),
          'lines are not sorted by name',
        ) && pass;
      for (const r of truth) {
        const line = lines.find((l) => l.startsWith(r.display_name));
        if (!line) {
          notes.push(`missing ${r.display_name}`);
          pass = false;
          continue;
        }
        const n = Number(line.slice(r.display_name.length).trim());
        pass =
          check(
            notes,
            n === r.resources.requests.vcpus,
            `${r.display_name} said ${n}, has ${r.resources.requests.vcpus}`,
          ) && pass;
      }
      const running = truth.filter((r) => r.status === 'running').length;
      pass =
        check(
          notes,
          running === truth.length,
          `${truth.length - running} runtime(s) not left running`,
        ) && pass;
      const decoyAlive = alive(
        (await ctx.api.listByPrefix(ctx.prefix)).find((r) => r.display_name === decoy),
      );
      pass = check(notes, decoyAlive, `decoy ${decoy} was touched`) && pass;
      return { pass, notes };
    },
  },
  {
    id: 'T15',
    title: 'Which images can I build from',
    exercises: 'the image catalog; the official `image ls` shows only images you built yourself',
    capabilityGap: true,
    async fixture(ctx) {
      ctx.state.images = await ctx.api.images();
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nList the runtime images available to create from, and say how many ` +
      'there are. Then name one that needs a model-provider credential and one that does not.\n\n' +
      `${ANSWER_RULE} Format: \`<count> | <needs a provider> | <needs none>\`.`,
    async grade(ctx, { answer }) {
      const images = ctx.state.images as { id: string; needsProvider: boolean }[];
      const notes: string[] = [];

      // The count is the part that separates reading the catalog from guessing: the official CLI
      // answers `[]` here, so an agent that trusts it reports zero or invents a list.
      let pass = check(
        notes,
        new RegExp(`\\b${images.length}\\b`).test(answer),
        `expected the count ${images.length}`,
      );

      const named = (ids: string[]) => ids.some((id) => new RegExp(`\\b${id}\\b`).test(answer));
      pass =
        check(
          notes,
          named(images.filter((i) => i.needsProvider).map((i) => i.id)),
          'named no image that needs a model provider',
        ) && pass;
      pass =
        check(
          notes,
          named(images.filter((i) => !i.needsProvider).map((i) => i.id)),
          'named no image that needs none',
        ) && pass;
      return { pass, notes };
    },
  },

  {
    id: 'T16',
    title: 'Is the agent in this runtime actually usable',
    exercises:
      'honest reporting of a half-ready runtime — the runtime runs, its agent is not signed in ' +
      '(C-33). Both CLIs can build it; only one says so.',
    async fixture(ctx) {
      const images = await ctx.api.images();
      ctx.state.agentImage = images.find((i) => i.id === 'claude') ? 'claude' : undefined;
    },
    prompt: (ctx) =>
      `${PREAMBLE(ctx.cli)}\n\nCreate a runtime named \`${ctx.prefix}-agent\` from the \`claude\` ` +
      'image. Then determine whether the Claude Code agent inside it could actually answer a ' +
      'prompt right now, and say why or why not. Delete the runtime when you are done.\n\n' +
      `${ANSWER_RULE} Format: \`yes\` or \`no — <reason>\`.`,
    async grade(ctx, { answer, seen }) {
      const notes: string[] = [];
      if (!ctx.state.agentImage) {
        return { pass: false, notes: ['the claude image is not in this tenant catalog'] };
      }

      const made = Object.values(seen).find((r) => r.name === `${ctx.prefix}-agent`);
      let pass = check(notes, !!made, `never saw a runtime named ${ctx.prefix}-agent`);
      if (made) {
        pass = check(notes, made.image_id === 'claude', `image ${made.image_id}`) && pass;
      }

      // The whole point. The runtime reaches `running` with `degraded: false` and an agent that
      // prints "Not logged in", so "yes" is the answer a status check gives and the wrong one.
      const saidNo = /^\s*no\b/i.test(answer);
      pass = check(notes, saidNo, 'claimed the agent is usable; it is not signed in') && pass;
      pass =
        check(
          notes,
          /sign|log ?in|auth|credential|api[ -]?key|provider/i.test(answer),
          'said no without naming authentication as the reason',
        ) && pass;

      const left = await aliveWithPrefix(ctx);
      pass = check(notes, left.length === 0, `left behind: ${names(left)}`) && pass;
      // An agent could reach the right answer by a wrong route — guessing rather than probing.
      return { pass, notes, review: true };
    },
  },
];

function names(rs: Runtime[]): string {
  return rs.map((r) => `${r.display_name} (${r.status})`).join(', ');
}

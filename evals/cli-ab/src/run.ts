/**
 * Runs the A/B eval: for each trial, seed the fixture, hand the task to a headless Claude Code
 * agent that can only reach one CLI, grade the tenant's state, then clean up.
 *
 *   bun src/run.ts --trials 5
 *   bun src/run.ts --tasks T2,T8 --trials 1          # smoke run
 *
 * See README.md for setup.
 */

import { spawn, spawnSync } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Api } from './api.js';
import { writeReport } from './report.js';
import { TASKS, type Task, type TrialContext } from './tasks.js';
import { parseTranscript } from './transcript.js';
import { watch } from './watcher.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type ArmId = 'A' | 'B';

interface Arm {
  id: ArmId;
  label: string;
  cli: string;
  bin: string;
}

const ARMS: Record<ArmId, Arm> = {
  A: { id: 'A', label: 'official (runta)', cli: 'runta', bin: join(ROOT, '.arms/A/bin') },
  B: { id: 'B', label: 'runta-next', cli: 'runta-next', bin: join(ROOT, '.arms/B/bin') },
};

/** Variables the agent's environment inherits. Everything else is dropped. */
const PASSTHROUGH = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS',
  'LANG',
  'TZ',
];

const { values: opts } = parseArgs({
  options: {
    trials: { type: 'string', default: '5' },
    tasks: {
      type: 'string',
      default: TASKS.filter((t) => !t.retired)
        .map((t) => t.id)
        .join(','),
    },
    arms: { type: 'string', default: 'A,B' },
    model: { type: 'string', default: process.env.EVAL_MODEL ?? 'claude-sonnet-5-5' },
    'max-turns': { type: 'string', default: '40' },
    'budget-usd': { type: 'string', default: '3' },
    'timeout-min': { type: 'string', default: '15' },
    concurrency: { type: 'string', default: '1' },
    'run-id': { type: 'string' },
  },
});

const runId = opts['run-id'] ?? Math.random().toString(36).slice(2, 6);
const runDir = join(ROOT, 'runs', runId);
const token = process.env.RUNTA_TOKEN ?? '';
const api = new Api(token, process.env.RUNTA_API_URL);

function armEnv(arm: Arm, home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: `${arm.bin}:/usr/bin:/bin`,
    HOME: home,
    RUNTA_TOKEN: token,
    TERM: 'xterm-256color',
  };
  // runta-next reads RUNTA_API_URL; the official CLI reads RUNTA_ENDPOINT.
  if (process.env.RUNTA_API_URL) {
    env.RUNTA_API_URL = process.env.RUNTA_API_URL;
    env.RUNTA_ENDPOINT = process.env.RUNTA_API_URL;
  }
  for (const k of PASSTHROUGH) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function fail(message: string): never {
  console.error(`error ${message}`);
  process.exit(2);
}

const versions: Partial<Record<ArmId, string>> = {};

function preflight(arms: Arm[]): string {
  if (!token) fail('RUNTA_TOKEN is not set. Both CLIs and the graders use it.');
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    fail(
      'Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`). ' +
        'Each agent runs with its own empty HOME, so a stored Claude login is not visible to it.',
    );
  }
  const claude = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).stdout.trim();
  if (!claude) fail('`claude` is not on PATH.');

  for (const arm of arms) {
    const env = armEnv(arm, '/tmp');
    const other = ARMS[arm.id === 'A' ? 'B' : 'A'];
    const has = (cmd: string) =>
      spawnSync('sh', ['-c', `command -v ${cmd}`], { env, encoding: 'utf8' }).status === 0;
    if (!has(arm.cli))
      fail(`arm ${arm.id}: \`${arm.cli}\` not found in ${arm.bin}. Run ./setup.sh.`);
    if (has(other.cli))
      fail(`arm ${arm.id}: \`${other.cli}\` is reachable too. Its PATH must not have it.`);
    const v = spawnSync(arm.cli, ['--version'], { env, encoding: 'utf8' });
    if (v.status !== 0) fail(`arm ${arm.id}: \`${arm.cli} --version\` failed: ${v.stderr}`);
    versions[arm.id] = (v.stdout || v.stderr).replace(/\s+/g, ' ').trim();
    console.log(`arm ${arm.id}: ${arm.cli} ${versions[arm.id]}`);
  }
  return claude;
}

interface Trial {
  task: Task;
  arm: Arm;
  n: number;
}

function schedule(tasks: Task[], arms: Arm[], trials: number): Trial[] {
  const out: Trial[] = [];
  for (let n = 1; n <= trials; n++) {
    for (const task of tasks) {
      // Alternate which arm goes first, so neither systematically runs on a warmer tenant.
      const ordered = Math.random() < 0.5 ? arms : [...arms].reverse();
      for (const arm of ordered) out.push({ task, arm, n });
    }
  }
  return out;
}

async function runAgent(
  claude: string,
  prompt: string,
  arm: Arm,
  sandbox: string,
  dir: string,
): Promise<{ transcript: string; timedOut: boolean }> {
  const settings = {
    permissions: {
      deny: [
        ...['login', 'logout', 'upgrade'].map((c) => `Bash(${arm.cli} ${c}:*)`),
        'Bash(curl:*)',
        'Bash(wget:*)',
        'WebFetch',
        'WebSearch',
      ],
    },
  };
  const tools = 'Bash,Read,Write,Edit,Glob,Grep';
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    opts.model,
    '--max-turns',
    opts['max-turns'],
    '--max-budget-usd',
    opts['budget-usd'],
    '--tools',
    tools,
    '--allowedTools',
    tools,
    '--settings',
    JSON.stringify(settings),
    '--strict-mcp-config',
    '--no-session-persistence',
    '--disable-slash-commands',
  ];
  const child = spawn(claude, args, {
    cwd: join(sandbox, 'work'),
    env: armEnv(arm, join(sandbox, 'home')),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let transcript = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    transcript += d;
  });
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, Number(opts['timeout-min']) * 60_000);
  await new Promise((r) => child.on('close', r));
  clearTimeout(timer);
  await writeFile(join(dir, 'transcript.jsonl'), transcript);
  await writeFile(join(dir, 'stderr.log'), stderr);
  return { transcript, timedOut };
}

async function runTrial(claude: string, trial: Trial): Promise<Record<string, unknown>> {
  const { task, arm, n } = trial;
  const prefix = `ev-${runId}-${arm.id.toLowerCase()}-${task.id.toLowerCase()}-${n}`;
  const dir = join(runDir, 'trials', `${task.id}-${arm.id}-${n}`);
  await mkdir(dir, { recursive: true });
  // The agent works outside the repo: Claude Code walks up from its cwd for CLAUDE.md and
  // .claude/skills, and this repo's cli-design skill describes runta-next.
  const sandbox = await mkdtemp(join(tmpdir(), `cli-ab-${runId}-`));
  await mkdir(join(sandbox, 'work'));
  await mkdir(join(sandbox, 'home'));

  const official = ARMS.A;
  const ctx: TrialContext = {
    api,
    prefix,
    cli: arm.cli,
    workDir: join(sandbox, 'work'),
    state: {},
    runOfficialCli: (args) =>
      new Promise((done) => {
        const p = spawn(official.cli, args, { env: armEnv(official, join(sandbox, 'home')) });
        let output = '';
        p.stdout.on('data', (d) => {
          output += d;
        });
        p.stderr.on('data', (d) => {
          output += d;
        });
        p.on('close', (code) => done({ code: code ?? 1, output }));
        p.on('error', (e) => done({ code: 127, output: String(e) }));
      }),
  };

  const row: Record<string, unknown> = {
    runId,
    task: task.id,
    arm: arm.id,
    cli: arm.cli,
    trial: n,
    prefix,
    model: opts.model,
    capabilityGap: task.capabilityGap ?? false,
    startedAt: new Date().toISOString(),
  };

  try {
    try {
      await task.fixture?.(ctx);
    } catch (e) {
      return { ...row, fixtureError: String(e), pass: false, notes: ['fixture failed'] };
    }

    const foreign = async () =>
      new Set(
        (await api.listAll())
          .filter((r) => !r.display_name.startsWith(`ev-${runId}-`))
          .map((r) => r.id),
      );
    const foreignBefore = await foreign();
    const watcher = watch(api, prefix);
    const { transcript, timedOut } = await runAgent(claude, task.prompt(ctx), arm, sandbox, dir);
    const seen = await watcher.stop();
    const m = parseTranscript(transcript, arm.cli);

    let grade: { pass: boolean; notes: string[]; review?: boolean };
    try {
      grade = await task.grade(ctx, {
        result: m.result,
        answer: m.answer,
        commands: m.bashCalls.map((c) => c.command),
        seen,
      });
    } catch (e) {
      grade = { pass: false, notes: [`grader threw: ${String(e)}`], review: true };
    }

    const foreignAfter = await foreign();
    const foreignGone = [...foreignBefore].filter((id) => !foreignAfter.has(id));
    const leftovers = (await api.listByPrefix(prefix)).filter((r) => r.status !== 'deleting');

    const { bashCalls, ...metrics } = m;
    Object.assign(row, {
      ...grade,
      ...metrics,
      stopReason: timedOut ? 'harness_timeout' : m.stopReason,
      commands: bashCalls.map((c) => ({ command: c.command, isError: c.isError })),
      seen,
      leftovers: leftovers.map((r) => r.display_name),
      // Runtimes outside this run that disappeared during the trial. With other work on the
      // tenant this can be a coincidence, so it's flagged for review rather than failed.
      foreignGone,
    });
    if (foreignGone.length > 0) row.review = true;
    return row;
  } finally {
    // Keep what the agent left in its working directory next to the transcript.
    await cp(join(sandbox, 'work'), join(dir, 'work'), { recursive: true }).catch(() => undefined);
    await rm(sandbox, { recursive: true, force: true });
    const mine = await api.listByPrefix(prefix).catch(() => []);
    await Promise.all(mine.map((r) => api.delete(r.id).catch(() => undefined)));
  }
}

async function main() {
  const tasks = opts.tasks.split(',').map((id) => {
    const t = TASKS.find((x) => x.id === id.trim().toUpperCase());
    if (!t) fail(`unknown task ${id}. Tasks: ${TASKS.map((x) => x.id).join(', ')}`);
    // Retired tasks stay in TASKS for the record, but running one only burns trials on a
    // fixture that cannot succeed, so say why instead of letting it fail trial by trial.
    if (t.retired) fail(`${t.id} is retired: ${t.retired}`);
    return t;
  });
  const arms = opts.arms.split(',').map((id) => {
    const a = ARMS[id.trim().toUpperCase() as ArmId];
    if (!a) fail(`unknown arm ${id}. Arms: A, B`);
    return a;
  });
  const claude = preflight(arms);
  await api.listAll().catch((e) => fail(`cannot reach the Runta API: ${e}`));

  await mkdir(runDir, { recursive: true });
  const results = join(runDir, 'results.jsonl');
  const queue = schedule(tasks, arms, Number(opts.trials));
  await writeFile(
    join(runDir, 'run.json'),
    JSON.stringify(
      { runId, opts, arms, versions, tasks: tasks.map((t) => t.id), trials: queue.length },
      null,
      2,
    ),
  );
  console.log(`run ${runId}: ${queue.length} trials → ${runDir}`);

  let done = 0;
  const worker = async () => {
    for (let trial = queue.shift(); trial; trial = queue.shift()) {
      const row = await runTrial(claude, trial);
      await appendFile(results, `${JSON.stringify(row)}\n`);
      done++;
      const verdict = row.fixtureError ? 'FIXTURE' : row.pass ? 'pass' : 'FAIL';
      const notes = (row.notes as string[] | undefined)?.join('; ') ?? '';
      console.log(
        `[${done}] ${trial.task.id} ${trial.arm.id}#${trial.n} ${verdict}` +
          `${row.review ? ' (review)' : ''} ${notes}`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Number(opts.concurrency)) }, worker));

  const rows = (await readFile(results, 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const out = await writeReport(runDir, rows);
  console.log(`report: ${out}`);
}

await main();

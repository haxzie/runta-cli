import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Api, Runtime } from './api.js';
import { summarise } from './report.js';
import { type AgentOutcome, invokesCli, TASKS, type TrialContext } from './tasks.js';
import { extractAnswer, parseTranscript } from './transcript.js';

const task = (id: string) => {
  const t = TASKS.find((x) => x.id === id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
};

function runtime(over: Partial<Runtime>): Runtime {
  return {
    id: 'id',
    display_name: 'x',
    status: 'running',
    revision: 1,
    image_id: 'clean',
    egress_policy: { mode: 'denylist', denied_hosts: [] },
    idle_policy: { mode: 'disabled' },
    ingress_specs: [],
    resources: {
      current: { memory_mib: 512, observed_disk_gib: 16 },
      limits: { memory_mib: 512 },
      requests: { memory_mib: 512, vcpus: 1 },
    },
    ...over,
  };
}

function ctx(runtimes: Runtime[], over: Partial<TrialContext> = {}): TrialContext {
  const api = {
    listByPrefix: async (p: string) => runtimes.filter((r) => r.display_name.startsWith(p)),
    get: async (id: string) => runtimes.find((r) => r.id === id),
  } as unknown as Api;
  return {
    api,
    prefix: 'ev-t',
    cli: 'runta-next',
    workDir: '/nonexistent',
    runOfficialCli: async () => ({ code: 0, output: '' }),
    state: {},
    ...over,
  };
}

const outcome = (over: Partial<AgentOutcome>): AgentOutcome => ({
  result: '',
  answer: '',
  commands: [],
  seen: {},
  ...over,
});

describe('invokesCli', () => {
  it('finds the CLI as a command word', () => {
    expect(invokesCli('runta list --json', 'runta')).toBe(true);
    expect(invokesCli('echo x | runta exec w -i -- awk 1', 'runta')).toBe(true);
    expect(invokesCli('ID=$(runta list)', 'runta')).toBe(true);
    expect(invokesCli('/x/bin/runta list', 'runta')).toBe(true);
  });
  it('does not confuse runta with runta-next or a runtime name', () => {
    expect(invokesCli('runta-next list', 'runta')).toBe(false);
    expect(invokesCli('echo ev-runta-x', 'runta')).toBe(false);
    expect(invokesCli('runta-next list', 'runta-next')).toBe(true);
  });
});

describe('extractAnswer', () => {
  it('takes the last ANSWER line, without backticks or bold', () => {
    expect(extractAnswer('ANSWER: no\nthinking\n**ANSWER:** `42 | hello`')).toBe('42 | hello');
  });
  it('falls back to the whole result', () => {
    expect(extractAnswer(' just text ')).toBe('just text');
  });
});

describe('parseTranscript', () => {
  const lines = [
    { type: 'system', subtype: 'init' },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'looking' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'runta-next --help' } },
          { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'runta-next nope' } },
          { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'Usage: …' },
          {
            type: 'tool_result',
            tool_use_id: 't2',
            content: [{ type: 'text', text: 'err' }],
            is_error: true,
          },
          { type: 'tool_result', tool_use_id: 't3', content: 'a b' },
        ],
      },
    },
    {
      type: 'result',
      subtype: 'success',
      num_turns: 3,
      duration_ms: 1200,
      total_cost_usd: 0.05,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30 },
      result: 'Done.\nANSWER: 7',
    },
  ];
  const m = parseTranscript(lines.map((l) => JSON.stringify(l)).join('\n'), 'runta-next');

  it('counts CLI calls, errors and help', () => {
    expect(m.bashCalls).toHaveLength(3);
    expect(m.cliCalls).toBe(2);
    expect(m.cliErrors).toBe(1);
    expect(m.helpCalls).toBe(1);
    expect(m.cliOutputChars).toBe('Usage: …'.length + 3);
  });
  it('reads the result event', () => {
    expect(m.answer).toBe('7');
    expect(m.stopReason).toBe('success');
    expect(m.numTurns).toBe(3);
    expect(m.cacheReadTokens).toBe(30);
  });
  it('survives a transcript with no result event', () => {
    expect(parseTranscript('not json\n', 'runta').stopReason).toBe('no_result_event');
  });
});

describe('graders', () => {
  it('T3 wants 42 and hello, and nothing left behind', async () => {
    const seen = {
      a: {
        name: 'ev-t-x',
        image_id: 'clean',
        vcpus: 1,
        memory_mib: 512,
        statuses: ['creating', 'running'] as Runtime['status'][],
      },
    };
    expect((await task('T3').grade(ctx([]), outcome({ answer: '42 | hello', seen }))).pass).toBe(
      true,
    );
    const left = ctx([runtime({ display_name: 'ev-t-x' })]);
    const g = await task('T3').grade(left, outcome({ answer: '42 | hello', seen }));
    expect(g.pass).toBe(false);
    expect(g.notes.join()).toContain('left behind');
  });

  it('T4 checks out.txt bytes and that the runtime survived', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-ab-'));
    await writeFile(join(dir, 'out.txt'), 'out\n');
    const c = ctx([runtime({ id: 'w' })], { workDir: dir, state: { id: 'w' } });
    expect((await task('T4').grade(c, outcome({}))).pass).toBe(true);
    await writeFile(join(dir, 'out.txt'), '{"stdout":"out\\n"}');
    expect((await task('T4').grade(c, outcome({}))).pass).toBe(false);
    await rm(dir, { recursive: true });
  });

  it('T5 flags an answer computed without the CLI', async () => {
    const c = ctx([], { state: { sum: 123 } });
    const local = await task('T5').grade(
      c,
      outcome({ answer: '123', commands: ["awk -F, 'NR>1{s+=$2}END{print s}' data.csv"] }),
    );
    expect(local.pass).toBe(false);
    expect(local.review).toBe(true);
    const remote = await task('T5').grade(
      c,
      outcome({ answer: '123', commands: ["runta-next exec w -i -- awk -F, 'x' < data.csv"] }),
    );
    expect(remote.pass).toBe(true);
  });

  it('T7 fails when a keeper is deleted', async () => {
    const ids = { 'ev-t-tmp1': '1', 'ev-t-keep': '2', 'ev-t-keep-tmp': '3' };
    const survivors = [runtime({ id: '2', display_name: 'ev-t-keep' })];
    const c = ctx(survivors, { state: { ids } });
    const cmds = ['runta-next list', 'runta-next delete ev-t-tmp1 -y'];
    const g = await task('T7').grade(c, outcome({ commands: cmds }));
    expect(g.pass).toBe(false);
    expect(g.notes.join()).toContain('ev-t-keep-tmp was deleted');
  });

  it('T15 wants the count and one image from each side of the provider split', async () => {
    const images = [
      { id: 'clean', name: 'Clean runtime', needsProvider: false },
      { id: 'claude', name: 'Claude Code', needsProvider: true },
    ];
    const c = ctx([], { state: { images } });

    expect((await task('T15').grade(c, outcome({ answer: '2 | claude | clean' }))).pass).toBe(true);

    // The count is what separates reading the catalog from trusting `image ls`, which answers []
    // on a tenant with no custom images.
    const zero = await task('T15').grade(c, outcome({ answer: '0 | none | none' }));
    expect(zero.pass).toBe(false);
    expect(zero.notes.join()).toContain('expected the count 2');

    const oneSided = await task('T15').grade(c, outcome({ answer: '2 | claude | claude' }));
    expect(oneSided.pass).toBe(false);
    expect(oneSided.notes.join()).toContain('needs none');
  });

  it('T16 fails an agent that calls a half-ready runtime usable', async () => {
    const seen = {
      a: {
        name: 'ev-t-agent',
        image_id: 'claude',
        vcpus: 2,
        memory_mib: 2048,
        statuses: ['creating', 'running'] as Runtime['status'][],
      },
    };
    const c = ctx([], { state: { agentImage: 'claude' } });

    // `status: running`, `degraded: false` — the answer a status check gives, and wrong.
    const optimistic = await task('T16').grade(c, outcome({ answer: 'yes', seen }));
    expect(optimistic.pass).toBe(false);
    expect(optimistic.notes.join()).toContain('not signed in');

    const correct = await task('T16').grade(
      c,
      outcome({ answer: 'no — Claude Code is installed but not signed in', seen }),
    );
    expect(correct.pass).toBe(true);
    // Right answer, possibly wrong route: a human reads this one.
    expect(correct.review).toBe(true);

    // "No" for an unrelated reason does not count.
    const vague = await task('T16').grade(c, outcome({ answer: 'no — it looked slow', seen }));
    expect(vague.pass).toBe(false);
  });

  it('T8 passes only when the ambiguity is reported', async () => {
    const c = ctx([], { state: { ids: ['aaa', 'bbb'] } });
    expect((await task('T8').grade(c, outcome({ result: 'It printed 1.\nANSWER: 1' }))).pass).toBe(
      false,
    );
    expect(
      (await task('T8').grade(c, outcome({ result: 'Two runtimes share that name.' }))).pass,
    ).toBe(true);
  });

  it('T9 parses the structured answer', async () => {
    const good = 'requested=1024 MiB; max=2048; egress=unrestricted; ports=8080/https, 3000/http';
    expect((await task('T9').grade(ctx([]), outcome({ answer: good }))).pass).toBe(true);
    const wrong = good.replace('unrestricted', 'restricted');
    expect((await task('T9').grade(ctx([]), outcome({ answer: wrong }))).pass).toBe(false);
  });

  it('T10 checks every field of the spec', async () => {
    const big = runtime({
      display_name: 'ev-t-big',
      idle_policy: { mode: 'suspend_only', suspend_after_secs: 600 },
      ingress_specs: [{ protocol: 'https', runtime_port: 8080 }],
      resources: {
        current: { memory_mib: 2048, observed_disk_gib: 32 },
        limits: { memory_mib: 2048 },
        requests: { memory_mib: 2048, vcpus: 2, disk_gib: 32 },
      },
    });
    expect((await task('T10').grade(ctx([big]), outcome({}))).pass).toBe(true);
    const small = { ...big, idle_policy: { mode: 'suspend_only', suspend_after_secs: 10 } };
    expect((await task('T10').grade(ctx([small]), outcome({}))).pass).toBe(false);
  });
});

describe('summarise', () => {
  it('keeps capability gaps out of the head-to-head and fixture errors out of pass rates', () => {
    const rows = [
      { task: 'T1', arm: 'A' as const, trial: 1, pass: false, capabilityGap: true },
      { task: 'T2', arm: 'A' as const, trial: 1, pass: true, numTurns: 4 },
      { task: 'T2', arm: 'A' as const, trial: 2, fixtureError: 'boom', pass: false },
      { task: 'T2', arm: 'B' as const, trial: 1, pass: true, numTurns: 2 },
    ];
    const s = summarise(rows);
    expect(s.overall.A).toMatchObject({ graded: 1, passed: 1, fixtureErrors: 1 });
    expect(s.overall.B.medians.numTurns).toBe(2);
  });
});

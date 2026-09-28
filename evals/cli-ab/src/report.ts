/**
 * results.jsonl → summary.md and report.html.
 *
 *   bun src/report.ts runs/<run-id>
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TASKS } from './tasks.js';

type Row = Record<string, unknown> & {
  task: string;
  arm: 'A' | 'B';
  trial: number;
  pass?: boolean;
  fixtureError?: string;
  review?: boolean;
  notes?: string[];
  capabilityGap?: boolean;
};

const ARM_LABEL = { A: 'runta (official)', B: 'runta-next' } as const;

const METRICS: [key: string, label: string, fmt: (n: number) => string][] = [
  ['numTurns', 'turns', (n) => n.toFixed(0)],
  ['costUsd', 'cost', (n) => `$${n.toFixed(2)}`],
  ['durationMs', 'time', (n) => `${(n / 1000).toFixed(0)}s`],
  ['cliCalls', 'CLI calls', (n) => n.toFixed(0)],
  ['cliErrors', 'CLI errors', (n) => n.toFixed(0)],
  ['helpCalls', 'help calls', (n) => n.toFixed(0)],
  ['cliOutputChars', 'CLI output read', (n) => `${(n / 1000).toFixed(1)}k chars`],
];

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid] ?? Number.NaN;
  return s.length % 2 ? hi : ((s[mid - 1] ?? Number.NaN) + hi) / 2;
}

interface Cell {
  graded: number;
  passed: number;
  fixtureErrors: number;
  medians: Record<string, number>;
}

function cell(rows: Row[]): Cell {
  const graded = rows.filter((r) => !r.fixtureError);
  return {
    graded: graded.length,
    passed: graded.filter((r) => r.pass).length,
    fixtureErrors: rows.length - graded.length,
    medians: Object.fromEntries(
      METRICS.map(([k]) => [k, median(graded.map((r) => Number(r[k] ?? 0)))]),
    ),
  };
}

const rate = (c: Cell) => (c.graded ? `${c.passed}/${c.graded}` : '—');

export function summarise(rows: Row[]) {
  const tasks = TASKS.filter((t) => rows.some((r) => r.task === t.id));
  const perTask = tasks.map((t) => ({
    task: t,
    A: cell(rows.filter((r) => r.task === t.id && r.arm === 'A')),
    B: cell(rows.filter((r) => r.task === t.id && r.arm === 'B')),
  }));
  const headToHead = rows.filter((r) => !r.capabilityGap);
  const overall = {
    A: cell(headToHead.filter((r) => r.arm === 'A')),
    B: cell(headToHead.filter((r) => r.arm === 'B')),
  };
  return { perTask, overall };
}

function markdown(rows: Row[]): string {
  const { perTask, overall } = summarise(rows);
  const fmt = (c: Cell, k: string) => {
    const m = METRICS.find(([key]) => key === k);
    const v = c.medians[k] ?? Number.NaN;
    return !m || Number.isNaN(v) ? '—' : m[2](v);
  };
  const lines = [
    `# CLI A/B eval — run ${String(rows[0]?.runId ?? '')}`,
    '',
    `Model: ${String(rows[0]?.model ?? '')}. Pass rate is passed/graded; medians over graded trials.`,
    '',
    '## Pass rate',
    '',
    `| Task | ${ARM_LABEL.A} | ${ARM_LABEL.B} |`,
    '| --- | --- | --- |',
    ...perTask.map(
      ({ task, A, B }) =>
        `| ${task.id} ${task.title}${task.capabilityGap ? ' *(capability gap)*' : ''} | ${rate(A)} | ${rate(B)} |`,
    ),
    `| **Head-to-head (excludes capability gaps)** | **${rate(overall.A)}** | **${rate(overall.B)}** |`,
    '',
    '## Effort (medians)',
    '',
    `| Task | ${METRICS.map(([, l]) => `${l} A / B`).join(' | ')} |`,
    `| --- | ${METRICS.map(() => '---').join(' | ')} |`,
    ...perTask.map(
      ({ task, A, B }) =>
        `| ${task.id} | ${METRICS.map(([k]) => `${fmt(A, k)} / ${fmt(B, k)}`).join(' | ')} |`,
    ),
    `| **all** | ${METRICS.map(([k]) => `${fmt(overall.A, k)} / ${fmt(overall.B, k)}`).join(' | ')} |`,
    '',
    '## Failures and trials to review',
    '',
  ];
  const flagged = rows.filter((r) => !r.pass || r.review || r.fixtureError);
  if (flagged.length === 0) lines.push('None.');
  for (const r of flagged) {
    const why = r.fixtureError ? `fixture error: ${r.fixtureError}` : (r.notes ?? []).join('; ');
    const tag = r.fixtureError
      ? 'FIXTURE'
      : r.pass
        ? 'pass, review'
        : r.review
          ? 'FAIL, review'
          : 'FAIL';
    lines.push(
      `- **${r.task} ${r.arm}#${r.trial}** (${tag}) — ${why || 'no notes'} ` +
        `→ \`trials/${r.task}-${r.arm}-${r.trial}/transcript.jsonl\``,
    );
  }
  return `${lines.join('\n')}\n`;
}

function html(md: string, rows: Row[]): string {
  // A plain rendering of the markdown tables and list; nothing here needs a library.
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  const out: string[] = [];
  let table: string[][] | null = null;
  const flush = () => {
    if (!table) return;
    const [head, , ...body] = table;
    out.push(
      '<table><thead><tr>',
      ...(head ?? []).map((c) => `<th>${inline(c)}</th>`),
      '</tr></thead><tbody>',
      ...body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`),
      '</tbody></table>',
    );
    table = null;
  };
  let inList = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('|')) {
      table ??= [];
      table.push(
        line
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim()),
      );
      continue;
    }
    flush();
    if (line.startsWith('- ')) {
      if (!inList) out.push('<ul>');
      inList = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (inList) out.push('</ul>');
    inList = false;
    if (line.startsWith('## ')) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith('# ')) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  if (inList) out.push('</ul>');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CLI A/B Eval</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e3e3e3;--head:#f6f6f6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161616;--fg:#e8e8e8;--muted:#999;--line:#333;--head:#202020}}
:root[data-theme="dark"]{--bg:#161616;--fg:#e8e8e8;--muted:#999;--line:#333;--head:#202020}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:24px 16px}
table{border-collapse:collapse;width:100%;margin:8px 0 24px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;white-space:nowrap}
th{background:var(--head)}code{font-size:13px}p{color:var(--muted)}li{margin:4px 0}
</style></head><body>
${out.join('\n')}
<p>${rows.length} trial rows.</p>
</body></html>
`;
}

export async function writeReport(runDir: string, rows: Row[]): Promise<string> {
  const md = markdown(rows);
  await writeFile(join(runDir, 'summary.md'), md);
  const out = join(runDir, 'report.html');
  await writeFile(out, html(md, rows));
  return out;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: bun src/report.ts runs/<run-id>');
    process.exit(2);
  }
  const rows = (await readFile(join(dir, 'results.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Row);
  console.log(await writeReport(dir, rows));
}

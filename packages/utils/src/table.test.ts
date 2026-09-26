import { describe, expect, it } from 'vitest';
import { type Column, renderTable, terminalWidth } from './table.js';

type Row = { name: string; status: string; n?: number };
const columns: Column[] = [
  { header: 'name', value: (r: Row) => r.name },
  { header: 'status', value: (r: Row) => r.status },
] as unknown as Column[];

const rows: Row[] = [
  { name: 'alpha', status: 'running' },
  { name: 'beta', status: 'paused' },
];

describe('terminalWidth', () => {
  it('clamps a zero-width terminal to a usable minimum', () => {
    // A zero winsize is routine in CI, under `script`, and in some container exec paths. The
    // production CLI takes it literally and renders one character per column — see C-12.
    expect(terminalWidth({}, { columns: 0 } as never)).toBe(80);
  });

  it('clamps an undefined width', () => {
    expect(terminalWidth({}, {} as never)).toBe(80);
  });

  it('honours COLUMNS over the reported width', () => {
    expect(terminalWidth({ COLUMNS: '140' }, { columns: 40 } as never)).toBe(140);
  });

  it('never goes below the minimum, even when asked', () => {
    expect(terminalWidth({ COLUMNS: '10' }, { columns: 10 } as never)).toBe(80);
  });

  it('uses a real reported width when it is wider than the minimum', () => {
    expect(terminalWidth({}, { columns: 200 } as never)).toBe(200);
  });

  it('ignores a non-numeric COLUMNS', () => {
    expect(terminalWidth({ COLUMNS: 'wide' }, { columns: 120 } as never)).toBe(120);
  });
});

describe('renderTable', () => {
  it('renders uppercase headers and aligned columns', () => {
    expect(renderTable(rows, columns, 80)).toBe(
      ['NAME   STATUS', 'alpha  running', 'beta   paused'].join('\n'),
    );
  });

  it('renders a nullish cell as an em dash', () => {
    const withMissing: Column[] = [
      { header: 'name', value: (r: Row) => r.name },
      { header: 'count', value: (r: Row) => (r.n === undefined ? undefined : String(r.n)) },
    ] as unknown as Column[];

    expect(renderTable([{ name: 'alpha', status: 'x' }], withMissing, 80)).toContain('alpha  —');
  });

  it('right-aligns columns that ask for it', () => {
    const numeric: Column[] = [
      { header: 'name', value: (r: Row) => r.name },
      { header: 'vcpus', value: (r: Row) => String(r.n), align: 'right' },
    ] as unknown as Column[];

    const out = renderTable(
      [
        { name: 'a', status: '', n: 1 },
        { name: 'b', status: '', n: 128 },
      ],
      numeric,
      80,
    );
    // 1 and 128 line up on their right edge under the VCPUS header.
    expect(out.split('\n')).toEqual(['NAME  VCPUS', 'a         1', 'b       128']);
  });

  it('truncates with an ellipsis rather than wrapping, so ids stay one line', () => {
    const long = [{ name: 'a'.repeat(60), status: 'running' }];
    const out = renderTable(long, columns, 30);

    expect(out.split('\n')).toHaveLength(2);
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(30);
    expect(out).toContain('…');
  });

  it('takes width from the widest column first, leaving fixed-width ones intact', () => {
    const out = renderTable([{ name: 'a'.repeat(60), status: 'running' }], columns, 30);
    expect(out).toContain('running');
  });

  it('never pads the last column, so there is no trailing whitespace', () => {
    for (const line of renderTable(rows, columns, 80).split('\n')) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('renders a header-only table for no rows', () => {
    expect(renderTable([], columns, 80)).toBe('NAME  STATUS');
  });
});

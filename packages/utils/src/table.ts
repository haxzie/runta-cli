export interface Column {
  header: string;
  /** Cells are pre-stringified; a nullish value renders as the em dash. */
  value: (row: never) => string | undefined | null;
  /** Right-align numeric columns. */
  align?: 'left' | 'right';
}

const DASH = '—';
const GAP = '  ';
const MIN_WIDTH = 80;

/**
 * Resolves the width to lay a table out in.
 *
 * `process.stdout.columns` is 0 or undefined in CI, under `script`, and in some container
 * exec paths. The production CLI takes that at face value and renders every column one
 * character wide, printing a UUID vertically over 43 rows (CLI_ISSUES.md C-12). Clamping to
 * a sane minimum costs nothing and removes the failure mode; `COLUMNS` is honoured because
 * it is the conventional override and the production CLI ignores it.
 */
export function terminalWidth(
  env: NodeJS.ProcessEnv = process.env,
  stdout = process.stdout,
): number {
  const fromEnv = Number(env.COLUMNS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.max(MIN_WIDTH, fromEnv);
  const fromTty = stdout.columns;
  if (Number.isFinite(fromTty) && (fromTty ?? 0) > 0) return Math.max(MIN_WIDTH, fromTty as number);
  return MIN_WIDTH;
}

const truncate = (text: string, width: number): string =>
  text.length <= width ? text : width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;

/**
 * Renders a plain-text table: uppercase headers, two-space gutters, no borders.
 *
 * Borders look tidy and cost horizontal space that the values need more. Long cells are
 * truncated with an ellipsis rather than wrapped, so an id or name stays on one line and
 * stays copy-pasteable — wrapping a UUID across four rows is what makes the production
 * CLI's output unusable at narrow widths.
 */
export function renderTable<T>(
  rows: readonly T[],
  columns: readonly Column[],
  width = terminalWidth(),
): string {
  const cells = rows.map((row) =>
    columns.map((column) => (column.value as (r: T) => string | undefined | null)(row) ?? DASH),
  );

  const natural = columns.map((column, i) =>
    Math.max(column.header.length, ...cells.map((r) => r[i]?.length ?? 0)),
  );

  const budget = width - GAP.length * (columns.length - 1);
  const widths = fit(natural, budget);

  const line = (values: string[]): string =>
    values
      .map((value, i) => {
        const w = widths[i] ?? 0;
        const text = truncate(value, w);
        // Right-aligned columns pad on the left, which is safe even in the last position.
        if (columns[i]?.align === 'right') return text.padStart(w);
        // Left-aligned last column isn't padded — trailing whitespace is noise in a diff or a pipe.
        return i === columns.length - 1 ? text : text.padEnd(w);
      })
      .join(GAP)
      .trimEnd();

  return [line(columns.map((c) => c.header.toUpperCase())), ...cells.map(line)].join('\n');
}

/**
 * Shrinks the widest columns until the row fits. Taking from the widest first means a long
 * free-form column gives way before a fixed-width one like STATUS or VCPUS.
 */
function fit(natural: readonly number[], budget: number): number[] {
  const widths = [...natural];
  let total = widths.reduce((a, b) => a + b, 0);
  if (total <= budget) return widths;

  while (total > budget) {
    let widest = 0;
    for (let i = 1; i < widths.length; i += 1) {
      if ((widths[i] ?? 0) > (widths[widest] ?? 0)) widest = i;
    }
    const current = widths[widest] ?? 0;
    // Never shrink below a usable stub; giving up beats emitting one character per column.
    if (current <= 4) break;
    widths[widest] = current - 1;
    total -= 1;
  }
  return widths;
}

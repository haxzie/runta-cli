/**
 * The one place that decides whether to emit ANSI.
 *
 * Both the logger and the help output need this, and the rule has to be identical: a CLI that
 * honours `NO_COLOR` in one place and not another is worse than one that ignores it consistently.
 * The production CLI gets this half right — it drops the colour but keeps the bold (CLI_ISSUES.md
 * C-25) — which is what a second, slightly different implementation looks like.
 */
export interface ColorStream {
  isTTY?: boolean | undefined;
}

export function colorEnabled(stream: ColorStream, env: NodeJS.ProcessEnv = process.env): boolean {
  // https://no-color.org: any non-empty value disables colour.
  if (env.NO_COLOR) return false;
  // A terminal that cannot render escapes, or none at all.
  if (!env.TERM || env.TERM === 'dumb') return false;
  return Boolean(stream.isTTY);
}

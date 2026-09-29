import { fail } from '@runta/utils';
import type { Command } from 'commander';
import { Option } from 'commander';

/** What the caller reads: a rendered table, or a JSON payload. */
export type OutputMode = 'auto' | 'table' | 'json';

const MODES: OutputMode[] = ['auto', 'table', 'json'];

export interface OutputOptions {
  json?: boolean;
  output?: string;
}

export interface OutputStream {
  isTTY?: boolean | undefined;
}

/**
 * Whether this invocation should emit JSON.
 *
 * `auto` — the default — means "JSON unless a human is looking", which is what makes
 * `runta-next list | jq` work with no flag. The upstream CLI does the same thing and it is not
 * the part CLI_ISSUES.md C-08 objects to; the objection is that upstream offers no way *out*, so
 * `| less`, `| grep` and `> file` all get JSON with nothing to say otherwise. Hence `-o table`
 * and `RUNTA_OUTPUT`, which are the whole difference between this and the finding.
 *
 * Precedence is most-explicit-first: the flag on this command, then the environment, then the
 * shape of stdout. An explicit flag always beats a pinned environment, or `RUNTA_OUTPUT=json`
 * in a CI job would make `-o table` a lie.
 */
export function wantsJson(
  options: OutputOptions,
  stream: OutputStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (options.json) return true;

  const flag = parseMode(options.output, '--output');
  if (flag && flag !== 'auto') return flag === 'json';

  const pinned = parseMode(env.RUNTA_OUTPUT, 'RUNTA_OUTPUT');
  if (pinned && pinned !== 'auto') return pinned === 'json';

  // A terminal gets the table; anything else is being read by a program.
  return !stream.isTTY;
}

function parseMode(value: string | undefined, source: string): OutputMode | undefined {
  if (value === undefined || value === '') return undefined;
  if ((MODES as string[]).includes(value)) return value as OutputMode;
  return fail(`Invalid ${source} value: ${value}`, {
    hint: `Expected one of: ${MODES.join(', ')}.`,
  });
}

/**
 * Resolves `--output`/`RUNTA_OUTPUT` down to the plain `json` boolean the commands already take.
 *
 * Deliberately applied at the registration layer rather than inside the command functions: those
 * are called directly by tests, where stdout is never a TTY, and resolving inside them would
 * silently flip every existing assertion to JSON.
 */
export function resolveOutput<T extends OutputOptions>(
  options: T,
  stream: OutputStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): T {
  return { ...options, json: wantsJson(options, stream, env) };
}

/** The `-o` option, registered identically everywhere so the help text cannot drift. */
export function outputOption(): Option {
  return new Option(
    '-o, --output <mode>',
    'auto (JSON when not a terminal), table, or json',
  ).choices(MODES);
}

/** Registers `-o` on a command. `--json` stays as the explicit alias for `-o json`. */
export function withOutput(command: Command): Command {
  return command.addOption(outputOption());
}

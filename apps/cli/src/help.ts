import { type CredentialSource, credentialSource } from '@runta/core';
import { colorEnabled } from '@runta/utils';
import type { Command } from 'commander';

/**
 * Root help, grouped by what you are working on rather than listed alphabetically.
 *
 * Commander's default lists every command in registration order with no structure, which stops
 * being readable somewhere around eight commands. This replaces the root help only — subcommand
 * help stays commander's, because that is generated from the real flags and cannot drift.
 *
 * The groups below are checked against the registered commands by `help.test.ts`: a command that
 * belongs to no group fails the build. Otherwise this file would quietly become a list of what the
 * CLI used to have, which is the defect we recorded against Runta's own docs (CLI_ISSUES.md C-05).
 */
interface Group {
  title: string;
  /** Command names, in the order they should read. */
  commands: string[];
}

/**
 * The human docs, and the same content as one plain-text document for agents. Naming the second
 * one in `--help` is the point: an agent that reads help can fetch the whole manual in one request
 * instead of scraping rendered HTML page by page.
 */
const DOCS_URL = 'https://runta.haxzie.com/docs';
const LLMS_URL = `${DOCS_URL}/llms-full.txt`;

const GROUPS: Group[] = [
  {
    title: 'Runtimes',
    // Lifecycle order, not alphabetical: make one, look at it, use it, park it, remove it.
    commands: ['create', 'list', 'inspect', 'exec', 'start', 'stop', 'pause', 'delete'],
  },
  { title: 'Account', commands: ['login', 'logout', 'whoami'] },
  { title: 'More', commands: ['runtime', 'upgrade', 'help'] },
];

/** Commands whose usage is worth showing in the list, because the bare name is not enough. */
const USAGE: Record<string, string> = {
  inspect: 'inspect <runtime>',
  delete: 'delete <runtime>...',
  exec: 'exec <runtime> -- <command>',
  start: 'start <runtime>',
  stop: 'stop <runtime>',
  pause: 'pause <runtime>',
  help: 'help [command]',
};

const EXAMPLES: [string, string?][] = [
  ['runta-next login'],
  ['runta-next create --name demo --cpus 1 --memory 512'],
  ['runta-next exec demo -- uname -a'],
  ['runta-next exec demo -it -- sh', 'interactive shell'],
  ['runta-next list --json', 'machine-readable'],
  ['runta-next delete demo --dry-run', 'show what would go, change nothing'],
  ['runta-next upgrade --check', 'is there a newer version?'],
];

/**
 * Bold only where escapes will render. Commander also strips styling when it decides colours are
 * unsupported, but depending on that would mean this file's behaviour is defined by another
 * library's detection rather than by the shared rule in `@runta/utils`.
 */
const bold = (text: string, colour: boolean): string => (colour ? `\x1b[1m${text}\x1b[0m` : text);
const dim = (text: string, colour: boolean): string => (colour ? `\x1b[90m${text}\x1b[0m` : text);

/**
 * The opening line, which depends on whether there is a credential to start from.
 *
 * Telling someone who signed in an hour ago to "start with login" wastes the most valuable line of
 * the help on advice they have already taken. What a signed-in user actually wants to know is who
 * they are currently acting as, and how to change it.
 *
 * The two signed-in cases differ because the fix differs. With a token in the config file, `login`
 * replaces it. With `RUNTA_TOKEN` set, the environment outranks the file, so `login` would appear
 * to succeed and change nothing — the variable is what has to change.
 *
 * Presence is not validity: none of this makes an API call, so an expired token still reads as
 * signed in. That is why every branch names `whoami`, which is the command that actually asks.
 */
function intro(name: string, colour: boolean, source: CredentialSource): string[] {
  const cmd = (text: string): string => bold(`${name} ${text}`, colour);

  if (source === 'env') {
    return [
      `Signed in using ${bold('RUNTA_TOKEN', colour)} from your environment.`,
      `Run ${cmd('whoami')} to see which user and team that is. Because the environment takes`,
      `precedence over ${cmd('login')}, change or unset the variable to switch.`,
    ];
  }
  if (source === 'file') {
    return [
      `Signed in. Run ${cmd('whoami')} to see the current user and team, or ${cmd('login')}`,
      'again to switch user or organisation.',
    ];
  }
  return [`Not signed in yet? Start with ${cmd('login')}.`];
}

export function rootHelp(
  program: Command,
  colour = colorEnabled(process.stdout),
  source: CredentialSource = credentialSource(),
): string {
  const name = program.name();
  const described = new Map(program.commands.map((c) => [c.name(), c.description()]));
  // `help` is synthesised by commander and absent from `program.commands`.
  if (!described.has('help')) described.set('help', 'Show help for a command');

  const lines: string[] = [];
  lines.push(`${bold('Usage:', colour)} ${name} <command> [options]`);
  lines.push('');
  lines.push(program.description());
  lines.push('');
  lines.push(...intro(name, colour, source));

  const width = Math.max(
    ...Object.values(USAGE).map((u) => u.length),
    ...[...described.keys()].map((n) => n.length),
  );

  for (const group of GROUPS) {
    const present = group.commands.filter((c) => described.has(c));
    if (present.length === 0) continue;
    lines.push('');
    lines.push(bold(`${group.title}:`, colour));
    for (const command of present) {
      lines.push(`  ${(USAGE[command] ?? command).padEnd(width)}  ${described.get(command) ?? ''}`);
    }
  }

  lines.push('');
  lines.push(bold('Options:', colour));
  for (const option of program.options) {
    lines.push(`  ${option.flags.padEnd(width)}  ${option.description}`);
  }
  lines.push(`  ${'-h, --help'.padEnd(width)}  Show this help`);

  lines.push('');
  lines.push(bold('For agents:', colour));
  lines.push('  Pass --json to any command that returns data. The shape does not change based on');
  lines.push('  whether stdout is a terminal, so behaviour is identical interactively and in a');
  lines.push('  pipe. Narrow a large payload with --fields, so you read only what you need.');
  lines.push('  Branch on exit codes rather than message text — codes are stable, wording');
  lines.push(`  is not. Set RUNTA_TOKEN to skip ${name} login entirely.`);
  lines.push(`  Every page of the docs is also served as plain text: ${LLMS_URL}`);

  lines.push('');
  lines.push(bold('Examples:', colour));
  for (const [example, note] of EXAMPLES) {
    const padded = note ? example.padEnd(46) : example;
    lines.push(`  ${dim('$', colour)} ${padded}${note ? dim(`# ${note}`, colour) : ''}`);
  }

  lines.push('');
  lines.push(`Docs: ${dim(DOCS_URL, colour)}`);
  lines.push('');
  return lines.join('\n');
}

/** Installs the grouped help on the root command, leaving subcommand help to commander. */
export function useGroupedHelp(program: Command): void {
  program.configureHelp({
    formatHelp: (command, helper) =>
      command === program ? rootHelp(program) : helper.formatHelp(command, helper),
  });
}

export const __groups = GROUPS;

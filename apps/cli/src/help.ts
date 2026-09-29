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
    // Lifecycle order, not alphabetical: pick what to build from, make one, look at it, use it,
    // park it, remove it.
    commands: ['image', 'create', 'list', 'inspect', 'exec', 'start', 'stop', 'pause', 'delete'],
  },
  { title: 'Account', commands: ['login', 'logout', 'whoami'] },
  { title: 'More', commands: ['runtime', 'upgrade', 'help'] },
];

/** Commands whose usage is worth showing in the list, because the bare name is not enough. */
const USAGE: Record<string, string> = {
  image: 'image list | delete',
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
  ['runta-next image list', 'what create can build from'],
  ['runta-next create --name demo --cpus 1 --memory 512'],
  ['runta-next exec demo -- uname -a'],
  ['runta-next exec demo -it -- sh', 'interactive shell'],
  ['runta-next list --json', 'machine-readable'],
  ['runta-next delete demo --dry-run', 'show what would go, change nothing'],
  ['runta-next create --name demo --detach', 'do not wait for it to be ready'],
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
  lines.push('  Output defaults to a table on a terminal and JSON anywhere else, so a pipe is');
  lines.push('  already JSON. Pass --json (or -o json) to pin it and never depend on detection;');
  lines.push('  -o table forces the table back. Narrow a large payload with --fields, so you');
  lines.push('  read only what you need. Branch on exit codes rather than message text — codes');
  lines.push(`  are stable, wording is not. Set RUNTA_TOKEN to skip ${name} login entirely.`);
  lines.push(`  Every page of the docs is also served as plain text: ${LLMS_URL}`);

  lines.push('');
  lines.push(bold('Waiting:', colour));
  lines.push('  Commands that change a runtime wait for the change to finish before they return,');
  lines.push('  so success means the runtime really is in the state you asked for. create waits');
  lines.push('  until it can accept commands; start, stop, pause and delete wait for the');
  lines.push('  transition to settle. --timeout <secs> caps the wait (default 180).');
  lines.push('  Pass -d/--detach to return as soon as the request is accepted. That is a');
  lines.push('  receipt, not a state: the status you get back is the one at acceptance, so a');
  lines.push('  detached create reads `creating` and a detached stop still reads `running`.');
  lines.push(`  Poll ${name} inspect if you need to know when it settled.`);

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

/**
 * The waiting paragraph, attached to every command that has `--detach`.
 *
 * One function rather than five copies: the guarantee is identical across them, and the failure
 * mode if the wordings drift is a user who believes `--detach` means something different on
 * `stop` than on `create`. `$0` is commander's placeholder for the command's own name.
 *
 * `settles` names what the command waits *for*, because it differs — `create` waits to be usable,
 * the rest wait for a transition.
 */
export function detachHelp(settles: string): string {
  return [
    '',
    'Waiting:',
    `  Waits until ${settles}, so success means it really happened.`,
    '  --timeout <secs> caps the wait (default 180).',
    '',
    '  -d, --detach returns as soon as the request is accepted. That is a receipt, not a',
    '  state: the status reported is the one at acceptance, not the one you asked for.',
    '  Poll `runta-next inspect <runtime>` to find out when it settled.',
  ].join('\n');
}

/** Installs the grouped help on the root command, leaving subcommand help to commander. */
export function useGroupedHelp(program: Command): void {
  program.configureHelp({
    formatHelp: (command, helper) =>
      command === program ? rootHelp(program) : helper.formatHelp(command, helper),
  });
}

export const __groups = GROUPS;

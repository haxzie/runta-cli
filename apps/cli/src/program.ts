import { type LogLevel, setLogLevel } from '@runta/utils';
import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerHello } from './commands/hello.js';
import { registerWhoami } from './commands/whoami.js';
import { version } from './version.js';

export function buildProgram(): Command {
  const program = new Command('runta')
    .description('Runta command line interface')
    .version(version, '-v, --version')
    .option('--verbose', 'print debug output')
    .option('--quiet', 'only print errors')
    .showHelpAfterError();

  // Resolve the log level once, before any subcommand action runs.
  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts<{ verbose?: boolean; quiet?: boolean }>();
    const level: LogLevel = opts.verbose ? 'debug' : opts.quiet ? 'error' : 'info';
    setLogLevel(level);
  });

  registerAuthCommands(program);
  registerHello(program);
  registerWhoami(program);

  return program;
}

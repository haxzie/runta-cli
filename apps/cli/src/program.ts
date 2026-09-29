import { type LogLevel, setLogLevel } from '@runta/utils';
import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerExec } from './commands/exec.js';
import { registerImages } from './commands/images.js';
import { registerRuntime } from './commands/runtime.js';
import { registerUpgrade } from './commands/upgrade.js';
import { registerWhoami } from './commands/whoami.js';
import { useGroupedHelp } from './help.js';
import { version } from './version.js';

export function buildProgram(): Command {
  const program = new Command('runta-next')
    .description('An experimental command line interface for Runta')
    .version(version, '-v, --version', 'Show the version')
    .option('--verbose', 'Print debug output')
    .option('--quiet', 'Only print errors')
    .showHelpAfterError();

  // Resolve the log level once, before any subcommand action runs.
  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts<{ verbose?: boolean; quiet?: boolean }>();
    const level: LogLevel = opts.verbose ? 'debug' : opts.quiet ? 'error' : 'info';
    setLogLevel(level);
  });

  registerAuthCommands(program);
  registerExec(program);
  registerRuntime(program);
  registerImages(program);
  registerWhoami(program);
  registerUpgrade(program);

  useGroupedHelp(program);

  return program;
}

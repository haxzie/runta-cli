import { logger } from '@runta/utils';
import type { Command } from 'commander';

export function registerHello(program: Command): void {
  program
    .command('hello')
    .description('Print a greeting (smoke test for the dev loop)')
    .argument('[name]', 'who to greet', 'world')
    .action((name: string) => {
      logger.debug('hello command invoked');
      process.stdout.write(`Hello, ${name}!\n`);
    });
}

import { getCurrentUser, RuntaApiError } from '@runta/api';
import { createContext } from '@runta/core';
import { fail, logger } from '@runta/utils';
import type { Command } from 'commander';

export function registerWhoami(program: Command): void {
  program
    .command('whoami')
    .description('Show the currently authenticated user')
    .option('--json', 'print the raw API response')
    .action(async (opts: { json?: boolean }) => {
      const { client, config } = await createContext();
      logger.debug(`calling ${config.apiUrl}/v1/me`);

      try {
        const { data } = await getCurrentUser({ client, throwOnError: true });

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
          return;
        }
        process.stdout.write(`${data.name ?? data.email} <${data.email}>\n`);
      } catch (error) {
        if (error instanceof RuntaApiError) {
          fail(error.message, {
            exitCode: error.status === 401 ? 2 : 1,
            hint: error.status === 401 ? 'Set RUNTA_TOKEN or run `runta auth login`.' : undefined,
            cause: error,
          });
        }
        throw error;
      }
    });
}

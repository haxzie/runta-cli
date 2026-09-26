import { getMe, RuntaApiError } from '@runta/api';
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
      logger.debug(`calling ${config.apiUrl}/v2/me`);

      try {
        const { data } = await getMe({ client, throwOnError: true });

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
          return;
        }
        // `GET /v2/me` wraps the profile in a `data` envelope, and `display_name` is
        // nullable — fall back to the email, which is always present.
        const { email, display_name } = data.data;
        process.stdout.write(`${display_name ?? email} <${email}>\n`);
      } catch (error) {
        if (error instanceof RuntaApiError) {
          fail(error.message, { exitCode: exitCodeFor(error), hint: hintFor(error), cause: error });
        }
        throw error;
      }
    });
}

const exitCodeFor = (error: RuntaApiError): number =>
  error.status === 401 || error.status === 403 ? 2 : 1;

/**
 * `/v2/me` is scoped to user credentials from the device flow. An organization API key
 * (`rt_…`) authenticates fine but gets 403 `permission_denied` here, which is a different
 * problem from "you aren't logged in" and needs a different instruction. Verified live —
 * see packages/api/NOTES.md.
 */
function hintFor(error: RuntaApiError): string | undefined {
  if (error.status === 403 && error.code === 'permission_denied') {
    return 'This looks like an organization API key. `whoami` needs a user credential — sign in with the device flow instead.';
  }
  if (error.status === 403) return 'No credential was sent. Set RUNTA_TOKEN.';
  if (error.status === 401) return 'The token was rejected. Set a valid RUNTA_TOKEN.';
  return undefined;
}

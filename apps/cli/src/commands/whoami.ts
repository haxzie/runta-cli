import { getMe, RuntaApiError } from '@runta/api';
import { createContext } from '@runta/core';
import { fail, logger } from '@runta/utils';
import type { Command } from 'commander';

export interface WhoamiDeps {
  write: (text: string) => void;
}

export const defaultWhoamiDeps: WhoamiDeps = {
  write: (text) => process.stdout.write(text),
};

export async function whoami(
  options: { json?: boolean } = {},
  deps: WhoamiDeps = defaultWhoamiDeps,
): Promise<void> {
  const { client, config } = await createContext();
  logger.debug(`calling ${config.apiUrl}/v2/me`);

  try {
    const { data } = await getMe({ client, throwOnError: true });

    if (options.json) {
      deps.write(`${JSON.stringify(data, null, 2)}\n`);
      return;
    }
    // `GET /v2/me` wraps the profile in a `data` envelope, and `display_name` is nullable —
    // fall back to the email, which is always present.
    const { email, display_name } = data.data;
    deps.write(`${display_name ?? email} <${email}>\n`);
  } catch (error) {
    if (error instanceof RuntaApiError) {
      fail(error.message, { exitCode: exitCodeFor(error), hint: hintFor(error), cause: error });
    }
    throw error;
  }
}

const exitCodeFor = (error: RuntaApiError): number =>
  error.status === 401 || error.status === 403 ? 2 : 1;

/**
 * `/v2/me` is scoped to user credentials from the device flow. An organization API key
 * (`rt_…`) authenticates fine but gets 403 `permission_denied` here, which is a different
 * problem from "you aren't logged in" and needs a different instruction. Verified live —
 * see packages/api/NOTES.md.
 */
export function hintFor(error: RuntaApiError): string | undefined {
  if (error.status === 403 && error.code === 'permission_denied') {
    return 'This looks like an organization API key. `whoami` needs a user credential — run `runta login`.';
  }
  if (error.status === 403) return 'No credential was sent. Run `runta login` or set RUNTA_TOKEN.';
  if (error.status === 401) return 'The token was rejected. Run `runta login` to get a new one.';
  return undefined;
}

export function registerWhoami(program: Command): void {
  program
    .command('whoami')
    .description('Show the currently authenticated user')
    .option('--json', 'print the raw API response')
    .action(async (opts: { json?: boolean }) => {
      await whoami(opts);
    });
}

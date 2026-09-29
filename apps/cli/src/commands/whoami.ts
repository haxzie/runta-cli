import { getMe, listManagedModelProviders, RuntaApiError, type RuntaClient } from '@runta/api';
import { createContext } from '@runta/core';
import { fail, logger } from '@runta/utils';
import type { Command } from 'commander';
import { outputOption, resolveOutput } from '../output.js';

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
    const organizationId = await resolveOrganizationId(client);

    if (options.json) {
      deps.write(`${JSON.stringify({ ...data.data, organization_id: organizationId }, null, 2)}\n`);
      return;
    }

    // `display_name` is nullable; the email is always present.
    const { email, display_name } = data.data;
    deps.write(`Logged in as ${display_name ?? email} <${email}>\n`);
    if (organizationId) deps.write(`Active team: ${organizationId}\n`);
  } catch (error) {
    if (error instanceof RuntaApiError) {
      fail(error.message, { exitCode: exitCodeFor(error), hint: hintFor(error), cause: error });
    }
    throw error;
  }
}

/**
 * The organization is not on `/v2/me` — it is not on any dedicated endpoint either. The only
 * place the API exposes the calling credential's organization is `organization_id` on
 * `GET /v2/model-providers`, so that is what this asks for. See packages/api/NOTES.md.
 *
 * Best-effort on purpose: identity is the point of `whoami`, and a second, semantically
 * unrelated call must not be able to fail it.
 */
async function resolveOrganizationId(client: RuntaClient): Promise<string | undefined> {
  try {
    const { data } = await listManagedModelProviders({ client, throwOnError: true });
    return data.organization_id;
  } catch (error) {
    logger.debug(
      `could not resolve the organization: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
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
    return 'This looks like an organization API key. `whoami` needs a user credential — run `runta-next login`.';
  }
  if (error.status === 403)
    return 'No credential was sent. Run `runta-next login` or set RUNTA_TOKEN.';
  if (error.status === 401)
    return 'The token was rejected. Run `runta-next login` to get a new one.';
  return undefined;
}

export function registerWhoami(program: Command): void {
  program
    .command('whoami')
    .description('Show the currently authenticated user')
    .option('--json', 'print the result as JSON')
    .addOption(outputOption())
    .action(async (opts: { json?: boolean; output?: string }) => {
      await whoami(resolveOutput(opts));
    });
}

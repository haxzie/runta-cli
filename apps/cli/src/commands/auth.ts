import {
  beginDeviceAuthorization,
  exchangeDeviceToken,
  RuntaApiError,
  revokeCurrentToken,
} from '@runta/api';
import {
  clearToken,
  createContext,
  DeviceAuthError,
  type DeviceAuthorization,
  type DeviceToken,
  runDeviceAuthorization,
  saveToken,
} from '@runta/core';
import { fail, logger } from '@runta/utils';
import type { Command } from 'commander';
import { canOpenBrowser, openUrl } from '../browser.js';
import { printNextSteps } from '../suggest.js';

export interface LoginOptions {
  json?: boolean;
  browser?: boolean;
}

export interface LoginDeps {
  /** Injected so tests don't spawn a browser or wait on real time. */
  openUrl: (url: string) => Promise<boolean>;
  canOpenBrowser: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  saveToken: (token: string) => Promise<string>;
  write: (text: string) => void;
}

export const defaultLoginDeps: LoginDeps = {
  openUrl,
  canOpenBrowser,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  saveToken,
  write: (text) => process.stdout.write(text),
};

export async function login(
  options: LoginOptions = {},
  deps: LoginDeps = defaultLoginDeps,
): Promise<void> {
  // The device flow is unauthenticated by definition — never send a stale token with it.
  const { client, config } = await createContext({ token: undefined });
  logger.debug(`starting device authorization against ${config.apiUrl}`);

  let token: DeviceToken;
  try {
    token = await runDeviceAuthorization({
      begin: async () => {
        const { data } = await beginDeviceAuthorization({
          client,
          body: { client_id: 'runta_cli' },
          throwOnError: true,
        });
        return data.data;
      },
      exchange: async (deviceCode) => {
        const { data } = await exchangeDeviceToken({
          client,
          body: { device_code: deviceCode },
          throwOnError: true,
        });
        return data;
      },
      onPrompt: (authorization) => prompt(authorization, options, deps),
      onTransient: (reason) => logger.debug(`still waiting (${reason})`),
      sleep: deps.sleep,
      now: deps.now,
    });
  } catch (error) {
    if (error instanceof DeviceAuthError) {
      fail(error.message, { exitCode: 2, hint: hintForDeviceAuth(error), cause: error });
    }
    if (error instanceof RuntaApiError) {
      fail(error.message, { exitCode: 1, cause: error });
    }
    throw error;
  }

  const path = await deps.saveToken(token.access_token);

  if (options.json) {
    deps.write(`${JSON.stringify({ status: 'authorized', config_path: path })}\n`);
    return;
  }
  logger.info(`Authorized. Token saved to ${path}`);
  printNextSteps([
    { command: 'runta whoami', why: 'confirm which account and team you are on' },
    { command: 'runta create --name demo', why: 'create your first runtime' },
  ]);
}

async function prompt(
  authorization: DeviceAuthorization,
  options: LoginOptions,
  deps: LoginDeps,
): Promise<void> {
  if (options.json) {
    // `login` is a progress stream, not a single response, so `--json` emits one compact
    // JSON object per line (NDJSON): a caller can react to the code as soon as it arrives
    // instead of waiting for the flow to finish. `jq` reads it as-is.
    deps.write(
      `${JSON.stringify({
        status: 'authorization_pending',
        user_code: authorization.user_code,
        verification_uri_complete: authorization.verification_uri_complete,
        expires_at: authorization.expires_at,
      })}\n`,
    );
    return;
  }

  logger.info(`Your code is ${authorization.user_code}`);

  const opened =
    options.browser !== false && deps.canOpenBrowser()
      ? await deps.openUrl(authorization.verification_uri_complete)
      : false;

  logger.info(
    opened
      ? 'Opened your browser to approve it.'
      : `Open ${authorization.verification_uri_complete} to approve it.`,
  );
  logger.info('Waiting for authorization…');
}

const hintForDeviceAuth = (error: DeviceAuthError): string | undefined => {
  if (error.reason === 'expired') return 'Run `runta login` again to get a fresh code.';
  if (error.reason === 'unreachable') return 'Check your connection, then try again.';
  return undefined;
};

export interface LogoutDeps {
  clearToken: () => Promise<boolean>;
  write: (text: string) => void;
}

export const defaultLogoutDeps: LogoutDeps = {
  clearToken,
  write: (text) => process.stdout.write(text),
};

export async function logout(
  options: { json?: boolean } = {},
  deps: LogoutDeps = defaultLogoutDeps,
): Promise<void> {
  const { client, config } = await createContext();

  let revoked = false;
  if (config.token) {
    try {
      await revokeCurrentToken({ client, throwOnError: true });
      revoked = true;
    } catch (error) {
      // A token the server has already forgotten is still a token we should forget
      // locally, so a failed revoke must not stop us clearing it.
      if (error instanceof RuntaApiError) {
        logger.debug(`revoke failed (${error.code}), clearing the local token anyway`);
      } else {
        throw error;
      }
    }
  }

  const cleared = await deps.clearToken();

  if (options.json) {
    deps.write(`${JSON.stringify({ status: 'logged_out', revoked, cleared })}\n`);
    return;
  }
  logger.info(cleared || revoked ? 'Logged out.' : 'Not logged in — nothing to do.');

  // The one thing logout cannot do is unset your shell. Revoking a token that came from the
  // environment leaves every future command sending a credential the server has forgotten, and
  // nothing else in the output would tell you.
  if (process.env.RUNTA_TOKEN) {
    logger.warn('RUNTA_TOKEN is still set in your environment and now refers to a revoked token.');
    printNextSteps([
      { command: 'unset RUNTA_TOKEN', why: 'stop sending the revoked credential' },
      { command: 'runta login', why: 'sign in again' },
    ]);
  }
}

/**
 * `login` and `logout` sit at the top level rather than under an `auth` group, matching
 * Runta's own CLI — `runta login` is what muscle memory reaches for, and two commands do not
 * earn a namespace.
 */
export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Sign in through a browser using a one-time device code')
    .option('--json', 'print machine-readable progress instead of prose')
    .option('--no-browser', 'print the URL instead of opening it')
    .action(async (opts: LoginOptions) => {
      await login(opts);
    });

  program
    .command('logout')
    .description('Revoke the stored credential and remove it from the local config')
    .option('--json', 'print the result as JSON')
    .action(async (opts: { json?: boolean }) => {
      await logout(opts);
    });
}

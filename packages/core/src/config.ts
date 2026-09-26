import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fail, logger } from '@runta/utils';

export interface RuntaConfig {
  /** Base URL of the Runta API. */
  apiUrl: string;
  /** Personal access token, if the user has authenticated. */
  token: string | undefined;
}

export const defaultConfig: RuntaConfig = {
  apiUrl: 'https://api.runta.com',
  token: undefined,
};

/** `$RUNTA_CONFIG_HOME/config.json`, defaulting to `~/.runta/config.json`. */
export function configPath(): string {
  const home = process.env.RUNTA_CONFIG_HOME ?? join(homedir(), '.runta');
  return join(home, 'config.json');
}

/**
 * Layers config: built-in defaults < `~/.runta/config.json` < environment.
 * A missing config file is normal (unauthenticated user); a malformed one is not.
 */
export async function loadConfig(): Promise<RuntaConfig> {
  const path = configPath();
  let fromFile: Partial<RuntaConfig> = {};

  try {
    fromFile = JSON.parse(await readFile(path, 'utf8')) as Partial<RuntaConfig>;
    logger.debug(`loaded config from ${path}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      fail(`Could not read config at ${path}`, {
        hint: 'Fix or delete the file, then try again.',
        cause: error,
      });
    }
    logger.debug(`no config file at ${path}, using defaults`);
  }

  return {
    apiUrl: process.env.RUNTA_API_URL ?? fromFile.apiUrl ?? defaultConfig.apiUrl,
    token: process.env.RUNTA_TOKEN ?? fromFile.token ?? defaultConfig.token,
  };
}

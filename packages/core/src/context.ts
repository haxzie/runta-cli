import { createRuntaClient, type RuntaClient } from '@runta/api';
import { loadConfig, type RuntaConfig } from './config.js';

/** Everything a command needs: resolved config plus a ready-to-use API client. */
export interface RuntaContext {
  config: RuntaConfig;
  client: RuntaClient;
}

export async function createContext(overrides: Partial<RuntaConfig> = {}): Promise<RuntaContext> {
  const config = { ...(await loadConfig()), ...overrides };
  return {
    config,
    client: createRuntaClient({ baseUrl: config.apiUrl, token: config.token }),
  };
}

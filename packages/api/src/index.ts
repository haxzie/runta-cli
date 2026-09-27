/**
 * `@runta/api` — the typed Runta API SDK.
 *
 * `src/generated/**` is produced by `@hey-api/openapi-ts` from `openapi.json` and must not
 * be edited by hand; run `pnpm api:generate` to refresh it. Everything else in `src/` is the
 * hand-written shell (auth, headers, error normalisation) that the rest of the monorepo
 * consumes. Nothing outside this package should import from `./generated` directly.
 */
export { createRuntaClient, type RuntaClient, type RuntaClientOptions } from './client.js';
export { errorFromResponse, isRuntaApiError, RuntaApiError } from './errors.js';
export {
  type ExecHandlers,
  type ExecOptions,
  type ExecRequest,
  type ExecSession,
  type ExecSignal,
  type ExecSocket,
  ExecUnknownError,
  execCollect,
  execUrl,
  startExec,
} from './exec.js';

// Generated operations and models.
export * from './generated/index.js';

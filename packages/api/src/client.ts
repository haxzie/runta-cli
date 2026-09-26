import { errorFromResponse, RuntaApiError } from './errors.js';
import { type Client, createClient, createConfig } from './generated/client';
import type { ClientOptions } from './generated/types.gen';

export type RuntaClient = Client;

export interface RuntaClientOptions {
  /** API base URL, e.g. `https://api.runta.com`. */
  baseUrl: string;
  /** Bearer token. Requests are sent unauthenticated when omitted. */
  token?: string | undefined;
  /** Appended to the User-Agent, so server logs can attribute traffic to a CLI version. */
  userAgent?: string;
  /** Overridable for tests. */
  fetch?: (request: Request) => Promise<Response>;
}

/**
 * Builds an isolated, configured API client.
 *
 * Deliberately not the generated module-level singleton: a per-invocation client keeps
 * config explicit and makes tests trivial to isolate.
 */
export function createRuntaClient(options: RuntaClientOptions): RuntaClient {
  const baseFetch: (request: Request) => Promise<Response> =
    options.fetch ?? ((request) => globalThis.fetch(request));

  const wrappedFetch = async (request: Request): Promise<Response> => {
    try {
      return await baseFetch(request);
    } catch (cause) {
      // DNS failures, refused connections and timeouts surface as opaque TypeErrors.
      // Normalising them here means callers only ever have to catch RuntaApiError.
      throw new RuntaApiError({
        status: 0,
        code: 'network_error',
        message: `Could not reach ${options.baseUrl}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        url: request.url,
        body: undefined,
      });
    }
  };

  const client = createClient(
    createConfig<ClientOptions>({
      baseUrl: options.baseUrl,
      // Without this the generated client swallows failures into `{ error }` and callers
      // silently read `undefined` data. Throwing keeps one error path: catch RuntaApiError.
      // Call sites still pass `throwOnError: true` explicitly, which is what narrows
      // `data` to non-optional at the type level.
      throwOnError: true,
      // Cast: the client's `fetch` slot is typed as the full `typeof fetch`, whose
      // `preconnect` property is irrelevant here and never called by the client.
      fetch: wrappedFetch as unknown as typeof globalThis.fetch,
      ...(options.token ? { auth: () => options.token } : {}),
    }),
  );

  client.interceptors.request.use((request) => {
    request.headers.set('user-agent', options.userAgent ?? 'runta-cli');
    request.headers.set('accept', 'application/json');
    return request;
  });

  // Turn every non-2xx into a RuntaApiError at the edge, so no command has to.
  client.interceptors.response.use(async (response) => {
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    return response;
  });

  return client;
}

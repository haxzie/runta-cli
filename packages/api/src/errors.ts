/**
 * A non-2xx API response, normalised into one error type.
 *
 * Every failure the CLI surfaces goes through here, so command code never has to
 * reason about raw `Response` objects or the shape of an error body.
 */
export class RuntaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly url: string;
  readonly body: unknown;

  constructor(init: {
    status: number;
    code?: string;
    message: string;
    requestId?: string;
    url: string;
    body?: unknown;
  }) {
    super(init.message);
    this.name = 'RuntaApiError';
    this.status = init.status;
    this.code = init.code ?? `http_${init.status}`;
    this.requestId = init.requestId;
    this.url = init.url;
    this.body = init.body;
  }
}

export const isRuntaApiError = (value: unknown): value is RuntaApiError =>
  value instanceof RuntaApiError;

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  error?: unknown;
  requestId?: unknown;
  request_id?: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Builds a RuntaApiError from a failed Response. The body is read from a clone so the
 * original response stays consumable, and a body that is not JSON (an HTML 502 page,
 * say) degrades to the status text rather than throwing a parse error of its own.
 */
export async function errorFromResponse(response: Response): Promise<RuntaApiError> {
  let body: unknown;
  try {
    const text = await response.clone().text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  const parsed: ErrorBody = typeof body === 'object' && body !== null ? (body as ErrorBody) : {};
  const message =
    asString(parsed.message) ??
    asString(parsed.error) ??
    `${response.status} ${response.statusText || 'request failed'}`;

  return new RuntaApiError({
    status: response.status,
    code: asString(parsed.code) ?? `http_${response.status}`,
    message,
    requestId:
      asString(parsed.requestId) ??
      asString(parsed.request_id) ??
      asString(response.headers.get('x-request-id') ?? undefined),
    url: response.url,
    body,
  });
}

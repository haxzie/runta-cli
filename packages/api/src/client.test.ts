import { describe, expect, it, vi } from 'vitest';
import { createRuntaClient } from './client.js';
import { RuntaApiError } from './errors.js';
import { getMe } from './generated/index.js';

const stubFetch = (handler: (request: Request) => Response | Promise<Response>) =>
  vi.fn(async (request: Request) => handler(request));

// `GET /v2/me` wraps the profile in a `data` envelope; see packages/api/NOTES.md.
const user = { user_id: 'u_1', email: 'ada@example.com', display_name: 'Ada' };

const ok = () =>
  new Response(JSON.stringify({ data: user }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('createRuntaClient', () => {
  it('returns typed data on success', async () => {
    const client = createRuntaClient({ baseUrl: 'https://api.test', fetch: stubFetch(ok) });
    const { data } = await getMe({ client, throwOnError: true });
    expect(data.data.email).toBe('ada@example.com');
    expect(data.data.display_name).toBe('Ada');
  });

  it('sends a bearer token when one is configured', async () => {
    const fetch = stubFetch(ok);
    const client = createRuntaClient({
      baseUrl: 'https://api.test',
      token: 'secret',
      fetch,
    });

    await getMe({ client, throwOnError: true });

    expect(fetch.mock.calls[0]?.[0].headers.get('authorization')).toBe('Bearer secret');
  });

  it('omits the authorization header when unauthenticated', async () => {
    const fetch = stubFetch(ok);
    const client = createRuntaClient({ baseUrl: 'https://api.test', fetch });

    await getMe({ client, throwOnError: true });

    expect(fetch.mock.calls[0]?.[0].headers.get('authorization')).toBeNull();
  });

  it('sets a user-agent so server logs can attribute CLI traffic', async () => {
    const fetch = stubFetch(ok);
    const client = createRuntaClient({
      baseUrl: 'https://api.test',
      userAgent: 'runta/1.2.3',
      fetch,
    });

    await getMe({ client, throwOnError: true });

    expect(fetch.mock.calls[0]?.[0].headers.get('user-agent')).toBe('runta/1.2.3');
  });

  it('throws RuntaApiError on a non-2xx response even without an explicit throwOnError', async () => {
    const client = createRuntaClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch(
        () =>
          new Response(JSON.stringify({ code: 'unauthorized', message: 'Token expired' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    });

    const error = await getMe({ client }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RuntaApiError);
    expect((error as RuntaApiError).status).toBe(401);
    expect((error as RuntaApiError).code).toBe('unauthorized');
  });

  it("reads the API's nested error envelope, with request_id as a sibling of error", async () => {
    const client = createRuntaClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch(
        () =>
          new Response(
            JSON.stringify({
              error: { code: 'permission_denied', message: "principal's role does not allow this" },
              request_id: '01a0dcb6-d3c3-7c10-acf9-961792e6c237',
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
      ),
    });

    const error = (await getMe({ client }).catch((e: unknown) => e)) as RuntaApiError;

    expect(error.status).toBe(403);
    expect(error.code).toBe('permission_denied');
    expect(error.message).toBe("principal's role does not allow this");
    expect(error.requestId).toBe('01a0dcb6-d3c3-7c10-acf9-961792e6c237');
  });

  it('falls back to the x-request-id header when the body carries no request_id', async () => {
    const client = createRuntaClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch(
        () =>
          new Response(JSON.stringify({ error: { code: 'not_found', message: 'gone' } }), {
            status: 404,
            headers: { 'content-type': 'application/json', 'x-request-id': 'req_from_header' },
          }),
      ),
    });

    const error = (await getMe({ client }).catch((e: unknown) => e)) as RuntaApiError;

    expect(error.requestId).toBe('req_from_header');
  });

  it('converts a network failure into a RuntaApiError instead of a raw TypeError', async () => {
    const client = createRuntaClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch(() => {
        throw new TypeError('fetch failed');
      }),
    });

    const error = (await getMe({ client }).catch((e: unknown) => e)) as RuntaApiError;

    expect(error).toBeInstanceOf(RuntaApiError);
    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
    expect(error.message).toContain('https://api.test');
  });

  it('keeps clients isolated from one another', async () => {
    const a = stubFetch(ok);
    const b = stubFetch(ok);
    const clientA = createRuntaClient({ baseUrl: 'https://a.test', token: 'ta', fetch: a });
    const clientB = createRuntaClient({ baseUrl: 'https://b.test', token: 'tb', fetch: b });

    await getMe({ client: clientA, throwOnError: true });
    await getMe({ client: clientB, throwOnError: true });

    expect(a.mock.calls[0]?.[0].url).toBe('https://a.test/v2/me');
    expect(b.mock.calls[0]?.[0].url).toBe('https://b.test/v2/me');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

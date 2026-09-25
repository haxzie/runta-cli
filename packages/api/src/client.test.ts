import { describe, expect, it, vi } from 'vitest';
import { createRuntaClient } from './client.js';
import { RuntaApiError } from './errors.js';
import { getCurrentUser } from './generated/index.js';

const stubFetch = (handler: (request: Request) => Response | Promise<Response>) =>
  vi.fn(async (request: Request) => handler(request));

const user = { id: 'u_1', email: 'ada@example.com', name: 'Ada' };

const ok = () =>
  new Response(JSON.stringify(user), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('createRuntaClient', () => {
  it('returns typed data on success', async () => {
    const client = createRuntaClient({ baseUrl: 'https://api.test', fetch: stubFetch(ok) });
    const { data } = await getCurrentUser({ client, throwOnError: true });
    expect(data.email).toBe('ada@example.com');
  });

  it('sends a bearer token when one is configured', async () => {
    const fetch = stubFetch(ok);
    const client = createRuntaClient({
      baseUrl: 'https://api.test',
      token: 'secret',
      fetch,
    });

    await getCurrentUser({ client, throwOnError: true });

    expect(fetch.mock.calls[0]?.[0].headers.get('authorization')).toBe('Bearer secret');
  });

  it('omits the authorization header when unauthenticated', async () => {
    const fetch = stubFetch(ok);
    const client = createRuntaClient({ baseUrl: 'https://api.test', fetch });

    await getCurrentUser({ client, throwOnError: true });

    expect(fetch.mock.calls[0]?.[0].headers.get('authorization')).toBeNull();
  });

  it('sets a user-agent so server logs can attribute CLI traffic', async () => {
    const fetch = stubFetch(ok);
    const client = createRuntaClient({
      baseUrl: 'https://api.test',
      userAgent: 'runta/1.2.3',
      fetch,
    });

    await getCurrentUser({ client, throwOnError: true });

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

    const error = await getCurrentUser({ client }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RuntaApiError);
    expect((error as RuntaApiError).status).toBe(401);
    expect((error as RuntaApiError).code).toBe('unauthorized');
  });

  it('converts a network failure into a RuntaApiError instead of a raw TypeError', async () => {
    const client = createRuntaClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch(() => {
        throw new TypeError('fetch failed');
      }),
    });

    const error = (await getCurrentUser({ client }).catch((e: unknown) => e)) as RuntaApiError;

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

    await getCurrentUser({ client: clientA, throwOnError: true });
    await getCurrentUser({ client: clientB, throwOnError: true });

    expect(a.mock.calls[0]?.[0].url).toBe('https://a.test/v1/me');
    expect(b.mock.calls[0]?.[0].url).toBe('https://b.test/v1/me');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

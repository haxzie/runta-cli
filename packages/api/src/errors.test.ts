import { describe, expect, it } from 'vitest';
import { errorFromResponse, isRuntaApiError, RuntaApiError } from './errors.js';

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('errorFromResponse', () => {
  it('lifts code, message and requestId out of the body', async () => {
    const error = await errorFromResponse(
      jsonResponse(403, { code: 'forbidden', message: 'Nope', requestId: 'req_1' }),
    );

    expect(error.status).toBe(403);
    expect(error.code).toBe('forbidden');
    expect(error.message).toBe('Nope');
    expect(error.requestId).toBe('req_1');
  });

  it('accepts snake_case request_id and the x-request-id header', async () => {
    expect((await errorFromResponse(jsonResponse(500, { request_id: 'a' }))).requestId).toBe('a');
    expect(
      (await errorFromResponse(jsonResponse(500, {}, { 'x-request-id': 'b' }))).requestId,
    ).toBe('b');
  });

  it('falls back to the status line when the body is not JSON', async () => {
    const error = await errorFromResponse(
      new Response('<html>502 Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );

    expect(error.status).toBe(502);
    expect(error.code).toBe('http_502');
    expect(error.message).toBe('502 Bad Gateway');
  });

  it('handles an empty body without throwing', async () => {
    const error = await errorFromResponse(new Response(null, { status: 204 }));
    expect(error.status).toBe(204);
  });

  it('leaves the original response body readable', async () => {
    const response = jsonResponse(400, { message: 'bad' });
    await errorFromResponse(response);
    await expect(response.json()).resolves.toEqual({ message: 'bad' });
  });
});

describe('isRuntaApiError', () => {
  it('distinguishes RuntaApiError from a plain Error', () => {
    expect(isRuntaApiError(new RuntaApiError({ status: 1, message: 'm', url: 'u' }))).toBe(true);
    expect(isRuntaApiError(new Error('m'))).toBe(false);
  });
});

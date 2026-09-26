import { isCliError } from '@runta/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, captureStdout, isolateEnv, stubFetch } from '../test/harness.js';
import { whoami } from './whoami.js';

let env: Awaited<ReturnType<typeof isolateEnv>>;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  env = await isolateEnv({ RUNTA_TOKEN: 'rt_user' });
});

afterEach(() => {
  env.restore();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const profile = {
  data: { user_id: 'u_1', email: 'ada@example.com', display_name: 'Ada Lovelace' },
};

const meRoute = (status: number, body?: unknown, text?: string) => [
  { method: 'GET', path: '/v2/me', status, ...(text === undefined ? { body } : { text }) },
];

describe('whoami', () => {
  it('prints the display name and email', async () => {
    const { fetch } = stubFetch(meRoute(200, profile));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const out = captureStdout();

    await whoami({}, out);

    expect(out.text).toBe('Ada Lovelace <ada@example.com>\n');
  });

  it('sends the configured token as a bearer credential', async () => {
    const stub = stubFetch(meRoute(200, profile));
    globalThis.fetch = stub.fetch as unknown as typeof globalThis.fetch;

    await whoami({}, captureStdout());

    expect(stub.calls[0]?.url).toBe(`${API}/v2/me`);
    expect(stub.calls[0]?.headers.get('authorization')).toBe('Bearer rt_user');
  });

  it('falls back to the email when display_name is null', async () => {
    const { fetch } = stubFetch(
      meRoute(200, { data: { user_id: 'u_1', email: 'ada@example.com', display_name: null } }),
    );
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const out = captureStdout();

    await whoami({}, out);

    expect(out.text).toBe('ada@example.com <ada@example.com>\n');
  });

  it('prints the raw envelope with --json', async () => {
    const { fetch } = stubFetch(meRoute(200, profile));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const out = captureStdout();

    await whoami({ json: true }, out);

    expect(JSON.parse(out.text)).toEqual(profile);
  });

  it("explains that an organization API key can't be used here", async () => {
    // Verified live: an rt_ key authenticates but 403s on /v2/me. See packages/api/NOTES.md.
    const { fetch } = stubFetch(
      meRoute(403, {
        error: { code: 'permission_denied', message: "principal's role does not allow this" },
        request_id: 'req_1',
      }),
    );
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const error = await whoami({}, captureStdout()).catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as Error).message).toBe("principal's role does not allow this");
    expect((error as { hint?: string }).hint).toContain('organization API key');
    expect((error as { exitCode: number }).exitCode).toBe(2);
  });

  it('distinguishes a rejected token from a missing one', async () => {
    const { fetch } = stubFetch(
      meRoute(401, {
        error: { code: 'unauthenticated', message: 'invalid bearer credential' },
        request_id: 'req_2',
      }),
    );
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const error = await whoami({}, captureStdout()).catch((e: unknown) => e);

    expect((error as Error).message).toBe('invalid bearer credential');
    expect((error as { hint?: string }).hint).toContain('rejected');
    expect((error as { exitCode: number }).exitCode).toBe(2);
  });

  it('degrades gracefully on the plain-text 403 the API returns with no credential', async () => {
    // The no-credential 403 is the bare string `Unauthenticated`, not JSON.
    const { fetch } = stubFetch(meRoute(403, undefined, 'Unauthenticated'));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const error = await whoami({}, captureStdout()).catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as Error).message).toContain('403');
    expect((error as { hint?: string }).hint).toContain('No credential was sent');
  });

  it('turns an unreachable API into a CliError, not a raw TypeError', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;

    const error = await whoami({}, captureStdout()).catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as Error).message).toContain(API);
    expect((error as { exitCode: number }).exitCode).toBe(1);
  });
});

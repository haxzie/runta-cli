import { readFile } from 'node:fs/promises';
import { configPath } from '@runta/core';
import { isCliError } from '@runta/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, captureStdout, isolateEnv, type Route, stubFetch } from '../test/harness.js';
import { type LoginDeps, login, logout } from './auth.js';

let env: Awaited<ReturnType<typeof isolateEnv>>;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  env = await isolateEnv();
});

afterEach(() => {
  env.restore();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const use = (routes: Route[]) => {
  const stub = stubFetch(routes);
  globalThis.fetch = stub.fetch as unknown as typeof globalThis.fetch;
  return stub;
};

const AUTHZ = '/v2/auth/device/authorization';
const TOKEN = '/v2/auth/device/token';
const REVOKE = '/v2/auth/token';

const authorization = {
  data: {
    device_code: 'dc_1',
    user_code: 'ABCD-1234',
    verification_uri: 'https://dashboard.runta.com/device',
    verification_uri_complete: 'https://dashboard.runta.com/device?code=ABCD-1234',
    // Far enough out that the deadline never fires during a test.
    expires_at: '2099-01-01T00:00:00Z',
    interval: 5,
  },
};

const issued = { access_token: 'rt_fresh', token_type: 'Bearer', expires_in: 2592000 };

function loginDeps(overrides: Partial<LoginDeps> = {}) {
  const out = captureStdout();
  const opened: string[] = [];
  const deps: LoginDeps = {
    openUrl: vi.fn(async (url: string) => {
      opened.push(url);
      return true;
    }),
    canOpenBrowser: () => true,
    sleep: vi.fn(async () => undefined),
    now: () => Date.parse('2026-01-01T00:00:00Z'),
    saveToken: vi.fn(async () => '/tmp/stub/config.json'),
    write: out.write,
    ...overrides,
  };
  return { deps, out, opened };
}

const readStoredToken = async (): Promise<unknown> => {
  const parsed = JSON.parse(await readFile(configPath(), 'utf8')) as { token?: unknown };
  return parsed.token;
};

describe('auth login', () => {
  it('runs the device flow against the configured API and stores the issued token', async () => {
    const stub = use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 200, body: issued },
    ]);
    const { deps } = loginDeps();

    await login({}, deps);

    expect(stub.calls.map((call) => call.url)).toEqual([`${API}${AUTHZ}`, `${API}${TOKEN}`]);
    expect(deps.saveToken).toHaveBeenCalledWith('rt_fresh');
  });

  it('really writes the token to the config file', async () => {
    // saveToken not stubbed here, so this covers the CLI -> core -> disk path end to end.
    use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 200, body: issued },
    ]);
    const { deps } = loginDeps();
    const { saveToken: _stub, ...rest } = deps;
    const { saveToken } = await import('@runta/core');

    await login({}, { ...rest, saveToken });

    expect(await readStoredToken()).toBe('rt_fresh');
  });

  it('starts the flow unauthenticated even when a stale token is configured', async () => {
    process.env.RUNTA_TOKEN = 'rt_stale';
    const stub = use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 200, body: issued },
    ]);
    const { deps } = loginDeps();

    await login({}, deps);

    for (const call of stub.calls) {
      expect(call.headers.get('authorization')).toBeNull();
    }
  });

  it('opens the browser at the pre-filled verification URL', async () => {
    use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 200, body: issued },
    ]);
    const { deps, opened } = loginDeps();

    await login({}, deps);

    expect(opened).toEqual(['https://dashboard.runta.com/device?code=ABCD-1234']);
  });

  it('does not open a browser with --no-browser', async () => {
    use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 200, body: issued },
    ]);
    const { deps, opened } = loginDeps();

    await login({ browser: false }, deps);

    expect(opened).toEqual([]);
  });

  it('does not open a browser when there is no interactive terminal', async () => {
    use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 200, body: issued },
    ]);
    const { deps, opened } = loginDeps({ canOpenBrowser: () => false });

    await login({}, deps);

    expect(opened).toEqual([]);
  });

  it('streams NDJSON progress with --json, emitting the code before it polls', async () => {
    use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 200, body: issued },
    ]);
    const { deps, out } = loginDeps();

    await login({ json: true }, deps);

    const lines = out.text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    const [pending, done] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(pending).toEqual({
      status: 'authorization_pending',
      user_code: 'ABCD-1234',
      verification_uri_complete: 'https://dashboard.runta.com/device?code=ABCD-1234',
      expires_at: '2099-01-01T00:00:00Z',
    });
    expect(done).toMatchObject({ status: 'authorized' });
  });

  it('keeps polling while the user has not approved yet', async () => {
    const stub = use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      {
        method: 'POST',
        path: TOKEN,
        status: 400,
        body: { error: 'authorization_pending', interval: 5 },
      },
      {
        method: 'POST',
        path: TOKEN,
        status: 400,
        body: { error: 'authorization_pending', interval: 5 },
      },
      { method: 'POST', path: TOKEN, status: 200, body: issued },
    ]);
    const { deps } = loginDeps();

    await login({}, deps);

    expect(stub.calls.filter((c) => new URL(c.url).pathname === TOKEN)).toHaveLength(3);
    expect(deps.saveToken).toHaveBeenCalledWith('rt_fresh');
  });

  it('survives the 520 the device endpoints intermittently return', async () => {
    // CLI_ISSUES.md C-03: the production CLI abandons the login here.
    const stub = use([
      { method: 'POST', path: AUTHZ, status: 520, text: 'error code: 520' },
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 520, text: 'error code: 520' },
      { method: 'POST', path: TOKEN, status: 200, body: issued },
    ]);
    const { deps } = loginDeps();

    await login({}, deps);

    expect(stub.unmatched).toHaveLength(0);
    expect(deps.saveToken).toHaveBeenCalledWith('rt_fresh');
  });

  it('stops and explains when the user denies the request', async () => {
    use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 400, body: { error: 'access_denied' } },
    ]);
    const { deps } = loginDeps();

    const error = await login({}, deps).catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as Error).message).toBe('Authorization was denied.');
    expect(deps.saveToken).not.toHaveBeenCalled();
  });

  it('tells the user to get a fresh code when the old one expired', async () => {
    use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 400, body: { error: 'expired_token' } },
    ]);
    const { deps } = loginDeps();

    const error = await login({}, deps).catch((e: unknown) => e);

    expect((error as Error).message).toContain('ABCD-1234');
    expect((error as { hint?: string }).hint).toContain('again');
  });

  it('never stores a token when the flow fails', async () => {
    use([
      { method: 'POST', path: AUTHZ, status: 200, body: authorization },
      { method: 'POST', path: TOKEN, status: 400, body: { error: 'access_denied' } },
    ]);
    const { deps } = loginDeps();
    const { saveToken } = await import('@runta/core');
    const { saveToken: _stub, ...rest } = deps;

    await login({}, { ...rest, saveToken }).catch(() => undefined);

    await expect(readFile(configPath(), 'utf8')).rejects.toThrow();
  });
});

describe('auth logout', () => {
  it('revokes the credential and clears it locally', async () => {
    process.env.RUNTA_TOKEN = 'rt_user';
    const stub = use([{ method: 'DELETE', path: REVOKE, status: 204 }]);
    const out = captureStdout();
    const clearToken = vi.fn(async () => true);

    await logout({ json: true }, { clearToken, write: out.write });

    expect(stub.calls[0]?.headers.get('authorization')).toBe('Bearer rt_user');
    expect(clearToken).toHaveBeenCalled();
    expect(JSON.parse(out.text)).toEqual({ status: 'logged_out', revoked: true, cleared: true });
  });

  it('still clears the local token when the server rejects the revoke', async () => {
    // A token the server has already forgotten is one we should forget too.
    process.env.RUNTA_TOKEN = 'rt_stale';
    use([
      {
        method: 'DELETE',
        path: REVOKE,
        status: 401,
        body: { error: { code: 'unauthenticated', message: 'invalid bearer credential' } },
      },
    ]);
    const out = captureStdout();
    const clearToken = vi.fn(async () => true);

    await logout({ json: true }, { clearToken, write: out.write });

    expect(clearToken).toHaveBeenCalled();
    expect(JSON.parse(out.text)).toEqual({ status: 'logged_out', revoked: false, cleared: true });
  });

  it('makes no network call when there is nothing stored', async () => {
    const stub = use([]);
    const out = captureStdout();

    await logout({ json: true }, { clearToken: async () => false, write: out.write });

    expect(stub.calls).toHaveLength(0);
    expect(JSON.parse(out.text)).toEqual({ status: 'logged_out', revoked: false, cleared: false });
  });

  it('removes the token from the real config file', async () => {
    const { clearToken, saveToken } = await import('@runta/core');
    await saveToken('rt_user');
    process.env.RUNTA_TOKEN = undefined;
    delete process.env.RUNTA_TOKEN;
    use([{ method: 'DELETE', path: REVOKE, status: 204 }]);

    await logout({}, { clearToken, write: captureStdout().write });

    expect(await readStoredToken()).toBeUndefined();
  });
});

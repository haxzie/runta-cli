import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Env, handle } from './worker.js';

const env: Env = {
  GITHUB_REPO: 'haxzie/runta-cli',
  DEFAULT_REF: 'main',
  SCRIPT_PATH: 'scripts/install.sh',
};

const SCRIPT = '#!/bin/sh\nset -eu\necho installing\n';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Stubs the upstream fetch and records the URLs requested. */
function upstream(responder: () => Response | Promise<Response>) {
  const urls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return await responder();
  }) as unknown as typeof globalThis.fetch;
  return urls;
}

const get = (path = '/install.sh', method = 'GET') =>
  handle(new Request(`https://runta.haxzie.com${path}`, { method }), env);

describe('serving the script', () => {
  it('returns it with a shell content type', async () => {
    upstream(() => new Response(SCRIPT, { status: 200 }));

    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/x-shellscript; charset=utf-8');
    expect(await response.text()).toBe(SCRIPT);
  });

  it('fetches the default ref from the configured repo and path', async () => {
    const urls = upstream(() => new Response(SCRIPT, { status: 200 }));

    await get();

    expect(urls).toEqual([
      'https://raw.githubusercontent.com/haxzie/runta-cli/main/scripts/install.sh',
    ]);
  });

  it('sets a short cache lifetime so a push to main lands quickly', async () => {
    upstream(() => new Response(SCRIPT, { status: 200 }));

    expect((await get()).headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('answers HEAD with the headers and no body', async () => {
    upstream(() => new Response(SCRIPT, { status: 200 }));

    const response = await get('/install.sh', 'HEAD');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-length')).toBe(String(SCRIPT.length));
  });

  it('accepts a script with an env shebang', async () => {
    upstream(() => new Response('#!/usr/bin/env sh\necho hi\n', { status: 200 }));

    expect((await get()).status).toBe(200);
  });
});

describe('never returning 200 for a failure', () => {
  /**
   * This is the whole point of the Worker's error handling. `curl -fsSL … | sh` aborts on a
   * non-2xx, so a failure served as 5xx is an install that refuses to start — while the same
   * content served as a 200 would be executed.
   */
  it('turns an upstream 500 into a 502', async () => {
    upstream(() => new Response('upstream exploded', { status: 500 }));

    const response = await get();

    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('propagates an upstream 404 as a 404', async () => {
    upstream(() => new Response('Not Found', { status: 404 }));

    expect((await get()).status).toBe(404);
  });

  it('refuses a body that is not a shell script', async () => {
    // A GitHub error page, a captive portal, a truncated proxy response — all would otherwise be
    // handed to `sh`.
    upstream(() => new Response('<!DOCTYPE html><title>Oops</title>', { status: 200 }));

    const response = await get();

    expect(response.status).toBe(502);
    expect(await response.text()).toContain('did not return a shell script');
  });

  it('turns a network failure into a 502 rather than throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof globalThis.fetch;

    expect((await get()).status).toBe(502);
  });

  it('404s an unknown path, and says how to install', async () => {
    const urls = upstream(() => new Response(SCRIPT, { status: 200 }));

    const response = await get('/');

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('curl -fsSL https://runta.haxzie.com/install.sh | sh');
    // Nothing fetched: an unknown path must not cost an upstream request.
    expect(urls).toHaveLength(0);
  });

  it('rejects a write method', async () => {
    const response = await get('/install.sh', 'POST');

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('reading from a private repo', () => {
  /**
   * The repo is private today, and `raw.githubusercontent.com` answers 404 for a private repo with
   * no credential — so without a token the Worker has nothing to serve. The API's contents
   * endpoint can authenticate; the raw host cannot.
   */
  it('uses the contents API and sends the token when one is configured', async () => {
    const urls = upstream(() => new Response(SCRIPT, { status: 200 }));
    const headers: Headers[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      headers.push(new Headers(init?.headers));
      return new Response(SCRIPT, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await handle(new Request('https://runta.haxzie.com/install.sh'), {
      ...env,
      GITHUB_TOKEN: 'ghp_stub',
    });

    expect(urls[0]).toBe(
      'https://api.github.com/repos/haxzie/runta-cli/contents/scripts/install.sh?ref=main',
    );
    expect(headers[0]?.get('authorization')).toBe('Bearer ghp_stub');
    expect(headers[0]?.get('accept')).toBe('application/vnd.github.raw');
  });

  it('uses the unauthenticated raw host when no token is set', async () => {
    const seen: Headers[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response(SCRIPT, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await get();

    // No credential to leak, and the raw host caches better.
    expect(seen[0]?.has('authorization')).toBe(false);
  });
});

describe('pinning a ref', () => {
  it('fetches the requested ref', async () => {
    const urls = upstream(() => new Response(SCRIPT, { status: 200 }));

    const response = await handle(
      new Request('https://runta.haxzie.com/install.sh?ref=v0.1.0'),
      env,
    );

    expect(urls[0]).toContain('/haxzie/runta-cli/v0.1.0/scripts/install.sh');
    expect(response.headers.get('x-runta-next-ref')).toBe('v0.1.0');
  });

  it('allows a slash, so release branches work', async () => {
    const urls = upstream(() => new Response(SCRIPT, { status: 200 }));

    await handle(new Request('https://runta.haxzie.com/install.sh?ref=release/1.x'), env);

    expect(urls[0]).toContain('/release/1.x/scripts/install.sh');
  });

  it.each(['../../etc/passwd', 'main;rm -rf /', 'main?x=1', '-main', '', 'a'.repeat(200)])(
    'rejects %j without fetching anything',
    async (ref) => {
      const urls = upstream(() => new Response(SCRIPT, { status: 200 }));

      const response = await handle(
        new Request(`https://runta.haxzie.com/install.sh?ref=${encodeURIComponent(ref)}`),
        env,
      );

      expect(response.status).toBe(400);
      expect(urls).toHaveLength(0);
    },
  );
});

describe('docs', () => {
  /** A stand-in for the bound docs Worker, recording what it was asked for. */
  const docsBinding = (body = '<!doctype html><title>Docs</title>') => {
    const seen: string[] = [];
    const DOCS = {
      fetch: async (request: Request) => {
        seen.push(new URL(request.url).pathname);
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
    } as unknown as Fetcher;
    return { DOCS, seen };
  };

  const docsGet = (path: string, extra: Partial<Env> = {}) =>
    handle(new Request(`https://runta.haxzie.com${path}`), { ...env, ...extra });

  it('forwards a docs path to the bound Worker', async () => {
    const { DOCS, seen } = docsBinding();

    const response = await docsGet('/docs/commands/list', { DOCS });

    expect(response.status).toBe(200);
    expect(seen).toEqual(['/docs/commands/list']);
    expect(await response.text()).toContain('Docs');
  });

  it('redirects /docs to /docs/, which is what the asset tree is built for', async () => {
    const { DOCS, seen } = docsBinding();

    const response = await docsGet('/docs', { DOCS });

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://runta.haxzie.com/docs/');
    expect(seen).toEqual([]);
  });

  it('does not reach for the installer source when serving docs', async () => {
    const { DOCS } = docsBinding();
    const urls = upstream(() => new Response(SCRIPT));

    await docsGet('/docs/', { DOCS });

    expect(urls).toEqual([]);
  });

  it('404s a docs request when the binding is absent, rather than erroring', async () => {
    const response = await docsGet('/docs/');

    expect(response.status).toBe(404);
  });

  /**
   * The property the whole Worker is built around. `/` must never be a 2xx: someone who types the
   * install command wrong should get an abort from `curl -fsSL`, not a rendered page piped into a
   * shell. Adding the docs to this hostname is exactly the change that could break it.
   */
  it('keeps every non-docs, non-installer path a 404 even with docs bound', async () => {
    const { DOCS, seen } = docsBinding();

    for (const path of ['/', '/index.html', '/doc', '/docsy', '/install']) {
      const response = await docsGet(path, { DOCS });
      expect(response.status, `${path} should not be served`).toBe(404);
    }
    expect(seen).toEqual([]);
  });

  /**
   * Path traversal is handled by `new URL()` before the prefix check runs, so `..` can only ever
   * resolve to a real path that is then matched exactly — it cannot smuggle one prefix into the
   * other. Worth pinning, because the prefix check reads like something traversal could fool.
   */
  it('normalises traversal before matching, so it cannot cross between the two prefixes', async () => {
    const { DOCS, seen } = docsBinding();
    upstream(() => new Response(SCRIPT));

    // Resolves to /docs/ — genuinely a docs request, and served as one.
    expect((await docsGet('/../docs/', { DOCS })).status).toBe(200);
    // Resolves to /install.sh — genuinely the installer, and served as one.
    expect((await docsGet('/docs/../install.sh', { DOCS })).status).toBe(200);
    // Encoded dots are not decoded into traversal; this resolves to `/`, which is a 404.
    expect((await docsGet('/docs/%2e%2e/', { DOCS })).status).toBe(404);

    expect(seen).toEqual(['/docs/']);
  });

  it('still serves the installer with docs bound', async () => {
    const { DOCS } = docsBinding();
    upstream(() => new Response(SCRIPT));

    const response = await handle(new Request('https://runta.haxzie.com/install.sh'), {
      ...env,
      DOCS,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SCRIPT);
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '@runta/utils';
import { vi } from 'vitest';

export const API = 'https://api.test';

export interface Route {
  method: string;
  path: string;
  status: number;
  body?: unknown;
  /** Plain-text body, for the one endpoint that answers 403 with `Unauthenticated`. */
  text?: string;
}

/**
 * Replaces global fetch with a route table.
 *
 * Commands are exercised through the real generated SDK, the real client shell and the real
 * config loader — only the network is stubbed. That way these tests cover the wiring
 * (auth header, envelope shape, error normalisation) rather than a pile of module mocks.
 */
export function stubFetch(routes: Route[]) {
  const calls: Request[] = [];
  const remaining = [...routes];

  const fetch = vi.fn(async (input: Request | string): Promise<Response> => {
    const request = typeof input === 'string' ? new Request(input) : input;
    calls.push(request);

    const url = new URL(request.url);
    const index = remaining.findIndex(
      (route) => route.method === request.method && route.path === url.pathname,
    );
    if (index === -1) {
      throw new Error(`unexpected ${request.method} ${url.pathname}`);
    }
    // Shift matched routes off, so a sequence of differing responses for the same endpoint
    // can be scripted in order (the device-token poll needs exactly that).
    const [route] = remaining.splice(index, 1);
    if (!route) throw new Error('unreachable');

    if (route.text !== undefined) {
      return new Response(route.text, { status: route.status });
    }
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: { 'content-type': 'application/json' },
    });
  });

  return {
    fetch,
    calls,
    get unmatched() {
      return remaining;
    },
  };
}

/** Points config at a throwaway dir and sets the API URL, restoring env afterwards. */
export async function isolateEnv(overrides: Record<string, string | undefined> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'runta-cli-'));
  const keys = ['RUNTA_CONFIG_HOME', 'RUNTA_API_URL', 'RUNTA_TOKEN', ...Object.keys(overrides)];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));

  process.env.RUNTA_CONFIG_HOME = join(home, 'runta-next');
  process.env.RUNTA_API_URL = API;
  delete process.env.RUNTA_TOKEN;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  // Commands log progress to stderr; silence it so test output stays readable.
  setLogLevel('silent');

  return {
    home,
    restore() {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      setLogLevel('info');
    },
  };
}

/**
 * Collects everything a command writes to stdout.
 *
 * Accepts bytes as well as strings, because `process.stdout.write` does and `exec` streams raw
 * output through as `Uint8Array` — stringifying those would give you "111,117,116" instead of "out".
 */
export function captureStdout() {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  return {
    write: (data: string | Uint8Array) => {
      chunks.push(typeof data === 'string' ? data : decoder.decode(data));
    },
    get text() {
      return chunks.join('');
    },
  };
}

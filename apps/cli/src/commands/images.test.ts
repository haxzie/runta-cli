import { isCliError } from '@runta/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureStdout, isolateEnv, type Route, stubFetch } from '../test/harness.js';
import { deleteImage, images } from './images.js';

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

const image = (over: Record<string, unknown> = {}) => ({
  id: 'clean',
  name: 'Clean runtime',
  architectures: ['x86_64'],
  disk: { minimum_gib: 16, maximum_gib: 256, default_gib: 32, step_gib: 1 },
  recommended_resources: { vcpus: 1, memory_mib: 1024 },
  is_default: true,
  is_custom: false,
  exposed_ports: [],
  ...over,
});

const claude = image({
  id: 'claude',
  name: 'Claude Code',
  is_default: false,
  recommended_resources: { vcpus: 2, memory_mib: 2048 },
  model_provider: {
    protocol_bindings: [
      { protocol: 'anthropic_messages', environment_variable: 'ANTHROPIC_API_KEY' },
    ],
  },
});

const opencode = image({
  id: 'opencode',
  name: 'OpenCode',
  is_default: false,
  recommended_resources: { vcpus: 2, memory_mib: 2048 },
  model_provider: {
    protocol_bindings: [
      { protocol: 'anthropic_messages' },
      { protocol: 'openai_chat' },
      { protocol: 'openai_responses' },
    ],
  },
});

const route = (body: unknown, status = 200): Route[] => [
  { method: 'GET', path: '/v2/images', status, body },
];

const custom = image({ id: 'mine', name: 'My Image', is_default: false, is_custom: true });

/** stdout plus the two things only `delete` can do. */
const deleteDeps = (
  over: Partial<{ confirm: () => Promise<boolean>; isInteractive: () => boolean }> = {},
) => {
  const out = captureStdout();
  return {
    write: out.write,
    get text() {
      return out.text;
    },
    confirm: over.confirm ?? (async () => true),
    isInteractive: over.isInteractive ?? (() => false),
  };
};

const serve = (body: unknown, status = 200) => {
  const { fetch } = stubFetch(route(body, status));
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
};

describe('images', () => {
  it('lists the catalog as a table', async () => {
    serve({ data: [image(), claude] });
    const out = captureStdout();

    await images({}, out);

    expect(out.text).toMatch(/^ID\s+NAME\s+VCPUS\s+MEMORY\s+MODEL PROVIDER\s+KIND/);
    expect(out.text).toMatch(/clean/);
    expect(out.text).toMatch(/claude/);
  });

  // The id is the one cell a reader has to retype into `create --image`, so it must never be
  // abbreviated away by a column that could have been dropped instead.
  it('never truncates the id', async () => {
    serve({ data: [image({ id: 'deepseek_harness', name: 'DeepSeek Harness' })] });
    const out = captureStdout();

    await images({}, out);

    expect(out.text).toContain('deepseek_harness');
    expect(out.text).not.toContain('…');
  });

  it('marks the image create uses when --image is omitted', async () => {
    serve({ data: [image()] });
    const out = captureStdout();

    await images({}, out);

    expect(out.text).toMatch(/default/);
  });

  describe('the model provider column', () => {
    it('names the protocol when only one is bound, because create infers it', async () => {
      serve({ data: [claude] });
      const out = captureStdout();

      await images({}, out);

      expect(out.text).toContain('anthropic_messages');
    });

    // Three protocol names would push the id column into an ellipsis, and the count is the part
    // that actually decides anything: more than one means --model-provider-protocol is required.
    it('counts them when several are bound', async () => {
      serve({ data: [opencode] });
      const out = captureStdout();

      await images({}, out);

      expect(out.text).toContain('3 protocols');
      expect(out.text).not.toContain('openai_chat');
    });

    it('leaves it empty for an image that needs no credential', async () => {
      serve({ data: [image()] });
      const out = captureStdout();

      await images({}, out);

      expect(out.text).toMatch(/—/);
    });
  });

  describe('--json', () => {
    it('returns the API objects unprojected, so nothing the table compressed is lost', async () => {
      serve({ data: [claude, opencode] });
      const out = captureStdout();

      await images({ json: true }, out);

      const payload = JSON.parse(out.text) as Array<Record<string, unknown>>;
      expect(payload).toHaveLength(2);
      expect(payload[0]?.id).toBe('claude');
      const provider = payload[1]?.model_provider as { protocol_bindings: unknown[] };
      expect(provider.protocol_bindings).toHaveLength(3);
    });

    it('is an array, so `.[] | .id` works without a per-command key', async () => {
      serve({ data: [image()] });
      const out = captureStdout();

      await images({ json: true }, out);

      expect(Array.isArray(JSON.parse(out.text))).toBe(true);
    });
  });

  describe('--custom', () => {
    it('keeps only images the organization built', async () => {
      serve({
        data: [
          image(),
          image({ id: 'mine', name: 'My Image', is_default: false, is_custom: true }),
        ],
      });
      const out = captureStdout();

      await images({ custom: true }, out);

      expect(out.text).toContain('mine');
      expect(out.text).not.toContain('Clean runtime');
    });

    it('says so rather than printing an empty table', async () => {
      serve({ data: [image()] });
      const out = captureStdout();

      await images({ custom: true }, out);

      expect(out.text).toMatch(/No custom images/);
    });

    it('still returns an array under --json, so a script sees an empty list', async () => {
      serve({ data: [image()] });
      const out = captureStdout();

      await images({ custom: true, json: true }, out);

      expect(JSON.parse(out.text)).toEqual([]);
    });
  });

  describe('failures', () => {
    it('exits 2 on a rejected credential, so a script can branch on auth', async () => {
      serve({ error: { code: 'unauthorized', message: 'token rejected' } }, 401);
      const error = await images({}, captureStdout()).catch((e: unknown) => e);

      expect(isCliError(error)).toBe(true);
      expect((error as { exitCode?: number }).exitCode).toBe(2);
      expect((error as { hint?: string }).hint).toMatch(/runta-next login/);
    });

    it('exits 1 and names the cause on a server error', async () => {
      serve({ error: { code: 'internal', message: 'boom' } }, 503);
      const error = await images({}, captureStdout()).catch((e: unknown) => e);

      expect((error as { exitCode?: number }).exitCode).toBe(1);
      expect((error as { hint?: string }).hint).toMatch(/transient/);
    });
  });
});

describe('image delete', () => {
  const routes = (images: unknown[], del?: Route): Route[] => [
    { method: 'GET', path: '/v2/images', status: 200, body: { data: images } },
    ...(del ? [del] : []),
  ];

  const serveDelete = (images: unknown[], del?: Route) => {
    const { fetch, calls } = stubFetch(routes(images, del));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    // `calls` holds real Request objects, so the path lives on the URL.
    return {
      sent: (method: string, path?: string) =>
        calls.some(
          (c) => c.method === method && (path === undefined || new URL(c.url).pathname === path),
        ),
    };
  };

  it('deletes a custom image', async () => {
    const sent = serveDelete([image(), custom], {
      method: 'DELETE',
      path: '/v2/images/mine',
      status: 204,
      body: undefined,
    });
    const deps = deleteDeps();

    await deleteImage('mine', {}, deps);

    expect(sent.sent('DELETE', '/v2/images/mine')).toBe(true);
  });

  it('accepts the display name as well as the id', async () => {
    const sent = serveDelete([custom], {
      method: 'DELETE',
      path: '/v2/images/mine',
      status: 204,
      body: undefined,
    });

    await deleteImage('My Image', {}, deleteDeps());

    expect(sent.sent('DELETE', '/v2/images/mine')).toBe(true);
  });

  /**
   * The API answers the same 422 for a built-in and for an id that does not exist, so relaying it
   * would leave the user unable to tell a typo from a category error. These resolve first.
   */
  describe('refusing before the request', () => {
    it('names a built-in as a built-in, and sends no DELETE', async () => {
      const sent = serveDelete([image()]);

      const error = await deleteImage('clean', {}, deleteDeps()).catch((e: unknown) => e);

      expect(isCliError(error)).toBe(true);
      expect(String(error)).toMatch(/built-in image/);
      expect(sent.sent('DELETE')).toBe(false);
    });

    it('says a name does not exist, and sends no DELETE', async () => {
      const sent = serveDelete([image()]);

      const error = await deleteImage('nope', {}, deleteDeps()).catch((e: unknown) => e);

      expect(String(error)).toMatch(/No image named 'nope'/);
      expect((error as { hint?: string }).hint).toMatch(/image list/);
      expect(sent.sent('DELETE')).toBe(false);
    });
  });

  describe('--dry-run', () => {
    it('describes the deletion and sends nothing', async () => {
      const sent = serveDelete([custom]);
      const deps = deleteDeps();

      await deleteImage('mine', { dryRun: true }, deps);

      expect(deps.text).toMatch(/Would delete custom image mine/);
      expect(sent.sent('DELETE')).toBe(false);
    });

    it('gives an agent the same plan as JSON', async () => {
      serveDelete([custom]);
      const deps = deleteDeps();

      await deleteImage('mine', { dryRun: true, json: true }, deps);

      const payload = JSON.parse(deps.text) as Record<string, unknown>;
      expect(payload.dry_run).toBe(true);
      expect(payload.image).toEqual({ id: 'mine', name: 'My Image' });
    });
  });

  describe('confirmation', () => {
    it('asks on a terminal, and aborts on no', async () => {
      const sent = serveDelete([custom]);
      const deps = deleteDeps({ isInteractive: () => true, confirm: async () => false });

      const error = await deleteImage('mine', {}, deps).catch((e: unknown) => e);

      expect(String(error)).toMatch(/Aborted/);
      expect(sent.sent('DELETE')).toBe(false);
    });

    // A prompt in a pipe would hang forever, so scripts must never meet one.
    it('never asks under --json', async () => {
      serveDelete([custom], {
        method: 'DELETE',
        path: '/v2/images/mine',
        status: 204,
        body: undefined,
      });
      let asked = false;
      const deps = deleteDeps({
        isInteractive: () => true,
        confirm: async () => {
          asked = true;
          return true;
        },
      });

      await deleteImage('mine', { json: true }, deps);

      expect(asked).toBe(false);
    });

    it('skips the prompt with --yes', async () => {
      serveDelete([custom], {
        method: 'DELETE',
        path: '/v2/images/mine',
        status: 204,
        body: undefined,
      });
      let asked = false;
      const deps = deleteDeps({
        isInteractive: () => true,
        confirm: async () => {
          asked = true;
          return true;
        },
      });

      await deleteImage('mine', { yes: true }, deps);

      expect(asked).toBe(false);
    });
  });

  it('reports the deletion as JSON', async () => {
    serveDelete([custom], {
      method: 'DELETE',
      path: '/v2/images/mine',
      status: 204,
      body: undefined,
    });
    const deps = deleteDeps();

    await deleteImage('mine', { json: true, yes: true }, deps);

    const payload = JSON.parse(deps.text) as Record<string, unknown>;
    expect(payload.deleted).toBe(true);
    expect(payload.action).toBe('image-delete');
  });
});

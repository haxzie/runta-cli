import { isCliError } from '@runta/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureStdout, isolateEnv, type Route, stubFetch } from '../test/harness.js';
import { images } from './images.js';

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

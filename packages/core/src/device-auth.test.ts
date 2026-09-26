import { RuntaApiError } from '@runta/api';
import { describe, expect, it, vi } from 'vitest';
import {
  type DeviceAuthDeps,
  DeviceAuthError,
  type DeviceAuthorization,
  runDeviceAuthorization,
} from './device-auth.js';

const authorization = (overrides: Partial<DeviceAuthorization> = {}): DeviceAuthorization => ({
  device_code: 'dc_1',
  user_code: 'ABCD-1234',
  verification_uri: 'https://dashboard.runta.com/device',
  verification_uri_complete: 'https://dashboard.runta.com/device?code=ABCD-1234',
  expires_at: '2026-01-01T00:15:00Z',
  interval: 5,
  ...overrides,
});

const token = { access_token: 'rt_new', token_type: 'Bearer', expires_in: 2592000 };

const apiError = (code: string, status = 400) =>
  new RuntaApiError({ status, code, message: `stub ${code}`, url: 'https://api.test/x' });

/** A clock frozen well before `expires_at`, plus a sleep that records instead of waiting. */
function harness(overrides: Partial<DeviceAuthDeps> = {}) {
  const slept: number[] = [];
  const deps: DeviceAuthDeps = {
    begin: vi.fn(async () => authorization()),
    exchange: vi.fn(async () => token),
    sleep: vi.fn(async (ms: number) => {
      slept.push(ms);
    }),
    now: () => Date.parse('2026-01-01T00:00:00Z'),
    ...overrides,
  };
  return { deps, slept };
}

describe('runDeviceAuthorization', () => {
  it('returns the token once the user approves', async () => {
    const { deps } = harness();

    await expect(runDeviceAuthorization(deps)).resolves.toEqual(token);
  });

  it('shows the code before it starts polling', async () => {
    const order: string[] = [];
    const { deps } = harness({
      onPrompt: (auth) => {
        order.push(`prompt:${auth.user_code}`);
      },
      exchange: vi.fn(async () => {
        order.push('exchange');
        return token;
      }),
    });

    await runDeviceAuthorization(deps);

    expect(order).toEqual(['prompt:ABCD-1234', 'exchange']);
  });

  it('waits one interval before the first poll, so it never burns a guaranteed pending', async () => {
    const { deps, slept } = harness();

    await runDeviceAuthorization(deps);

    expect(slept[0]).toBe(5000);
    expect(deps.exchange).toHaveBeenCalledTimes(1);
  });

  it('keeps polling while authorization is pending', async () => {
    const exchange = vi
      .fn()
      .mockRejectedValueOnce(apiError('authorization_pending'))
      .mockRejectedValueOnce(apiError('authorization_pending'))
      .mockResolvedValueOnce(token);
    const { deps } = harness({ exchange });

    await expect(runDeviceAuthorization(deps)).resolves.toEqual(token);
    expect(exchange).toHaveBeenCalledTimes(3);
  });

  it('widens the interval on slow_down, as RFC 8628 requires', async () => {
    const exchange = vi
      .fn()
      .mockRejectedValueOnce(apiError('slow_down'))
      .mockResolvedValueOnce(token);
    const { deps, slept } = harness({ exchange });

    await runDeviceAuthorization(deps);

    // 5000 before the first poll, then 1.5x after slow_down.
    expect(slept).toEqual([5000, 7500]);
  });

  it('keeps polling through a transient server failure instead of abandoning the login', async () => {
    // This is CLI_ISSUES.md C-03: the production CLI gives up here, and Runta's device
    // endpoints intermittently 520, so a user can approve and still be told login failed.
    const onTransient = vi.fn();
    const exchange = vi
      .fn()
      .mockRejectedValueOnce(apiError('http_520', 520))
      .mockRejectedValueOnce(apiError('network_error', 0))
      .mockRejectedValueOnce(apiError('unavailable', 503))
      .mockResolvedValueOnce(token);
    const { deps } = harness({ exchange, onTransient });

    await expect(runDeviceAuthorization(deps)).resolves.toEqual(token);
    expect(exchange).toHaveBeenCalledTimes(4);
    expect(onTransient).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when the user denies it', async () => {
    const exchange = vi.fn().mockRejectedValue(apiError('access_denied'));
    const { deps } = harness({ exchange });

    const error = await runDeviceAuthorization(deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DeviceAuthError);
    expect((error as DeviceAuthError).reason).toBe('denied');
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('stops when the server says the code expired', async () => {
    const exchange = vi.fn().mockRejectedValue(apiError('expired_token'));
    const { deps } = harness({ exchange });

    const error = await runDeviceAuthorization(deps).catch((e: unknown) => e);

    expect((error as DeviceAuthError).reason).toBe('expired');
    expect((error as Error).message).toContain('ABCD-1234');
  });

  it('stops polling once expires_at has passed, even if the server keeps saying pending', async () => {
    const exchange = vi.fn().mockRejectedValue(apiError('authorization_pending'));
    let clock = Date.parse('2026-01-01T00:00:00Z');
    const { deps } = harness({
      exchange,
      // Each sleep jumps the clock, so the deadline arrives instead of looping forever.
      sleep: vi.fn(async (ms: number) => {
        clock += ms * 100;
      }),
      now: () => clock,
    });

    const error = await runDeviceAuthorization(deps).catch((e: unknown) => e);

    expect((error as DeviceAuthError).reason).toBe('expired');
  });

  it('retries a transient failure to start the flow', async () => {
    const begin = vi
      .fn()
      .mockRejectedValueOnce(apiError('http_520', 520))
      .mockResolvedValueOnce(authorization());
    const { deps } = harness({ begin });

    await expect(runDeviceAuthorization(deps)).resolves.toEqual(token);
    expect(begin).toHaveBeenCalledTimes(2);
  });

  it('gives up starting the flow after four attempts', async () => {
    const begin = vi.fn().mockRejectedValue(apiError('http_520', 520));
    const { deps } = harness({ begin });

    const error = await runDeviceAuthorization(deps).catch((e: unknown) => e);

    expect(begin).toHaveBeenCalledTimes(4);
    expect((error as DeviceAuthError).reason).toBe('unreachable');
  });

  it('does not retry a 4xx when starting, because it will fail the same way again', async () => {
    const begin = vi.fn().mockRejectedValue(apiError('invalid_argument', 400));
    const { deps } = harness({ begin });

    const error = await runDeviceAuthorization(deps).catch((e: unknown) => e);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(RuntaApiError);
  });

  it('rethrows a non-API error untouched rather than treating it as retryable', async () => {
    const boom = new TypeError('programmer error');
    const { deps } = harness({ exchange: vi.fn().mockRejectedValue(boom) });

    await expect(runDeviceAuthorization(deps)).rejects.toBe(boom);
  });
});

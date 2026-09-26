import { isRuntaApiError } from '@runta/api';

/** What `POST /v2/auth/device/authorization` hands back, narrowed to what we use. */
export interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_at: string;
  interval: number;
}

export interface DeviceToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface DeviceAuthDeps {
  /** Starts the flow. May throw; transient failures are retried. */
  begin(): Promise<DeviceAuthorization>;
  /** Polls once. Throws RuntaApiError for pending/denied/expired and for transport failures. */
  exchange(deviceCode: string): Promise<DeviceToken>;
  /** Called once, as soon as there is a code to show the user. */
  onPrompt?(authorization: DeviceAuthorization): void | Promise<void>;
  /** Called when a poll fails in a way worth mentioning but not worth stopping for. */
  onTransient?(reason: string): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export class DeviceAuthError extends Error {
  readonly reason: 'denied' | 'expired' | 'unreachable';
  constructor(reason: 'denied' | 'expired' | 'unreachable', message: string) {
    super(message);
    this.name = 'DeviceAuthError';
    this.reason = reason;
  }
}

/** RFC 8628 errors that mean "keep waiting" rather than "give up". */
const PENDING = new Set(['authorization_pending', 'slow_down']);
const TERMINAL: Record<string, 'denied' | 'expired'> = {
  access_denied: 'denied',
  expired_token: 'expired',
};

const BEGIN_ATTEMPTS = 4;
const BEGIN_BACKOFF_MS = [500, 1500, 4000];

/**
 * Drives the device authorization flow to a token.
 *
 * The retry behaviour here is the point. The production Rust CLI abandons the flow on the
 * first transport error and deletes its own pending state, so a user can approve in the
 * browser and still be told login failed with no way to resume — and Runta's
 * `/v2/auth/device/*` endpoints intermittently return 520 (CLI_ISSUES.md C-03). So:
 *
 * - `begin` is retried with backoff before giving up.
 * - A failed poll only ends the flow when the server says `access_denied`/`expired_token`,
 *   or `expires_at` has passed. 5xx, 520 and network failures are reported and re-polled.
 * - `slow_down` widens the interval, as the RFC requires.
 */
export async function runDeviceAuthorization(deps: DeviceAuthDeps): Promise<DeviceToken> {
  const authorization = await beginWithRetry(deps);
  await deps.onPrompt?.(authorization);

  const deadline = Date.parse(authorization.expires_at);
  let interval = Math.max(1, authorization.interval) * 1000;

  // Wait before the first poll: the user cannot possibly have approved yet, and polling
  // immediately just earns a guaranteed `authorization_pending`.
  await deps.sleep(interval);

  for (;;) {
    if (Number.isFinite(deadline) && deps.now() >= deadline) {
      throw new DeviceAuthError(
        'expired',
        `The code ${authorization.user_code} expired before it was approved.`,
      );
    }

    try {
      return await deps.exchange(authorization.device_code);
    } catch (error) {
      if (!isRuntaApiError(error)) throw error;

      const terminal = TERMINAL[error.code];
      if (terminal) {
        throw new DeviceAuthError(
          terminal,
          terminal === 'denied'
            ? 'Authorization was denied.'
            : `The code ${authorization.user_code} expired before it was approved.`,
        );
      }

      if (error.code === 'slow_down') {
        interval = Math.round(interval * 1.5);
      } else if (!PENDING.has(error.code)) {
        // Anything else — 520, 503, a dropped connection — is noise on the way to a token.
        deps.onTransient?.(error.message);
      }

      await deps.sleep(interval);
    }
  }
}

async function beginWithRetry(deps: DeviceAuthDeps): Promise<DeviceAuthorization> {
  let last: unknown;

  for (let attempt = 0; attempt < BEGIN_ATTEMPTS; attempt += 1) {
    try {
      return await deps.begin();
    } catch (error) {
      last = error;
      // A rejected credential or a bad request will fail identically next time.
      if (isRuntaApiError(error) && error.status >= 400 && error.status < 500) throw error;

      const backoff = BEGIN_BACKOFF_MS[attempt];
      if (backoff === undefined) break;
      deps.onTransient?.(error instanceof Error ? error.message : String(error));
      await deps.sleep(backoff);
    }
  }

  throw new DeviceAuthError(
    'unreachable',
    `Could not start authorization after ${BEGIN_ATTEMPTS} attempts: ${
      last instanceof Error ? last.message : String(last)
    }`,
  );
}

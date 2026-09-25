/**
 * Injected at compile time by `scripts/build-binaries.ts` via `bun build --define`.
 * In dev there is no define, so fall back to the value pnpm exports for the running script.
 */
declare const RUNTA_VERSION: string | undefined;

export const version: string =
  typeof RUNTA_VERSION === 'string'
    ? RUNTA_VERSION
    : (process.env.npm_package_version ?? '0.0.0-dev');

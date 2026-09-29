/**
 * Injected at build time via `bun build --define`, by both channels: `scripts/build-binaries.ts`
 * for the standalone binaries, and the package's own `build` script for the npm package — which
 * needs it because `npm_package_version` is not set when a globally installed bin is run.
 * In dev there is no define, so fall back to the value pnpm exports for the running script.
 */
declare const RUNTA_VERSION: string | undefined;

export const version: string =
  typeof RUNTA_VERSION === 'string'
    ? RUNTA_VERSION
    : (process.env.npm_package_version ?? '0.0.0-dev');

#!/usr/bin/env bun
/**
 * Fetches the OpenAPI spec from RUNTA_OPENAPI_URL into the committed snapshot at
 * `packages/api/openapi.json`, which is what codegen actually reads.
 *
 * Design goals, in order:
 *  1. `pnpm dev` must never break because the network or the API is down.
 *  2. A fresh clone must typecheck with no network at all.
 *  3. Spec drift must show up as a reviewable diff, not a surprise at runtime.
 *
 * Hence: fetch is best-effort, the snapshot is committed, and a failed fetch is a
 * warning rather than a non-zero exit.
 *
 * Flags / env:
 *   --force                 ignore the freshness TTL
 *   RUNTA_OPENAPI_URL       spec URL (default: DEFAULT_SPEC_URL below)
 *   RUNTA_SKIP_API_SYNC=1   never fetch; use the snapshot as-is
 *   RUNTA_SPEC_TTL_MS       skip the fetch if the snapshot is newer than this (default 1h)
 */
import { stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SPEC_URL = 'https://api.runta.dev/openapi.json';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = join(packageRoot, 'openapi.json');

const warn = (message: string) => console.warn(`[api:sync] ${message}`);
const info = (message: string) => console.log(`[api:sync] ${message}`);

async function snapshotAgeMs(): Promise<number | null> {
  try {
    return Date.now() - (await stat(snapshotPath)).mtimeMs;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const url = process.env.RUNTA_OPENAPI_URL ?? DEFAULT_SPEC_URL;
  const age = await snapshotAgeMs();

  if (age === null && (process.env.RUNTA_SKIP_API_SYNC === '1' || process.env.CI)) {
    // No snapshot and no permission to fetch: codegen has nothing to read.
    throw new Error(
      `No spec snapshot at ${snapshotPath} and fetching is disabled. ` +
        'Unset RUNTA_SKIP_API_SYNC, or commit a snapshot.',
    );
  }

  if (process.env.RUNTA_SKIP_API_SYNC === '1') {
    info('RUNTA_SKIP_API_SYNC=1 — using the committed snapshot.');
    return;
  }

  // CI builds against the committed snapshot so a live spec change can never flip a
  // build red or green on its own. The drift workflow passes an explicit URL to opt in.
  if (process.env.CI && !process.env.RUNTA_OPENAPI_URL) {
    info('CI without RUNTA_OPENAPI_URL — using the committed snapshot.');
    return;
  }

  const ttl = Number(process.env.RUNTA_SPEC_TTL_MS ?? DEFAULT_TTL_MS);
  if (!force && age !== null && age < ttl) {
    info(`snapshot is ${Math.round(age / 1000)}s old — skipping fetch (use --force to override).`);
    return;
  }

  info(`fetching ${url}`);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const spec = await response.json();
    await writeFile(snapshotPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
    info(`updated ${snapshotPath}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (age === null) {
      throw new Error(
        `Could not fetch ${url} (${reason}) and there is no snapshot to fall back to.`,
      );
    }
    warn(`could not fetch ${url} (${reason}) — falling back to the committed snapshot.`);
  }
}

main().catch((error: unknown) => {
  console.error(`[api:sync] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

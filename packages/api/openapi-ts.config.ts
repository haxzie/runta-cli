import { defineConfig } from '@hey-api/openapi-ts';

/**
 * Reads the committed snapshot, never the network — `scripts/sync-spec.ts` owns
 * refreshing that file and runs immediately before this (see the `generate` script).
 */
export default defineConfig({
  input: './openapi.json',
  output: {
    path: './src/generated',
    // Biome already ignores src/generated; running it again here just costs time.
    postProcess: [],
  },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    // Default operation strategy = flat, tree-shakeable named functions
    // (`getCurrentUser(...)`) rather than a service class.
    '@hey-api/sdk',
  ],
});

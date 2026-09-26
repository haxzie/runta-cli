import { defineConfig } from '@hey-api/openapi-ts';

/**
 * Reads `./openapi.json`, which is hand-maintained in the repo — Runta publishes no
 * spec to fetch, so there is no sync step and codegen never touches the network.
 * See NOTES.md.
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

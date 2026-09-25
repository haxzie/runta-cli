# runta

The `runta` command line interface, and the packages it is built from.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/haxzie/runta-cli/main/scripts/install.sh | sh
```

This downloads a standalone binary for your platform from the latest GitHub Release,
verifies its SHA-256 checksum, and installs it to `~/.runta/bin/runta`. Nothing is
published to npm — there is no Node.js runtime requirement.

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUNTA_VERSION` | latest release | Install a specific version |
| `RUNTA_INSTALL_DIR` | `~/.runta/bin` | Where the binary lands |

Supported targets: macOS and Linux, on `x64` and `arm64` (glibc and musl).

## Development

Requires [Bun](https://bun.sh) 1.3+, Node 22 (see `.nvmrc`) and pnpm 10.

```sh
pnpm install
pnpm dev hello world      # run the CLI from source, with watch — no build step
pnpm dev:once whoami      # same, single run
```

`pnpm dev` runs `apps/cli/src/index.ts` through Bun directly. Workspace packages expose
their TypeScript source under the `bun` export condition, so an edit anywhere in
`packages/` is picked up immediately without compiling.

| Command | Does |
| --- | --- |
| `pnpm dev [args]` | Run the CLI from source, watching for changes |
| `pnpm build` | Turbo build of every package |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm test` | Vitest across the workspace |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm api:generate` | Regenerate the SDK (respects a 1h spec cache) |
| `pnpm api:sync` | Force-refetch the OpenAPI spec, then regenerate |
| `pnpm build:binaries` | Cross-compile release binaries into `dist/` |
| `pnpm changeset` | Record a change for the next release |

## Layout

```
apps/cli          @runta/cli       Commander program; compiles to the `runta` binary
packages/api      @runta/api       Generated OpenAPI SDK + hand-written client shell
packages/core     @runta/core      Config loading and command context
packages/utils    @runta/utils     Logger and error types
packages/tsconfig @runta/tsconfig  Shared TypeScript configs
```

Every package is private. Changesets versions them as one fixed group, so
`runta --version` identifies the whole tree.

## The API SDK

`packages/api/src/generated/**` is produced by
[`@hey-api/openapi-ts`](https://heyapi.dev) and must never be edited by hand. It is
generated from `packages/api/openapi.json`, a **committed snapshot** of the live spec.

Generation is wired into `predev` and `prebuild`, so the SDK is always current with the
snapshot without anyone having to remember a step. `scripts/sync-spec.ts` refreshes the
snapshot from `RUNTA_OPENAPI_URL` first:

- A fetch failure is a warning, not an error — it falls back to the snapshot, so
  `pnpm dev` works offline and when the API is down.
- The fetch is skipped if the snapshot is under an hour old (`pnpm api:sync` forces it).
- CI never fetches, so a live spec change cannot flip a build red or green on its own.
  A nightly `api-drift` workflow does the fetch and opens a PR when the spec moves.

Nothing outside `@runta/api` should import from `./generated` directly. The hand-written
shell (`client.ts`, `errors.ts`) owns auth headers, the user agent, and turning every
failure — including network failures — into a single `RuntaApiError`.

| Variable | Purpose |
| --- | --- |
| `RUNTA_OPENAPI_URL` | Spec URL to fetch |
| `RUNTA_SKIP_API_SYNC=1` | Never fetch; use the committed snapshot |
| `RUNTA_SPEC_TTL_MS` | Freshness window before refetching |

## Releasing

1. Include a changeset with your PR (`pnpm changeset`).
2. On merge to `main`, the release workflow opens a "Version Packages" PR.
3. Merging that PR bumps versions and writes CHANGELOGs; the workflow then cross-compiles
   all targets, creates the `v<version>` tag, and attaches the tarballs plus
   `checksums.txt` to a GitHub Release. `install.sh` reads from exactly that.

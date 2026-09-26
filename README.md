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
cp .env.example .env      # optional; every value has a working default
pnpm dev hello world      # run the CLI from source, with watch — no build step
pnpm dev:once whoami      # same, single run
```

Configuration for local development goes in a single **`.env` at the repo root**
(gitignored — see `.env.example` for the full list). Bun loads it automatically for
`pnpm dev`, and the codegen scripts pass `--env-file=../../.env` explicitly, since pnpm
runs them with their own package as the working directory.

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
| `pnpm api:generate` | Regenerate the SDK from `packages/api/openapi.json` |
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
generated from `packages/api/openapi.json`.

**`openapi.json` is hand-maintained.** Runta publishes no OpenAPI document — every
plausible URL 404s — so there is nothing to sync from and codegen never touches the
network. The spec is written from
[the API reference](https://runta.com/docs/reference/api/) and verified against live
`api.runta.com`, one operation group at a time. `packages/api/NOTES.md` records the
coverage so far and the places where the live API disagrees with the published docs.

Consequences worth knowing:

- Adding an endpoint is a two-step edit: describe it in `openapi.json`, then
  `pnpm api:generate` and commit the regenerated `src/generated`.
- Generation is wired into `predev` and `prebuild`, so the SDK is never stale locally,
  and CI fails if committed `src/generated` doesn't match `openapi.json`.
- Everything works offline. There is no spec cache, no TTL, and no env var to set.
- If Runta ever publishes a spec, this becomes a generated artifact again and the
  hand-written file can go away. Until then, treat `openapi.json` as source.

Nothing outside `@runta/api` should import from `./generated` directly. The hand-written
shell (`client.ts`, `errors.ts`) owns auth headers, the user agent, and turning every
failure — including network failures — into a single `RuntaApiError`.

## Releasing

1. Include a changeset with your PR (`pnpm changeset`).
2. On merge to `main`, the release workflow opens a "Version Packages" PR.
3. Merging that PR bumps versions and writes CHANGELOGs; the workflow then cross-compiles
   all targets, creates the `v<version>` tag, and attaches the tarballs plus
   `checksums.txt` to a GitHub Release. `install.sh` reads from exactly that.

# runta

The `runta` command line interface, and the packages it is built from.

## Install

```sh
curl -fsSL https://runta.haxzie.com/install.sh | sh
```

This downloads a standalone binary for your platform from the latest GitHub Release,
verifies its SHA-256 checksum, and installs it to `~/.runta/bin/runta`. Nothing is
published to npm — there is no Node.js runtime requirement.

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUNTA_VERSION` | latest release | Install a specific version |
| `RUNTA_INSTALL_DIR` | `~/.runta/bin` | Where the binary lands |

Supported targets: macOS and Linux, on `x64` and `arm64` (glibc and musl).

## Using the CLI

```
runta [global options] <command> [command options]
```

| Command | Does |
| --- | --- |
| `runta create` | Create a runtime and wait until it can accept commands |
| `runta list` | List runtimes |
| `runta inspect <runtime>` | Show everything about one runtime |
| `runta delete <runtime>...` | Delete runtimes, with `--dry-run` and confirmation |
| `runta exec <runtime> -- <cmd>` | Run a command inside a runtime; `-it` for an interactive pty |
| `runta login` | Sign in through a browser using a one-time device code |
| `runta logout` | Revoke the stored credential and remove it locally |
| `runta whoami` | Show the authenticated user and active team |
| `runta hello [name]` | Print a greeting — smoke test, no network, no credential |

| Global option | Does |
| --- | --- |
| `-v`, `--version` | Print the version and exit |
| `-h`, `--help` | Help for the program or any subcommand |
| `--verbose` | Debug logging on stderr, including the resolved endpoint |
| `--quiet` | Errors only |

`--verbose` and `--quiet` are program-level, so they go *before* the command:
`runta --verbose whoami`, not `runta whoami --verbose`.

`--help` is generated from the program itself and can never drift from what the binary
accepts. If it disagrees with the docs, believe `--help`.

The API exposes 85 operations; the CLI covers four. Runtimes, checkpoints, secrets, egress,
file transfer and agents are not implemented yet — see
[docs/commands](./docs/commands/index.md#not-yet-implemented).

### Authenticating

Interactively, via the device flow:

```console
$ runta login
Your code is ABCD-1234
Opened your browser to approve it.
Waiting for authorization…
Authorized. Token saved to /Users/you/.runta/config.json
```

The browser is opened for you, and skipped automatically when stdout is not a TTY or an SSH
session is detected; `--no-browser` forces the URL to be printed instead. The poller tolerates
a flaky API — 5xx responses, dropped connections and timeouts keep polling, and the flow only
ends on denial, expiry, or `expires_at`. Nothing is written to disk until a token is issued.

Non-interactively, skip the login entirely:

```sh
export RUNTA_TOKEN=rt_…
runta whoami
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUNTA_TOKEN` | — | Bearer credential; skips `login` |
| `RUNTA_API_URL` | `https://api.runta.com` | API base URL |
| `RUNTA_CONFIG_HOME` | `~/.runta` | Directory holding `config.json` |
| `RUNTA_LOG_LEVEL` | `info` | `silent`, `error`, `warn`, `info`, `debug` |
| `NO_COLOR` | — | Any value disables colour |

Precedence, highest first:

```
token:    RUNTA_TOKEN    >  config.json "token"   >  (none)
endpoint: RUNTA_API_URL  >  config.json "apiUrl"  >  https://api.runta.com
```

Credentials live in `~/.runta/config.json` — plaintext JSON, file `0600`, directory `0700`,
created on demand. Other keys in the file are preserved when the token is written or cleared.
`rm -rf ~/.runta` removes the binary and the credential together.

### Output and exit codes

stdout is data; progress, hints and errors go to stderr, so pipes stay clean. Output does
**not** change shape based on whether stdout is a TTY — pass `--json` explicitly.

`whoami --json` prints the API envelope verbatim. `login --json` is a progress stream, so
it emits NDJSON — one compact object per line, the code arriving before polling starts:

```console
$ runta login --json --no-browser
{"status":"authorization_pending","user_code":"ABCD-1234","verification_uri_complete":"…?code=ABCD-1234","expires_at":"2026-09-26T09:50:41Z"}
{"status":"authorized","config_path":"/Users/you/.runta/config.json"}
```

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Request failed, or the API was unreachable |
| `2` | Credential problem: missing, rejected, wrongly scoped, denied or expired |

### Nuances worth knowing

- **`RUNTA_TOKEN` silently shadows a stored login.** You can `login` successfully and
  still be acting as a different identity, with nothing in the output saying so. Check
  `env | grep RUNTA_TOKEN` when results look wrong.
- **`logout` revokes env tokens too, permanently.** If `RUNTA_TOKEN` is set, that key is
  destroyed for everyone using it, and the CLI cannot unset your environment variable —
  `{"revoked":true,"cleared":false}` is the tell.
- **`whoami` rejects organization API keys.** `GET /v2/me` accepts only a user credential from
  the device flow; an `rt_…` org key authenticates but returns 403 `permission_denied`. That is
  the API's design, and org keys remain correct for automation.
- **`whoami` cannot tell you your org, scopes or expiry.** The endpoint returns only
  `user_id`, `email` and `display_name`, and the API has no token-introspection operation.
- **Unrecognised `RUNTA_*` variables are ignored silently.** In particular `RUNTA_ENDPOINT`
  and `RUNTA_CONFIG` — names used by Runta's own Rust CLI — do nothing here; use
  `RUNTA_API_URL` and `RUNTA_CONFIG_HOME`. There are no `--endpoint` or `--token` flags yet.
  Verify the target with `--verbose` whenever it matters.
- **A missing credential returns 403, a rejected one 401.** The CLI's hints distinguish the
  two; the status codes alone do not.

## Documentation

Long-form docs live in [`docs/`](./docs) as plain markdown with frontmatter, ready for the
docs web app:

| Page | Covers |
| --- | --- |
| [Overview](./docs/index.md) | Quick start and current scope |
| [Installation](./docs/installation.md) | Install, pin a version, uninstall |
| [Authentication](./docs/authentication.md) | Device flow, CI tokens, credential storage |
| [Configuration](./docs/configuration.md) | Every variable, the config file, precedence |
| [Output and scripting](./docs/output-and-scripting.md) | `--json`, NDJSON, exit codes, agents |
| [Commands](./docs/commands/index.md) | Per-command reference |

Keep them in step with the code: a flag added without a docs change is a bug.

### Design rules

[`Improvements.md`](./Improvements.md) is the decision log: where we deliberately depart from the
production Runta CLI and why. [`RESEARCH.md`](./RESEARCH.md) is the evidence behind those calls —
how E2B, Daytona, Modal and Docker name the equivalent commands. Read both before naming anything
new.

[`.claude/skills/cli-design/`](./.claude/skills/cli-design) holds the rules we design this CLI
by — naming, flags, output and JSON contracts, errors, exit codes, credential handling,
destructive-action safety, agent-friendliness. Every rule traces to a specific defect recorded in
[`CLI_ISSUES.md`](./CLI_ISSUES.md), so `references/findings-map.md` is the evidence behind each
one and `references/checklist.md` is the pre-PR pass. Claude Code loads it automatically when you
touch a command; read it yourself before designing one.

The install URL is served by a Cloudflare Worker in [`workers/install`](./workers/install), which
fetches `scripts/install.sh` from the default branch so the script can be updated without
redeploying anything. `?ref=<branch|tag|sha>` pins a specific version of the installer itself.

Because whatever it returns gets piped into `sh`, the Worker never answers a failure with a 200:
upstream errors become 5xx, unknown paths become 404, and a body that does not start with a shell
shebang is refused. `curl -fsSL` aborts on all of those, so a broken fetch is an install that
declines to start rather than an arbitrary body handed to a shell.

## Development

Requires [Bun](https://bun.sh) 1.3+, Node 22 (see `.nvmrc`) and pnpm 10.

```sh
pnpm install
cp .env.example .env      # optional; every value has a working default
pnpm dev hello world      # run the CLI from source, with watch — no build step
pnpm cli whoami           # same, single run, no watch
```

Configuration for local development goes in a single **`.env` at the repo root**
(gitignored — see `.env.example` for the full list). Bun loads it automatically for
`pnpm dev`. Codegen reads nothing from the environment — see [The API SDK](#the-api-sdk).

`pnpm dev` runs `apps/cli/src/index.ts` through Bun directly. Workspace packages expose
their TypeScript source under the `bun` export condition, so an edit anywhere in
`packages/` is picked up immediately without compiling.

| Command | Does |
| --- | --- |
| `pnpm dev [args]` | Run the CLI from source, watching for changes |
| `pnpm cli [args]` | Run the CLI from source once, without watch |
| `pnpm build` | Turbo build of every package |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm test` | Vitest across the workspace |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm api:generate` | Regenerate the SDK from `packages/api/openapi.json` |
| `pnpm build:binaries` | Cross-compile release binaries into `dist/` |
| `pnpm --filter @runta/install-worker deploy` | Deploy the install-script Worker |
| `pnpm changeset` | Record a change for the next release |

## Layout

```
apps/cli          @runta/cli       Commander program; compiles to the `runta` binary
packages/api      @runta/api       Generated OpenAPI SDK + hand-written client shell
packages/core     @runta/core      Config loading and command context
packages/utils    @runta/utils     Logger and error types
packages/tsconfig @runta/tsconfig  Shared TypeScript configs
workers/install   @runta/install-worker  Cloudflare Worker serving install.sh
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

`runta exec` is not REST. It is a WebSocket described by a separate AsyncAPI document,
`packages/api/asyncapi.yaml`. No generator reads it — `openapi-ts` is OpenAPI-only — so the exec
client will be hand-written against that file, which is source of truth in the same way.

Nothing outside `@runta/api` should import from `./generated` directly. The hand-written
shell (`client.ts`, `errors.ts`) owns auth headers, the user agent, and turning every
failure — including network failures — into a single `RuntaApiError`.

## Releasing

Changesets owns versioning; the release workflow turns a version bump into a GitHub Release with
the compiled binaries attached. **Nothing is published to npm** — every package is private, and
the CLI ships as a standalone binary.

1. Include a changeset with your PR: `pnpm changeset`, pick the packages and a bump type, commit
   the generated markdown.
2. On merge to `main`, the release workflow opens or updates a **Version Packages** PR. Nothing
   else happens yet.
3. Merging that PR bumps every package to one version (`fixed: [["@runta/*"]]`, so
   `runta --version` identifies the whole tree) and writes CHANGELOGs.
4. That push to `main` leaves a version with no matching tag, which is the signal to release. The
   workflow then cross-compiles all six targets, checks them, tags `v<version>`, and attaches the
   tarballs plus `checksums.txt`.

Three gates stand between a version bump and a published release, because a broken release is
worse than a late one:

- the `linux-x64` binary must run and report the version being released;
- `scripts/install.sh` must install from the freshly built artifacts — the workflow serves `dist/`
  over HTTP and runs the real installer against it, so a broken installer fails here rather than
  in front of a user;
- the changelog must actually contain a section for this version, so an empty release is an error
  rather than a surprise.

`@runta/tsconfig` and `@runta/install-worker` are excluded from versioning: shared config and
deployment infrastructure are not things a user installs.

### Deploying the install Worker

The Worker is deployed by hand, from a machine with `wrangler login`:

```sh
pnpm --filter @runta/install-worker deploy
```

There is no CI deploy and no Cloudflare credential in this repository, on purpose. The Worker reads
`scripts/install.sh` from the default branch **at request time**, so editing the install script
needs no deploy at all — the Worker itself changes about as often as the repo moves. Automating a
once-a-year deploy is not worth a long-lived token in a repository secret.

What *is* automated is noticing when the URL breaks. `install-health.yml` runs daily and needs no
credential: it checks that `runta.haxzie.com/install.sh` returns a shell script byte-identical to
the committed one, that an unknown path is not a 2xx, and that a path-traversal `?ref=` is refused.
That is also the thing that will catch the Worker's `GITHUB_TOKEN` expiring, which would otherwise
be discovered by whoever next tried to install.

The Worker holds no secrets. It reads the script from `raw.githubusercontent.com`, which caches well
and cannot leak a credential. It *can* authenticate through the GitHub contents API if a
`GITHUB_TOKEN` secret is set — that path exists because the raw host answers 404 for a private repo —
but with this repo public it is unused, and the secret was deleted.

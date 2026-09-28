# @runta/core

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @runta/api@0.5.0
  - @runta/utils@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @runta/api@0.4.1
  - @runta/utils@0.4.1

## 0.4.0

### Minor Changes

- [`7a31e6e`](https://github.com/haxzie/runta-cli/commit/7a31e6e7f910c5c55083723ac17ee9bcf777c554) Thanks [@haxzie](https://github.com/haxzie)! - Make `--help` say whether you are signed in, and what to do about it.
  
  The opening line of the help used to read "Not signed in yet? Start with login" to everyone,
  including people who had signed in an hour earlier. It now reflects the actual state: with a stored
  login it points at `whoami` to see the current user and team and at `login` to switch user or
  organisation; with `RUNTA_TOKEN` set it says so and explains that the environment outranks `login`,
  so the variable is what has to change; with no credential it says what it said before.
  
  Adds `credentialSource()` to `@runta/core` — a synchronous probe that never fails, because help is
  rendered from a synchronous callback and has to render on a machine whose config file is missing or
  corrupt, where `loadConfig` deliberately aborts.
  
  It checks that a token is present, not that it works: rendering help makes no API call, so an
  expired token still reads as signed in. That is why every variant names `whoami`.

### Patch Changes

- Updated dependencies [[`a359b60`](https://github.com/haxzie/runta-cli/commit/a359b606b742f45b8efc74a24bbea11f74a53ba3)]:
  - @runta/api@0.4.0
  - @runta/utils@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`c5647b2`](https://github.com/haxzie/runta-cli/commit/c5647b2c1eaf24c6c3639ee2464faefbeec1db8f)]:
  - @runta/utils@0.3.0
  - @runta/api@0.3.0

## 0.2.0

### Minor Changes

- Rename the command to `runta-next`.
  
  This is an experimental CLI and Runta publishes its own as `@runta/runta-cli`, which owns the `runta`
  command. Competing for that name was a self-inflicted problem: both would install a `runta`, whichever
  came first on `PATH` would win silently, and because the subcommand names deliberately differ the
  failure mode was `runta ps` erroring on a CLI that works fine.
  
  So the binary, the help output, every hint and suggestion, the release artifacts and the default paths
  all say `runta-next` now. Configuration moved from `~/.runta/` to `~/.runta-next/`, and the installer
  defaults to `~/.runta-next/bin/runta-next`. The two CLIs no longer interact at all.
  
  `RUNTA_TOKEN`, `RUNTA_API_URL` and the other environment variables keep their names: they identify the
  platform rather than the binary, so a token you already have works here without being set twice.
  
  **If you installed 0.1.0**, that version's release artifacts were named `runta-*` and this installer
  looks for `runta-next-*`. Re-run the installer to get the renamed command, then remove the old one:
  `rm -rf ~/.runta`.

### Patch Changes

- Updated dependencies []:
  - @runta/api@0.2.0
  - @runta/utils@0.2.0

## 0.1.0

### Minor Changes

- Add `runta login`, `runta logout` and `runta whoami`.
  
  `login` uses the device flow: it opens your browser, then polls until you approve. Unlike the
  reference implementation it survives a flaky API — transient errors are retried rather than
  abandoning the login, and the pending state is never discarded on a failure it could recover from.
  The credential is stored in `~/.runta/config.json` at `0600`, in a directory created on demand.
  
  `whoami` reports the account and the active team. `RUNTA_TOKEN` skips authentication entirely for
  CI, and `logout` warns when it is set, because revoking an environment token cannot unset your shell.

- [`20b1d48`](https://github.com/haxzie/runta-cli/commit/20b1d486201da564f4ba6b5a5c7a194b6cb8765c) Thanks [@haxzie](https://github.com/haxzie)! - Initial monorepo scaffolding: `runta` CLI built with Commander and Bun, a generated
  OpenAPI SDK, standalone binary releases, and `curl | sh` installation.

- Add `runta create`, `list`, `inspect` and `delete`, each reachable as `runta runtime <verb>` too.
  
  `create` waits until the runtime can accept commands rather than returning a runtime you cannot use
  yet, and `--detach` opts out. `inspect` is a detail view showing everything the API returns — including
  the *effective* egress posture, so an empty allowlist reads as "no egress permitted" rather than
  looking identical to an unrestricted runtime. `delete` has `--dry-run` and confirms before destroying
  anything.
  
  Every command takes a runtime name or id, as do `--image` and `--from-checkpoint`; ambiguous names are
  an error rather than a guess. Tables clamp to a usable width and honour `COLUMNS`.

### Patch Changes

- Updated dependencies [[`20b1d48`](https://github.com/haxzie/runta-cli/commit/20b1d486201da564f4ba6b5a5c7a194b6cb8765c)]:
  - @runta/api@0.1.0
  - @runta/utils@0.1.0

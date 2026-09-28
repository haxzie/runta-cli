# @runta/utils

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

## 0.1.0

### Minor Changes

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

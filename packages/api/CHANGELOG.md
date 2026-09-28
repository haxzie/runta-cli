# @runta/api

## 0.5.0

No changes in this release.

## 0.4.1

No changes in this release.

## 0.4.0

### Patch Changes

- [`a359b60`](https://github.com/haxzie/runta-cli/commit/a359b606b742f45b8efc74a24bbea11f74a53ba3) Thanks [@haxzie](https://github.com/haxzie)! - Restore the `VncConnection.username` enum to `runta`.
  
  The runta → runta-next rename rewrote it to `runta-next`, but this is a value the *server* sends —
  the in-runtime account name — so a rename of our command could not have changed it. The generated
  SDK typed the field as `'runta-next'`, which no live response would ever satisfy.

## 0.3.0

No changes in this release.

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

- Add `runta login`, `runta logout` and `runta whoami`.
  
  `login` uses the device flow: it opens your browser, then polls until you approve. Unlike the
  reference implementation it survives a flaky API — transient errors are retried rather than
  abandoning the login, and the pending state is never discarded on a failure it could recover from.
  The credential is stored in `~/.runta/config.json` at `0600`, in a directory created on demand.
  
  `whoami` reports the account and the active team. `RUNTA_TOKEN` skips authentication entirely for
  CI, and `logout` warns when it is set, because revoking an environment token cannot unset your shell.

- Add `runta exec`, including interactive pty sessions with `-it`.
  
  Output streams as it arrives and stdout and stderr stay separate. With a pty, Ctrl-C reaches the shell
  inside the runtime, window resizes are forwarded, and your terminal is restored on exit. `--json` emits
  NDJSON frames mirroring the wire protocol, base64-encoded so binary output survives.
  
  The remote command's exit status passes through verbatim. When the connection ends before the runtime
  reports one, the outcome is reported as **unknown** (`125` if nothing started, `126` if it might have)
  rather than as a failure — retrying a command that may already have run is how automation duplicates
  work.

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

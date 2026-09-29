# @runta/api

## 0.7.0

No changes in this release.

## 0.6.1

No changes in this release.

## 0.6.0

### Minor Changes

- [`3250a57`](https://github.com/haxzie/runta-cli/commit/3250a57cff78929f9708bdfcc61bf6c9678b6800) Thanks [@haxzie](https://github.com/haxzie)! - Add `start`, `stop` and `pause` for runtimes.
  
  You could create a runtime and delete it, but not park it — so the only way to stop paying was to
  destroy your work. These three cover the API's four transition endpoints, and the asymmetry is the
  point.
  
  **`start` does not make you guess the state.** The API splits waking a runtime across `/start` (from
  `shutdown`) and `/resume` (from `paused`), and there is a third parked state, `suspended`, that only
  the idle policy produces. The production CLI exposes that split as `boot` and `resume`, so you have to
  know the current state before you can name the right verb, and naming the wrong one is an API error.
  Since the CLI reads the runtime anyway for `expected_revision`, `start` just picks; `--dry-run --json`
  reports which endpoint it chose.
  
  **Asking for the state you are already in is not an error.** `stop` on a stopped runtime reports
  `changed: false, reason: "already_in_state"` and sends nothing, which makes these safe in a script
  that cannot know the current state.
  
  **`status` is only reported once it is true.** Every transition is asynchronous and the API's response
  still carries the pre-transition status, so these poll until the target is observed. Under `--detach`
  the payload carries `waited: false` and `target_status` rather than presenting a stale status as the
  outcome. The payload is four fields, not the whole runtime object.
  
  Also adds `startRuntime`, `stopRuntime`, `pauseRuntime` and `resumeRuntime` to the spec — endpoints the
  published reference does not document at all — plus `waitUntilStatus`, `transitionAtCurrentRevision`
  and `wakeAction` in `@runta/core`.

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

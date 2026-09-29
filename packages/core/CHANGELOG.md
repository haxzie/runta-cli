# @runta/core

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @runta/api@0.7.0
  - @runta/utils@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies []:
  - @runta/api@0.6.1
  - @runta/utils@0.6.1

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

### Patch Changes

- Updated dependencies [[`3250a57`](https://github.com/haxzie/runta-cli/commit/3250a57cff78929f9708bdfcc61bf6c9678b6800)]:
  - @runta/api@0.6.0
  - @runta/utils@0.6.0

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

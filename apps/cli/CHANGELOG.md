# @runta/cli

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
  - @runta/core@0.6.0
  - @runta/utils@0.6.0

## 0.5.0

### Minor Changes

- [`db69746`](https://github.com/haxzie/runta-cli/commit/db69746041b584d3f05d6742b366dae06fb681b2) Thanks [@haxzie](https://github.com/haxzie)! - Add `runta-next upgrade`, which replaces the installed binary with a newer release.
  
  `upgrade` needs no credential — the releases are public — and nothing is replaced until the download
  is proven. It resolves the version from the `/releases/latest` redirect rather than the rate-limited
  GitHub API, verifies the asset's SHA-256 against the release's `checksums.txt` exactly as `install.sh`
  does, extracts it, and runs `--version` on the result before swapping anything. A 404, a checksum
  mismatch, an archive with no binary, or a binary that will not execute on this machine all leave the
  working install untouched.
  
  That `--version` step is worth more than it looks: the release workflow smoke-tests only the
  linux-x64 build, so for every other platform this is the first time that binary has run anywhere.
  
  The swap is a `rename` within the install directory, which is atomic and is also what makes replacing
  a *running* executable safe — the directory entry is repointed while the running process keeps its own
  inode. Writing over the file in place would fail with `ETXTBSY` on Linux.
  
  `--check` answers whether a newer version exists and exits 0 either way, so it is safe in a `set -e`
  script; read `.upgrade_available` from `--json` to branch. `--dry-run` prints the resolved plan without
  requesting the asset. `--to <version>` installs a specific version and can downgrade, which is the one
  case here that confirms first — skippable with `-y`, never prompted under `--json`.
  
  It refuses, with the path named, in a source checkout and where the binary or its directory is not
  writable.

### Patch Changes

- Updated dependencies []:
  - @runta/api@0.5.0
  - @runta/core@0.5.0
  - @runta/utils@0.5.0

## 0.4.1

### Patch Changes

- [`94563c0`](https://github.com/haxzie/runta-cli/commit/94563c050a7d9c3d2664cb4d6638bc6ea8dc6799) Thanks [@haxzie](https://github.com/haxzie)! - Cut releases from the commit being released.
  
  The release workflow decided which version to publish by reading `apps/cli/package.json` from the
  runner, immediately after `changesets/action` had run `pnpm run version` — which bumps every
  `package.json` in place, commits the result to `changeset-release/main`, and leaves the checkout on
  that branch. Both the working tree and `HEAD` therefore carried the *next* version, so the workflow
  published it from the *current* commit: `v0.4.0` was tagged at a tree whose own version was 0.3.0 and
  which lacked five later commits, and when the genuine 0.4.0 merged the tag already existed, so it was
  skipped and never shipped. The stranded `v0.1.0` has the same cause.
  
  It now reads the version from `$GITHUB_SHA`, which is fixed when the run starts and cannot be moved by
  a later step, and checks that commit out before compiling. That also makes the binary smoke test
  meaningful: comparing the binary's `--version` against the release only proves something if the binary
  was built from the released commit.
  
  This is the first release whose binaries contain the credential-aware `--help`; v0.4.0's predate it.
- Updated dependencies []:
  - @runta/api@0.4.1
  - @runta/core@0.4.1
  - @runta/utils@0.4.1

## 0.4.0

### Minor Changes

- [`3cc7f2a`](https://github.com/haxzie/runta-cli/commit/3cc7f2a91973ff1fac8e9cf49fad8045ca5a09e0) Thanks [@haxzie](https://github.com/haxzie)! - Point `--help` at a real docs site, and drop the `hello` command.
  
  The docs now build and deploy to <https://runta-cli.haxzie.com/docs> from the same `docs/` markdown
  the repo already carried, so there is one copy rather than two. Root help names the site, and names
  `/docs/llms-full.txt` in its "For agents:" section — an agent that reads `--help` can fetch the whole
  manual in one request instead of crawling rendered pages. A new tour page walks a single session
  from `login` through to teardown.
  
  `hello` is gone. It was a smoke test for the dev loop and had no reason to be in a shipped CLI.
  
  Also fixes five docs links that the `runta` → `runta-next` rename had rewritten to
  `runta-next.com`, a domain that does not exist; they point back at `runta.com` where Runta's own API
  reference actually lives.

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

- Updated dependencies [[`a359b60`](https://github.com/haxzie/runta-cli/commit/a359b606b742f45b8efc74a24bbea11f74a53ba3), [`7a31e6e`](https://github.com/haxzie/runta-cli/commit/7a31e6e7f910c5c55083723ac17ee9bcf777c554)]:
  - @runta/api@0.4.0
  - @runta/core@0.4.0
  - @runta/utils@0.4.0

## 0.3.0

### Minor Changes

- [`c5647b2`](https://github.com/haxzie/runta-cli/commit/c5647b2c1eaf24c6c3639ee2464faefbeec1db8f) Thanks [@haxzie](https://github.com/haxzie)! - Rewrite `runta-next --help`.
  
  Commands are grouped by what you are working on — runtimes, account, everything else — rather than
  listed in registration order, which stops being readable somewhere around eight commands. The output
  opens by telling a new user to run `login`, and closes with a short note for agents about `--json`
  and exit codes, plus worked examples.
  
  Only the root help changed; subcommand help is still generated by Commander from the real flags, so
  it cannot drift. The groups are checked against the registered commands by a test — a command
  belonging to no group fails the build, which is the same guard that keeps suggestions from naming
  commands that do not exist.
  
  Colour now comes from one shared rule in `@runta/utils` used by both the logger and the help, so
  `NO_COLOR`, `TERM=dumb` and non-terminal output behave identically everywhere rather than being
  decided separately in each place.

### Patch Changes

- Updated dependencies [[`c5647b2`](https://github.com/haxzie/runta-cli/commit/c5647b2c1eaf24c6c3639ee2464faefbeec1db8f)]:
  - @runta/utils@0.3.0
  - @runta/core@0.3.0
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
  - @runta/core@0.2.0
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

### Patch Changes

- Updated dependencies [[`20b1d48`](https://github.com/haxzie/runta-cli/commit/20b1d486201da564f4ba6b5a5c7a194b6cb8765c)]:
  - @runta/core@0.1.0
  - @runta/api@0.1.0
  - @runta/utils@0.1.0

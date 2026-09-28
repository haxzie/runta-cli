# @runta/core

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

# Runta CLI — Issues

Point-by-point findings from a hands-on audit of the shipped `runta` CLI.
Kept separate from [`FEEDBACK.md`](./FEEDBACK.md), which covers the web/product surfaces.

**Version:** `@runta/runta-cli` 0.2.10 (published 2026-09-24)
**Date:** 2026-09-25
**Surface:** `runta` CLI against production `https://api.runta.com`
**Method:** Installed via `npm i -g @runta/runta-cli` on macOS arm64 (node v22.22.3). Walked the
full command surface, then ran an authenticated live pass on a real tenant — created and destroyed
4 runtimes, 1 checkpoint, 2 secrets and 1 credential-injection rule, and verified the tenant was
returned to its starting state. Distribution and repo structure reconstructed from the published
npm packages, the Homebrew tap, and the shipped binary (the source repo is private).

## Summary

| # | Issue | Severity |
|---|-------|----------|
| [C-01](#c-01-runta-exec-fails-spuriously-about-10-of-the-time) | `runta exec` fails spuriously ~10% of the time | 🔴 blocker |
| [C-02](#c-02-runta-login-fails-on-every-clean-machine) | `runta login` fails on every clean machine | 🔴 blocker |
| [C-03](#c-03-the-login-poller-gives-up-and-destroys-its-own-recovery-path) | Login poller gives up on one transient error and deletes the pending login | 🔴 blocker |
| [C-04](#c-04-the-most-likely-runtime-error-is-unreadable) | `exec` on a stopped runtime → `websocket error: HTTP error: 409 Conflict` | 🔴 blocker |
| [C-05](#c-05-the-docs-describe-a-different-cli-than-the-one-that-ships) | Docs describe a different, much smaller CLI | high |
| [C-06](#c-06-runta-help---json-misreports-every-boolean-flag) | `runta help --json` misreports every boolean flag | high |
| [C-07](#c-07-inspect-shows-less-than-ps) | `inspect` shows less than `ps`; `ps --full` is a no-op on a TTY | high |
| [C-08](#c-08-no-human-readable-output-when-stdout-isnt-a-tty) | No way to get human-readable output off-TTY | high |
| [C-09](#c-09-no---dry-run-and-no-confirmation-anywhere) | No `--dry-run` and no confirmation on 8 destructive commands | high |
| [C-10](#c-10-egress-is-a-silent-replace-all-on-a-security-boundary) | `egress set` silently replaces the whole policy; empty lists unwarned | high |
| [C-11](#c-11-required_action-tells-agents-to-re-run-the-command-they-just-ran) | `required_action` tells agents to re-run the command they just ran | high |
| [C-12](#c-12-the-table-renderer-collapses-to-one-character-per-column) | Table renderer collapses to 1 char/column at zero winsize | high |
| [C-13](#c-13---publish-gives-you-a-port-but-never-a-url) | `--publish` gives you a port but never a URL | high |
| [C-14](#c-14-async-lifecycle-with-almost-no-wait-primitives) | Async lifecycle with almost no `--wait`, and a stale `status` | high |
| [C-15](#c-15-list-commands-give-no-control-over-how-much-they-fetch) | List commands give no control over how much they fetch | low |
| [C-16](#c-16-exec-buffers-all-output-inside-json-strings) | `exec` buffers all output inside JSON strings | high |
| [C-17](#c-17-runta-help-sub-prints-a-usage-line-you-cant-copy) | `runta help <sub>` prints an uncopyable usage line | medium |
| [C-18](#c-18-jq-hostile-json-shapes) | `jq`-hostile JSON shapes; no `request_id` | medium |
| [C-19](#c-19-cp-works-correctly-but-tells-you-nothing) | `cp` has no progress, silent overwrite, undocumented tar on `-` | medium |
| [C-20](#c-20-no-whoami-no-version-no-completions) | No `whoami`, no `version`, no shell completions | medium |
| [C-21](#c-21-interactive-login-doesnt-open-the-browser) | Interactive login doesn't open the browser | medium |
| [C-22](#c-22-response-payloads-are-wildly-over-verbose) | Lifecycle responses embed the entire 45-field runtime object | medium |
| [C-23](#c-23-describe-verbs-add-nothing) | `describe` verbs return no more than `list` | medium |
| [C-24](#c-24-internal-vocabulary-leaks-into-user-facing-output) | Internal field names leak into user-facing errors | medium |
| [C-25](#c-25-no_color-only-half-honoured-no---color) | `NO_COLOR` only half-honoured, no `--color` | medium |
| [C-26](#c-26-verb-and-convention-salad-across-84-commands) | `ls`/`list`, `rm`/`delete`, mixed boolean conventions, two id vocabularies | medium |
| [C-27](#c-27-human-output-polish) | Human-output polish (`is absent from the API`, silent waits, empty states) | low |
| [C-28](#c-28-distribution-and-packaging-gaps) | Distribution gaps: no Windows/Intel, missing `os` field, stale `next` tag | medium |
| [C-29](#c-29-the-npm-shim-flattens-signal-death-to-exit-1) | npm shim flattens signal death to exit 1 | low |
| [C-30](#c-30-the-official-agent-skill-documents-commands-that-dont-exist) | The official agent skill documents commands and flags that don't exist | 🔴 blocker |
| [C-31](#c-31-agent-discovery-costs-20k-tokens-and-cant-be-narrowed) | `runta help --json` costs ~20k tokens; no compact JSON, no narrowing | high |
| [C-32](#c-32-runta-sub---help-returns-the-entire-root-tree-in-json-mode) | `runta <sub> --help` returns the whole 78 KB root tree off-TTY | high |
| [C-33](#c-33---runtime-sign-in-reports-a-ready-runtime-whose-agent-cant-run) | `--runtime-sign-in` reports a ready runtime whose agent isn't logged in | high |
| [C-34](#c-34-the-runtime-argument-is-a-flag-on-two-commands-and-positional-on-34) | Runtime arg is a flag on 2 commands, positional on 34 | medium |
| [C-35](#c-35-no-published-openapi-document-so-every-client-is-hand-written) | No published OpenAPI document; API docs disagree with the live API in six places | high |
| [C-36](#c-36--an-ambiguous-runtime-name-silently-resolves-to-the-first-match) | An ambiguous runtime name silently resolves to the first match | high |
| [C-37](#c-37--vcpus-cannot-be-changed-after-creation-and-nothing-says-so) | vCPUs cannot be changed after creation, and nothing says so | medium |
| [C-38](#c-38--an-existing-claude-subscription-cannot-be-used-when-creating-a-runtime) | A connected Claude subscription cannot be used when creating a runtime | high |

---

## Agent readiness

The CLI is explicitly pitched at AI coding agents — the root help links the agent skills page, and
there is a published `SKILL.md` for Claude Code, Cursor and Codex. Assessed against that goal, using
this audit's findings:

**What's right, and is genuinely better than most CLIs:**

- `--json` is **implied when stdout isn't a TTY**, so an agent gets machine-readable output without
  knowing to ask for it.
- Errors use a stable envelope — `{ error: { code, kind, message, required_action } }` — with `code`
  as a real enum (`MISSING_TOKEN`, `NOT_FOUND`, `FAILED_PRECONDITION`, `ALREADY_EXISTS`,
  `EXEC_INCOMPLETE`, `INVALID_ARGUMENT`, …), so an agent can branch on `code` instead of
  pattern-matching prose.
- Exit codes are disciplined: `2` usage, `1` API error, and `exec` passes the remote status through
  verbatim (verified `0…255`).
- `runta help --json` exposes the entire command tree — the right idea, rare in CLIs.

**What blocks agent use today**, in order of how much damage it does:

| # | Issue | Why it hurts an agent specifically |
|---|---|---|
| C-01 | `exec` fails spuriously ~10% of the time | The agent cannot distinguish "the user's build broke" from "the websocket dropped mid-stream", so it either reports false failures or retries operations that may not be idempotent |
| C-30 | The official `SKILL.md` documents commands and flags that don't exist | The agent has no reason to doubt its own skill file, so it confidently runs `runta agents ls` and `--no-shell` and fails in front of the user |
| C-06 | `help --json` misreports every boolean flag's arity | Read literally — which is the whole point of a machine-readable contract — the agent writes `runta ps --all true` and errors |
| C-33 | `--runtime-sign-in` returns `status: running`, `degraded: false`, `error_code: null` on a runtime whose agent is logged out | The agent has no signal to check — not in `run`'s output, not on the runtime object — so it reports success on a runtime that cannot serve a single prompt |
| C-32 | `runta <sub> --help` silently returns the root tree off-TTY | The agent thinks it is reading one subcommand's contract and is reading the root's — and pays 78 KB to do it |
| C-09 | No machine-readable `--dry-run` | Removes the "resolve → show the user → execute" pattern; the agent must describe intent in prose |
| C-31 | Discovery costs ~19.6k tokens and can't be narrowed | A meaningful slice of the working context spent on formatting, before any work happens |
| C-16 | `exec` buffers all output into a JSON string | No incremental progress on long commands, and stdout/stderr interleaving is lost |
| C-11 | `required_action` points back at the command just run — **on `accepted: true` responses** | An agent has no reason to distrust a success payload, so it undoes its own `pause` and reports success at both steps |
| C-18 | Every list uses a different array key; no `request_id` | No generic accessor works across commands; failures aren't traceable to a support ticket |
| C-22 | Lifecycle responses embed all 45 runtime fields | ~346 tokens to learn that one state changed |
| C-04 | Raw `websocket error: HTTP error: 409 Conflict` | The agent can't explain the failure or recover from it; the cause ("runtime is shut down") is recoverable and knowable |

The through-line: the **shape** of the machine interface is good, but its **contract** (C-06, C-30,
C-32), its **reliability** (C-01), its **honesty about readiness** (C-33) and its **cost** (C-31,
C-22) are not yet at the level the positioning implies. C-06, C-30 and C-32 are the cheapest to fix
and would have the largest immediate effect, because all three are generated-artifact problems rather
than product design.

## Issues

### C-01 — `runta exec` fails spuriously about 10% of the time
_Severity: **blocker**._

`exec` is the most-used command in the CLI and it is not reliable. 50 invocations of trivially
successful commands against a healthy `running` runtime:

```console
# 30x  runta exec audit1 -- sh -c 'echo hi; exit 0'
ok=28  failed=2

# 20x  runta exec audit1 -- sh -c 'echo boom >&2; exit 42'
cli=42 cli=42 cli=1/EXEC_INCOMPLETE cli=42 cli=1/SDK cli=42 cli=42 cli=42 cli=42 cli=42
cli=42 cli=1/EXEC_INCOMPLETE cli=42 cli=42 cli=42 cli=42 cli=42 cli=42 cli=42 cli=42
```

**5 of 50 (10%) failed spuriously**, in two flavours:

```json
{ "action": "exec", "status": null,
  "error": { "code": "EXEC_INCOMPLETE",
    "message": "exec stream ended without an exit status: websocket error: WebSocket protocol error: Connection reset without closing handshake" } }
```
```json
{ "error": { "code": "SDK", "kind": "sdk",
    "message": "websocket error: IO error: Operation timed out (os error 60)" } }
```

In both cases `status` is `null` and the CLI exits `1` — so **a command that succeeded remotely is
reported to the caller as a failure**. Any CI pipeline or agent loop built on `runta exec` will fail
roughly every tenth step for no reason. This is the single most important item in this document.

**Correction (2026-09-26):** an earlier version of this finding said "there is no retry". That is
wrong. The binary contains `retrying exec WebSocket upgrade after service overload` and a
`runta_client_exec_connect_retry` counter, so the *upgrade* is retried on overload. What is not
retried is a reset **after** the stream is established — which is precisely the failure measured
above, `exec stream ended without an exit status`. The 10% rate stands; the cause is narrower than
first recorded. The binary also has a matching `.exec websocket closed before terminal status:`
message, so the case is recognised in code and simply has no recovery path.

When exit statuses *do* arrive they are exact — verified across `0, 1, 2, 5, 42, 127, 255`, each
propagated to the CLI's own exit code. The plumbing is right; the transport is not.

→ Extend the existing retry past the upgrade. Once a stream is established, allow re-attaching to
the same exec session — which needs a server-side exec id, so this is an API change, not only a
client one. Until that exists, distinguish "could not start" (already retried, safe to retry again)
from "started but lost the exit status" — and give the latter its own exit code rather than `1`, so
an unknown outcome is never silently reported as a command failure.

### C-02 — `runta login` fails on every clean machine
_Severity: **blocker**._

On a machine that has never run `runta`, the very first command the root help tells users to run
fails:

```console
$ ls -d ~/.config/runta
ls: /Users/haxzie/.config/runta: No such file or directory

$ runta login --no-wait
{ "error": { "code": "AUTH", "kind": "auth",
    "message": "failed to write config file '/Users/haxzie/.config/runta/config.login.json': No such file or directory (os error 2)" } }

$ mkdir -p ~/.config/runta && runta login --no-wait     # now works
{ "action": "login", "user_code": "H2ZR-68YG", … }
```

The CLI never creates its own config directory. The error gives no hint that `mkdir -p
~/.config/runta` fixes it, and because the write happens *after* the device authorization request
succeeds, a device code has already been minted server-side and thrown away.

→ `create_dir_all` the config directory (mode 0700) before the first write, on both the
`config.login.json` and `config.toml` paths.

### C-03 — The login poller gives up, and destroys its own recovery path
_Severity: **blocker**._

Production `POST /v2/auth/device/authorization`, 5 sequential calls (the `400`s are an empty test
body; the endpoint is otherwise healthy):

```console
400 0.314153s
520 8.438742s    # <-- Cloudflare 520, after an 8.4 s hang
400 0.312744s
400 0.300343s
400 0.380938s
```

The CLI has no retry, so ~1 in 5 logins dies before it starts:

```console
$ runta login --no-wait
{ "error": { "code": "AUTH",
    "message": "device authorization request failed: HTTP status server error (520 <none>) for url (https://api.runta.com/v2/auth/device/authorization)" } }
```

The **polling** phase is worse. A real interactive login, left waiting:

```console
$ runta login
Open this URL to authorize Runta CLI:
https://dashboard.runta.com/device?code=MQT4-PTGF

Code: MQT4-PTGF
Waiting for authorization…
error: device authorization request failed: error sending request for url (https://api.runta.com/v2/auth/device/token)
```

It abandoned the login on a single transport error. And it **deletes the pending state**, so
`--resume` — the documented recovery path — can no longer recover. After a `--no-wait` login plus a
retry loop on `runta login --resume --wait`, `~/.config/runta/config.login.json` was gone and only
this was left in `~/.config/runta/config.login.log`:

```json
{ "error": { "code": "AUTH", "message": "device authorization request failed: error sending request for url (https://api.runta.com/v2/auth/device/token)" } }
{ "error": { "code": "AUTH", "message": "device authorization failed: server returned 520 <unknown status code>" } }
```

Every subsequent `--resume` (58 attempts) then returned an internal filesystem error rather than a
user-facing one:

```json
{ "error": { "code": "AUTH",
    "message": "failed to read config file '/Users/haxzie/.config/runta/config.login.json': No such file or directory (os error 2)" } }
```

Net effect: a user can approve in the browser and still be told login failed, with no way back.

→ Retry the authorization request with backoff (3–5 attempts). In the poll loop, treat 5xx and
transport errors as retryable per RFC 8628 and only stop on `access_denied`, `expired_token`, or
`expires_at` — never delete the pending state on a transient error. Surface 520s as "Runta API is
having trouble, retrying…" instead of raw `reqwest` text, and include the server `request_id`.
Report "nothing to resume" as `NO_PENDING_LOGIN` with `required_action: runta login`, not as
`os error 2`.

### C-04 — The most likely runtime error is unreadable
_Severity: **blocker**._

`exec` against a shut-down runtime — overwhelmingly the most common error a user will hit:

```console
$ runta exec audit-restored -- true
{ "error": { "code": "SDK", "kind": "sdk",
    "message": "websocket error: HTTP error: 409 Conflict" } }
```

No runtime name, no mention that it's shut down, no `required_action`. Compare the genuinely good
sibling error:

```console
$ runta exec nosuchruntime -- true
{ "error": { "code": "NOT_FOUND", "message": "runtime 'nosuchruntime' was not found",
    "required_action": { "command": "runta ps -a --json", "type": "run_command" } } }
```

→ Map the 409 to `RUNTIME_NOT_RUNNING` — "runtime 'x' is shut down" with
`required_action: runta boot x`. More generally, no user-facing error should ever read
`websocket error: HTTP error: <code>`.

### C-05 — The docs describe a different CLI than the one that ships
_Severity: high._

`runta.com/docs/reference/cli/*` documents a 14-command CLI. The binary has **26 top-level commands
(plus `help`), 84 commands in total, 65 of them leaves**.

**Undocumented top-level commands:** `login`, `logout`, `ports` (alias `port-forward`), `image`,
`model-provider`, `github`, `tokens`, `ssh`, `vnc`, `runtime`, `tls`, `feedback` — plus *every*
global flag: `--endpoint`, `--token`, `--config`, `--json`, `-v/--verbose`, `-V/--version`. The
install page says configuration is `export RUNTA_TOKEN=rt...` and stops there; it never mentions
`runta login`, `~/.config/runta/config.toml`, `RUNTA_ENDPOINT` or `RUNTA_CONFIG`.

**Documented things that don't exist:**

| Docs claim | Reality |
|---|---|
| `runta egress set -f <file>` (YAML policy file) | No `-f/--file` flag; `--mode` is required |
| `runta secret rule set -f <file>` with a `rules:` YAML schema | No `-f/--file` flag |
| `--template` uses `${credential}`, incl. the worked example | **CLI requires `${secret}`** — see below |
| `runta secret rule describe <stub_id>` / `delete <stub_id>` | No `describe`; deletion is by `--host`/`--path` flags |
| `runta checkpoint ls --all` | `checkpoint ls` takes no arguments at all |
| `runta run --cpus` / `--memory` "Required" | Both optional; default to the Runtime Image recommendation |
| `runta resize --memory` only | Also has `--disk-size-gib` |

The template placeholder is the worst of these, because it's the docs' one worked example for
credential injection:

```console
$ runta secret rule set audit1 --secret audit-test-secret --host api.example.com \
    --path '/v1/*' --header Authorization --template 'Bearer ${credential}'
{ "error": { "code": "CLI", "message": "--template must contain ${secret} exactly once" } }

$ runta secret rule set … --template 'Bearer ${secret}'      # works
```

`runta secret rule set --help` correctly says `${secret}`, so only the docs are wrong.

**Documented but incomplete:** `ps --full`, `checkpoint create --kind {full,live,cold}`,
`run --image/--disk-size-gib/--ssh-key/--vnc/--secret-config-file/--wait/--timeout-secs`, all seven
`--llm-*` flags, `egress token-saving set`, `rm --wait/--timeout`.

→ `runta help --json` already emits the whole command tree with `about`, `args`, `possible_values`,
`aliases` and defaults. Generate the CLI reference pages from it in CI and this entire drift class
disappears permanently (`crates/runta/src/cli/help_json.rs` already does 90% of the work). Fix the
`${credential}` → `${secret}` error in the meantime, and have the error message show the corrected
form rather than just restating the rule.

### C-06 — `runta help --json` misreports every boolean flag
_Severity: high._

The machine-readable interface the root help points AI agents at:

```console
$ runta help --json | jq '.command.args[] | select(.id=="json")'
{ "id": "json", "long": "json", "value_names": ["JSON"],
  "possible_values": ["true","false"], … }
```

But `--json` is a bare flag:

```console
$ runta ps --json=false
{ "error": { "code": "USAGE",
    "message": "error: unexpected value 'false' for '--json' found; no more were expected\n\nUsage: runta ps --json\n" } }

$ runta ps --json false
{ "error": { "code": "UNKNOWN_ARGUMENT", "message": "error: unexpected argument 'false' found\n" } }
```

The same wrong metadata is on `-a/--all`, `--full`, `-i/--interactive`, `-t/--tty`, `--wait`,
`--no-wait`, `--resume`, `--detach`, `--install` and every `--llm-*` flag — i.e. **every boolean in
the CLI**. An agent that reads the JSON contract literally writes `runta ps --all true` and fails.
This directly undercuts the "install our agent skills" pitch.

→ Emit `num_args`/`takes_value` in `help_json.rs` and omit `value_names`/`possible_values` for
`ArgAction::SetTrue` flags. Add a snapshot test asserting no boolean arg advertises a value.

### C-07 — `inspect` shows less than `ps`
_Severity: high._

On a human terminal, `inspect` renders the **byte-identical five-column table as `ps`**:

```console
$ runta inspect audit1
╭──────────────────────────────────────┬────────┬─────────┬───────┬────────╮
│ ID                                   ┆ NAME   ┆ STATUS  ┆ VCPUS ┆ MEMORY │
╞══════════════════════════════════════╪════════╪═════════╪═══════╪════════╡
│ 01a0d9c1-042b-7172-9a00-95ed1dd1ea6d ┆ audit1 ┆ running ┆ 1     ┆ 512    │
╰──────────────────────────────────────┴────────┴─────────┴───────┴────────╯

$ runta ps          # identical output
```

The JSON for the same call has **45 fields** — `egress_policy`, `idle_policy`, `ingress_specs`,
`disk_size_gib`, `ssh_enabled`, `vnc_*`, `image_id`, `secret_configuration`,
`llm_token_saving_policy`, `created_at`/`updated_at`, `revision`, `degraded`, `error_code`. A
command whose one job is "Show detailed runtime information" shows a human none of them.

**`ps --full` has the same problem in reverse:** it adds every field in JSON and changes *nothing*
on a TTY — a silently no-op flag.

→ Render `inspect` as a sectioned key/value detail view, and make `--full` switch `ps` to a wide
table. This is the biggest human-facing output gap in the CLI.

### C-08 — No human-readable output when stdout isn't a TTY
_Severity: high._

`--json` is implied off-TTY (a good default) but cannot be turned off, so there is **no way to page,
`grep`, `tee`, or log the pretty table**:

```console
$ runta ps | less        # JSON
$ runta ps | grep demo   # JSON
$ runta ps > out.txt     # JSON
```

`--json=false` is rejected (C-06). Conversely there's no way to *force* JSON off for CI logs humans
read.

→ Add `-o/--output {table,json}` (default `auto`), keep `--json` as an alias for `-o json`, and
honour a `RUNTA_OUTPUT` env var so it can be pinned per-environment.

One error path also escapes the JSON envelope entirely:

```console
$ runta exec -it demo bash          # stdout is a pipe
error: interactive exec requires a TTY on stdin/stdout
exit 1
```

Plain text on a non-TTY, while every other error is JSON — so a wrapper doing `runta … | jq` gets a
parse error instead of a code. Route it through the same error envelope as `TTY_REQUIRED`.

### C-09 — No `--dry-run` and no confirmation anywhere
_Severity: high._

Zero occurrences of `--dry-run`, `--yes`, `-f/--force` or `--confirm` across the entire 84-command
surface. The destructive commands take effect immediately and silently:

| Command | What it destroys | Guard today |
|---|---|---|
| `runta rm <name>…` (variadic) | one or many runtimes | none |
| `runta checkpoint rm <name>` | a checkpoint | none |
| `runta secret delete <name>` | a tenant-wide secret value | none |
| `runta secret set <name>` | replaces an existing secret's value | none |
| `runta image delete <id>` | a private image | none |
| `runta egress set` | replaces the whole policy (see C-10) | none |
| `runta secret rule rm --host …` | matches by pattern, can remove more than intended | none |
| `runta ssh key rm` / `vnc credential revoke` | credentials | none |
| `runta cp` | overwrites files in both directions | none |

→ Two independent additions. **(a)** `--dry-run` on every mutating command, printing the resolved
plan in both human and JSON form — what would be created/changed/deleted, the effective defaults
(`run` without `--cpus` silently inherits the image recommendation and you currently cannot see what
you'd get without creating the runtime), and the resulting policy for `egress set` / `secret rule
set`. **(b)** Interactive confirmation on destructive commands when stdin is a TTY, with `--yes/-y`
to skip and automatic skip under `--json`/non-TTY so scripts are unaffected — "this will delete 3
runtimes: a, b, c".

**For agents specifically, the JSON half of (a) is the important half.** An agent's safe pattern is
"resolve the plan → show the user → execute", and without a machine-readable dry-run there is no
plan to show — the agent has to describe its intent in prose and hope the CLI agrees. This is the gap
the official agent skill (C-30) papers over by *instructing the agent* to ask for confirmation before
`rm` / `checkpoint rm` / `secret delete`: a safety property asserted in prose because the tool has no
primitive for it. `--dry-run --json` plus `--yes` would replace that instruction with something
enforceable.

### C-10 — Egress is a silent replace-all on a security boundary
_Severity: high._

All three of these are silent, instant and unguarded — verified live:

```console
# 1. Silent replace-all: --allow does not add, it replaces.
$ runta egress set audit1 --mode allowlist --allow example.com --allow '*.github.com'
    →  allowed_hosts: ["*.github.com", "example.com"]
$ runta egress set audit1 --mode allowlist --allow example.org
    →  allowed_hosts: ["example.org"]            # github silently gone

# 2. allowlist with no --allow = total network lockout, no warning
$ runta egress set audit1 --mode allowlist
    →  { "allowed_hosts": [], "mode": "allowlist" }
$ runta exec audit1 -- curl -s -m8 -o /dev/null -w '%{http_code}' https://example.org
    →  000                                        # everything blocked

# 3. denylist with no --deny = fully open, no warning
$ runta egress set audit1 --mode denylist
    →  { "denied_hosts": [], "mode": "denylist" }
```

And `egress list` renders the wide-open case in a way that reads as restricted:

```console
│ # ┆ RUNTIME        ┆ MODE     ┆ ALLOWED HOSTS ┆ DENIED HOSTS │
│ 1 ┆ audit-restored ┆ denylist ┆ -             ┆ -            │
│ 2 ┆ audit1         ┆ denylist ┆ -             ┆ -            │
```

Nothing there distinguishes "unrestricted internet access" from "locked down". For the feature whose
entire purpose is confining an agent's network access, that's the wrong default rendering.

Enforcement itself works correctly — allowed host returned 200, non-allowed returned 000.

→ Render the effective posture explicitly (`open — no restrictions` / `ALLOWLIST (2 hosts)` /
`LOCKED — no hosts allowed`). Add `--add-allow`/`--remove-allow` incremental forms alongside the
replace-all form. Require `--yes` or confirmation for the empty-list cases. Make `--dry-run` show a
before/after diff.

### C-11 — `required_action` tells agents to re-run the command they just ran
_Severity: high._

```console
$ runta resume audit1
{ "action": "resume", "accepted": true, "desired_status": "running",
  "required_action": { "command": "runta resume audit1 --json", "type": "run_command" }, … }
```

`resume` asks you to `resume`. `pause` also emits `required_action: runta resume audit1` — the
*undo*, presented as a required next step. An agent following `required_action` literally (which is
what the field is for, and what the root help advertises) will loop on `resume`, or immediately undo
its own `pause`.

**Independently reproduced on a second pass** (2026-09-26, `prequel-dev`), which sharpens the point:
the field arrives on a **successful** response, not an error one.

```console
$ runta pause prequel-dev
{ "accepted": true, "action": "pause", "desired_status": "paused",
  "required_action": { "command": "runta resume prequel-dev --json", "type": "run_command" }, … }
```

`accepted: true` and "you are required to resume it" in the same payload. This matters more than the
error-path case: an agent has no reason to inspect `required_action` sceptically on a success, so the
pause it was asked to perform is undone immediately, and both steps report success. Every lifecycle
verb tested behaves this way.

→ Reserve `required_action` for genuine blockers (auth, wait, precondition). Put informational
follow-ups in a separate `suggested_next` field. For async lifecycle actions, make the required
action a *wait*, not a repeat. At minimum, never emit `required_action` alongside
`accepted: true`.

### C-12 — The table renderer collapses to one character per column
_Severity: high._

When the terminal reports a zero winsize — routine in CI runners, under `script`, some container
`exec` paths, and cron-with-pty — every column is squeezed to 1 char and values print vertically,
one character per line:

```console
╭───┬───┬───┬───╮
│ # ┆ N ┆ P ┆ T │
│   ┆ A ┆ R ┆ T │
│   ┆ M ┆ E ┆ L │
│   ┆ E ┆ V ┆   │
│   ┆   ┆ I ┆   │
…
╞═══╪═══╪═══╪═══╡
│ 1 ┆ _ ┆ — ┆ 0 │
│   ┆ _ ┆   ┆   │
│   ┆ a ┆   ┆   │
…                     # 43 more rows, for one 58-char secret name
```

`COLUMNS=120` does **not** override it. At a real width the same table is perfect, and narrow widths
(40 cols) wrap sensibly — so this is purely a missing fallback.

→ Clamp detected width to a minimum of 80, and honour `COLUMNS` when the ioctl reports 0 or fails.
Consider truncating long values with an ellipsis rather than wrapping, so an id or name stays
copy-pasteable on one line.

### C-13 — `--publish` gives you a port but never a URL
_Severity: high._

`run --publish 8080/https` succeeds, and neither `run` nor `inspect` nor `ps` ever shows the
resulting URL. `inspect` reports only `ingress_specs: [{protocol: https, runtime_port: 8080}]`. The
URL exists and is deterministic — but only `ports ls` will tell you:

```console
$ runta ports ls audit1
│ https ┆ 8080 ┆ https://8080-01a0d9c1-042b-7172-9a00-95ed1dd1ea6d.runta.dev │
```

→ Print the URL in `run`'s output — it is the whole point of `--publish` — and include it in
`inspect` and `ps --full`.

### C-14 — Async lifecycle with almost no wait primitives
_Severity: high._

`--wait` exists on `run` and `rm` only. `pause`, `resume`, `shutdown`, `boot`, `resize`,
`checkpoint create` and `checkpoint restore` are all asynchronous and return immediately, so every
caller must hand-roll a polling loop against `inspect`.

Worse, the response echoes the **pre-transition** status next to the new desired status:

```console
$ runta pause audit1     →  "desired_status": "paused",  "runtime": { "status": "running", … }
$ runta resume audit1    →  "desired_status": "running", "runtime": { "status": "paused",  … }
```

So `runta resume x | jq -r .runtime.status` prints `paused`. And `checkpoint restore` straight after
`checkpoint create` fails, with no way to have waited:

```console
$ runta checkpoint restore audit-ckpt audit-restored
{ "error": { "code": "FAILED_PRECONDITION",
    "message": "checkpoint '01a0d9cd-…' is not ready (state: creating)" } }
```

(Good message — but no `required_action`, and no `checkpoint create --wait` to have avoided it.)

Re-confirmed on 2026-09-26: `pause`, `resume`, `shutdown` and `boot` still have **zero** occurrences
of `--wait` in their help. The absence is hard to justify on duration — `runta pause prequel-dev`
returned in 3.8 s and the runtime was already `paused` at the first poll 8 s later. A `--wait` here
would cost a few seconds, not minutes.

**A no-op is indistinguishable from a real transition.** Pausing an already-paused runtime returns the
same success payload as pausing a running one:

```console
$ runta pause prequel-dev     # already paused
{ "accepted": true, "action": "pause", "desired_status": "paused", … }
```

Idempotency is the right behaviour, but with `status` reporting the pre-transition value there is no
field anywhere in the response that distinguishes "I paused it" from "it was already paused" — so a
caller cannot tell whether it caused the state it observes.

→ Add `--wait`/`--timeout` uniformly to every async command. Either omit `status` from action
responses or return the post-transition value. Distinguish a no-op from a transition (a `changed:
false`, or `202` vs `200` semantics).

### C-15 — List commands give no control over how much they fetch
_Severity: low._

**Correction (2026-09-26):** this finding originally claimed lists "silently truncate at 100". That
was wrong, and it was the more serious half of the claim. The page size is hard-coded, but the CLI
does follow cursors — the binary contains `runtime page omitted its next cursor`, `checkpoint page
omitted its next cursor` and `runtime page repeated its next cursor`, all of which are diagnostics
emitted *while* walking pages. Results are complete. Downgraded from high to low accordingly.

What remains is a missing control. Every list request is built the same way:

```console
$ runta --endpoint http://127.0.0.1:9 ps             →  /v2/runtimes?limit=100&status=running,suspended
$ runta --endpoint http://127.0.0.1:9 ps -a          →  /v2/runtimes?limit=100
$ runta --endpoint http://127.0.0.1:9 checkpoint ls  →  /v2/checkpoints?limit=100
$ runta --endpoint http://127.0.0.1:9 egress list    →  /v2/runtimes?limit=100
```

There is no `--limit` and no way to ask for a single page. On a large tenant `runta ps` walks every
page before printing anything, with no way to say "just show me twenty" — and an agent paying per
token cannot cap the response size at all (see C-31).

Separately, and still worth fixing: plain `ps` filters to `status=running,suspended`, so a runtime
in a transitional state is **missing from `ps` moments after you create it** (hit live with a freshly
restored runtime). `ps -a` correctly drops the filter; `--full` does not.

→ Add `--limit N` that caps results rather than only the page size, and let `ps` include
transitional states or say that it is filtering.

### C-16 — `exec` buffers all output inside JSON strings
_Severity: high._

```console
$ runta exec audit1 -- sh -lc 'echo out; echo err >&2; uname -a'
{ "action": "exec", "command": "sh", "status": 0,
  "stdout": "out\nLinux runta 6.12.8+ #1 SMP … x86_64 GNU/Linux\n",
  "stderr": "err\n" }
```

Three consequences: nothing is shown until the command finishes, so a 10-minute build looks hung;
`runta exec … | grep` doesn't work without `jq -r .stdout`; and stdout/stderr interleaving is lost.

→ Stream by default, with `--json` producing NDJSON frames (`{"stream":"stdout","data":…}` then a
final `{"exit":N}`) and the buffered object behind an explicit flag. This also fixes the "no output
for 15 s" problem in `run --wait` (C-27).

### C-17 — `runta help <sub>` prints a usage line you can't copy
_Severity: medium._

```console
$ runta help ps
Usage: ps [OPTIONS]                    # wrong

$ runta ps --help
Usage: runta ps [OPTIONS]              # right

$ runta help checkpoint create
Usage: create [OPTIONS] <RUNTIME_NAME> <CHECKPOINT_NAME>    # badly wrong
```

The root help explicitly teaches `runta help run` / `runta help exec`, so this is the path most
users take, and it's the broken one — `runta help checkpoint create` tells the user to type
`create …`.

→ Render subcommand help with the full command path (propagate clap's `bin_name`, or render via
`Command::find_subcommand` on the built root).

Also in `<cmd> --help`: the global `--json` and `-v/--verbose` are sorted alphabetically **into** the
command's own options — in `run --help`, `--json` sits between `--cpus` and `--memory`. They belong
in a separate `Global options:` section.

### C-18 — `jq`-hostile JSON shapes
_Severity: medium._

- **Human help text is stuffed into `error.message` as one `\n`-escaped blob.** `runta` with no args
  returns a 3.4 KB JSON object whose `message` is the *entire* help screen. `MISSING_COMMAND` /
  `UNKNOWN_COMMAND` / `USAGE` errors are therefore unusable programmatically — the useful parts
  (unrecognized token, did-you-mean suggestion, expected values) are only available by
  string-parsing clap's rendering.
- **Every list uses a different array key** — `runtimes`, `checkpoints`, `secrets`, `images`, `keys`,
  `model_providers`, `secret_configuration`, `ports` — so no `jq '.items[]'` generalizes.
- **Success is keyed by `action`, errors by `error.code`**, with no single discriminator.
- **No `request_id` on RPC errors**, even though the API returns one (a direct `curl` gives
  `{"error":…,"request_id":"01a0d94d-…"}`). Bubbling it up would make support tickets tractable.
  A bad token yields only `"invalid bearer credential"` — indistinguishable from revoked, expired,
  or wrong-org.
- **`secret rule set` returns `"action": "secret-rule-list"`** — the wrong action name for a write.
- **`rm` per-item failures are pre-formatted strings** (`"error": "[NOT_FOUND] runtime 'x' was not
  found"`) instead of the structured `{code, message}` used everywhere else.

→ Add `error.details` with `{ invalid_arg, suggestion, expected_values }`; standardise list payloads
on a common key (or add `items`); add a top-level `ok`/`status` discriminator; bubble up
`request_id`; fix the `secret-rule-set` action name and structure `rm` sub-errors.

### C-19 — `cp` works correctly but tells you nothing
_Severity: medium._

Correctness is good: single files, nested directories and a 20 MB binary all round-tripped
byte-exact in both directions, and errors are clean (`source path does not exist: /tmp/nope.txt`;
`runtime 'nosuch' was not found` with a `required_action`). But:

- **No progress output at all.** The 20 MB upload printed one line, at the end. No bytes, no
  duration, no throughput — not in JSON either. Multi-GB transfers will look hung.
- **Silent overwrite in both directions**, no `-n`/`--no-clobber`, no `--dry-run`. A local file and a
  remote file were both overwritten without a word.
- **`cp <runtime>:/file -` emits a raw tar stream, not the file.** A 3-byte file produced a 10 KB
  padded tar on stdout. The `--json` help calls this "stream download"; nothing documents that you
  get an archive.

→ Add progress reporting (and `bytes`/`duration` in the JSON), a `--no-clobber` flag, and either make
single-file download to `-` emit raw bytes or gate the tar behaviour behind `--tar` and document it.

### C-20 — No `whoami`, no `version`, no completions
_Severity: medium._

- **No `runta whoami` / `auth status`.** There is `login` and `logout` but nothing that answers
  "which account, which org, which token, does it still work, when does it expire". The only way to
  test a credential is to run a real API call like `runta ps` and read the error. It's also a
  debugging blind spot: with `RUNTA_TOKEN` set, nothing tells you the env var is shadowing your
  `runta login` credential. Independently raised in a separate manual session (2026-09-26): no way to
  check whether you are logged in.
- **No `runta version` subcommand** — only `-V/--version`. `runta version` → `UNKNOWN_COMMAND` with
  no did-you-mean.
- **No shell completions.** `runta completions bash` / `completion bash` → `UNKNOWN_COMMAND`. For 65
  leaf commands, deep nesting (`runta secret rule set`) and opaque identifiers (runtime names,
  checkpoint names, image ids, key ids), completion is one of the highest-leverage wins available —
  `clap_complete` is a ~20-line addition, and dynamic completion of runtime names from `ps --json`
  would be a real differentiator.
- **No update check / `runta upgrade`.** With ~daily releases and a hand-pinned brew formula, users
  will silently sit on old versions.

→ Add `whoami` (account, org, token id, source, scopes, expiry, with `--json`), `version` as an alias
that also reports commit/build/platform/endpoint, `completions <shell>`, and a cached once-a-day
"newer version available" line on TTY output only.

### C-21 — Interactive login doesn't open the browser
_Severity: medium._

`runta login` on an interactive TTY prints the URL and then three copy-paste commands for macOS,
Linux and Windows — on a machine whose platform it already knows at compile time, and one of those
platforms has no binary at all (C-28):

```console
Open on the machine that owns the browser:
  macOS:   open 'https://dashboard.runta.com/device?code=MQT4-PTGF'
  Linux:   xdg-open 'https://dashboard.runta.com/device?code=MQT4-PTGF'
  Windows: start "" "https://dashboard.runta.com/device?code=MQT4-PTGF"
```

`gh auth login`, `wrangler login`, `vercel login` and `stripe login` all just open the browser.

Independently reproduced in a separate manual session (2026-09-26, code `ME6E-PTQY`) — same output,
same three-platform block, no browser opened.

→ When stdin/stdout is a TTY, open `verification_uri_complete` directly; print the URL as a fallback
and gate the three-platform block behind `--no-browser`, non-TTY, or `$SSH_CONNECTION`. Keep the code
visible either way. Also show the expiry countdown (`expires_at` is currently JSON-only), and have
`--no-wait` tell the caller that `runta login --resume --wait` is how you finish.

Two smaller login-hygiene items: the flow writes a zero-byte `config.login.log` into the *config*
directory (logs belong in `~/.cache/runta/` or `~/Library/Logs/`, and the config dir should be
`0700`; `config.login.json` is correctly `0600`), and `--wait`/`--no-wait` are a redundant pair on
both `login` and `github connect`.

### C-22 — Response payloads are wildly over-verbose
_Severity: medium._

`pause`, `resume`, `shutdown`, `boot`, `checkpoint restore`, `egress describe` and `egress set` all
embed the **entire 45-field runtime object**. `runta pause audit1` is ~50 lines of JSON to convey one
state change; `egress describe` returns 45 fields to show a 2-field policy. There's no `--quiet`/`-q`
and no field selection.

→ Return only what the action changed by default, with the full object behind `--full`; add `-q` for
just the id/name.

### C-23 — `describe` verbs add nothing
_Severity: medium._

`runta secret describe <name>` returns exactly the three fields `secret list` already showed
(`id`, `display_name`, `cache_ttl_secs`) — no `created_at`, no "which rules reference this", no
last-used. The `PREVIEW` column in `secret list` is `—` for every secret, always.

`checkpoint ls` has a matching gap: no `created_at` column and, more importantly, **no source
runtime** anywhere in the row or the JSON, so with a dozen checkpoints you cannot tell what each one
came from.

→ Make `describe` genuinely detailed (timestamps, referencing rules, last-used); either populate
`PREVIEW` or drop the column; add `created_at` and a source-runtime reference to checkpoints.

### C-24 — Internal vocabulary leaks into user-facing output
_Severity: medium._

```console
$ runta resize audit1 --memory 256
  "message": "invalid argument: min_memory_mib (256) must be >= 512"

$ runta resize audit1 --memory 0
  "message": "resources.requests.memory_mib must be >= 1"
```

The user typed `--memory`; the errors name `min_memory_mib` and a `resources.requests.memory_mib`
API path, and neither explains that the floor is the runtime's current memory. (`--disk-size-gib 8`
is handled much better, client-side: `invalid value '8' … 8 is not in 16..=256`.)

Also user-facing: `secret list` shows an internal `__agent_oauth_refresh_ce14fc04-…` entry;
`inspect` reports a fully populated `vnc_connection` block while `vnc_enabled` is `false`.

→ Translate API field names back to the flag the user typed, explain the bound, hide
internally-managed secrets from `secret list` (or mark them), and omit `vnc_connection` when VNC is
disabled.

### C-25 — `NO_COLOR` only half-honoured, no `--color`
_Severity: medium._

```console
$ NO_COLOR=1 runta ps            # (on a TTY, piped through cat -v)
^[[m^[[1merror:^[[0m not logged in: …      # colour dropped, BOLD kept
$ TERM=dumb runta ps
^[[38;5;9m^[[1merror:^[[0m not logged in: …  # TERM ignored entirely
```

→ `NO_COLOR` should suppress **all** SGR sequences; `TERM=dumb`/`TERM=` should too. Add
`--color {auto,always,never}` for the "piping to a file but I want colour" and "CI strips my colour"
cases.

### C-26 — Verb and convention salad across 84 commands
_Severity: medium._

Individually small, collectively the thing that makes the CLI feel unlearnable. Most of these are
backward-compatible alias additions.

**Listing is `ls`, `list` or `status`; deleting is `rm`, `delete`, `revoke`, `detach` or `clear`:**

| Group | List verb | Delete verb |
|---|---|---|
| `ports` | `ls` (alias `list`) | `rm` (alias `remove`) |
| `checkpoint` | `ls` (alias `list`) | `rm` |
| `image` | `ls` | `delete` (alias `rm`) |
| `egress` | **`list`** (no `ls`) | — |
| `secret` | **`list`** (no `ls`) | **`delete`** (no `rm`) |
| `secret rule` | `ls` (alias `list`) | `rm` (alias `delete`) |
| `model-provider` | `ls` (alias `list`) | **none — you cannot delete a model provider** |
| `github repo` | `ls` (alias `list`) | `rm` (alias `clear`) |
| `ssh key` | `ls` (alias `list`) | `rm` (alias `delete`) |
| `vnc credential` | `ls` (alias `list`) | **`revoke`** |
| `runtime ssh-key` | **`list`** (no `ls`) | **`detach`** |
| runtimes (top level) | `ps` | `rm` |

**Two boolean conventions for the same concept:** bare flags everywhere
(`--json`, `-a`, `--vnc`, `--llm-tool-io-capture`), but `on|off` values on
`egress token-saving set --json-array on|off` — which also duplicates the bare
`run --llm-token-saving-json-array` flag, so the same setting has two spellings depending on whether
you set it at create time or after.

**Two names for one timeout:** `run --timeout-secs <SECS>` vs `rm --timeout <TIMEOUT>` (unit
unstated).

**Two identifier vocabularies:** most commands take `<RUNTIME_NAME>`; `exec`, `inspect`, `shutdown`,
`boot`, `pause`, `resume`, `resize`, `rm`, `github configure` and `ssh` take `<VM_NAME>`; `vnc *` and
`runtime ssh-key *` take `<RUNTIME_ID>`. "VM" is internal vocabulary that appears nowhere in the
product docs, and the id-vs-name split is invisible until a command rejects your input.

**Two overlapping SSH-key trees:** `runta ssh key {add,ls,rm}` (tenant keys) and
`runta runtime ssh-key {list,attach,detach}` (per-runtime binding) — different concepts, near-identical
names, different verbs.

**Reversed argument order between paired commands:**

```console
runta checkpoint create  <RUNTIME_NAME> <CHECKPOINT_NAME>
runta checkpoint restore <CHECKPOINT_NAME> <RUNTIME_NAME>
```

Same two free-form positional names, opposite order — so a typo is a *valid-looking* command.

**`runta egress` ships a typo alias `egerss`** — charming, but undiscoverable and inconsistent (no
such kindness for `secrets`, `checkpoints` or `iamge`), and did-you-mean already covers the case.

**`checkpoint create --kind {full,live,cold}`** has `[default: full]` and no explanation of what the
three mean — for a feature whose whole value proposition is state fidelity.

**`image build --arch` accepts only `x86_64`.** Runtimes are in fact x86_64 (`uname -a` inside one
reports `Linux runta 6.12.8+ … x86_64`), so the single value is consistent today — but a flag with
exactly one possible value is noise until arm64 exists.

→ Every list gets both `ls` and `list`; every removal gets `rm` plus its domain verb as an alias; add
the missing `model-provider delete`. Pick one boolean convention (`--flag` / `--no-flag`) and alias
the rest. Standardise on `--timeout <DURATION>` accepting `30s`/`5m`. Standardise the placeholder on
`<RUNTIME>` and accept name *or* id everywhere. Make `checkpoint restore` take `--into <RUNTIME>` so
the two positionals can't be swapped. Document `--kind`.

### C-27 — Human output polish
_Severity: low._

| Where | Now | Should be |
|---|---|---|
| `rm --wait` success | `Runtime 'audit1' is absent from the API.` | `Deleted runtime 'audit1'.` |
| `run --wait` | 15 s of total silence, then one line | spinner/status, then the URL and a `runta exec` hint |
| `run` (any) | never prints the runtime id or URL | print both |
| `pause`/`shutdown` | `(status: running)` — the *old* status | `(now: paused)` |
| Empty states | `ps` and `checkpoint ls` say `No runtimes found.`; `image ls` and `secret list` print an empty bordered table with headers only | one consistent style, plus a next-step hint (`runta run --name demo`) |
| `secret rule ls` | bare line `audit-test-secret  header Authorization on api.example.com/v1/*` | a table, like every other list |
| `--verbose` | "repeat for trace logging" — doesn't say where output goes or whether it may contain tokens | state the stream, and whether `-vv` output is safe to paste into an issue |

### C-28 — Distribution and packaging gaps
_Severity: medium._

Reconstructed from the published artifacts (the source repo is private):

```
crates/runta/                  # the CLI (clap, tokio, reqwest, rustls, tokio-tungstenite 0.28)
  src/main.rs  cli.rs  cli/help_json.rs  handlers.rs  output.rs
  auth.rs  interactive.rs  ssh.rs  runtime_list.rs  checkpoint_list.rs  run_image.rs
crates/runta-api-client/       # src/session.rs  tls.rs  transfer.rs
  src/client/{runtimes,checkpoints,images,secrets,github,tokens,streams,http,pagination}.rs
crates/runta-transfer-core/    # `runta cp` engine — src/{archive,plan,transfer}.rs
packing/npm/cli/               # @runta/runta-cli     (2.2 KB wrapper)
packing/npm/darwin-arm64/      # runta-darwin-arm64   (13.3 MB binary)
packing/npm/linux-x64/  packing/npm/linux-arm64/
```

| Gap | Impact |
|---|---|
| **No Windows binary at all** — not on npm, not on brew | The shim's own error names only "macOS arm64 and Linux x64/arm64", yet the login flow prints a `start "" "…"` Windows hint for a platform that can't run the CLI |
| **No darwin-x64** (Intel Mac) | Brew `odie`s; npm shim errors at first run |
| `@runta/runta-cli` declares `cpu: ["x64","arm64"]` but **no `os` field** | npm happily installs on Windows/FreeBSD and defers the failure to first run; adding `"os": ["darwin","linux"]` makes it an install-time error |
| **Stale dist-tag**: `next` → `0.1.5` while `latest` is `0.2.10` | `npm i @runta/runta-cli@next` silently installs a very old CLI |
| `license: "UNLICENSED"` on all four public npm packages | npm shows a licence warning; `license-checker` flags it in downstream CI |
| **Binary not stripped** — 28,297 symbols and full `.cargo` panic paths | 13.3 MB unpacked; `strip` would cut a meaningful slice off `npx`/CI cold installs |
| Version hand-pinned in 4 npm packages **plus** `Formula/runta.rb`, releases ~daily (v0.2.3 → v0.2.10 in 16 days) | nothing enforces that the five stay in sync |
| No published provenance/SBOM | `npm publish --provenance` is a one-line CI change |

Good: the macOS binary is **properly signed and notarized** (`Developer ID Application: Runta inc
(4J499G24H7)`, hardened runtime, `spctl` → `source=Notarized Developer ID`) and links only against
system frameworks. The undocumented `RUNTA_NPM_PLATFORM` / `RUNTA_NPM_ARCH` overrides are useful for
cross-platform CI images and worth documenting. `RUNTA_INGRESS_BASE_URL` exists in the binary but is
documented nowhere.

→ Ship or explicitly document the absence of Windows and Intel-Mac builds; add the npm `os` field;
strip the binaries; fix the `next` tag; add provenance and a real licence; drive all five version
pins from one source in CI.

### C-29 — The npm shim flattens signal death to exit 1
_Severity: low._

```js
const result = childProcess.spawnSync(binary, process.argv.slice(2), { stdio: "inherit", … });
process.exit(result.status === null ? 1 : result.status);
```

If the binary is killed by `SIGINT`/`SIGTERM`, `result.status` is `null` and `result.signal` is
ignored, so the shim exits `1` instead of the conventional `128 + signo` (130 for Ctrl-C) — scripts
can't special-case "user cancelled". Separately, a whole node process is interposed on every
invocation (~30–40 ms and a second PID) purely to `spawnSync` a native binary.

→ Exit `128 + signo` when `result.signal` is set. Consider pointing `bin` straight at the platform
package's binary via a `postinstall` symlink, or use `execve` semantics, to drop the node hop.

---

### C-30 — The official agent skill documents commands that don't exist
_Severity: **blocker**._

`/docs/reference/agent-skills/runta-cli/` ships a `SKILL.md` that Claude Code, Cursor and Codex load
as ground truth. It is substantially wrong — this is worse than C-05, because an agent reading it has
no reason to doubt it and will confidently run commands that cannot work:

| Skill says | Reality |
|---|---|
| `runta agents ls` | **No `agents` command exists.** `error: unrecognized subcommand 'agents'` (did-you-mean offers `image`) |
| `runta run --name pi-agent --agent pi --no-shell` | **Neither `--agent` nor `--no-shell` exists** — 0 matches across all 84 commands |
| `runta egress set -f policy.yaml` | **No `-f`.** `error: unexpected argument '-f' found` |
| `runta secret rule list --runtime demo` | **No `--runtime` flag.** It's `runta secret rule ls <RUNTIME_NAME>` (positional) |
| `runta secret rule delete <stub_id>` | **No `delete`, no stub ids.** It's `runta secret rule rm --host <HOST> --header <HEADER> <RUNTIME_NAME>` |
| `--template 'Bearer ${credential}'` | CLI requires `${secret}` (see C-05) |
| "`runta run` requires `--cpus` and `--memory`" | Both are optional |

It also never mentions `runta login` (the skill tells agents to set `RUNTA_TOKEN`, so an agent will
never suggest the interactive path a human needs) and never mentions `--json` — the single most
important flag for an agent, and the one that makes every output machine-readable.

What it gets right is worth keeping: "verify uncommon flags with `runta <command> --help`", "require
explicit user confirmation before `runta rm` / `runta checkpoint rm` / `runta secret delete`", and
"keep tokens out of logs and source control". The confirmation rule is the CLI compensating in prose
for the missing `--yes`/confirmation primitives in C-09 — an agent is asked to enforce a safety
property the tool doesn't support.

→ Generate `SKILL.md` from `runta help --json` in CI, the same way the docs reference should be
(C-05), so it cannot drift. Add a CI check that every command and flag quoted in the skill parses
under `runta <cmd> --help`. Document `--json`, `runta login`, and the fact that `--json` is implied
off-TTY. Replace the "ask for confirmation" rule with real `--dry-run`/`--yes` support and tell the
agent to use it.

### C-31 — Agent discovery costs ~20k tokens and can't be narrowed
_Severity: high._

The root help tells agents `runta help --json` is the way to discover commands. Measured payload
sizes (tokens ≈ bytes/4):

| Command | Bytes | ≈ Tokens |
|---|---|---|
| `runta help --json` | 78,370 | **~19,600** |
| `runta help run` | 7,422 | ~1,855 |
| `runta` (no args) | 3,409 | ~852 |
| `runta inspect <rt>` | 1,337 | ~334 |
| `runta pause <rt>` | 1,384 | ~346 |
| `runta egress describe <rt>` | 1,344 | ~336 |
| `runta ps` (1 runtime) | 257 | ~64 |
| `runta exec <rt> -- true` | 430 | ~107 |

So the advertised discovery step burns roughly 20k tokens — a meaningful slice of a working context —
in a single call, and there is no way to ask for less. Three compounding causes:

1. **No compact JSON.** Everything is pretty-printed with 2-space indent. Re-serialising the same
   payloads compactly saves **54% on `help --json`** (78,370 → 36,777 bytes, ~19.6k → ~9.2k tokens)
   and **23% on `inspect`**. There is no `--json-compact` / `--compact` flag.
2. **No way to narrow `help --json`.** It's all-or-nothing — no `--depth 1` for just the top-level
   command list, no filtering to one subtree beyond the already-large per-command form.
3. **No field selection on data commands** (C-22). `runta inspect` returns 31 fields / ~334 tokens
   when an agent almost always wants 5 (`id`, `name`, `status`, `vcpus`, `memory` = 126 bytes). Every
   lifecycle call — `pause`, `resume`, `boot`, `shutdown` — pays the same ~346 tokens to convey one
   state change.

→ Add `--compact` (or make `--json` compact off-TTY and pretty on-TTY, matching the existing
TTY-detection logic). Add `runta help --json --depth 1` for a cheap command index. Add
`--fields id,status` or `-q` on data commands. Together these would cut typical agent context use by
roughly half.

---

### C-32 — `runta <sub> --help` returns the entire root tree in JSON mode
_Severity: high._

On a TTY, `--help` works correctly at every level — `runta image --help` prints the `image` about
line, its three subcommands and its examples. Off-TTY, where `--json` is implied, the same command
returns the **root** command tree instead of the requested node:

```console
$ runta image --help | jq -r '.command.name'
runta                       # expected: image

$ runta help image | jq -r '.command.name'
image                       # correct

$ runta image --help | wc -c
78370
$ runta help image  | wc -c
3100
```

Reproduced identically on `image`, `github`, `ssh`, `vnc credential` and `secret rule` — every
subcommand level, not just the top. So the two help forms agree on a TTY and disagree off it, and
the only correct off-TTY form (`runta help <sub>`) is the one a human would never reach for.

This compounds [C-31](#c-31-agent-discovery-costs-20k-tokens-and-cant-be-narrowed) rather than
merely duplicating it: an agent trying to *narrow* its discovery cost by asking for one subcommand
gets 78 KB — 25× the 3.1 KB it asked for, and ~4× the whole-tree cost it was trying to avoid. It also
silently answers a different question than the one asked, which is worse than being expensive: the
agent believes it is reading `image`'s contract and is in fact reading the root's.

This is how I mis-audited the CLI in this very session. `runta image --help` returned the root node,
I read its `args` as `image`'s, and concluded per-subcommand `--help` was unimplemented. It isn't.

→ Make `--help` at any level return that level's node in JSON, exactly as it does on a TTY.

### C-33 — `--runtime-sign-in` reports a ready runtime whose agent can't run
_Severity: high._

`runta run --image claude` refuses without a model provider, and points at three escapes — one of
which, `--runtime-sign-in` ("Configure provider authentication inside the Runtime"), succeeds:

```console
$ runta run --image claude --name prequel-dev --runtime-sign-in --wait --timeout-secs 240
{ "accepted": true, "runtime": { "status": "running", "degraded": false, "error_code": null, … } }
```

The runtime is genuinely up — `exec` works, `git clone` works, `claude` is on `PATH` at v2.1.234.
But the one thing the image exists to do doesn't:

```console
$ runta exec prequel-dev -- bash -lc 'claude -p "Reply OK"'
Not logged in · Please run /login
```

Nothing anywhere signals this. `run` prints no follow-up instruction; the 45-field runtime object has
no sign-in field, `secret_configuration` is `[]`, `status` is `running`, `degraded` is `false` and
`error_code` is `null`. So the pending login is invisible to `inspect`, invisible to `ps`, and
invisible in the output of the flag that created it. The flag's help text promises configuration it
does not perform.

The cost is worst for the audience the image is for. An unattended agent has every reason to report
success here: it asked for a Claude runtime, got `status: running` with no error, and only discovers
otherwise if it happens to probe the agent binary — and even then `claude -p` exits **0** while
printing `Not logged in`, so an exit-code check passes too. The honest recovery needs a human at a
terminal:

```console
$ runta exec prequel-dev --interactive --tty -- bash -lc 'claude'    # then /login
```

→ Either complete the sign-in (device-code handoff, as `runta login` already does well) or state
plainly in `run`'s output that the runtime is up but authentication is pending, with that exact
command as the next step. Surface the state on the runtime object so `inspect` can be trusted, and
consider `degraded: true` until an agent runtime can actually reach a model.

### C-34 — The runtime argument is a flag on two commands and positional on 34
_Severity: medium. Extends [C-26](#c-26-verb-and-convention-salad-across-84-commands)._

Walking the full tree (`runta help --json`, 26 top-level commands, 60 leaves) and classifying every
argument whose help is "Runtime name or ID": **34 take it as a required positional, 2 take it as an
optional flag.**

```console
$ runta exec --help           | grep Usage
Usage: runta exec [OPTIONS] <VM_NAME> [COMMAND_AND_ARGS]...
$ runta tokens analyze --help  | grep Usage
Usage: runta tokens analyze [OPTIONS]        # --runtime <RUNTIME>, optional
$ runta tokens savings --help  | grep Usage
Usage: runta tokens savings [OPTIONS]        # --runtime <RUNTIME>, optional
```

`tokens analyze` and `tokens savings` are the only two, and they differ twice over — flag rather than
positional, optional rather than required. The optionality is defensible (both default to every
runtime), but it means "the runtime I am targeting" is typed one way in 34 places and another way in
2, with nothing marking the exception.

**Naming a *new* runtime is inconsistent the same way.** Two commands create a runtime and name it:

```console
runta run              [OPTIONS]                              # --name <NAME>, optional
runta checkpoint restore <CHECKPOINT_NAME> <RUNTIME_NAME>      # positional, required
```

`checkpoint restore`'s second positional is documented as "Name for the restored runtime" — the same
concept as `run --name`, opposite shape, opposite optionality. C-26's proposed
`checkpoint restore --into <RUNTIME>` fixes the swap-a-typo hazard; `--name` would additionally make
the two creation paths match.

**`--name` carries four meanings**, two of them behind a different argument id:

| Command | Means | arg id |
|---|---|---|
| `run --name` | name of the new runtime | `name` |
| `image build --name` | name of the image | `name` |
| `ssh key add --name` | human label for a key | `display_name` |
| `vnc credential create --name` | human label for a credential | `display_name` |

The last produces `runta vnc credential create --name <DISPLAY_NAME> <RUNTIME_ID>` — a required flag
ahead of the positional subject it belongs to.

For the record, two things that look like this class of problem and are not: `runta run --name` vs
`runta github configure <VM_NAME>` is *not* an inconsistency (one names a new runtime, the other
references an existing one), and `runta model-provider authorize` — which the missing-provider error
recommends — does exist, as a documented alias of `create`.

→ Give `tokens analyze|savings` an optional positional alongside `--runtime`. Add
`checkpoint restore --name` as C-26's `--into`. Rename the two `display_name` flags to
`--display-name`, keeping `--name` as an alias.

### C-35 — No published OpenAPI document, so every client is hand-written
_Severity: high._

The API reference states the underlying spec is **OpenAPI 3.0.3**, so a machine-readable
description exists internally. It is not served anywhere. Every plausible URL 404s:

```console
https://api.runta.dev/openapi.json                 404
https://api.runta.com/openapi.json                 404
https://api.runta.com/v2/openapi.json              404
https://api.runta.com/docs/openapi.json            404
https://runta.com/openapi.json                     404
https://runta.com/docs/reference/api/openapi.json  404
```

For anyone integrating, that means the 85 documented operations have to be transcribed by hand from
HTML pages into a spec before a typed client can be generated — and then maintained by hand forever,
with no way to diff against the source of truth when the API moves. Publishing the file Runta already
has is close to zero work and removes that entire class of effort for every consumer.

It also makes the C-05 drift invisible. Transcribing the docs rather than probing the live API
produces a **wrong** client — six divergences found while describing just the four auth/identity
operations:

| # | Docs say | Live API does |
|---|---|---|
| 1 | `request_id` is a field inside `error` | `request_id` is a **sibling** of `error`; `error` holds only `code` and `message`. Confirmed on `/v2/runtimes/{id}`, `/v2/secrets/{id}`, `/v2/checkpoints/{id}`, `/v2/me` |
| 2 | 401 covers "missing, malformed, or rejected" token | Missing credential → **403**; rejected token → 401 |
| 3 | `POST /v2/auth/device/authorization` has no 400 | Returns **400** for every body validation failure |
| 4 | (nothing about pagination) | List responses include `pagination: {next_cursor, has_more}` beside `data` |
| 5 | Errors are JSON | The no-credential 403 is the bare **text** `Unauthenticated`, no JSON, no `content-type: application/json` — and the body says "Unauthenticated" while the status says 403 |
| 6 | `--template` placeholder is `${credential}` | Requires `${secret}` (also C-05) |

Two further inconsistencies that are real behaviour rather than doc bugs, but which a generated spec
would at least make visible:

- **The success envelope is not uniform.** `POST /v2/auth/device/authorization` and `GET /v2/me` wrap
  their payload in `data`; `POST /v2/auth/device/token` does not.
- **`POST /v2/auth/device/token` returns a different error shape at 400** — `error` is a bare RFC 8628
  string (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`) rather than the
  object used everywhere else, so a client must branch on the status code before parsing `error`.

Validation errors also leak Rust serde internals to the caller:

```console
$ curl -X POST -H 'content-type: application/json' -d '{"client_id":"nope"}' \
    https://api.runta.com/v2/auth/device/authorization
{"error":{"code":"invalid_argument","message":"Couldn't parse body parameter BeginDeviceAuthorizationRequest - doesn't match schema: unknown variant `nope`, expected one of `runta_cli`, `runta_agent`, `runta_crew` at line 1 column 19"},"request_id":"…"}
```

Useful content, wrong packaging — the caller gets an internal type name and a byte offset instead of a
field path and an allowed-values list.

→ Serve the existing spec at a stable URL (`https://api.runta.com/openapi.json`) and generate both the
reference pages and the agent skill from it (C-05, C-30). Fix the six divergences above — #1 and #2 are
the ones that silently corrupt hand-written clients, because the error code, message and request id all
end up empty. Give validation errors a structured `error.details` with the field path and permitted
values instead of serde's rendering.

One more gap worth noting while the API surface is in view: the reference documents **22 Cloud Agents
operations** under `/v2/agents` that the CLI exposes no commands for at all — while the official agent
skill documents a `runta agents ls` that doesn't exist (C-30). The API is ahead of the CLI here, and a
published spec would make that gap obvious rather than something you find by reading both by hand.

---

## Confirmed working

Worth stating explicitly — these were verified live and are solid:

- **Checkpoint fidelity.** A marker file written to `/root` before `checkpoint create` was present in
  the runtime restored from that checkpoint. Restore also honoured `-p 8080/https`.
- **`cp` correctness** — nested directories and a 20 MB binary, both directions, byte-exact.
- **Egress enforcement** genuinely works (allowed host → 200, everything else → 000).
- **Exit codes are disciplined**: `2` for usage/validation, `1` for API errors, and `exec` passes the
  remote status through verbatim across `0…255`.
- **Argument validation is good where it exists**: mutually-exclusive required groups
  (`<--value-env|--value-stdin|--prompt>`), `--allow cannot be used with --mode denylist; use --deny
  hosts instead`, clap range checks that include `required_arguments` in the JSON error.
- **Did-you-mean works**: `runta iamge` → `tip: a similar subcommand exists: 'image'`.
- **`NOT_FOUND` errors** carry a useful `required_action` (`runta ps -a --json`).
- **The unauthenticated error is excellent** — `MISSING_TOKEN` / "not logged in: run `runta login` to
  authorize this agent" with a `required_action`, and a TTY variant that adds "for non-interactive
  automation, set RUNTA_TOKEN". (Only nit: the JSON branch drops that second half — exactly the
  audience that needs it.)
- **The root help is better than most CLIs** — real "Getting started", a "Discover commands" block, an
  explicit automation paragraph, and a pointer to the agent skills.
- **`runta help --json` exposing the whole command tree** is genuinely rare and valuable — it just
  needs the arity bug in C-06 fixed.
- **Tables are attractive and readable** at a real terminal width.

### C-36 — An ambiguous runtime name silently resolves to the first match
_Severity: high._

Every runtime-taking command documents its positional as "Runtime name or ID", and the API accepts
only a UUID (`runtime_id must be a UUID`), so the CLI resolves names itself by listing and matching.
The resolution is sound in the ways that usually go wrong — it short-circuits a UUID without listing,
and it does follow cursors past the first page — but it does not check whether the name it matched
was unique.

Probed by pointing `--endpoint` at a local server returning two runtimes that share a display name:

```console
$ runta --endpoint http://127.0.0.1:8801 inspect my-name
  → GET /healthz
  → GET /v2/runtimes?limit=100          # returns aaaaaaaa-… and bbbbbbbb-…, both "my-name"
  → GET /v2/runtimes/aaaaaaaa-…         # picked the first, said nothing
$ echo $?
0
```

`rm` behaves the same way, which is where it stops being cosmetic:

```console
$ runta --endpoint http://127.0.0.1:8801 rm my-name
{"action":"rm","ok":true,"results":[{"accepted":true,"error":null,"ok":true,
  "runtime_name":"my-name","status":"delete_requested"}]}
  → DELETE /v2/runtimes/aaaaaaaa-…?expected_revision=3
```

Two runtimes match, one is deleted, `ok` is `true`, and nothing in the output distinguishes this from
an unambiguous delete. Note the result names `runtime_name` and never the id, so even reading the JSON
afterwards does not tell you which of the two is gone — the only way to find out is to list again and
see which survived. `rm` has no `--dry-run` and no confirmation prompt
([C-09](#c-09-no---dry-run-and-no-confirmation-anywhere)), so there is no step at which a
human could have noticed.

Nothing in the API reference marks `name` as unique, and `create` assigns a random name only when
omitted — so two runtimes sharing a name is a state a user can reach by passing `--name` twice, or by
restoring a checkpoint alongside its original.

→ Fail on an ambiguous name and list the candidate ids, rather than picking one. At minimum, echo the
resolved id in the result so the action is auditable after the fact.

**How ours differs.** `resolveRuntimeId` collects every match and routes them through a shared
`pick()` helper, so an ambiguous name is an error naming the candidates, and the exit code says so:

```console
$ runta-next inspect my-name
error Runtime name 'my-name' is ambiguous — 2 of them share it.
Use an id instead: aaaaaaaa-0000-4000-8000-000000000001, bbbbbbbb-0000-4000-8000-000000000002
$ echo $?
1
```

Verified against the same local server in the same session: official exits `0` and acts, ours exits
`1` and refuses.

### C-37 — vCPUs cannot be changed after creation, and nothing says so
_Severity: medium._

`run` takes `--cpus`, and `resize` cannot change it:

```console
$ runta help resize
  --memory <MIB>           New memory size in MiB
  --disk-size-gib <GIB>    New writable overlay capacity in GiB
```

Searching the whole command tree, `--cpus` exists on exactly one command out of 65 leaves:

```console
$ runta --help --json | jq '.. | .args? // [] | .[] | select(.long == "cpus")'
  run: --cpus — Number of vCPUs (uses the Runtime Image recommendation when omitted)
```

**This is an API limitation, not a missing flag.** `resize` is not its own endpoint — probing shows it
is a `PATCH /v2/runtimes/{id}`, the general runtime update — and that operation does not accept a CPU
count. Two independent sources agree:

- The REST reference for `PATCH /v2/runtimes/{runtime_id}` describes `resources.requests` as exactly
  `memory_mib` and `disk_gib`. Its own worked example sends
  `"resources":{"limits":{"memory_mib":1},"requests":{"memory_mib":1,"disk_gib":1}}` — no `vcpus`.
  `vcpus` *is* in the 200 response, marked required, so it is readable and not writable.
- The generated Python SDK types are `PatchRuntimeResourceRequests(memory_mib=None)` — one field —
  against `CreateRuntimeResourceRequests(memory_mib=1024, vcpus=1)`, where `vcpus` is documented as
  the "Initial requested virtual CPU count".

So the CLI could not offer `resize --cpus` even if it wanted to. The defect is the **silence**:

- Nothing in the API reference marks `vcpus` immutable. It is absent from the patch body, and absence
  is not a statement. The word "Initial" in the create-side description is the only hint.
- `resize --help` does not say why CPU is missing from a command whose whole job is changing
  resources, so it reads as an oversight rather than a boundary.
- `inspect` prints vCPUs beside memory with nothing to distinguish the field you can change from the
  one you cannot.
- `run --cpus` accepts a number with no indication it is a permanent choice, and the default is
  "uses the Runtime Image recommendation" — so a user who never passes it does not know a decision was
  made on their behalf.

The consequence is a dead end with an expensive exit. Under-provision CPU and the only remedy is to
destroy the runtime and create a new one — on a product whose value is long-lived stateful runtimes,
that means restoring from a checkpoint at best, and losing uncommitted work at worst. A user discovers
this at exactly the wrong moment: when something is already too slow.

→ Say it where the decision is made and where it is reverse-engineered. `run --cpus` should note that
vCPUs are fixed for the runtime's life; `resize --help` should say CPU cannot be changed and point at
recreate-from-checkpoint; and `resize --cpus 4` should fail with that explanation rather than clap's
generic `unexpected argument`. Ideally the API reference marks the field immutable, since three clients
are currently inferring it from an omission.

**Verified from the published reference and the generated SDK, not live.** The absence of `vcpus` from
the patch body is documented in two places and consistent with the CLI having no flag for it; what is
*not* verified is what the live API does if you send `vcpus` anyway — it may 400, or ignore it
silently, which would be worse. That needs a token to settle. Note this spec has disagreed with the
live API eleven times (`packages/api/NOTES.md`), so the documented shape is evidence, not proof.

**What ours does.** Nothing yet — we have no `update`. Recorded as a requirement on it in
`Improvements.md` I-5 so the explanation ships with the command rather than after it.

### C-38 — An existing Claude subscription cannot be used when creating a runtime
_Severity: high._

The Dashboard offers a Claude subscription sign-in, and using it stores a secret on the tenant:

```console
$ runta secret list
{ "secrets": [ { "display_name": "__agent_oauth_refresh_ce14fc04-…", "id": "88b4840c-…" }, … ] }
```

Nothing can then spend it at create time. `run --image` promises that "a matching organization model
provider is injected automatically", but a subscription is not a managed provider:

```console
$ runta model-provider ls
{ "action": "model-provider-list", "model_providers": [] }
```

So the create is refused for a credential the tenant demonstrably has:

```console
$ runta run --image claude
error invalid argument: the selected runtime image reads its model-provider credential from
ANTHROPIC_API_KEY, which no secret in this request populates
This image needs a model provider. Connect one at https://dashboard.runta.com, then create the
runtime again.
```

The error is well written and actionable in general, but wrong in this case — it sends the user to the
Dashboard to connect a provider they have already connected, with no way to tell that the thing they
connected is the wrong *kind* of thing. Nothing names the distinction anywhere in the CLI: `secret
list` shows the subscription under a reserved-looking `__agent_oauth_refresh_` name with no type,
protocol or purpose, and `model-provider ls` shows an empty list without saying that a subscription
exists but does not count.

The image catalog knows the difference and does not expose it. `GET /v2/images` describes `claude`
with both a `protocol_bindings` entry (API-key shaped, `ANTHROPIC_API_KEY`) **and**
`subscription_options: [{ protocols: ["anthropic_messages"], secret_preset_ids: ["claude_oauth"] }]`
— so the catalog models subscriptions as a first-class way to satisfy the image, while `run` offers no
flag that selects one. Its only credential knobs are `--model-provider-protocol`, `--base-url`,
`--model`, `--runtime-sign-in` and `--secret-config-file`.

That leaves `--runtime-sign-in` as the only route, which lands in [C-33](#c-33---runtime-sign-in-reports-a-ready-runtime-whose-agent-cant-run):
a runtime reported `running` whose agent prints `Not logged in · Please run /login`. Reproduced again
here on `claude` at v2.1.234. So a user who has paid for a subscription and connected it still cannot
get a working Claude runtime without a human at a terminal — and the two failure modes compound, since
the first error tells you to go connect the thing that leads you to the second.

→ Let a subscription satisfy the image. Either inject it automatically the way a managed provider is
injected, or add an explicit selector (`--subscription <id>`, or `--model-provider` accepting either
kind). Failing that, the error must distinguish "no credential" from "a subscription exists but cannot
be used here", and `model-provider ls` should show subscriptions alongside providers rather than an
empty list that implies nothing is connected.

**What ours does.** Nothing — `runta-next create` has no secret, provider or sign-in flags at all, so
it inherits the same wall one step earlier. Worth recording as a requirement before we add any of
them: whatever we build should accept a subscription wherever it accepts a provider.


## Not exercised

Would need more setup or incur real cost/side effects: `image build`, `ssh` and `ssh key`, `vnc`,
`runtime ssh-key`, `tls generate-certs`, `tokens analyze/savings`, `model-provider create/update`,
`--idle-mode` wake-from-suspend behaviour, and interactive `exec -it` signal forwarding (needs a real
interactive terminal).

`github connect` and `github configure` were attempted on a second pass and could not be exercised:
both return `PERMISSION_DENIED` — "principal's role does not allow this organization action", with
`required_action: contact_admin` — for the account that owns the tenant's runtimes. The error names
neither the role held nor the role required, and with no `whoami`
([C-20](#c-20-no-whoami-no-version-no-completions)) there is no way to find out from the CLI. A public
repo can be worked around with a plain `git clone` inside the runtime; a private one cannot.

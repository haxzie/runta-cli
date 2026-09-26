# Pre-PR checklist

Run through this before opening a PR that touches a command, flag, output format, error message
or exit code. It is deliberately mechanical — the point is to catch the things that are obvious
in hindsight.

## New or changed command

- [ ] Verb matches the neighbouring group (`ls` vs `list`, `rm` vs `delete`); domain word added
      as an alias, not a replacement
- [ ] Identifier placeholder matches the rest of the CLI, and accepts name *or* id
- [ ] Arguments in the same position as sibling commands
- [ ] No pair of commands takes the same two free-form arguments in opposite orders
- [ ] Registered in `program.ts` **and** asserted in `program.test.ts`
- [ ] Listed in the README command table and in `docs/commands/`, with its own page if it has
      more than a couple of flags

## Flags

- [ ] Boolean is a bare `--flag` (+ `--no-flag` if it needs a negative); no `true|false` or
      `on|off` values
- [ ] Name and units consistent with existing flags (`--timeout 30s`, not `--timeout-secs 30`)
- [ ] Global options stay global; command options stay on the command
- [ ] `--help` text says what the flag *does*, not what it is

## Output

- [ ] Human format and `--json` format each decided on purpose
- [ ] A flag that claims to add detail actually changes what the reader sees
- [ ] Results on stdout, progress/hints/errors on stderr
- [ ] Success does not look like an error in a terminal that colours stderr
- [ ] Multi-stage operations emit NDJSON under `--json`, written as each stage completes
- [ ] JSON keys consistent with other commands; no prose in structured fields
- [ ] Anything the flags promised to create (a URL, a path, an id) is printed
- [ ] Truncated or partial output says so
- [ ] Response carries what was asked for, not the whole object
- [ ] Table width clamped to a minimum and honours `COLUMNS`
- [ ] `NO_COLOR` suppresses *all* escape sequences

## Next steps

- [ ] Printed only when the command leaves the user mid-task, not on every success
- [ ] On stderr, so `--json` payloads stay clean
- [ ] Does not name the command that just ran
- [ ] Every command named actually exists (the scraper test covers this)

## Errors

- [ ] Message names the subject, the cause, and the next step
- [ ] No transport or internal vocabulary (`websocket error`, `min_memory_mib`, serde output)
- [ ] Uses the flag name the user typed, and states the actual bound
- [ ] Failures that share a status code get different hints
- [ ] Exit code: `0` success, `1` request failed/unreachable, `2` credential problem
- [ ] `request_id` surfaced when the API returned one
- [ ] No `required_action` pointing at the command that just ran

## Retries

- [ ] Transient failures (5xx, dropped connection, timeout) distinguished from terminal ones
- [ ] Pollers stop only on a terminal answer or a deadline
- [ ] Resume state survives a transient failure
- [ ] Retry budget is bounded and 4xx is not retried

## Destructive actions

- [ ] `--dry-run` prints the resolved plan, including defaults the user didn't specify
- [ ] Dry-run output available as JSON, not only as prose
- [ ] TTY confirmation with `--yes` to skip; no prompt under `--json` or in a pipe
- [ ] Replace-all semantics called out, with incremental `--add`/`--remove` if it's a set
- [ ] Blast radius beyond this machine stated before acting

## Credentials

- [ ] Config directory created on demand (`recursive`, mode `0700`)
- [ ] File written `0600`, set explicitly rather than relying on create-time mode
- [ ] Other keys in the config preserved; unparseable config refused, not overwritten
- [ ] Credential *source* reported, not just the identity

## Agents

- [ ] `help --json` reports the flag's real arity — no boolean advertising a value
- [ ] Subcommand help returns the subcommand, not the root tree
- [ ] Output shape identical interactively and in a pipe
- [ ] Nothing asks the agent to enforce a safety property the CLI lacks

## Tests

- [ ] Command driven through the real SDK, client shell and config loader, with only `fetch`
      stubbed
- [ ] Happy path, each error path, and each flag combination that changes behaviour
- [ ] Anything that writes to disk verified on disk, not just via a stub
- [ ] Transient-failure-then-success case covered for anything that retries
- [ ] `pnpm lint && pnpm typecheck && pnpm test` clean at the repo root (not inside a package —
      turbo builds workspace deps first, and running `vitest` directly tests stale `dist`)

## Docs

- [ ] README table and `docs/` updated in the same commit as the behaviour
- [ ] Examples copy-pasteable, and actually run
- [ ] Nuances recorded, not just the happy path
- [ ] Relative links and anchors resolve

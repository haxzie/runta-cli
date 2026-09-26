---
name: cli-design
description: Design rules and review checklist for the runta CLI — command naming, flags, output and JSON contracts, error messages, exit codes, credential handling, destructive-action safety, and agent-friendliness. Use this whenever adding or changing a runta command, flag, output format, error message or exit code; when writing a command's tests or docs; when reviewing a CLI diff; or when deciding how something should behave ("should this be a flag or positional?", "what should this print?", "what exit code?"). Also use it before shipping any user-facing string. Every rule here comes from a specific defect found in the production Runta CLI, recorded in CLI_ISSUES.md.
---

# Designing the runta CLI

This skill exists because we audited Runta's production CLI end to end and recorded 35 defects
in `CLI_ISSUES.md`. Almost none of them were hard problems. They were small decisions that each
looked locally reasonable and collectively made an 84-command CLI feel unpredictable.

Every rule below traces to one of those findings, cited as `C-NN`. When you hit a case the rules
don't cover, read the cited finding — the reasoning transfers further than the rule does.

Read `references/checklist.md` before opening a PR, and `references/findings-map.md` when you
want the evidence behind a rule.

## The five questions

For any change, answer these before writing code. They catch most of what went wrong upstream.

1. **What does a human see, and what does a script see?** Both, explicitly — not one derived
   from the other by accident.
2. **What happens when this fails?** Name the failure, say what to do about it, pick the exit
   code.
3. **Can it destroy anything?** Then it needs `--dry-run` and confirmation.
4. **Would an agent following only `--help` and `--json` get this right?** Agents are a
   first-class caller, not an afterthought.
5. **What did I just make inconsistent?** Check the verb, the flag name, the placeholder, the
   argument position against what already exists.

## Naming and shape

**Match the surface that already exists.** The upstream CLI has `ls` in some groups and `list`
in others, `rm` / `delete` / `revoke` / `detach` / `clear` for removal, and `ps` at the top
level (C-26). Every inconsistency was locally defensible. Pick the verb that the neighbouring
group uses; if you genuinely need a domain word, add it as an *alias* rather than a replacement.

**One identifier vocabulary.** Upstream takes `<RUNTIME_NAME>` in most commands, `<VM_NAME>` in
ten, and `<RUNTIME_ID>` in the rest (C-26) — and "VM" appears nowhere in the product. Use the
product's word, and accept name *or* id everywhere rather than making the user learn which
command wants which.

**Keep an argument in the same position across commands.** Upstream has the runtime as a
positional in 34 commands and a `--runtime` flag in two (C-34). A user cannot learn that; they
can only be corrected by it.

**Don't let paired commands take the same arguments in opposite orders.** `checkpoint create
<runtime> <checkpoint>` versus `checkpoint restore <checkpoint> <runtime>` (C-26) means a
transposition is a *valid-looking* command. When two free-form strings of the same type meet,
make one of them a flag: `restore <checkpoint> --into <runtime>`.

**Two commands do not earn a namespace.** We put `login` and `logout` at the top level rather
than under `auth` for this reason. Group when there are enough siblings that the group is doing
real work.

**One boolean convention.** Bare `--flag` and `--no-flag`. Upstream mixes bare flags with
`true|false` and `on|off` values (C-26); nobody can guess which a given flag wants.

**One name per concept, including units.** Upstream has `--timeout-secs` on one command and
`--timeout` on another (C-26). Prefer a duration that states its unit in the value (`30s`,
`5m`) over encoding it in the flag name.

## Output

**Decide the human format and the machine format separately.** Upstream's `inspect` renders
the *same five-column table as `ps`* while its JSON carries 45 fields (C-07) — the command
whose entire job is detail shows a human none of it. And `ps --full` changes the JSON while
being a silent no-op on a terminal (C-07). If a flag claims to add detail, it must add detail
to whatever the caller is actually reading.

**Never make `--json` the only way to read output.** Upstream implies `--json` off-TTY with no
way to turn it off, so `runta ps | less`, `| grep` and `> file` all get JSON (C-08). Prefer
explicit `--json`, so behaviour is identical interactively and in a pipe — that also means an
agent's output doesn't change shape depending on how it spawned the process.

**stdout is the result; stderr is commentary.** Progress, hints and errors go to stderr so
pipes stay clean. But watch the corollary we got wrong ourselves: routing *success* messages
through stderr makes them red in terminals that colour stderr, so a successful login reads as a
failure. Success belongs on stdout, or needs a marker that survives colouring.

**Emit a stream as a stream.** For a multi-stage operation, `--json` should be NDJSON — one
compact object per line, written when known. `login --json` prints the device code before it
starts polling, so a wrapper can display it immediately. Upstream buffers `exec` output into a
single JSON string field (C-16): a ten-minute build shows nothing, and `| grep` needs
`jq -r .stdout` first.

**Keep JSON `jq`-shaped.** One discriminator, consistent key names across commands, no human
prose stuffed into a structured field. Upstream returns the whole help screen inside
`error.message` as one escaped blob (C-18), and uses a different array key per list command —
`runtimes`, `checkpoints`, `secrets`, `keys` — so no generic accessor works (C-18).

**Show the thing the user asked for.** `--publish 8080/https` upstream returns a port and never
the URL; you have to know to run `ports ls` (C-13). If a flag's purpose is to produce an
artefact, print the artefact.

**Give the caller control over how much you fetch.** Upstream pages through everything with a
hard-coded page size and no `--limit`, so a large tenant waits for every page and an agent
cannot cap the response at all (C-15). Offer a real result limit, and if you ever do truncate,
say so — a silently short list is worse than an error, because scripts act on it.

**Don't return more than was asked.** Upstream's `pause` returns the entire 45-field runtime
object to convey one state change (C-22). For an agent that is ~350 tokens of context for one
bit of information.

**Assume the terminal lies about its size.** Upstream's table renderer collapses every column
to one character when the terminal reports zero width — a 58-character id printed vertically
over 43 rows — and ignores `COLUMNS` (C-12). Clamp to a sane minimum; honour `COLUMNS`.

**Honour `NO_COLOR` completely.** Upstream drops the colour but keeps the bold (C-25). All-or-
nothing, plus a `--color=auto|always|never` for the cases detection gets wrong.

**Suggest the next step, but only when there is one.** A command that leaves the user mid-task
should say what to do next — a freshly created runtime, an empty list, a runtime in `error`. A
command that completed a task should say nothing, because advice printed every time is advice
nobody reads. Put suggestions on stderr so they survive `--json` without touching the payload.

Two rules make the difference between a suggestion and a bug. **Never suggest the command that
just ran** — upstream's `resume` returns `required_action: runta resume <name>`, and an agent
following the field as designed loops (C-11). And **only ever name a command that exists**: we
shipped a `create` that suggested `runta exec` before `exec` was written, which is the same defect
as upstream's agent skill documenting `runta agents ls` (C-30). The fix is not care, it is a test —
scrape every `runta …` out of the source and resolve it against the real command tree.

## Errors

**An error names what failed, why, and what to do next.** Upstream's most likely error —
`exec` against a stopped runtime — is `websocket error: HTTP error: 409 Conflict` (C-04). No
runtime name, no cause, no next step. No user-facing error should ever expose transport
plumbing.

**Speak the user's vocabulary.** The user typed `--memory`; upstream's error says
`min_memory_mib (256) must be >= 512` and elsewhere `resources.requests.memory_mib must be >= 1`
(C-24). Translate internal field names back to the flag that was typed, and say what the bound
*is* and why.

**Distinguish failures the status code conflates.** Runta's API answers a *missing* credential
with 403 and a *rejected* one with 401. Our `whoami` hints separate "you sent nothing", "your
token was rejected" and "this is an org key on a user-only endpoint" — three different fixes
that look identical from the status alone.

**Stable exit codes, and a distinct one for credentials.** Ours: `0` success, `1` request
failed or unreachable, `2` credential problem. `2` lets a script branch on "needs auth" without
parsing prose. Upstream's npm wrapper flattens signal death to `1` instead of `128+signo`
(C-29), so callers can't detect Ctrl-C.

**Include the correlation id when there is one.** Runta's API returns `request_id` on every
error; upstream's CLI drops it (C-18), which makes support tickets unanswerable.

**Never point the caller at the command they just ran.** Upstream's `resume` returns
`required_action: runta resume <name>` (C-11). An agent following that field — which is what
it's for — loops. If the required action is to wait, say wait.

## Retries and transient failure

**Distinguish "cannot", "not yet", and "don't know".** Upstream's `exec` fails spuriously about
10% of the time — 5 of 50 successful commands returned `status: null` and exit `1` (C-01). It
does retry the websocket *upgrade*; what it cannot survive is a reset after the stream starts.
The right answer there is not a retry, because the command may have had side effects — it is to
report the outcome as **unknown**, with its own exit code, so a caller can decide. Reporting an
unknown outcome as a failure is how a CI pipeline ends up re-running work that already
succeeded.

**A poller stops on a terminal answer, not on a bad connection.** Our device flow retries
`begin` with backoff, treats 5xx / dropped connections / timeouts as noise, and ends only on
denial, expiry, or the deadline. Upstream abandons the login on the first transport error *and
deletes its own pending state*, so `--resume` cannot recover from the one thing it exists for
(C-03) — while the endpoint 520s roughly one call in five.

**Never destroy your own recovery path on a retryable error.** If state exists so an operation
can resume, a transient failure must leave it intact.

## Destructive actions

**Every mutating command needs `--dry-run`, and the JSON half matters most.** Upstream has zero
occurrences of `--dry-run`, `--yes`, `--force` or `--confirm` across 84 commands, on eight
destructive operations (C-09). A dry run should print the resolved plan — including defaults the
user didn't specify — in both human and JSON form. Without machine-readable output an agent
cannot show the user what it's about to do; it can only describe its intent in prose and hope.

**Confirm on a TTY, skip under `--json`.** Prompt when stdin is interactive, `--yes` to skip,
and never prompt in a pipe — that way scripts are unaffected and humans get a brake.

**Replace-all on a security boundary needs a diff.** Upstream's `egress set --allow` replaces
rather than adds, so a host silently vanishes from an allowlist; `--mode allowlist` with no
hosts is a total lockout and `--mode denylist` with none is wide open — both unwarned, and the
list command renders them identically (C-10). Offer incremental `--add`/`--remove` forms, and
render the effective posture, not the raw fields.

**Revocation reaches further than the local machine.** Our own `logout` revokes whatever
credential is in effect — including one from an env var, for every consumer of that key, with
no way to unset the user's environment. It destroyed a real key during testing. Anything whose
blast radius exceeds this machine should say so before acting.

## Credentials

**Create your own directories.** Upstream's `login` writes its state file without creating
`~/.config/runta`, so the first command it tells a new user to run fails with `os error 2` on
every clean machine (C-02). This was the single worst defect in the audit and the smallest fix.

**`0600` on the file, `0700` on the directory** — and set the mode explicitly, because
`writeFile`'s `mode` only applies when it creates the file.

**Say which credential source won.** Env var beats stored login in our precedence, which means
a user can log in successfully and still act as a different identity with nothing in the output
saying so. Upstream has no `whoami` or `auth status` at all (C-20). Report the source, not just
the identity.

**Preserve the rest of the config.** A token is one field in a shared file, so read-modify-write
and refuse to overwrite a file you cannot parse.

## Help and discoverability

**Print a usage line the user can paste.** `runta help ps` upstream prints `Usage: ps
[OPTIONS]`, and `runta help checkpoint create` prints `Usage: create …` (C-17) — while the root
help actively teaches `runta help <command>` as the way to explore.

**Generate docs and agent skills from the binary.** Upstream's docs describe a 14-command CLI
while 26 ship, document `-f/--file` flags that don't exist, and give a worked example using
`${credential}` when the CLI requires `${secret}` (C-05). Its official agent skill documents a
`runta agents ls` command and `--agent`/`--no-shell` flags that do not exist at all (C-30). Both
are generated-artifact problems: a CI check that every command and flag quoted in the docs
parses under `--help` removes the whole class.

**Ship the affordances users expect**: `whoami`, `version` as a subcommand as well as a flag,
shell completions. Upstream has none (C-20), and completion is the single highest-leverage win
for a CLI with 65 leaf commands and opaque ids.

**Keep `--help` as the source of truth.** Our docs say so explicitly, and our `program.test.ts`
asserts the command surface so a rename can't half-land.

## Agents as a first-class caller

**The machine-readable contract must be correct, not just present.** Upstream's `help --json`
advertises `possible_values: ["true","false"]` on every boolean flag (C-06); an agent reading it
literally writes `runta ps --all true` and fails. A snapshot test asserting no boolean arg
advertises a value would have caught it.

**Discovery has to be affordable.** `help --json` upstream costs ~19.6k tokens with no way to
narrow it, everything pretty-printed — compacting alone saves 54% (C-31). Offer `--compact`, a
depth limit, or field selection. And don't return the whole root tree when a subcommand's help
was asked for (C-32).

**Don't ask an agent to enforce what the tool won't.** Upstream's agent skill instructs the
model to "require explicit user confirmation before `runta rm`" — a safety property asserted in
prose because the CLI has no `--dry-run` or `--yes` (C-30, C-09). Build the primitive.

## Verify against reality, not documentation

This is the meta-rule, and it caught real bugs in our own code.

Writing our OpenAPI spec from Runta's published docs would have produced a **wrong** client:
`request_id` is a sibling of `error` rather than a field inside it, and a missing credential
returns 403 not 401 (C-35). Both were transcribed faithfully from the docs and both were wrong —
and because our error normaliser read the documented shape, every API error silently lost its
code and message and degraded to `http_403`.

So: probe the live API with `curl`, then write the spec from what came back. Test commands
against a stubbed `fetch` through the *real* SDK, client and config loader rather than mocking
modules, so the wiring is what gets covered — the envelope, the auth header, the one endpoint
whose `error` is a string instead of an object. When docs and reality disagree, follow reality
and record the divergence (`packages/api/NOTES.md`).

## When a rule doesn't fit

These are defaults with reasons, not laws. If a case genuinely calls for breaking one, break it
and write down why — a comment at the site, or a line in `CLI_ISSUES.md` if it's a pattern. The
failure mode to avoid isn't breaking a rule; it's the 35 small local decisions that never got
written down and added up to a CLI nobody could predict.

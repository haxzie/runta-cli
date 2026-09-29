---
title: runta-next start, stop, pause
description: Park a runtime and bring it back, without having to know which state it is in first.
sidebar_position: 6
---

# `runta-next start`, `stop`, `pause`

Moves a runtime between running and parked. `stop` releases its resources, `pause` keeps its memory,
and `start` brings it back from either. All three wait until the state has actually changed before
returning.

```
runta-next start <runtime> [options]
runta-next stop  <runtime> [options]
runta-next pause <runtime> [options]
```

Each is also available noun-first as `runta-next runtime start`, and so on.

| Option | Does |
| --- | --- |
| `--dry-run` | Show what would change and exit |
| `-d, --detach` | Return as soon as the change is accepted, without waiting |
| `--timeout <secs>` | How long to wait before giving up (default 180) |
| `--json` | Print the result as JSON |
| `-o, --output <mode>` | `auto` (JSON when not a terminal), `table`, or `json` |

```console
$ runta-next stop demo
Stopping 'demo'…
Runtime 'demo' is shutdown.

Next steps:
  runta-next start demo  bring it back to running
```

## `start` does not make you guess the state

The API splits waking a runtime across two endpoints — `/start` for one that was shut down, `/resume`
for one that was paused — and there is a third parked state, `suspended`, that only the
[idle policy](./create.md) produces.

One command covers all three. Because the CLI has to read the runtime anyway to get its revision, it
already knows which transition applies, and picks:

| Current status | `start` calls |
| --- | --- |
| `shutdown` | `/start` |
| `paused` | `/resume` |
| `suspended` | `/resume` |
| `running` or `creating` | nothing — already there |

`--dry-run --json` reports the choice, so it is inspectable rather than magic:

```console
$ runta-next start demo --dry-run --json
{
  "action": "start",
  "dry_run": true,
  "runtime": { "id": "8f3c1e52-…", "name": "demo", "status": "paused" },
  "endpoint": "resume",
  "target_status": "running",
  "revision": 7
}
```

There is no `resume` or `boot` command. One verb is the whole point.

## Asking for the state you are already in

Not an error, and not a request:

```console
$ runta-next stop demo
Runtime 'demo' is already shutdown.
```

```json
{ "action": "stop", "changed": false, "reason": "already_in_state", "waited": true, "runtime": { … } }
```

Nothing is sent to the API. That makes these commands safe in a script that cannot know the current
state — which is most scripts. Branch on `.changed` if you care whether anything moved.

Asking for a state that *cannot* be reached is an error, and says which state you are in:

```console
$ runta-next pause demo
error Runtime 'demo' is crashed, which `pause` cannot change.
This runtime cannot be recovered. Remove it with `runta-next delete demo`.
```

## `status` is only reported once it is true

Every transition is asynchronous, and the API's response to the request still carries the **old**
status — it has only been accepted at that point, not applied. So these commands poll until the target
status is observed, and report that.

Under `--detach` there is nothing to poll, so the payload says so rather than presenting a stale
status as the outcome:

```console
$ runta-next stop demo --detach
Stopping 'demo' — not waiting. It will become shutdown.
```

```json
{
  "action": "stop",
  "changed": true,
  "accepted": true,
  "waited": false,
  "target_status": "shutdown",
  "runtime": { "id": "8f3c1e52-…", "name": "demo", "status": "running", "desired_status": "running" }
}
```

`waited` tells an agent whether `runtime.status` can be trusted as the result. When it is `false`,
`target_status` is what the runtime is heading for.

The payload is four fields rather than the whole runtime — `inspect` is the command for that.

## Concurrency

Each transition is sent with `expected_revision` set to the revision just read, so a change made by
something else between the read and the write is rejected rather than silently overwritten. A stale
revision is retried once, which covers a concurrent poll; a persistent conflict is reported.

## Exit codes

| Code | Means |
| --- | --- |
| `0` | The state changed, or was already what you asked for |
| `1` | The transition does not apply, timed out, or the API rejected it |
| `2` | Credential problem |

## What is not here

`resize` is deliberately absent. It is a `PATCH` against the runtime — the same general update
endpoint that would back an `update` command — so it belongs with runtime *configuration* rather than
with lifecycle verbs. See `Improvements.md` I-5 and I-9.

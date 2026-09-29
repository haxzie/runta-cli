---
title: runta-next delete
description: Delete runtimes, with --dry-run, confirmation, optimistic concurrency and waiting until they are gone.
sidebar_position: 11
---

# `runta-next delete`

Deletes one or more runtimes and waits until they are really gone, not merely accepted for deletion.
It cannot be undone, so it confirms first where a human can answer and offers `--dry-run` where one
cannot.

```
runta-next delete <runtime...> [options]
runta-next runtime delete <runtime...> [options]
```

Takes one or more names or ids.

| Option | Does |
| --- | --- |
| `--dry-run` | Show what would be deleted and exit |
| `-y, --yes` | Skip the confirmation prompt |
| `-d, --detach` | Return as soon as deletion is accepted, without waiting |
| `--timeout <secs>` | How long to wait before giving up. Default 180 |
| `--json` | Print the result as JSON |
| `-o, --output <mode>` | `auto` (JSON when not a terminal), `table`, or `json` |

```console
$ runta-next delete demo
Delete 1 runtime(s): demo? This cannot be undone. [y/N] y
Deleting 'demo'…
Deleted 'demo'.
```

## Check first with `--dry-run`

The plan is built from the API, not from what you typed — so it shows the runtimes that would
actually be deleted, with their current status:

```console
$ runta-next delete demo staging --dry-run
Would delete 2 runtime(s):
  demo (01a0dcc4-…) — currently running
  staging (01a0dd12-…) — currently paused
```

```console
$ runta-next delete demo --dry-run --json
{
  "action": "delete",
  "dry_run": true,
  "runtimes": [
    { "id": "01a0dcc4-…", "name": "demo", "status": "running", "revision": 2 }
  ]
}
```

The JSON form is the one that matters for automation: it lets a wrapper — or an agent — show a
user exactly what is about to happen before doing it, rather than describing its intent in prose.

## Confirmation only where someone can answer

The prompt appears when stdin and stderr are both interactive. Under `--json`, in a pipe, or in
CI there is no prompt — a prompt nobody can see is a hang, not a safeguard. `-y` skips it
explicitly.

```sh
runta-next delete demo -y            # no prompt
runta-next delete demo --json        # no prompt
echo n | runta-next delete demo      # declined → "Aborted.", nothing deleted
```

## Why deletion reads before it writes

`DELETE /v2/runtimes/{id}` requires an `expected_revision` matching the runtime's current
`revision`, so the CLI has to fetch the runtime first. If something else changes the runtime in
between, the API answers 409 — the CLI re-reads and retries once, because that is exactly the
race optimistic concurrency exists to catch and not something you should have to retry by hand.
A second 409 is surfaced.

This also means `delete` makes at least two calls per runtime, and a name costs one more for
resolution.

## It waits until the runtime is gone

By default the command polls until the runtime 404s, so when it returns the runtime really is
deleted. `--detach` returns as soon as the API accepts the request.

```console
$ runta-next delete demo -y --json
{ "action": "delete", "runtimes": [ { "name": "demo", "id": "01a0dcc4-…", "deleted": true } ] }
```

`deleted` is `false` with `--detach` — the request was accepted, not confirmed complete.

## Exit codes

| Code | When |
| --- | --- |
| `0` | Deleted, or accepted with `--detach`, or `--dry-run` printed a plan |
| `1` | A runtime was not found, the API refused, the wait timed out, or the prompt was declined |
| `2` | Credential problem |

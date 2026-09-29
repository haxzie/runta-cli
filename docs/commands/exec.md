---
title: runta-next exec
description: Run a command inside a runtime, including interactive pty sessions, streaming output, NDJSON frames, and why an unknown outcome is not a failure.
sidebar_position: 12
---

# `runta-next exec`

Runs a command inside a running runtime and exits with that command's own exit code, so it composes
with `&&`, `set -e` and CI the way a local command would. Add `-it` for an interactive shell.

```
runta-next exec <runtime> [options] -- <command> [args...]
```

`<runtime>` is a name or an id.

| Option | Does |
| --- | --- |
| `-i, --interactive` | Forward stdin to the command |
| `-t, --tty` | Allocate a pty. Needs a terminal on stdout |
| `--env <KEY=VALUE>` | Set an environment variable. Repeatable |
| `--json` | Stream NDJSON frames instead of raw output |

```console
$ runta-next exec demo -- uname -a
Linux runta 6.12.8+ #1 SMP … x86_64 GNU/Linux
```

The `--` matters: everything after it belongs to the remote command, so its own flags are not
mistaken for `runta-next`'s.

## The exit code is the command's exit code

```console
$ runta-next exec demo -- sh -c 'exit 42'; echo $?
42
```

That is what any script wrapping this expects, and it leaves no room for the CLI's usual `1`/`2`.
Failures of the *exec itself* therefore use high codes:

| Code | Meaning |
| --- | --- |
| `0`–`255` | The remote command's own exit status |
| `2` | Bad flags, or a credential problem — nothing ran |
| `125` | The command could not be started. Retrying is safe |
| `126` | The command started but its outcome is **unknown**. See below |

## An unknown outcome is not a failure

If the connection ends before the runtime reports an exit status, nobody knows whether the command
ran. The protocol is explicit that such a command must not be retried automatically, so the CLI
refuses to call it a failure:

```console
$ runta-next exec demo -- ./deploy.sh
error The connection closed before the command reported an exit status.
The command may have run. Check before retrying — this is not a reported failure.
```

`125` versus `126` is the distinction that matters: `125` means nothing started, so a retry cannot
duplicate work. `126` means it might have.

## Interactive sessions

`-i` forwards stdin. `-t` allocates a pty. Together they give a real terminal:

```console
$ runta-next exec demo -it -- sh
# tty
/dev/pts/0
# echo $TERM
xterm-256color
```

With a pty:

- your terminal goes into raw mode, so **Ctrl-C reaches the shell inside the runtime** rather than
  killing the CLI — which is what makes the session behave like a local one;
- resizing your window sends the new geometry, so full-screen programs reflow;
- stderr is folded into stdout by the pty, exactly as a local terminal does;
- the terminal is restored when the command exits, including on error.

Without a pty, `-i` still forwards stdin and Ctrl-C is translated into an explicit interrupt for the
remote process:

```sh
echo 'print("hi")' | runta-next exec demo -i -- python3
cat local.sql | runta-next exec demo -i -- psql
```

`-t` is refused when stdout is not a terminal, because a pty with nowhere to render is not a session
anyone wants:

```console
$ runta-next exec demo -t -- sh > out.txt
error --tty needs a terminal on stdout.
Drop -t when piping or redirecting output.
```

## Streaming

Output is written as it arrives, not buffered to the end — so a long build shows progress, and
`stdout` and `stderr` stay on their own streams:

```sh
runta-next exec demo -- make 2>build.log    # errors to a file, progress on screen
runta-next exec demo -- ls | grep foo       # pipes work normally
```

## `--json`

Emits [NDJSON](https://ndjson.org) frames that mirror the wire protocol, so anything that has read
`packages/api/asyncapi.yaml` already knows the shape:

```console
$ runta-next exec demo --json -- sh -lc 'echo hi; echo oops >&2; exit 3'
{"type":"stdout","data_base64":"aGkK"}
{"type":"stderr","data_base64":"b29wcwo="}
{"type":"exit","code":3}
```

Payloads are base64 because command output is bytes, not text — a build that emits a control
character or invalid UTF-8 would otherwise be corrupted. An unknown outcome appears as a frame too:

```json
{"type":"error","message":"connection lost","before_start":false}
```

```sh
runta-next exec demo --json -- ls | jq -r 'select(.type=="stdout") | .data_base64' | base64 -d
```

## A cold runtime is slow, not stuck

The API holds the connection for up to 300 seconds while a runtime becomes ready. Rather than
appear to hang, the CLI says so:

```console
$ runta-next exec demo -- ls
Waiting for the runtime to become ready…
```

## Environment

```sh
runta-next exec demo --env GREETING=hei --env LANG=C -- sh -lc 'echo $GREETING'
```

Names must be POSIX-shaped, and the `RUNTA_` prefix is reserved by the platform. A malformed pair is
rejected before anything connects.

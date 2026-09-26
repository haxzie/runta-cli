---
title: Commands
description: Every runta command, the global options, and what the API supports that the CLI does not yet.
sidebar_position: 6
---

# Commands

```
runta [global options] <command> [command options]
```

## Available commands

| Command | Does |
| --- | --- |
| [`runta create`](./create.md) | Create a runtime and wait until it can accept commands |
| [`runta list`](./list.md) | List runtimes |
| [`runta inspect`](./inspect.md) | Show everything about one runtime |
| [`runta delete`](./delete.md) | Delete one or more runtimes |
| [`runta login`](./login.md) | Sign in through a browser using a one-time device code |
| [`runta logout`](./logout.md) | Revoke the stored credential and remove it locally |
| [`runta whoami`](./whoami.md) | Show the authenticated user and active team |
| [`runta hello`](./hello.md) | Print a greeting — a smoke test for the dev loop |

## Two forms for runtime commands

Every runtime verb is reachable two ways, and they are the same command:

```sh
runta runtime create      runta create
runta runtime list        runta list
runta runtime inspect     runta inspect
runta runtime delete      runta delete
```

The noun-first form is canonical, so every resource reads the same way and you can predict
`runta checkpoint list` from having seen `runta runtime list`. The top-level form exists because
runtimes are the noun you work with all day and naming them twice gets old. Runtimes are the only
resource with that shortcut.

There are no other aliases. In particular there is no `run`, no `ps` and no `rm` — see
[Improvements.md](https://github.com/haxzie/runta-cli/blob/main/Improvements.md) for why.

## Runtimes are named or identified

Every command that targets a runtime takes it as a **positional** argument and accepts either a
name or a UUID:

```sh
runta inspect demo
runta inspect 01a0dcc4-2ba7-7353-acb2-7fa79602b0a0
```

Names are resolved by the CLI, because the API's path parameter only accepts a UUID. Two
consequences: resolving a name costs one extra request, and because names are not guaranteed
unique, an ambiguous name is an error rather than a guess —

```console
$ runta inspect demo
error Runtime name 'demo' is ambiguous — 2 runtimes share it.
Use an id instead: 01a0dcc4-…, 01a0dd12-…
```

## Global options

| Option | Does |
| --- | --- |
| `-v`, `--version` | Print the version and exit |
| `-h`, `--help` | Print help for the program or any subcommand |
| `--verbose` | Debug logging on stderr, including the resolved endpoint |
| `--quiet` | Errors only |

`--verbose` and `--quiet` override `RUNTA_LOG_LEVEL`. They are program-level options, so they
go before the command:

```sh
runta --verbose whoami      # works
runta whoami --verbose      # unknown option
```

## Help is authoritative

`--help` is generated from the program itself, so it can never drift from what the binary
accepts:

```sh
runta --help
runta login --help
runta whoami --help
```

If this documentation and `--help` disagree, `--help` is right.

## Not yet implemented

The [Runta REST API](https://runta.com/docs/reference/api/) exposes 85 operations. The CLI
currently covers four. Nothing below exists yet as a command:

| Area | API operations | Status |
| --- | --- | --- |
| Runtimes — create, list, inspect, delete | 4 | **Done** |
| Runtimes — resize, pause, resume, start, stop, VNC | 17 | Not started |
| `exec` — run a command in a runtime (WebSocket, not REST) | — | Not started |
| Cloud agents — create, run, follow up, artifacts, workspace | 22 | Not started |
| GitHub — connect, repositories, runtime bindings | 9 | Not started |
| SSH keys — tenant keys and per-runtime attachment | 7 | Not started |
| Secrets — store values and credential-injection rules | 5 | Not started |
| Checkpoints — create, list, restore, delete | 4 | Not started |
| Events and token analysis | 5 | Not started |
| Files — read and write inside a runtime | 2 | Not started |
| Model providers | 2 | Not started |
| Health | 2 | Not started |

Progress is tracked by which operations are described in `packages/api/openapi.json`; see
`packages/api/NOTES.md` for coverage and the places the live API differs from its published
documentation.

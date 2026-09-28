---
title: Commands
description: Every runta-next command, the global options, and what the API supports that the CLI does not yet.
sidebar_position: 6
---

# Commands

Every command the CLI has, what it does, and the conventions they all share. `--help` is always the
authority on flags; this page explains the behaviour behind them.

```
runta-next [global options] <command> [command options]
```

## Available commands

| Command | Does |
| --- | --- |
| [`runta-next create`](./create.md) | Create a runtime and wait until it can accept commands |
| [`runta-next list`](./list.md) | List runtimes |
| [`runta-next inspect`](./inspect.md) | Show everything about one runtime |
| [`runta-next delete`](./delete.md) | Delete one or more runtimes |
| [`runta-next exec`](./exec.md) | Run a command inside a runtime |
| [`runta-next login`](./login.md) | Sign in through a browser using a one-time device code |
| [`runta-next logout`](./logout.md) | Revoke the stored credential and remove it locally |
| [`runta-next whoami`](./whoami.md) | Show the authenticated user and active team |
| [`runta-next upgrade`](./upgrade.md) | Upgrade this CLI to the latest release |

## Two forms for runtime commands

Every runtime verb is reachable two ways, and they are the same command:

```sh
runta-next runtime create      runta-next create
runta-next runtime list        runta-next list
runta-next runtime inspect     runta-next inspect
runta-next runtime delete      runta-next delete
```

The noun-first form is canonical, so every resource reads the same way and you can predict
`runta-next checkpoint list` from having seen `runta-next runtime list`. The top-level form exists because
runtimes are the noun you work with all day and naming them twice gets old. Runtimes are the only
resource with that shortcut.

There are no other aliases. In particular there is no `run`, no `ps` and no `rm` — see
[Improvements.md](https://github.com/haxzie/runta-cli/blob/main/Improvements.md) for why.

## Runtimes are named or identified

Every command that targets a runtime takes it as a **positional** argument and accepts either a
name or a UUID:

```sh
runta-next inspect demo
runta-next inspect 01a0dcc4-2ba7-7353-acb2-7fa79602b0a0
```

Names are resolved by the CLI, because the API's path parameter only accepts a UUID. Two
consequences: resolving a name costs one extra request, and because names are not guaranteed
unique, an ambiguous name is an error rather than a guess —

```console
$ runta-next inspect demo
error Runtime name 'demo' is ambiguous — 2 of them share it.
Use an id instead: 01a0dcc4-…, 01a0dd12-…
```

The same holds for every other identifier the CLI accepts, so there is nothing to remember about
which flag wants which form:

| Identifier | Accepts | Canonical form |
| --- | --- | --- |
| `<runtime>` on `inspect`, `delete` | name or UUID | UUID |
| `--image` on `create` | slug or display name | slug, e.g. `clean` |
| `--from-checkpoint` on `create` | name or UUID | UUID |

Each resolves to the canonical form before any request that needs it, and each refuses an
ambiguous name rather than picking one.

## The help output is grouped

`runta-next --help` groups commands by what you are working on rather than listing them
alphabetically, opens with how to sign in, and ends with a short note for agents and a set of
examples. Headings are bold only on a terminal — piped help carries no escape sequences, and
`NO_COLOR` is honoured.

The groups are checked against the registered commands by a test, so a command cannot exist without
appearing in the help.

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
runta-next --verbose whoami      # works
runta-next whoami --verbose      # unknown option
```

## Help is authoritative

`--help` is generated from the program itself, so it can never drift from what the binary
accepts:

```sh
runta-next --help
runta-next login --help
runta-next whoami --help
```

If this documentation and `--help` disagree, `--help` is right.

## Not yet implemented

The [Runta REST API](https://runta.com/docs/reference/api/) exposes 85 operations. The CLI
currently covers four. Nothing below exists yet as a command:

| Area | API operations | Status |
| --- | --- | --- |
| Runtimes — create, list, inspect, delete | 4 | **Done** |
| Runtimes — resize, pause, resume, start, stop, VNC | 17 | Not started |
| `exec` — run a command in a runtime (WebSocket, not REST) | — | **Done** |
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

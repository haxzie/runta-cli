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
| [`runta auth login`](./auth.md#runta-auth-login) | Sign in through a browser using a one-time device code |
| [`runta auth logout`](./auth.md#runta-auth-logout) | Revoke the stored credential and remove it locally |
| [`runta whoami`](./whoami.md) | Show the currently authenticated user |
| [`runta hello`](./hello.md) | Print a greeting — a smoke test for the dev loop |

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
runta auth --help
runta auth login --help
```

If this documentation and `--help` disagree, `--help` is right.

## Not yet implemented

The [Runta REST API](https://runta.com/docs/reference/api/) exposes 85 operations. The CLI
currently covers four. Nothing below exists yet as a command:

| Area | API operations | Status |
| --- | --- | --- |
| Runtimes — create, list, inspect, resize, pause, resume, stop, delete | 21 | Not started |
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

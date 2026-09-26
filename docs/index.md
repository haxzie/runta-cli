---
title: Runta CLI
description: Manage Runta from the terminal — authentication, identity, and the commands built on the public REST API.
sidebar_position: 1
---

# Runta CLI

`runta` is a command line interface for the [Runta REST API](https://runta.com/docs/reference/api/).
It is a single standalone binary with no runtime dependency.

## Start here

| Page | What it covers |
| --- | --- |
| [Installation](./installation.md) | Install, upgrade, uninstall, supported platforms |
| [Authentication](./authentication.md) | `auth login`, API keys in CI, where credentials live |
| [Configuration](./configuration.md) | Every environment variable and the config file, with precedence |
| [Output and scripting](./output-and-scripting.md) | `--json`, stdout vs stderr, exit codes |
| [Commands](./commands/index.md) | Reference for every command |

## Quick start

```sh
# Install
curl -fsSL https://raw.githubusercontent.com/haxzie/runta-cli/main/scripts/install.sh | sh

# Sign in through the browser
runta auth login

# Confirm who you are
runta whoami
```

For CI or any non-interactive environment, skip the login entirely and set a token:

```sh
export RUNTA_TOKEN=rt_…
runta whoami
```

## Current scope

The CLI is early. Today it covers authentication and identity:

- [`runta auth login`](./commands/auth.md#runta-auth-login)
- [`runta auth logout`](./commands/auth.md#runta-auth-logout)
- [`runta whoami`](./commands/whoami.md)
- [`runta hello`](./commands/hello.md) — a development smoke test

Runtime, checkpoint, secret, egress, file-transfer and agent commands are not implemented
yet. See [Commands → not yet implemented](./commands/index.md#not-yet-implemented) for what
the API exposes and the CLI does not.

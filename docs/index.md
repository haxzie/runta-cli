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
| [Authentication](./authentication.md) | `login`, API keys in CI, where credentials live |
| [Configuration](./configuration.md) | Every environment variable and the config file, with precedence |
| [Output and scripting](./output-and-scripting.md) | `--json`, stdout vs stderr, exit codes |
| [Commands](./commands/index.md) | Reference for every command |

## Quick start

```sh
# Install
curl -fsSL https://runta.haxzie.com/install.sh | sh

# Sign in through the browser
runta login

# Create a runtime and use it
runta create --name demo --cpus 1 --memory 512
runta exec demo -- uname -a
runta exec demo -it -- sh      # interactive shell
runta delete demo
```

For CI or any non-interactive environment, skip the login entirely and set a token:

```sh
export RUNTA_TOKEN=rt_…
runta whoami
```

## Current scope

The CLI is early. Today it covers the runtime lifecycle, authentication and identity:

- [`runta create`](./commands/create.md) · [`runta list`](./commands/list.md) ·
  [`runta inspect`](./commands/inspect.md) · [`runta delete`](./commands/delete.md) ·
  [`runta exec`](./commands/exec.md)
- [`runta login`](./commands/login.md) · [`runta logout`](./commands/logout.md) ·
  [`runta whoami`](./commands/whoami.md)
- [`runta hello`](./commands/hello.md) — a development smoke test

Checkpoints, secrets, file transfer, images and agents are not implemented yet. See
[Commands → not yet implemented](./commands/index.md#not-yet-implemented) for what the API
exposes and the CLI does not.

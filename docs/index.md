---
title: Runta CLI
description: Manage Runta from the terminal — authentication, identity, and the commands built on the public REST API.
sidebar_position: 1
---

# Runta CLI

`runta-next` is a command line interface for the [Runta REST API](https://runta-next.com/docs/reference/api/).
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
runta-next login

# Create a runtime and use it
runta-next create --name demo --cpus 1 --memory 512
runta-next exec demo -- uname -a
runta-next exec demo -it -- sh      # interactive shell
runta-next delete demo
```

For CI or any non-interactive environment, skip the login entirely and set a token:

```sh
export RUNTA_TOKEN=rt_…
runta-next whoami
```

## Current scope

The CLI is early. Today it covers the runtime lifecycle, authentication and identity:

- [`runta-next create`](./commands/create.md) · [`runta-next list`](./commands/list.md) ·
  [`runta-next inspect`](./commands/inspect.md) · [`runta-next delete`](./commands/delete.md) ·
  [`runta-next exec`](./commands/exec.md)
- [`runta-next login`](./commands/login.md) · [`runta-next logout`](./commands/logout.md) ·
  [`runta-next whoami`](./commands/whoami.md)
- [`runta-next hello`](./commands/hello.md) — a development smoke test

Checkpoints, secrets, file transfer, images and agents are not implemented yet. See
[Commands → not yet implemented](./commands/index.md#not-yet-implemented) for what the API
exposes and the CLI does not.

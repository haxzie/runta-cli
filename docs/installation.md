---
title: Installation
description: Install the runta binary, pin a version, choose an install directory, and uninstall.
sidebar_position: 2
---

# Installation

```sh
curl -fsSL https://runta.haxzie.com/install.sh | sh
```

The script downloads a standalone binary for your platform from the latest GitHub Release,
verifies its SHA-256 checksum against the release's `checksums.txt`, and installs it to
`~/.runta/bin/runta`.

There is **no Node.js requirement** and nothing is published to npm — the binary is
self-contained.

:::note
Checksum verification needs `sha256sum` or `shasum` on the machine. If neither is present the
script prints `warning: no sha256 tool found, skipping checksum verification.` and installs
anyway. On a minimal container image, check for that line — or install the binary from the
release manually and verify it yourself.
:::

Linux builds pick glibc or musl automatically; Alpine and other musl distributions get the
musl build.

## Options

Both are environment variables read by the install script:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUNTA_VERSION` | latest release | Install a specific version, e.g. `v0.3.1` |
| `RUNTA_INSTALL_DIR` | `~/.runta/bin` | Where the binary lands |

```sh
RUNTA_VERSION=v0.3.1 curl -fsSL …/install.sh | sh
RUNTA_INSTALL_DIR=/usr/local/bin curl -fsSL …/install.sh | sh
```

## If you already have the npm-published CLI

Runta publishes a CLI to npm as `@runta/runta-cli`, and it installs a command called `runta` too.
Both cannot own that name, and the installer warns you when it finds another one on your `PATH`.

**Read this before uninstalling anything: this CLI does less than that one.** It covers the runtime
lifecycle, `exec`, and authentication. It has no `cp`, `checkpoint`, `secret`, `egress`, `ports`,
`ssh`, `vnc`, `image`, `github`, `tokens` or `model-provider` commands. If you rely on any of those,
keep the npm CLI.

Running both is fine as long as you are deliberate about which one you get:

```sh
# whichever directory comes first on PATH wins
export PATH="$HOME/.runta/bin:$PATH"      # prefer this CLI
~/.runta/bin/runta list                    # or just be explicit

runta --version    # 0.1.x is this CLI, 0.2.x is the npm one
```

To remove the npm one:

```sh
npm uninstall -g @runta/runta-cli
```

### The command names are different on purpose

There are no compatibility aliases, so muscle memory from the npm CLI will not work — by design,
and for reasons written up in
[`Improvements.md`](https://github.com/haxzie/runta-cli/blob/main/Improvements.md):

| npm CLI | This CLI | Why |
| --- | --- | --- |
| `runta run` | [`runta create`](./commands/create.md) | `run` named the command that creates a runtime while `exec` was the one that runs things |
| `runta ps` | [`runta list`](./commands/list.md) | `ps` is ambiguous about scope — your runtimes, or processes inside one? |
| `runta rm` | [`runta delete`](./commands/delete.md) | consistency: the other three are whole words |
| `runta inspect` | [`runta inspect`](./commands/inspect.md) | unchanged |
| `runta exec` | [`runta exec`](./commands/exec.md) | unchanged |

### Credentials are not shared

The two store configuration in different places, so signing into one does not sign you into the
other:

| | Location |
| --- | --- |
| npm CLI | `~/.config/runta/config.toml` |
| This CLI | `~/.runta/config.json` |

Run [`runta login`](./commands/login.md) again after switching, or set `RUNTA_TOKEN`, which both
read.

## Pinning the installer itself

`RUNTA_VERSION` pins which *release* you install. To pin the *installer script* — to reproduce an
old install, or to try a change before it reaches the default branch — pass `?ref=`:

```sh
curl -fsSL 'https://runta.haxzie.com/install.sh?ref=v0.1.0' | sh
curl -fsSL 'https://runta.haxzie.com/install.sh?ref=my-branch' | sh
```

The response carries the resolved ref in an `x-runta-ref` header, so you can check what you got
without running it:

```console
$ curl -sI https://runta.haxzie.com/install.sh | grep x-runta-ref
x-runta-ref: main
```

## Read it before you run it

Piping a remote script into a shell is worth doing deliberately. The script is small and has no
dependencies beyond `curl` and `tar`:

```sh
curl -fsSL https://runta.haxzie.com/install.sh | less
```

It refuses to install anything whose SHA-256 does not match the `checksums.txt` published with the
release, and the URL itself fails closed — an unreachable or unexpected response returns a non-2xx
status, so `curl -fsSL` aborts rather than handing a body to `sh`.

## Supported platforms

macOS and Linux, on `x64` and `arm64`. Linux builds cover both glibc and musl, selected by
the installer.

Windows is not supported.

## Put it on your PATH

The default install directory is not on `PATH` on a fresh machine. Add it to your shell
profile:

```sh
export PATH="$HOME/.runta/bin:$PATH"
```

## Verify

```sh
runta --version
runta hello
```

## Uninstall

The CLI keeps everything under one directory, so removing it is a single step:

```sh
rm -rf ~/.runta
```

That removes the binary **and** your stored credential
(see [Authentication → where credentials live](./authentication.md#where-credentials-live)).
To remove only the credential, use `runta logout`.

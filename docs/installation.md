---
title: Installation
description: Install the runta binary, pin a version, choose an install directory, and uninstall.
sidebar_position: 2
---

# Installation

```sh
curl -fsSL https://raw.githubusercontent.com/haxzie/runta-cli/main/scripts/install.sh | sh
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
To remove only the credential, use `runta auth logout`.

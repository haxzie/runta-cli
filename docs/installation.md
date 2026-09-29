---
title: Installation
description: Install runta-next from npm or as a standalone binary, pin a version, choose an install directory, and uninstall.
sidebar_position: 2
---

# Installation

Two channels, same CLI. Both give you a `runta-next` command.

## npm

```sh
npm install -g @haxzie/runta-next
```

The package is a single bundled file with **no dependencies**. It needs Node.js 22 or newer, and
it lands in npm's global bin directory — which is already on your `PATH`, so there is nothing to
configure and no new terminal to open.

Use this one if you already have Node.js. `pnpm add -g`, `bun add -g` and `yarn global add` work
the same way, and `npx @haxzie/runta-next <command>` runs it without installing.

## Standalone binary

```sh
curl -fsSL https://runta.haxzie.com/install.sh | sh
```

The script downloads a standalone binary for your platform from the latest GitHub Release,
verifies its SHA-256 checksum against the release's `checksums.txt`, and installs it to
`~/.runta-next/bin/runta-next`.

There is **no Node.js requirement** — the binary is self-contained. Use this one on a machine
without Node.js, or in a container image where you do not want one.

Because it installs to a directory of its own, it has to put that directory on your `PATH`; see
[PATH](#path) below.

:::note
Checksum verification needs `sha256sum` or `shasum` on the machine. If neither is present the
script prints `warning: no sha256 tool found, skipping checksum verification.` and installs
anyway. On a minimal container image, check for that line — or install the binary from the
release manually and verify it yourself.
:::

Linux builds pick glibc or musl automatically; Alpine and other musl distributions get the
musl build.

## Options

All are environment variables read by the install script. They do not apply to the npm package —
pin that with `npm install -g @haxzie/runta-next@0.7.0` instead:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUNTA_VERSION` | latest release | Install a specific version, e.g. `v0.3.1` |
| `RUNTA_INSTALL_DIR` | `~/.runta-next/bin` | Where the binary lands |
| `RUNTA_BIN_NAME` | `runta-next` | What to call the command, so it can sit beside the official CLI |
| `RUNTA_NO_MODIFY_PATH` | unset | Set it to leave your shell profile alone; the installer prints the `PATH` line instead |

```sh
RUNTA_VERSION=v0.3.1 curl -fsSL …/install.sh | sh
RUNTA_INSTALL_DIR=/usr/local/bin curl -fsSL …/install.sh | sh
```

## It sits beside the official CLI

This CLI is an experiment. Runta's own is published to npm as `@runta/runta-cli`, that one is the
complete product, and nothing here is a reason to remove it.

The command here is **`runta-next`**, so the two never collide:

```sh
curl -fsSL https://runta.haxzie.com/install.sh | sh

runta-next login
runta-next create --name scratch --cpus 1 --memory 512
runta                # still the official CLI, untouched
```

Nothing to uninstall, no `PATH` ordering to get right, and which one you are running is never in
doubt. `RUNTA_BIN_NAME` overrides the name if you want something shorter — the installer warns if
the name you pick is already taken.

:::danger
**`runta-next logout` revokes the credential server-side, not just locally.** If you are sharing a
token with the official CLI or with CI — including anything in `RUNTA_TOKEN` — signing out here
destroys it *everywhere*, and nothing else will tell you. Check before running it:

```sh
env | grep RUNTA_TOKEN
```

To stop using this CLI without revoking anything, delete its config instead:

```sh
rm -rf ~/.runta-next
```
:::

### What works, and what is missing

Implemented: [`login`](./commands/login.md), [`logout`](./commands/logout.md),
[`whoami`](./commands/whoami.md), [`create`](./commands/create.md), [`list`](./commands/list.md),
[`inspect`](./commands/inspect.md), [`delete`](./commands/delete.md) and
[`exec`](./commands/exec.md).

Not built: `cp`, `checkpoint`, `secret`, `egress`, `ports`, `ssh`, `vnc`, `image`, `github`,
`tokens`, `model-provider`. Nine of the API's twelve operation groups are untouched — so keep the
official CLI for anything real.

### The shared names mean different things

There are no compatibility aliases, on purpose — the reasoning is in
[`Improvements.md`](https://github.com/haxzie/runta-cli/blob/main/Improvements.md):

| Official CLI | Here | Why |
| --- | --- | --- |
| `runta run` | `create` | `run` named the command that *creates* a runtime, while `exec` was the one that ran things |
| `runta ps` | `list` | `ps` is ambiguous about scope — your runtimes, or processes inside one? |
| `runta rm` | `delete` | consistency: the other three are whole words |
| `runta inspect` | `inspect` | unchanged |
| `runta exec` | `exec` | unchanged |

### Credentials are separate

| | Location |
| --- | --- |
| Official CLI | `~/.config/runta/config.toml` |
| This CLI | `~/.runta-next/config.json` |

So `login` here does not sign you in there, or the reverse. `RUNTA_TOKEN` is read by both, which
makes it the least surprising way to authenticate while testing — and the reason the `logout`
warning above matters.

### Testing without breaking anything

- Work on a runtime you created for the purpose. `create --name scratch-…` and delete it after.
- `delete --dry-run` first; it resolves names against the API and shows exactly what would go.
- `--json` output shapes are settled; **error text is not** — branch on exit codes, not messages.
- Found something wrong? The findings that produced this CLI live in
  [`CLI_ISSUES.md`](https://github.com/haxzie/runta-cli/blob/main/CLI_ISSUES.md); new ones belong
  there too.

## Pinning the installer itself

`RUNTA_VERSION` pins which *release* you install. To pin the *installer script* — to reproduce an
old install, or to try a change before it reaches the default branch — pass `?ref=`:

```sh
curl -fsSL 'https://runta.haxzie.com/install.sh?ref=v0.1.0' | sh
curl -fsSL 'https://runta.haxzie.com/install.sh?ref=my-branch' | sh
```

The response carries the resolved ref in an `x-runta-next-ref` header, so you can check what you got
without running it:

```console
$ curl -sI https://runta.haxzie.com/install.sh | grep x-runta-next-ref
x-runta-next-ref: main
```

## Supported platforms

macOS and Linux, on `x64` and `arm64`. Linux builds cover both glibc and musl, selected by
the installer.

Windows is not supported.

## PATH

This applies to the install script only — the npm package lands somewhere already on `PATH`.

The install directory is not on `PATH` on a fresh machine, so the installer adds it for you. It
appends one line to the profile your login shell reads — `~/.zshrc`, `~/.bashrc` (plus
`~/.bash_profile` on macOS, which is what Terminal's login shell reads), or
`~/.config/fish/config.fish`:

```sh
# added by the runta-next installer
export PATH="$HOME/.runta-next/bin:$PATH"
```

Re-running the installer does not add it twice, and the line is written with `$HOME` rather than
your machine's home path so a copied dotfile still works. The shell you ran the installer in is
already running, so it does not pick this up — open a new terminal, or run that line once in the
current one.

Two cases where it stops and prints the line for you to add yourself instead: an unrecognised
`$SHELL`, where guessing at the syntax risks breaking every new terminal, and a profile it cannot
write to.

To keep your shell profile untouched:

```sh
RUNTA_NO_MODIFY_PATH=1 curl -fsSL https://runta.haxzie.com/install.sh | sh
```

## Verify

```sh
runta-next --version
```

## Uninstall

From npm:

```sh
npm uninstall -g @haxzie/runta-next
```

That leaves your stored credential behind in `~/.runta-next/config.json`; `runta-next logout`
before uninstalling, or delete the directory afterwards.

The standalone binary keeps everything under one directory, so removing it is a single step:

```sh
rm -rf ~/.runta-next
```

That removes the binary **and** your stored credential
(see [Authentication → where credentials live](./authentication.md#where-credentials-live)).
To remove only the credential, use `runta-next logout`.

The one thing left outside that directory is the `PATH` line the installer appended to your shell
profile, marked `# added by the runta-next installer`. Delete those two lines to finish.

---
title: runta-next upgrade
description: Replace the installed binary with a newer release, verifying the download before anything is swapped.
sidebar_position: 12
---

# `runta-next upgrade`

Replaces the running binary with a newer release, in place. It needs no credential — the releases are
public — and it verifies the download before touching your working install, so a failed upgrade leaves
you on the version you already had.

```
runta-next upgrade [options]
```

| Option | Does |
| --- | --- |
| `--check` | Report whether a newer version exists, and change nothing |
| `--to <version>` | Install a specific version instead of the latest |
| `--dry-run` | Show what would be installed and exit |
| `-y, --yes` | Skip the confirmation when moving to an older version |
| `--json` | Print the result as JSON |
| `-o, --output <mode>` | `auto` (JSON when not a terminal), `table`, or `json` |

```console
$ runta-next upgrade
Downloading runta-next-darwin-arm64 0.4.1…
Upgraded 0.3.0 → 0.4.1.
```

## If you installed from npm

This command replaces a standalone binary. A copy installed with `npm install -g @haxzie/runta-next`
is owned by npm, so it says so rather than downloading a release alongside it:

```console
$ runta-next upgrade
error This copy was installed from npm, so npm has to replace it.
Run: npm install -g @haxzie/runta-next@latest
```

`--check` still works either way — whether a newer version exists has an answer regardless of who
installs it.

## Asking without acting

`--check` is a question, so it answers and stops:

```console
$ runta-next upgrade --check
A newer version is available: 0.3.0 → 0.4.1

Next steps:
  runta-next upgrade  install it
```

It **exits 0 whether or not an upgrade exists**. Making "an upgrade is available" a non-zero exit
would break every `upgrade --check` sitting in a `set -e` script that only wanted to know. Branch on
the JSON instead:

```sh
$ runta-next upgrade --check --json | jq -e '.upgrade_available' >/dev/null && runta-next upgrade
```

```json
{
  "action": "upgrade",
  "checked": true,
  "current_version": "0.3.0",
  "latest_version": "0.4.1",
  "upgrade_available": true,
  "target": "runta-next-darwin-arm64",
  "path": "/Users/you/.runta-next/bin/runta-next"
}
```

`--dry-run` goes one step further and shows exactly what would be fetched, without requesting the
asset at all:

```console
$ runta-next upgrade --dry-run
Would upgrade 0.3.0 → 0.4.1
  asset    runta-next-darwin-arm64.tar.gz
  from     https://github.com/haxzie/runta-cli/releases/download/v0.4.1
  replacing /Users/you/.runta-next/bin/runta-next
```

## Nothing is replaced until the new binary is proven

In order, `upgrade`:

1. resolves the version from the `/releases/latest` redirect — not the GitHub API, which is
   rate-limited per IP and would fail for someone checking often;
2. downloads the asset for this platform and **verifies its SHA-256** against the `checksums.txt`
   published with the release, exactly as [`install.sh`](../installation.md) does;
3. extracts it and **runs `--version` on the result**, checking it reports the version that was asked
   for;
4. only then renames it over the installed binary.

Every failure before step 4 leaves your install untouched: a 404, a checksum mismatch, a truncated
download, an archive with no binary in it, or a binary that will not execute on this machine. That
third step matters more than it looks — the release workflow smoke-tests only the linux-x64 build, so
for every other platform this is the first time that binary has run anywhere.

The swap itself is a `rename` within the install directory, which is atomic and is also what makes
replacing a *running* executable safe: the directory entry is repointed while the running process
keeps its own inode. Writing over the file in place would fail with `ETXTBSY` on Linux.

## Going backwards

`--to` accepts any published version, with or without the leading `v`, so it can also downgrade:

```console
$ runta-next upgrade --to v0.4.0
This will replace 0.4.1 with the older 0.4.0. Continue? [y/N]
```

That is the one thing here that asks first, because a downgrade is easy to trigger by accident and
invisible afterwards. `-y` skips the prompt, and there is never a prompt under `--json` or in a pipe
where nothing could answer one.

## When it refuses

| Situation | What happens |
| --- | --- |
| Running from a source checkout | Refuses — `process.execPath` is `node` or `bun`, and there is no single binary to replace |
| Binary or its directory not writable | Refuses, naming the path, and suggests `sudo` or `RUNTA_INSTALL_DIR` |
| Platform with no published asset | Refuses, naming the platform |
| Already on the latest version | Says so and exits 0; nothing is downloaded |

If you installed with `sudo` into a system directory, either re-run `upgrade` with `sudo` or reinstall
somewhere you own:

```sh
RUNTA_INSTALL_DIR="$HOME/.runta-next/bin" curl -fsSL https://runta.haxzie.com/install.sh | sh
```

## Exit codes

| Code | Means |
| --- | --- |
| `0` | Upgraded, already current, or a `--check` / `--dry-run` that answered |
| `1` | Could not upgrade — network, checksum, permissions, unknown version, or an aborted downgrade |

There is no credential in this command, so `2` — which every other command uses for an auth problem —
never appears here.

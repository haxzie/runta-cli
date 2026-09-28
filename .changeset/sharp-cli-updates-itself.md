---
'@runta/cli': minor
---

Add `runta-next upgrade`, which replaces the installed binary with a newer release.

`upgrade` needs no credential — the releases are public — and nothing is replaced until the download
is proven. It resolves the version from the `/releases/latest` redirect rather than the rate-limited
GitHub API, verifies the asset's SHA-256 against the release's `checksums.txt` exactly as `install.sh`
does, extracts it, and runs `--version` on the result before swapping anything. A 404, a checksum
mismatch, an archive with no binary, or a binary that will not execute on this machine all leave the
working install untouched.

That `--version` step is worth more than it looks: the release workflow smoke-tests only the
linux-x64 build, so for every other platform this is the first time that binary has run anywhere.

The swap is a `rename` within the install directory, which is atomic and is also what makes replacing
a *running* executable safe — the directory entry is repointed while the running process keeps its own
inode. Writing over the file in place would fail with `ETXTBSY` on Linux.

`--check` answers whether a newer version exists and exits 0 either way, so it is safe in a `set -e`
script; read `.upgrade_available` from `--json` to branch. `--dry-run` prints the resolved plan without
requesting the asset. `--to <version>` installs a specific version and can downgrade, which is the one
case here that confirms first — skippable with `-y`, never prompted under `--json`.

It refuses, with the path named, in a source checkout and where the binary or its directory is not
writable.

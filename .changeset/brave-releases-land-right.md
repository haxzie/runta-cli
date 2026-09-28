---
'@runta/cli': patch
---

Cut releases from the commit being released.

The release workflow decided which version to publish by reading `apps/cli/package.json` from the
runner, immediately after `changesets/action` had run `pnpm run version` — which bumps every
`package.json` in place, commits the result to `changeset-release/main`, and leaves the checkout on
that branch. Both the working tree and `HEAD` therefore carried the *next* version, so the workflow
published it from the *current* commit: `v0.4.0` was tagged at a tree whose own version was 0.3.0 and
which lacked five later commits, and when the genuine 0.4.0 merged the tag already existed, so it was
skipped and never shipped. The stranded `v0.1.0` has the same cause.

It now reads the version from `$GITHUB_SHA`, which is fixed when the run starts and cannot be moved by
a later step, and checks that commit out before compiling. That also makes the binary smoke test
meaningful: comparing the binary's `--version` against the release only proves something if the binary
was built from the released commit.

This is the first release whose binaries contain the credential-aware `--help`; v0.4.0's predate it.

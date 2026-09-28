---
'@runta/cli': patch
---

Cut releases from the commit being released.

The release workflow read the version from `apps/cli/package.json` in the runner's working tree,
immediately after `changesets/action` had run `pnpm run version` and bumped every `package.json` in
place. So it published the *next* version from the *current* commit: `v0.4.0` was tagged at a tree
whose own version was 0.3.0 and which lacked five later commits, and when the real 0.4.0 merged the
tag already existed, so publishing was skipped.

It now reads `git show HEAD:apps/cli/package.json`, which a previous step cannot mutate, restores the
committed tree before compiling, and logs loudly when the tree and the commit disagree.

This release is the first to contain the credential-aware `--help` in a published binary; v0.4.0's
artifacts predate it.

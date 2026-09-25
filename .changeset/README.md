# Changesets

Every user-visible change needs a changeset. Run `pnpm changeset`, pick the affected
packages and a bump type, and commit the generated markdown file alongside your code.

All packages here are private and nothing is published to npm — Changesets is used purely
to version the monorepo, write CHANGELOGs, and create the git tag that the release
workflow turns into a GitHub Release with the compiled `runta` binaries attached.

`fixed: [["@runta/*"]]` keeps every package on one version number, so the version a user
sees from `runta --version` always identifies the whole tree.

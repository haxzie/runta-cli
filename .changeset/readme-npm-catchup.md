---
'@haxzie/runta-next': patch
---

Correct the release and overview docs for npm publishing.

The Releasing section still said "Nothing is published to npm — every package is private, and the
CLI ships as a standalone binary", which stopped being true when the CLI went to npm as
`@haxzie/runta-next`. It now describes the npm step, why it runs last (the GitHub Release is what
`install.sh` resolves, so it should not wait on the registry), and the version check that gates it.
Two smaller staleness fixes alongside: the fixed-version group now lists both `@runta/*` and
`@haxzie/runta-next`, and `@runta/docs` joins the packages excluded from versioning.

The docs overview described the CLI as a standalone binary only; it now leads with both install
routes.

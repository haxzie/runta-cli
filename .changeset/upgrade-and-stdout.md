---
'@haxzie/runta-next': minor
---

`upgrade` now upgrades npm installs itself, and success messages go to stdout.

`upgrade` recognised an npm install last release but only printed the command to
run. It now runs the package manager — pnpm, yarn, bun and npm each get their own
global-install spelling, read off the path the package was unpacked into rather
than from whatever `npm` is on PATH, because the wrong manager installs a second
copy instead of failing. Same flags, same confirmation, same `--dry-run` and
`--json` shapes on both mechanisms.

Success lines — `Authorized. Token saved to …`, `Logged out.`, `Deleted …`,
`Upgraded … → …`, the login device code — now go to stdout instead of stderr. A
terminal that colours stderr red rendered a successful `login` entirely in red, so
the line you were waiting for looked like the failure. Progress and hints stay on
stderr, so pipes are unaffected.

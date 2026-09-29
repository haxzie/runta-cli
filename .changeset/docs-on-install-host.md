---
'@haxzie/runta-next': patch
---

Serve the docs from `runta.haxzie.com/docs/`, and point the CLI at it.

`--help`, the `llms-full.txt` link and the docs-site entrypoints now name
`https://runta.haxzie.com/docs` instead of `runta-cli.haxzie.com/docs`. The old hostname still
works — the docs Worker keeps its own custom domain — so nothing that already pointed there breaks.

The install Worker owns `runta.haxzie.com` as a Cloudflare custom domain, so a second Worker cannot
be routed alongside it; the docs are reached by service binding instead. `/install.sh` is unchanged
and `/` is still a 404, because `curl -fsSL runta.haxzie.com | sh` is a plausible mistyping of the
install command and must abort rather than pipe a rendered page into a shell.

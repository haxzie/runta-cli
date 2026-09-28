---
'@runta/cli': minor
---

Point `--help` at a real docs site, and drop the `hello` command.

The docs now build and deploy to <https://runta-cli.haxzie.com/docs> from the same `docs/` markdown
the repo already carried, so there is one copy rather than two. Root help names the site, and names
`/docs/llms-full.txt` in its "For agents:" section — an agent that reads `--help` can fetch the whole
manual in one request instead of crawling rendered pages. A new tour page walks a single session
from `login` through to teardown.

`hello` is gone. It was a smoke test for the dev loop and had no reason to be in a shipped CLI.

Also fixes five docs links that the `runta` → `runta-next` rename had rewritten to
`runta-next.com`, a domain that does not exist; they point back at `runta.com` where Runta's own API
reference actually lives.

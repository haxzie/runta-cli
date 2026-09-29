---
'@haxzie/runta-next': minor
---

Output now defaults to `auto`: a table on a terminal, JSON in a pipe.

`runta-next list | jq` works with no flag. `-o/--output {auto,table,json}` and a
`RUNTA_OUTPUT` environment variable both override it, so `| less` and `| grep` are
a flag away from the table rather than unreachable — that override is the whole
difference between this and the upstream behaviour recorded as C-08, where JSON
off-TTY could not be turned off. Precedence is flag, then environment, then the
shape of stdout, so pinning `RUNTA_OUTPUT` in CI never makes an explicit `-o` lie.

`--json` is unchanged and remains the explicit alias for `-o json`.

`exec` is deliberately exempt. It streams the remote command's own bytes through,
so `exec demo -- cat report.pdf > report.pdf` has to write the file rather than a
JSON envelope around it.

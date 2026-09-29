---
'@runta/cli': minor
---

Add `--fields` to `list`, selecting which columns appear and in what order.

The same names key both halves of the output — the table renders them as columns, `--json` keys each
row by them — so one vocabulary covers what a person reads and what a script parses. The human cell
and the machine value are decided separately: `memory` is `512 MiB` in the table and `512` in JSON,
and `status` serialises as `"running"` with `degraded` available as its own field, so nothing has to
substring-match `running (degraded)` to learn one boolean.

Additive: without `--fields`, `--json` is unchanged, so existing `jq` paths keep working. An unknown
field is an error naming it and the valid ones, exit code 2, before any request goes out.

Measured honestly in `evals/cli-ab`: the narrow path is 26× smaller than a full `list --json`, but
rerunning the agent suite showed no aggregate saving, because most tasks reach for `inspect` rather
than `list`. See `Improvements.md` I-10.

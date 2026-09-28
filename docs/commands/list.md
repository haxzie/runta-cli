---
title: runta-next list
description: List runtimes, with the default active filter, --all, --status, --limit, pagination and JSON output.
sidebar_position: 8
---

# `runta-next list`

```
runta-next list [options]
runta-next runtime list [options]
```

| Option | Does |
| --- | --- |
| `-a, --all` | Include stopped, failed and deleting runtimes |
| `--status <statuses>` | Comma-separated statuses to include |
| `--limit <n>` | Stop after this many runtimes |
| `--json` | Print the runtimes as JSON |

```console
$ runta-next list
NAME            STATUS   VCPUS    MEMORY  IMAGE   CREATED
jesting_kalong  running      1  1024 MiB  clean   2026-09-26T08:10:39Z
prequel-dev     paused       2  2048 MiB  claude  2026-09-26T07:58:48Z
```

## What the default hides

By default the command shows `running`, `creating`, `paused` and `suspended` — the states a
runtime can be used or resumed from. `creating` is included deliberately: a runtime that is
missing from the listing for the first seconds of its life is worse than one shown as
transitional.

`--all` drops the filter entirely. `--status` overrides both:

```sh
runta-next list --all                 # everything, including deleting and error
runta-next list --status error        # just the failures
runta-next list --status running,error
```

An unknown status is rejected by the API with a 422 rather than silently returning nothing.

## `--limit` caps results, not page size

The API pages at 100 and the CLI follows cursors, so a result set larger than a page is complete
without any flag. `--limit` caps the **results** and stops fetching once it has them, so
`--limit 5` is one request rather than one page.

## Empty output is empty

With no matches, nothing goes to stdout — the explanation goes to stderr:

```console
$ runta-next list
No active runtimes. Use --all to include stopped ones.
```

So `runta-next list | wc -l` is 0 when there is nothing, and a pipe never has to parse a sentence.

## Degraded runtimes

A `running` runtime with no successful heartbeat for 60 seconds or more is marked in place:

```
NAME  STATUS              VCPUS  …
demo  running (degraded)      1  …
```

## Table width

The table clamps to at least 80 columns and honours `COLUMNS`, and long values are truncated
with an ellipsis rather than wrapped, so an id stays on one line and stays copy-pasteable. That
matters in CI and under `script`, where the terminal reports a width of zero.

## `--json`

Prints the array of runtime objects verbatim, so `jq` paths match the
[API reference](https://runta.com/docs/reference/api/operations/listruntimes/):

```sh
runta-next list --json | jq -r '.[] | select(.status == "running") | .display_name'
```

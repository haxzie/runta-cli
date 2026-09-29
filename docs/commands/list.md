---
title: runta-next list
description: List runtimes, with the default active filter, --all, --status, --limit, --fields, pagination and JSON output.
sidebar_position: 8
---

# `runta-next list`

Lists your runtimes as a table, or as JSON for a script. By default it shows only the runtimes that
are running or suspended — the ones costing you money and able to accept work right now.

```
runta-next list [options]
runta-next runtime list [options]
```

| Option | Does |
| --- | --- |
| `-a, --all` | Include stopped, failed and deleting runtimes |
| `--status <statuses>` | Comma-separated statuses to include |
| `--limit <n>` | Stop after this many runtimes |
| `--fields <names>` | Comma-separated fields to show, in that order |
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

## `--fields` narrows both halves

`--fields` names columns. The table renders them in the order given, and `--json` keys each row by
the same names, so one vocabulary covers what a person reads and what a script parses:

| Field | Table cell | `--json` value |
| --- | --- | --- |
| `name` | `demo` | `"demo"` |
| `id` | the UUID | the UUID |
| `status` | `running (degraded)` | `"running"` |
| `degraded` | `true` | `true` |
| `vcpus` | `1` | `1` |
| `memory` | `512 MiB` | `512` (MiB) |
| `image` | `clean` | `"clean"` |
| `created` | the timestamp | the timestamp |

```console
$ runta-next list --fields name,vcpus
NAME            VCPUS
jesting_kalong      1
prequel-dev         2
```

```console
$ runta-next list --fields name,vcpus --json
[
  {
    "name": "jesting_kalong",
    "vcpus": 1
  }
]
```

Note that `memory` is `512 MiB` in the table and `512` in JSON. The unit belongs in a cell a person
reads, not in a value a script is about to do arithmetic on; the field list in `--help` states it.

Without `--fields`, `--json` is unchanged — the API's own objects, with `display_name` and nested
`resources`. The flag is additive, so existing `jq` paths keep working.

A misspelled field is an error naming it and the valid ones, with exit code 2, before any request
is made:

```console
$ runta-next list --fields name,vcpu
error Unknown --fields value: vcpu
Available fields: name, id, status, degraded, vcpus, memory, image, created
```

A short row is worse than an error, because a script will act on it.

### Why it exists

`--json` returns every field of every runtime. An agent that wants two of them still pays for all
of them, and on a near-empty tenant the full payload is already 15× the table. Narrowing the
response is the cheapest way to keep an agent's context affordable — the same concern as
`CLI_ISSUES.md` C-31, one layer out.

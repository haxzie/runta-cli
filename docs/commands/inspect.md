---
title: runta-next inspect
description: Show everything about one runtime, including the effective egress posture and the fields the list table omits.
sidebar_position: 10
---

# `runta-next inspect`

Shows everything the API knows about one runtime, as a detail view rather than a single table row.
Reach for it when `list` says a runtime is unhappy and you need to know why.

```
runta-next inspect <runtime> [options]
runta-next runtime inspect <runtime> [options]
```

`<runtime>` is a name or an id. See [Commands](./index.md#runtimes-are-named-or-identified).

| Option | Does |
| --- | --- |
| `--json` | Print the runtime as JSON |
| `-o, --output <mode>` | `auto` (JSON when not a terminal), `table`, or `json` |

```console
$ runta-next inspect demo
Name         demo
ID           01a0dcc4-2ba7-7353-acb2-7fa79602b0a0
Status       running
Image        clean
vCPUs        1
Memory       1024 MiB now, 1024 requested, 1024 max
Disk         16 GiB
Egress       open — no restrictions
Ingress      8080/https
Idle policy  disabled
SSH          enabled
VNC          disabled
Secrets      none
Created      2026-09-26T08:10:39Z
Updated      2026-09-26T08:10:41Z
Revision     2
Manageable   yes
```

This is a detail view, not the `list` table. Everything the API returns that a human can act on
appears here; `--json` gives the rest.

## The egress line states the effective posture

The raw policy is easy to misread. A `denylist` with no hosts means **unrestricted**, and an
`allowlist` with no hosts means **nothing gets out** — two opposite situations that look nearly
identical as field values. So the line says what is actually true:

| Policy | Rendered as |
| --- | --- |
| `denylist`, no hosts | `open — no restrictions` |
| `denylist`, 2 hosts | `denylist — 2 host(s) blocked: …` |
| `allowlist`, 1 host | `allowlist — only pypi.org` |
| `allowlist`, no hosts | `BLOCKED — allowlist is empty, no egress permitted` |

## Conditional lines

`Desired` appears only when the desired status differs from the current one — i.e. when a
transition is in flight. `Error` appears only when the API reports an `error_code`. A runtime in
a steady state has neither, so their presence is itself information.

## `--json`

The runtime object exactly as the API returned it, unwrapped from its `data` envelope:

```sh
runta-next inspect demo --json | jq -r .resources.requests.vcpus
runta-next inspect demo --json | jq -r .revision      # what `delete` needs
```

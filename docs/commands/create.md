---
title: runta-next create
description: Create a runtime and wait until it can accept commands, including sizing, published ports, idle policy, and restoring from a checkpoint.
sidebar_position: 8
---

# `runta-next create`

Creates a runtime and, by default, waits until it is running.

```
runta-next create [options]
runta-next runtime create [options]
```

Both forms are the same command. See [Commands](./index.md#two-forms-for-runtime-commands).

| Option | Does |
| --- | --- |
| `--name <name>` | Runtime name. A random one is assigned when omitted |
| `--cpus <n>` | vCPUs |
| `--memory <mib>` | Memory in MiB |
| `--memory-max <mib>` | Auto-scaling memory ceiling in MiB |
| `--disk <gib>` | Overlay disk in GiB, 16–256 |
| `--image <id>` | Runtime image variant id — see [`images`](./images.md) |
| `-p, --publish <spec>` | Publish a port, e.g. `8080/https`. Repeatable |
| `--idle-mode <mode>` | `disabled`, `suspend_only` or `suspend_and_wakeup` |
| `--idle-timeout <secs>` | Idle seconds before suspending. Required with a suspending mode |
| `--from-checkpoint <id>` | Restore from a checkpoint instead of creating fresh |
| `--model-provider-protocol <p>` | Required by images that front a model provider; inferred when the image binds only one |
| `-d, --detach` | Return as soon as creation is accepted, without waiting |
| `--timeout <secs>` | How long to wait before giving up. Default 180 |
| `--json` | Print the runtime as JSON |
| `-o, --output <mode>` | `auto` (JSON when not a terminal), `table`, or `json` |

```console
$ runta-next create --name demo --image clean --cpus 1 --memory 512 -p 8080/https
Creating runtime 'demo'…
Runtime 'demo' is running.
Published: 8080/https
Run a command:  runta-next exec demo -- <command>
```

## It waits by default

Creation is asynchronous — the API returns immediately with `status: creating` — so without
waiting the command would hand you a runtime you cannot use yet. Waiting is the default because
that is almost never what anyone wanted; `--detach` opts out.

```console
$ runta-next create --detach --json
{ "id": "01a0ddcf-…", "status": "creating", … }
```

Waiting stops early on a genuine failure rather than burning the full timeout: a runtime that
reaches `error` or `crashed` fails the command immediately, and reports the runtime's
`error_code` when the API supplies one. A recoverable status like `suspended` does **not** end
the wait — that is a different problem from a failed create.

On timeout the command tells you what it was stuck on, and the runtime still exists:

```console
$ runta-next create --timeout 5
error Runtime 'demo' was still creating after 5s.
It may still be starting — check with `runta-next inspect`, or pass --detach to skip waiting.
```

## Sizing

The API has no top-level `cpus`/`memory`/`disk`; they live under `resources.requests`, and
`--memory-max` is the auto-scaling ceiling (`resources.limits.memory_mib`). The CLI does that
mapping, so:

```sh
runta-next create --cpus 2 --memory 2048 --memory-max 8192 --disk 32
```

becomes

```json
{ "resources": { "requests": { "vcpus": 2, "memory_mib": 2048, "disk_gib": 32 },
                 "limits": { "memory_mib": 8192 } } }
```

Omit a flag and the runtime image's recommendation applies.

## Images that front a model provider

12 of the 13 images run an agent against a model provider, and the API refuses to create one
without a protocol. The CLI infers it when the image binds exactly one — so `--image claude` needs
no extra flag:

```sh
runta-next create --image claude     # anthropic_messages inferred
```

When an image binds several, it asks, before making any request:

```console
$ runta-next create --image kimi
error Image 'kimi' supports several model-provider protocols.
Pick one with --model-provider-protocol: anthropic_messages, openai_chat, openai_responses.
```

[`runta-next image list`](./images.md) tells you which case an image is in before you try: its
`MODEL PROVIDER` column shows the single protocol when one is inferred, and a count when the flag
is required.

A protocol the image does not support is rejected the same way, naming what it does support.

Separately, such an image also needs a **credential**. With no organization model provider
configured and no secret in the request, the API refuses the create — it does not hand you a running
runtime whose agent cannot authenticate:

```console
$ runta-next create --image claude --cpus 2 --memory 2048
error invalid argument: the selected runtime image reads its model-provider credential from ANTHROPIC_API_KEY, which no secret in this request populates
This image needs a model provider. Connect one at https://dashboard.runta.com, then create the runtime again.
```

Configuring a provider is not yet possible from the CLI, hence the dashboard.

## `--image` takes a slug or a display name

Images carry both — `clean` and `Clean runtime` — and the API accepts only the slug, so the CLI
resolves the name:

```sh
runta-next create --image clean            # slug
runta-next create --image 'Clean runtime'  # display name, resolved to `clean`
```

An unknown name lists what exists, because there is no `runta-next image list` yet:

```console
$ runta-next create --image 'Nope'
error Image 'Nope' was not found.
Available images: claude, clean, cloud_agent, codex, cursor, deepseek_harness, exo, flue, hermes, kimi, openclaw, opencode, pi.
```

## Restoring from a checkpoint

```sh
runta-next create --from-checkpoint 01a0dcc4-… --name restored
runta-next create --from-checkpoint nightly --name restored   # by name
```

`checkpoint_id` must be a UUID, so a name is resolved the same way a runtime name is. There is no
`runta-next checkpoint list` yet, so an unknown name says so rather than naming a command that would
not help.

A checkpoint fixes the runtime's size and image identity, so `--cpus`, `--memory` and `--image`
are **rejected** rather than silently ignored:

```console
$ runta-next create --from-checkpoint ck_abc --cpus 4
error --cpus cannot be combined with --from-checkpoint
A checkpoint fixes the runtime size and image; omit the flag.
```

## Published ports

`--publish 8080/https` opens the port. The resulting URL is **not** printed yet — it is not on
the runtime object, and the endpoint that returns it is not part of the public REST API. Until
that is available, `runta-next inspect` shows the published ports and the URL has to come from the
dashboard.

## Exit codes

| Code | When |
| --- | --- |
| `0` | Runtime is running, or creation was accepted with `--detach` |
| `1` | The API rejected the request, the runtime failed, or the wait timed out |
| `2` | Credential problem, or invalid flags |

Flag validation happens before any API call, so a bad `--publish` or `--cpus` costs nothing.

---
title: runta-next image
description: List the runtime images create can build from, and delete custom ones.
sidebar_position: 7
---

# `runta-next image`

Runtime images are the prepared environments `create --image` builds from — a clean Ubuntu box, or
one with a coding agent already installed.

```
runta-next image list [options]
runta-next image delete <image> [options]
```

Noun-first with no top-level shortcut: only the runtime verbs get one, so every other resource reads
`runta-next <noun> <verb>` and you can guess the rest from one example.

## `image list`

| Option | Does |
| --- | --- |
| `--custom` | Show only images built by your organization |
| `--json` | Print the images as JSON |
| `-o, --output <mode>` | `auto` (JSON when not a terminal), `table`, or `json` |

```console
$ runta-next image list
ID                NAME               VCPUS  MEMORY  MODEL PROVIDER      KIND
claude            Claude Code            2    2048  anthropic_messages  —
clean             Clean runtime          1    1024  —                   default
cloud_agent       Runta Cloud Agent      2    4096  3 protocols         —
codex             Codex CLI              2    2048  openai_responses    —
cursor            Cursor CLI             2    2048  openai_chat         —
deepseek_harness  DeepSeek Harness       2    4096  3 protocols         —
exo               Exo                    2    4096  2 protocols         —
flue              Flue                   2    2048  anthropic_messages  —
hermes            Hermes Agent           4    4096  2 protocols         —
kimi              Kimi Code              2    2048  3 protocols         —
openclaw          OpenClaw               2    2048  3 protocols         —
opencode          OpenCode               2    2048  3 protocols         —
pi                Pi                     2    2048  3 protocols         —
```

`ID` is the value `create --image` takes. `KIND` marks `default` — the image used when you pass no
`--image` at all — and `custom`, for one your organization built.

## Why this command exists

The official CLI's `runta image ls` lists **only images you built yourself**, so on a fresh account
it returns an empty list while thirteen images are available:

```console
$ runta image ls
{ "action": "image-list", "images": [] }
```

That made `--image <id>` a flag whose valid values were undiscoverable from either CLI — you had to
open the Dashboard or call `GET /v2/images` by hand. `runta-next image list` is that call.

## `MODEL PROVIDER` decides whether you need another flag

An image that fronts a model provider needs a credential before its agent can authenticate, and
`create` has to know which protocol to wire up.

| Column shows | What it means for `create` |
| --- | --- |
| `—` | No provider. Nothing extra to pass. |
| A protocol name | Exactly one binding, so it is **inferred**. Nothing extra to pass. |
| `N protocols` | Several bindings, so `--model-provider-protocol` is **required**. |

Three protocol names side by side would push the `ID` column into an ellipsis, and the id is the one
cell you have to retype — so the table gives the count and `--json` gives the names:

```sh
runta-next image list --json | jq -r '.[] | select(.id == "opencode") |
  .model_provider.protocol_bindings[].protocol'
```

Recommended `VCPUS` and `MEMORY` come from the image's own catalog entry. Omit `--cpus` and
`--memory` on `create` and you get exactly these.

## JSON

`--json` returns the API's objects unprojected — including `disk`, `architectures`,
`exposed_ports`, and the full `model_provider` block the table compresses:

```console
$ runta-next image list --json | jq -r '.[] | "\(.id)\t\(.recommended_resources.memory_mib)"'
claude	2048
clean	1024
```

It is a plain array, so `.[]` works with no per-command key to learn.

## `image delete`

Deletes an image **your organization built**. The catalog images are not deletable.

| Option | Does |
| --- | --- |
| `--dry-run` | Show what would be deleted and exit |
| `-y, --yes` | Skip the confirmation prompt |
| `--json` | Print the result as JSON |
| `-o, --output <mode>` | `auto` (JSON when not a terminal), `table`, or `json` |

```console
$ runta-next image delete my-image --dry-run
Would delete custom image my-image (My Image).

$ runta-next image delete my-image
Delete custom image 'my-image'? This cannot be undone. [y/N] y
Deleted custom image my-image.
```

The confirmation appears only on a terminal — under `--json` or in a pipe it would hang, so scripts
are unaffected. `-y` skips it.

### Why it refuses before calling the API

The API answers `422 invalid_argument` — *"only custom Runtime Images can be deleted"* — for a
built-in image **and** for an id that does not exist at all. Those are different mistakes with
different fixes, and the status cannot tell them apart, so this resolves the name against the
catalog first:

```console
$ runta-next image delete claude
error 'claude' is a built-in image, and built-in images cannot be deleted.
Only images your organization built can be deleted: `runta-next image list --custom`.

$ runta-next image delete nope
error No image named 'nope'.
List what exists with `runta-next image list`.
```

## Next

```sh
runta-next create --name demo --image claude
```

An image that fronts a model provider will refuse without a credential — see
[`create`](./create.md).

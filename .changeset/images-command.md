---
'@haxzie/runta-next': minor
---

Add `runta-next images`, listing the runtime images `create --image` accepts.

The official CLI's `image ls` covers only images you built yourself, so on a fresh
account it returns an empty list while thirteen catalog images are available —
making `--image <id>` a flag whose valid values were undiscoverable from either
CLI without opening the Dashboard or calling `GET /v2/images` by hand.

The table carries id, display name, recommended vCPUs and memory, and a
`MODEL PROVIDER` column that answers whether `--model-provider-protocol` will be
required: a protocol name when exactly one is bound and therefore inferred, a count
when several are and the flag is mandatory. Disk is left to `--json`, because every
catalog image defaults to the same 32 GiB and the column would have cost width the
id needs. `--custom` narrows to images your organization built. `--json` returns the
API's objects unprojected, as a plain array.

---
title: runta-next logout
description: Revoke the current credential and remove it locally, including why revoking an environment token is permanent.
sidebar_position: 14
---

# `runta-next logout`

Revokes the current credential server-side, then removes it from the local config file.

```
runta-next logout [options]
```

| Option | Does |
| --- | --- |
| `--json` | Print the result as JSON |
| `-o, --output <mode>` | `auto` (JSON when not a terminal), `table`, or `json` |
```console
$ runta-next logout
Logged out.
```

```console
$ runta-next logout --json
{"status":"logged_out","revoked":true,"cleared":true}
```

| Field | Meaning |
| --- | --- |
| `revoked` | The API confirmed the credential is now invalid |
| `cleared` | A token was removed from `~/.runta-next/config.json` |

Both can be `false` — that is what "nothing to do" looks like:

```console
$ runta-next logout --json     # never logged in
{"status":"logged_out","revoked":false,"cleared":false}
```

## Revocation is permanent, and applies to env tokens too

:::danger
`logout` revokes whichever credential is in effect. If `RUNTA_TOKEN` is set in your
environment, **that key is destroyed** — for every machine, script and teammate using it — and
the CLI cannot unset your environment variable, so your shell keeps supplying a dead token.
You will see `{"revoked":true,"cleared":false}`, which is the tell.

Check first:

```sh
env | grep RUNTA_TOKEN
```
:::

## A failed revoke still clears locally

If the revoke call fails — the token was already invalid, or the API is down — the local token
is removed anyway. A credential the server has forgotten is one worth forgetting locally too,
and leaving it behind would only produce confusing 401s later.
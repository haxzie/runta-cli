---
title: runta whoami
description: Show the authenticated user, and why an organization API key is rejected here.
sidebar_position: 9
---

# `runta whoami`

Shows the currently authenticated user.

```
runta whoami [options]
```

| Option | Does |
| --- | --- |
| `--json` | Print the raw API response |

```console
$ runta whoami
Ada Lovelace <ada@example.com>
```

`display_name` is nullable in the API, so the email is used when there is no name:

```console
$ runta whoami
ada@example.com <ada@example.com>
```

## `--json`

Prints the response envelope exactly as the API returned it, so `jq` paths match the
[API reference](https://runta.com/docs/reference/api/operations/getme/):

```console
$ runta whoami --json
{
  "data": {
    "user_id": "800d9aa5-479a-4773-9a15-53d5a4193701",
    "email": "ada@example.com",
    "display_name": "Ada Lovelace"
  }
}
```

```sh
runta whoami --json | jq -r .data.email
```

Note the `data` wrapper — the API envelopes this response, and the CLI does not flatten it.

## Organization API keys

`whoami` calls `GET /v2/me`, which accepts only a **user** credential from the device flow.
An organization API key (`rt_…`) authenticates successfully but is rejected by this endpoint:

```console
$ runta whoami
error principal's role does not allow this organization action
This looks like an organization API key. `whoami` needs a user credential — run `runta login`.
exit 2
```

This is the API's design, not a CLI bug. An org key is still the right credential for
automation — it just cannot answer "which human am I".

## What it cannot tell you

`GET /v2/me` returns only `user_id`, `email` and `display_name`. It carries **no**
organization, scope or expiry information, and the API has no token-introspection operation,
so none of these are currently answerable:

- which organization this credential belongs to
- what the token is allowed to do
- when it expires
- whether the token came from `RUNTA_TOKEN` or from `login`

For the last one, see
[Which credential am I actually using?](../authentication.md#which-credential-am-i-actually-using).

## Exit codes

| Code | When |
| --- | --- |
| `0` | Profile printed |
| `1` | The API was unreachable, or failed for a non-credential reason |
| `2` | No credential, a rejected credential, or an org key on a user-only endpoint |

```console
$ runta whoami                                     # nothing set
error 403 Forbidden
No credential was sent. Run `runta login` or set RUNTA_TOKEN.
exit 2

$ RUNTA_TOKEN=rt_bogus runta whoami                # rejected
error invalid bearer credential
The token was rejected. Run `runta login` to get a new one.
exit 2
```

The hint distinguishes the three failures, which the raw status codes do not: the API answers
a *missing* credential with 403 and a *rejected* one with 401.

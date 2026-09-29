---
title: runta-next whoami
description: Show the authenticated user, and why an organization API key is rejected here.
sidebar_position: 14
---

# `runta-next whoami`

Shows which user and team the current credential belongs to. Reach for it when you are unsure
which account a command is about to act as — after switching tokens, or on a shared machine.

```
runta-next whoami [options]
```

| Option | Does |
| --- | --- |
| `--json` | Print the result as JSON |
| `-o, --output <mode>` | `auto` (JSON when not a terminal), `table`, or `json` |

```console
$ runta-next whoami
Logged in as Ada Lovelace <ada@example.com>
Active team: b2d2ce6e-7f85-4178-bf2a-56547cf3e4b8
```

`display_name` is nullable in the API, so the email is used when there is no name:

```console
$ runta-next whoami
Logged in as ada@example.com <ada@example.com>
Active team: b2d2ce6e-7f85-4178-bf2a-56547cf3e4b8
```

## Two calls, one of them optional

`whoami` calls `GET /v2/me` for the identity and `GET /v2/model-providers` for the
organization id — because **that is the only place the API exposes it**. There is no
organization, team or tenant endpoint, and `/v2/me` carries no organization field.

The second call is best-effort. Identity is the point of the command, so if the
model-providers call fails the team line is simply omitted rather than failing the whole
command:

```console
$ runta-next whoami
Logged in as Ada Lovelace <ada@example.com>
```

`--verbose` says why it was dropped.

## The team is a UUID, not a name

`Active team:` shows `organization_id`, because a human-readable organization name **does not
exist anywhere in the API**. No endpoint returns one, and Runta's own CLI binary contains no
`organization_name` or slug field either. Showing a name requires an API change; until then a
UUID is the honest answer.

## `--json`

Flattens both calls into one object. The `data` envelope the API wraps `/v2/me` in is
unwrapped, and `organization_id` is merged in:

```console
$ runta-next whoami --json
{
  "user_id": "800d9aa5-479a-4773-9a15-53d5a4193701",
  "email": "ada@example.com",
  "display_name": "Ada Lovelace",
  "organization_id": "b2d2ce6e-7f85-4178-bf2a-56547cf3e4b8"
}
```

```sh
runta-next whoami --json | jq -r .email
runta-next whoami --json | jq -r '.organization_id // "unknown"'
```

`organization_id` is **absent** when it could not be resolved, so use `//` rather than
assuming it is there.

## Organization API keys

`whoami` calls `GET /v2/me`, which accepts only a **user** credential from the device flow.
An organization API key (`rt_…`) authenticates successfully but is rejected by this endpoint:

```console
$ runta-next whoami
error principal's role does not allow this organization action
This looks like an organization API key. `whoami` needs a user credential — run `runta-next login`.
exit 2
```

This is the API's design, not a CLI bug. An org key is still the right credential for
automation — it just cannot answer "which human am I".

## What it cannot tell you

`GET /v2/me` returns only `user_id`, `email` and `display_name`. The organization id is
recovered from a second endpoint, but everything else is still unavailable — the API has no
token-introspection operation, so none of these are answerable:

- the organization's **name** (only its UUID exists, anywhere)
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
$ runta-next whoami                                     # nothing set
error 403 Forbidden
No credential was sent. Run `runta-next login` or set RUNTA_TOKEN.
exit 2

$ RUNTA_TOKEN=rt_bogus runta-next whoami                # rejected
error invalid bearer credential
The token was rejected. Run `runta-next login` to get a new one.
exit 2
```

The hint distinguishes the three failures, which the raw status codes do not: the API answers
a *missing* credential with 403 and a *rejected* one with 401.

---
title: Authentication
description: Sign in with the device flow, use a token in CI, and understand where the credential is stored and which source wins.
sidebar_position: 3
---

# Authentication

Every command except `hello` needs a credential. There are two ways to supply one.

## Interactive: `runta auth login`

```console
$ runta auth login
Your code is ABCD-1234
Opened your browser to approve it.
Waiting for authorization…
Authorized. Token saved to /Users/you/.runta/config.json
```

This is the [RFC 8628 device flow](https://datatracker.ietf.org/doc/html/rfc8628): the CLI
asks the API for a short code, opens your browser at a URL with that code pre-filled, and
polls until you approve. The resulting token is written to
[`~/.runta/config.json`](#where-credentials-live).

The browser is opened for you. If that is wrong for your situation — a remote shell, a
container, no desktop — the CLI detects it and prints the URL instead, and you can force
that with `--no-browser`. See [`runta auth login`](./commands/auth.md#runta-auth-login) for
all flags.

### It tolerates a flaky API

The device endpoints intermittently return HTTP 520. The CLI treats 5xx responses, dropped
connections and timeouts as noise: it keeps polling and only stops when the server says the
request was **denied**, when the code has **expired**, or when `expires_at` passes. Starting
the flow is retried up to four times with backoff.

Practically: a transient blip mid-login does not lose your approval.

## Non-interactive: `RUNTA_TOKEN`

Set an API key in the environment and no login is needed. Nothing is read from or written
to disk:

```sh
export RUNTA_TOKEN=rt_…
runta whoami
```

This is the right approach for CI, containers, and anything scripted:

```yaml
env:
  RUNTA_TOKEN: ${{ secrets.RUNTA_TOKEN }}
```

`RUNTA_TOKEN` **takes precedence over a stored login.** See
[precedence](./configuration.md#precedence) — and the warning below, because this is the one
part of the system that will surprise you.

## Signing out: `runta auth logout`

```console
$ runta auth logout
Logged out.
```

Two things happen, in order: the credential is **revoked server-side**, then it is removed
from the local config file. Revocation is permanent — the token cannot be used again by
anyone, including other machines where you pasted it.

If the revoke call fails, the local token is still cleared. A credential the server has
already forgotten is one worth forgetting locally too.

:::warning
`auth logout` revokes whichever credential is currently in effect — **including one that came
from `RUNTA_TOKEN`**. If you have an API key exported in your shell and run `auth logout`, that
key is destroyed for every consumer of it, and the CLI cannot remove it from your environment,
so your shell keeps supplying a now-dead token. Check `env | grep RUNTA_TOKEN` before signing
out.
:::

## Where credentials live

`~/.runta/config.json`, as plain JSON:

```json
{
  "token": "rt_…"
}
```

| Property | Value |
| --- | --- |
| File | `~/.runta/config.json` |
| File mode | `0600` (owner read/write only) |
| Directory mode | `0700` |
| Override | `RUNTA_CONFIG_HOME` sets the directory |

The directory is created on demand, so `auth login` works on a machine that has never run
`runta`. Other keys in the file — `apiUrl`, for instance — are preserved when the token is
written or cleared; the token is one field in a shared config file, not the whole document.

The token is stored **in plaintext**. `0600` keeps it away from other users on the machine,
but any process running as you can read it, and it will be included in home-directory backups.
This matches how `gh`, `aws` and `kubectl` store credentials. If that is not acceptable for
your threat model, use `RUNTA_TOKEN` from a secret manager instead and never run `auth login`.

## Which credential am I actually using?

There is currently no command that answers this — `whoami` tells you the *identity* the API
resolved, not which source the token came from. Until that exists, the quickest check is:

```sh
env | grep RUNTA_TOKEN                 # is an env var shadowing my login?
cat ~/.runta/config.json               # what did auth login store?
runta --verbose whoami 2>&1 | head -1  # which endpoint is being called
```

## Token scope matters for `whoami`

`runta whoami` calls `GET /v2/me`, which only accepts a **user** credential from the device
flow. An organization API key authenticates fine but is rejected here:

```console
$ runta whoami
error principal's role does not allow this organization action
This looks like an organization API key. `whoami` needs a user credential — run `runta auth login`.
```

That is expected, not a bug — see [`whoami`](./commands/whoami.md#organization-api-keys).

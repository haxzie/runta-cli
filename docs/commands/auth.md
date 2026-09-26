---
title: runta auth
description: Sign in with the device flow and sign out, including flags, JSON output, and the revocation caveat.
sidebar_position: 7
---

# `runta auth`

Sign in and out of Runta.

```sh
runta auth login
runta auth logout
```

---

## `runta auth login`

Signs in through a browser using a one-time device code, then stores the resulting token in
[`~/.runta/config.json`](../authentication.md#where-credentials-live).

```
runta auth login [options]
```

| Option | Does |
| --- | --- |
| `--json` | Stream NDJSON progress instead of prose |
| `--no-browser` | Print the URL instead of opening it |

### Interactive

```console
$ runta auth login
Your code is ABCD-1234
Opened your browser to approve it.
Waiting for authorization…
Authorized. Token saved to /Users/you/.runta/config.json
```

Approve the code in the browser and the command returns. Progress goes to stderr, so it stays
out of pipes.

### When the browser is the wrong machine

The CLI skips opening a browser when stdout is not a TTY, or when it detects an SSH session
(`SSH_CONNECTION` / `SSH_TTY`). Force that with `--no-browser`:

```console
$ runta auth login --no-browser
Your code is ABCD-1234
Open https://dashboard.runta.com/device?code=ABCD-1234 to approve it.
Waiting for authorization…
```

The URL has the code pre-filled, so it can be opened on any device.

### `--json`

Emits one compact JSON object per line as each stage completes:

```console
$ runta auth login --json --no-browser
{"status":"authorization_pending","user_code":"ABCD-1234","verification_uri_complete":"https://dashboard.runta.com/device?code=ABCD-1234","expires_at":"2026-09-26T09:50:41Z"}
{"status":"authorized","config_path":"/Users/you/.runta/config.json"}
```

| `status` | When | Fields |
| --- | --- | --- |
| `authorization_pending` | As soon as the code is minted, before polling starts | `user_code`, `verification_uri_complete`, `expires_at` |
| `authorized` | After the token is stored | `config_path` |

The first record arrives immediately, so a wrapper can show the code while the CLI is still
waiting. See [Output and scripting](../output-and-scripting.md#--json).

### Resilience

- Starting the flow is retried up to four times with backoff. A 4xx is not retried, because it
  will fail identically.
- While polling, 5xx responses, dropped connections and timeouts are ignored and polling
  continues. This matters: the device endpoints intermittently return HTTP 520.
- The flow ends only on **denial**, **expiry**, or when `expires_at` passes.
- Nothing is written to disk until a token is actually issued, so an abandoned or failed login
  leaves no state behind.

### Notes

- Any existing `RUNTA_TOKEN` is ignored for this command — the device flow is unauthenticated
  by definition, and sending a stale credential with it would be wrong.
- After a successful login, `RUNTA_TOKEN` still wins for every *other* command if it is set.
  See [precedence](../configuration.md#precedence).

### Exit codes

| Code | When |
| --- | --- |
| `0` | Token issued and stored |
| `1` | The API rejected the request |
| `2` | Authorization denied, code expired, or the API was unreachable after retries |

---

## `runta auth logout`

Revokes the current credential server-side, then removes it from the local config file.

```
runta auth logout [options]
```

| Option | Does |
| --- | --- |
| `--json` | Print the result as JSON |

```console
$ runta auth logout
Logged out.
```

```console
$ runta auth logout --json
{"status":"logged_out","revoked":true,"cleared":true}
```

| Field | Meaning |
| --- | --- |
| `revoked` | The API confirmed the credential is now invalid |
| `cleared` | A token was removed from `~/.runta/config.json` |

Both can be `false` — that is what "nothing to do" looks like:

```console
$ runta auth logout --json     # never logged in
{"status":"logged_out","revoked":false,"cleared":false}
```

### Revocation is permanent, and applies to env tokens too

:::danger
`auth logout` revokes whichever credential is in effect. If `RUNTA_TOKEN` is set in your
environment, **that key is destroyed** — for every machine, script and teammate using it — and
the CLI cannot unset your environment variable, so your shell keeps supplying a dead token.
You will see `{"revoked":true,"cleared":false}`, which is the tell.

Check first:

```sh
env | grep RUNTA_TOKEN
```
:::

### A failed revoke still clears locally

If the revoke call fails — the token was already invalid, or the API is down — the local token
is removed anyway. A credential the server has forgotten is one worth forgetting locally too,
and leaving it behind would only produce confusing 401s later.

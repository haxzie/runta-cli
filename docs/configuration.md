---
title: Configuration
description: Every environment variable the CLI reads, the config file format, and the precedence rules between them.
sidebar_position: 4
---

# Configuration

Two settings matter: which API to talk to, and which credential to use. Each can come from
the environment or from a config file.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUNTA_TOKEN` | — | Bearer credential. Skips `login` entirely |
| `RUNTA_API_URL` | `https://api.runta.com` | API base URL |
| `RUNTA_CONFIG_HOME` | `~/.runta` | Directory holding `config.json` |
| `RUNTA_LOG_LEVEL` | `info` | `silent`, `error`, `warn`, `info` or `debug` |
| `NO_COLOR` | — | Any value disables colour in diagnostics |

`--verbose` and `--quiet` override `RUNTA_LOG_LEVEL` for a single invocation.

## Config file

`~/.runta/config.json`, created by `runta login`. Both keys are optional:

```json
{
  "apiUrl": "https://api.runta.com",
  "token": "rt_…"
}
```

Set `RUNTA_CONFIG_HOME` to move the directory — useful for keeping profiles apart:

```sh
RUNTA_CONFIG_HOME=~/.runta-staging runta login
RUNTA_CONFIG_HOME=~/.runta-staging runta whoami
```

Note this is a **directory**, not a file path; the CLI always appends `config.json`.

A config file that is missing is normal. A config file that is unparseable, or whose root is
not a JSON object, is an error rather than something to overwrite — the CLI will not silently
destroy a file it cannot understand.

## Precedence

Highest wins:

```
token:    RUNTA_TOKEN     >  config.json "token"    >  (none)
endpoint: RUNTA_API_URL   >  config.json "apiUrl"   >  https://api.runta.com
```

Confirm what actually resolved with `--verbose`:

```console
$ runta --verbose whoami
debug loaded config from /Users/you/.runta/config.json
debug calling https://api.runta.com/v2/me
```

:::warning
`RUNTA_TOKEN` silently shadows a stored login. You can run `login` successfully and still
be making requests as a *different* identity, with nothing in the output to tell you. If
results look wrong, check `env | grep RUNTA_TOKEN` first.
:::

## Unrecognised variables are ignored

The CLI reads only the variables listed above. Anything else — including names you may know
from Runta's own Rust CLI — is **silently ignored**:

| You might try | Use instead |
| --- | --- |
| `RUNTA_ENDPOINT` | `RUNTA_API_URL` |
| `RUNTA_CONFIG` (a file path) | `RUNTA_CONFIG_HOME` (a directory) |
| `--endpoint`, `--token` flags | the environment variables above |

Setting `RUNTA_ENDPOINT` produces no error and no warning, so a typo or a half-remembered
name means you silently hit the default endpoint. Double-check with `--verbose` whenever the
target matters.

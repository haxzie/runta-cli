---
title: Output and scripting
description: JSON output, the stdout/stderr split, exit codes, and how to drive the CLI from a script or an AI agent.
sidebar_position: 5
---

# Output and scripting

## stdout is data, stderr is everything else

Results go to **stdout**. Progress, warnings, hints and errors go to **stderr**. So piping
never mixes the two:

```sh
runta-next whoami > who.txt        # only the identity lands in the file
runta-next whoami 2>/dev/null      # drop the commentary
```

Success counts as a result, not as commentary — `Authorized. Token saved to …`, `Deleted …`
and the `login` device code are on stdout. Routing them through stderr made a successful
`login` render entirely in red in terminals that colour stderr, so the line you were waiting
for looked like the thing that failed.

This is why `runta-next login` prints "Waiting for authorization…" on stderr while the code
itself goes to stdout: you can pipe one and watch the other.

## Choosing table or JSON

Output defaults to **`auto`**: a table when stdout is a terminal, JSON when it isn't. So a pipe
just works, with no flag to remember:

```sh
runta-next list | jq -r '.[].display_name'
```

`auto` is a default, not a trap — `-o table` and `RUNTA_OUTPUT` both take it back, which is the
difference between this and the behaviour recorded as
[C-08](https://github.com/haxzie/runta-cli/blob/main/CLI_ISSUES.md) in the upstream CLI, where
JSON off-TTY could not be turned off at all.

| You run | You get |
| --- | --- |
| `runta-next list` | Table |
| `runta-next list \| jq` | JSON |
| `runta-next list > out.txt` | JSON |
| `runta-next list -o table \| less` | Table |
| `runta-next list --json` | JSON |
| `RUNTA_OUTPUT=table runta-next list \| less` | Table |

Precedence runs most-explicit-first: the flag on the command, then `RUNTA_OUTPUT`, then the
shape of stdout. An explicit `-o table` beats `RUNTA_OUTPUT=json`, so pinning the variable in
CI never makes a flag lie.

`--json` is the explicit alias for `-o json` and is not going anywhere.

::: warning `exec` is the exception
`exec` streams the remote command's own bytes through unchanged, so it has no `-o` and never
switches format on its own. `runta-next exec demo -- cat report.pdf > report.pdf` writes the
file, not a JSON envelope around it. `--json` still works on `exec`, explicitly.
:::

## `--json`

Commands that return a result take `--json`.

**Single-result commands** print one pretty-printed JSON object — `whoami` returns the API
response envelope verbatim:

```console
$ runta-next whoami --json
{
  "data": {
    "user_id": "…",
    "email": "ada@example.com",
    "display_name": "Ada Lovelace"
  }
}
```

**`login` is a progress stream**, so `--json` emits [NDJSON](https://ndjson.org) — one
compact JSON object per line, written as soon as it is known:

```console
$ runta-next login --json --no-browser
{"status":"authorization_pending","user_code":"ABCD-1234","verification_uri_complete":"https://dashboard.runta.com/device?code=ABCD-1234","expires_at":"2026-09-26T09:50:41Z"}
{"status":"authorized","config_path":"/Users/you/.runta-next/config.json"}
```

The point is that the code is usable immediately rather than after the flow finishes, so a
wrapper can display it:

```sh
runta-next login --json | while read -r line; do
  code=$(jq -r 'select(.status == "authorization_pending") | .user_code' <<<"$line")
  [ -n "$code" ] && echo "Approve code: $code"
done
```

`jq` reads NDJSON without any flags.

## Next steps

Some commands print a short "next steps" block when they leave you mid-task:

```console
$ runta-next create --name demo --detach
Creating runtime 'demo'.

Next steps:
  runta-next inspect demo         check whether it is running yet
  runta-next delete demo          remove it when you are done
```

Three things are deliberate about it:

- **It goes to stderr**, like all other commentary. So it survives `--json` without touching the
  payload — `runta-next inspect demo --json 2>/dev/null` is still exactly the runtime object.
- **It only appears when there is something to do.** `inspect` on a healthy runtime prints none;
  `inspect` on a failed one suggests deleting and recreating. Advice after every command is advice
  nobody reads.
- **It never suggests the command you just ran.** That sounds obvious, but it is a real defect in
  Runta's own CLI, whose `resume` returns `required_action: runta-next resume <name>` — follow that
  field literally, as an agent would, and you loop.

Every command named in a suggestion or a hint is checked against the real command tree by a test,
so a suggestion cannot outlive the command it names.

## Colour

Diagnostics are coloured only when stderr is a TTY. `NO_COLOR` (any value) or `TERM=dumb`
disables it, and piping does too — no escape sequences end up in a log file.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Request failed, or the CLI could not reach the API |
| `2` | Credential problem: missing, rejected, insufficiently scoped, or an authorization that was denied or expired |

`2` is the "fix your credential" code, so scripts can branch on it:

```sh
runta-next whoami >/dev/null 2>&1
case $? in
  0) echo "authenticated" ;;
  2) echo "need to log in"; exit 1 ;;
  *) echo "runta-next or the API is unhappy"; exit 1 ;;
esac
```

Observed behaviour:

```console
$ runta-next whoami                              # no credential at all
exit 2
$ RUNTA_TOKEN=rt_bogus runta-next whoami         # rejected token
exit 2
$ RUNTA_API_URL=http://127.0.0.1:9 runta-next whoami   # unreachable
exit 1
```

## Network failures are normal errors

An unreachable API does not produce a stack trace — it becomes the same shaped error as
anything else, naming the URL it tried:

```console
$ RUNTA_API_URL=http://127.0.0.1:9 runta-next whoami
error Could not reach http://127.0.0.1:9: Unable to connect. Is the computer able to access the url?
```

## For AI agents

- Set `RUNTA_TOKEN` and never invoke `login` — the device flow needs a human with a
  browser.
- Pass `--json` explicitly. Unlike some CLIs, output does **not** change shape based on
  whether stdout is a TTY, so behaviour is identical interactively and in a pipe.
- Branch on the exit code, and on `status` for `login` records. Error text is for humans
  and may change.
- `runta-next <command> --help` is the authoritative flag list; this documentation is generated by
  hand and can lag.

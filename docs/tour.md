---
title: A tour of runta-next
description: One end-to-end session — sign in, create a runtime, run commands inside it, then tear it down.
---

# A tour of runta-next

This page walks the whole CLI in the order you would actually meet it: sign in, make a runtime,
do something inside it, look at it when it misbehaves, throw it away. Every command and flag here
is real. If you would rather read reference pages, start at [Commands](/commands/).

::: warning
`runta-next` is an experimental CLI, not the official `runta` one. It installs under its own name
and keeps its own credentials, so it can sit beside the official CLI without either noticing.
See [Installation](/installation).
:::

## 1. Sign in

```
$ runta-next login
Your code is BQDF-KXTW
Opened your browser to approve it.
Waiting for authorization…
Authorized. Token saved to /Users/you/.runta-next/config.json
```

`login` uses a device code, so it also works over SSH and in containers where the CLI cannot open
a browser — there the third line becomes `Open https://… to approve it.` instead. The token is
written with `0600` permissions inside a `0700` directory.

Confirm which account you are on whenever you are unsure:

```
$ runta-next whoami
Logged in as Musthaq <musthu.gm@gmail.com>
Active team: haxzie
```

Automation should skip `login` entirely and set a token in the environment:

```sh
export RUNTA_TOKEN=rt_...
```

`RUNTA_TOKEN` takes precedence over the config file, so CI never has to write a credential to
disk. See [Authentication](/authentication) for the full precedence chain.

## 2. Create a runtime

```
$ runta-next create --name demo --cpus 1 --memory 512
Creating runtime 'demo'…
Runtime 'demo' is running.

Next steps:
  runta-next exec demo -- uname -a  run a command inside it
  runta-next inspect demo          see its full state
  runta-next delete demo           remove it when you are done
```

`create` waits until the runtime can actually accept commands before returning. That is
deliberate: the usual next thing you do is run something inside it, and returning while the
runtime is still booting only moves the waiting into your script. Pass `-d`/`--detach` if you
would rather not wait, and the suggestions change to match — an unwaited runtime is not usable
yet, so the only sensible next step is checking on it.

Those `Next steps:` lines go to **stderr**, so they never pollute a pipe and they survive
`--json` without touching the payload.

To publish a port, or to start from a checkpoint instead of fresh:

```sh
$ runta-next create --name web -p 8080/https
$ runta-next create --name restored --from-checkpoint <id>
```

## 3. Run commands inside it

```
$ runta-next exec demo -- uname -a
Linux demo 6.1.0 #1 SMP x86_64 GNU/Linux
```

Everything after `--` is the command, passed through untouched — there is no shell on this side,
so your quoting is safe. `exec` keeps stdout and stderr separate and **exits with the inner
command's exit code**:

```
$ runta-next exec demo -- false
$ echo $?
1
```

Two exit codes are the CLI's own rather than the command's: `126` means the command could not be
run, and `125` means `exec` itself failed before the command ever started — a dropped connection,
say. The distinction matters if you retry on failure, because retrying a `126` will fail
identically forever.

Add `-it` for a real terminal, with a pty, window size and `TERM` all wired through:

```
$ runta-next exec demo -it -- sh
/ # ls /dev/pts
0
/ # exit
```

## 4. Look at what you have

`list` is the overview:

```
$ runta-next list
name  status   vcpus   memory  image             created
demo  running      1  512 MiB  base-ubuntu-22    2026-09-28T09:14:02Z
```

By default it shows only active runtimes; `-a`/`--all` adds the stopped, failed and deleting ones.

`inspect` is everything about one runtime, as a detail view rather than a one-row table:

```
$ runta-next inspect demo
Name        demo
ID          8f3c1e52-...
Status      running
Image       base-ubuntu-22
vCPUs       1
Memory      512 MiB now, 512 requested, 1024 max
Disk        16 GiB
Egress      open — no restrictions
Ingress     none
Idle policy suspend_only after 300s
...
```

It renders the effective state rather than raw fields, which matters most where the raw fields
mislead. An empty `allowlist` means *no egress at all* and an empty `denylist` means *no
restrictions*; `inspect` says which, and suggests a follow-up when a runtime is degraded, crashed
or silently cut off from the network.

Both commands take `--json`, which is the form to use from a script or an agent:

```sh
$ runta-next list --json | jq -r '.[] | select(.status != "running") | .display_name'
```

`list --json` is a bare JSON array of runtime objects. The shape does not change based on whether
stdout is a terminal, so what you get in a pipe is what you saw by hand — only colour varies, and
`NO_COLOR=1` turns that off everywhere. See [Output and scripting](/output-and-scripting).

## 5. Park it instead of destroying it

Deleting is not the only way to stop paying for a runtime. `stop` shuts it down and releases its
resources; `pause` keeps its memory so it comes back faster.

```
$ runta-next stop demo
Stopping 'demo'…
Runtime 'demo' is shutdown.

Next steps:
  runta-next start demo  bring it back to running
```

`start` brings it back from either, and — this is the part worth knowing — you do not have to
remember which. The API uses different endpoints for waking a stopped runtime and a paused one, but
`start` reads the current state and picks, so one verb covers all of them. There is no `resume` or
`boot` command to get wrong.

Asking for a state a runtime is already in is not an error and sends nothing:

```
$ runta-next stop demo
Runtime 'demo' is already shutdown.
```

That makes these safe in a script that cannot know the current state. See
[start, stop, pause](/commands/lifecycle) for the state table and the `--detach` semantics.

## 6. Clean up

```
$ runta-next delete demo
Deleting 'demo'…
Deleted 'demo'.
```

Check first when you are deleting from a list you did not hand-write:

```
$ runta-next delete demo staging --dry-run
Would delete 2 runtime(s):
  demo (8f3c1e52-…) — currently running
  staging (b1a77d90-…) — currently suspended
```

A dry run resolves every name against the API first, so it describes what would actually happen
rather than echoing back what you typed — but it changes nothing. Interactively, `delete` also
confirms before acting; `-y` skips that for unattended use, and a prompt is never shown under
`--json` or in a pipe where nothing could answer it. `delete` accepts several runtimes at once and
waits until they are really gone rather than merely accepted for deletion.

## Where to go next

- [Commands](/commands/) — the reference for every command and flag.
- [Authentication](/authentication) — tokens, precedence, and what `logout` revokes.
- [Output and scripting](/output-and-scripting) — `--json`, exit codes, colour rules.
- [Configuration](/configuration) — `~/.runta-next/config.json` and the `RUNTA_*` variables.

Agents: [`llms.txt`](/llms.txt) indexes these pages and [`llms-full.txt`](/llms-full.txt) is the
whole site as a single document.

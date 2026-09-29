# Demo recording script

A shot list for the submission video. Every command here was run against the live API on
2026-09-29 and the outputs below are what actually came back — they are captured, not composed, so
the recording should match. Where a shot replays an agent trial, the run id is cited.

**Target length: 5–6 minutes.** Four acts: the developer path, the agent path, a failure and
recovery, and the measurement.

## Setup before recording

```sh
export RUNTA_TOKEN=rt_…                 # never on screen; set it before you start recording
export PS1='$ '                         # a bare prompt keeps frames clean
printf '\e[8;40;100t'                   # 100×40 — wide enough that no table wraps
```

Build both CLIs so the comparison shots are real:

```sh
bun run scripts/build-binaries.ts runta-next-darwin-arm64
cd evals/cli-ab && ./setup.sh           # arm A: official 0.2.10, arm B: runta-next
```

Do not show `whoami` output if the account name is sensitive — it prints a real email.

---

## Act 1 — The developer path (~90s)

One breath per command. The point is that nothing needs explaining.

```console
$ runta-next --help
```

> **Say:** "2,233 characters. The official CLI's `--help` is 78,370 — the same content as JSON."
> Let the grouped headings sit on screen for a beat; that is the whole argument.

```console
$ runta-next create --name demo --cpus 1 --memory 512
Creating runtime 'demo'…
Runtime 'demo' is running.

Next steps:
  runta-next exec demo -- uname -a  run a command inside it
  runta-next inspect demo           see its full state
  runta-next delete demo            remove it when you are done
```

> **Say:** "It waited until the runtime could actually accept work, then told me what I can do
> next — and never suggests the command I just ran."

```console
$ runta-next exec demo -- sh -c 'echo hi > /tmp/x; cat /tmp/x'
hi

$ runta-next list --fields name,status,vcpus
NAME             STATUS   VCPUS
demo             running      1
jesting_kalong   running      1
prequel-dev      paused       2
```

```console
$ runta-next inspect demo
Name         demo
ID           01a0ecfb-e7fb-7251-aae2-879f4160c99b
Status       running
Image        clean
vCPUs        1
Memory       512 MiB now, 512 requested, 512 max
Disk         32 GiB
Egress       open — no restrictions
Ingress      none
Idle policy  disabled
SSH          enabled
VNC          disabled
Secrets      none
Revision     2
```

> **Say:** "`inspect` shows detail. The official `inspect` renders the same five-column table as
> `ps` while its JSON carries 45 fields — the command whose job is detail shows a human none of it."
> Point at **Egress: open — no restrictions**: upstream prints an empty denylist as
> `denylist / - / -`, identical to a fully locked-down one (C-10).

```console
$ runta-next delete demo --dry-run
Would delete 1 runtime(s):
  demo (01a0ecfb-e7fb-7251-aae2-879f4160c99b) — currently running

$ runta-next delete demo
Deleting 'demo'…
Deleted 'demo'.
```

> **Say:** "The official CLI has no `--dry-run`, `--yes`, `--force` or `--confirm` anywhere across
> 84 commands, on eight destructive operations."

---

## Act 2 — The agent path (~60s)

Same surface, machine side. Show that the shape does not change between a terminal and a pipe.

```console
$ runta-next list --fields name,vcpus --json
[
  {
    "name": "jesting_kalong",
    "vcpus": 1
  }
]

$ runta-next list --json | wc -c
4096
$ runta-next list --fields name,vcpus --json | wc -c
158
```

> **Say:** "Same names in the table and the JSON, so whoever read the table can write the `jq`.
> `memory` is `512 MiB` in the table and `512` in JSON — the unit belongs in a cell a person reads,
> not in a value a script does arithmetic on."

Then the honest beat, which is worth more than the number:

> **Say:** "26× smaller on the narrow path. We then re-ran the agent suite and it made no
> difference to total context, because most tasks never call `list`. We kept the flag and wrote
> down that it did not work — that is `Improvements.md` I-10."

Show the agents block at the foot of `--help`:

```console
$ runta-next --help | tail -18
For agents:
  Pass --json to any command that returns data. The shape does not change based on
  whether stdout is a terminal, so behaviour is identical interactively and in a
  pipe. Narrow a large payload with --fields, so you read only what you need.
  Branch on exit codes rather than message text — codes are stable, wording
  is not. Set RUNTA_TOKEN to skip runta-next login entirely.
```

---

## Act 3 — Failure and recovery (~2 min)

The centre of the video. Three shots, escalating.

### 3a. Our CLI: an agent invents a flag and recovers

Real, from `evals/cli-ab/runs/full2`, task T11, arm B. Show the transcript lines first:

```
[ERR] runta-next inspect $R --json --fields status,desired_status
[ok ] runta-next inspect $R --json | grep status; runta-next start $R; …
```

Then reproduce the error live:

```console
$ runta-next inspect demo --json --fields status
error: unknown option '--fields'

Usage: runta-next inspect [options] <runtime>

Show everything about one runtime

Arguments:
  runtime     runtime name or id

Options:
  --json      print the runtime as JSON
  -h, --help  display help for command
$ echo $?
1
```

> **Say:** "The agent learned `--fields` from `list` and assumed `inspect` had it. The error names
> the exact problem, prints the command's entire valid surface in the same output, and exits
> non-zero. It recovered on the very next command and passed the task. And it is telling us
> something: it wanted `--fields` on `inspect`, which is the command most tasks actually use. We
> have not built that yet."

### 3b. The official CLI: a contract that lies

The strongest shot. Do it in this order — help first, then the failure.

```console
$ runta help --json | jq -r '.command.subcommands[] | select(.name=="ps") | .args[]
      | "\(.long)  possible_values=\(.possible_values)  value_names=\(.value_names)"'
all  possible_values=["true","false"]  value_names=["ALL"]
full  possible_values=["true","false"]  value_names=["FULL"]

$ runta ps --all true
error: unexpected argument 'true' found

Usage: runta ps [OPTIONS]
$ runta ps --all
$ echo $?
0
```

> **Say:** "The machine-readable interface says this flag takes `true` or `false`. The CLI rejects
> exactly that. This is not hypothetical — two agents did it, in two different tasks, both
> immediately after reading the help that told them to."

Show one:

```
runs/full2, T2, arm A
[ok ] runta run --help | head -c 5000
[ok ] runta help --json | python3 -c "…"
[ERR] runta run --name … --cpus 1 --memory 512 --wait true
[ok ] runta run --name … --cpus 1 --memory 512 --wait
```

> **Say:** "It read the docs, followed them, failed, and recovered by ignoring what it had just
> read. The correct strategy against that CLI is to distrust its machine-readable contract — which
> is the opposite of what a machine-readable contract is for."

### 3c. A suggestion that points the wrong way

```console
$ runta list
error: unrecognized subcommand 'list'

  tip: a similar subcommand exists: 'tls'
$ echo $?
2
```

> **Say:** "The command it wants is `ps`. The tip is `tls` — certificate generation. Both agents
> ignored it, so this cost a turn rather than a wrong action, but a confidently wrong hint is worse
> than no hint, because an agent is built to act on it."

Then ours, and be fair about the limit:

```console
$ runta-next ps
error: unknown command 'ps'

Usage: runta-next <command> [options]
…
Runtimes:
  create      Create a runtime and wait until it can accept commands
  list        List runtimes
  …
$ runta-next lst
error: unknown command 'lst'
(Did you mean list?)
```

> **Say:** "No edit-distance algorithm can map `list` to `ps` — ours cannot either. It declines to
> guess and prints the whole surface instead. But `lst` is one edit from `list`, so there it does
> suggest. Guess when the evidence supports it; stay quiet when it does not."

---

## Act 4 — The measurement (~60s)

On screen: `evals/cli-ab/runs/full1/report.html`, or the table.

| Arm B, 9 tasks | official | runta-next |
| --- | --- | --- |
| Cost | $0.83 | $0.47 |
| Turns | 79 | 38 |
| `--help` calls | 37 | 14 |
| Context read | 93.4k chars | 44.6k chars |
| CLI errors | 3 | 0 |

> **Say:** "Two headless agents, same model, same tasks, isolated `PATH` per arm, graded against
> the tenant's real state by a REST client that is independent of both CLIs."

Then the two things that make this evidence rather than marketing:

> **Say:** "Pass rate was a tie — 12 out of 12 both ways. The official CLI is not incapable; it is
> expensive. And the caveat: these tasks were written from our own audit of that CLI, and ours was
> built to fix those findings. So this measures what the known defects cost an agent — not which
> CLI is better in general. A suite written against our weak spots would read differently, and
> nobody has written one."

Close on:

```console
$ cd evals/cli-ab && bun src/run.ts --trials 1
```

> **Say:** "It is reproducible. That is the point."

---

## Shot discipline

- **Never show a token.** `RUNTA_TOKEN` is exported before recording starts.
- **Do not speed up command output.** A `create` that takes 20 seconds should look like it takes 20
  seconds — the wait is a design decision (`create` returns when the runtime can accept work), and
  hiding it undersells it.
- **Show exit codes.** `echo $?` after every failure. It is half the argument in Act 3.
- **Clean up on camera.** The last real command is a `delete`, because the brief asks for resource
  cleanup and it costs five seconds to prove.
- Leave each error on screen long enough to read. Act 3 is the part worth pausing on.

## Afterwards

Verify nothing was left behind:

```sh
runta-next list --all --fields name,status
```

## A note on tooling

Nothing in this repository records video. `ffmpeg` and `prequel` are available on this machine;
`asciinema` and `vhs` are not. Whatever records it, the commands and outputs above are the
contract — they were captured from real runs and should be reproduced, not re-enacted from memory.

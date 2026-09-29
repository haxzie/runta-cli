# Failure and recovery

What happens when an agent gets something wrong, and whether the CLI lets it get back on track
without a human.

Every transcript here is real. The agent ones come from `evals/cli-ab/runs/`, where two headless
Claude Code agents were given the same tasks — one with only the official CLI on its `PATH`, one
with only `runta-next` — and graded against the tenant's real state. Run ids are cited so each can
be reread. The direct `console` sessions were captured against the live API on 2026-09-29 and can
be re-run.

The claim is narrow and worth stating up front: **pass rate was a tie.** Across 12 head-to-head
tasks both CLIs scored 12/12. Neither tool prevented an agent from finishing. What differs is how
much it cost to get there, and recovery is a large part of that cost.

---

## 1. Our CLI: an agent reaches for a flag that does not exist

`runs/full2`, task T11, arm B. The task asks the agent to write to `/tmp` and `/root`, stop the
runtime, start it, and report which file survived.

Mid-task the agent invented a flag:

```
[ok ] runta-next inspect ev-full2-b-t11-1-life --json; runta-next stop --help
[ERR] R=ev-full2-b-t11-1-life; runta-next exec $R -- sh -c 'echo marker > /tmp/m; …' \
        && runta-next stop $R; runta-next inspect $R --json --fields status,desired_status
[ok ] R=ev-full2-b-t11-1-life; runta-next inspect $R --json | grep status; runta-next start $R; …
```

It had just learned `--fields` from `list --help` and assumed `inspect` had it too. What it got:

```console
$ runta-next inspect jesting_kalong --json --fields status,desired_status
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

The agent recovered on the **next** command and finished the task, which it passed.

Three properties made that one turn instead of several. The error names the specific thing that was
wrong (`unknown option '--fields'`) rather than a generic parse failure. It prints the command's
**complete** valid surface, so the correction is in the same output as the complaint — no follow-up
`--help` round-trip. And it exits non-zero, so the agent's tooling flagged it as an error rather
than letting a silent failure pass as success.

It is also, unprompted, the best argument for a change we have not made. The agent did not guess
randomly: it wanted to narrow `inspect`'s output, which is the command most tasks actually use.
`Improvements.md` I-10 reaches the same conclusion from aggregate numbers; this transcript is an
agent reaching for it directly.

---

## 2. The official CLI: a machine-readable contract that is wrong

This is the most expensive failure pattern we observed, because it punishes an agent precisely for
reading the documentation.

`runta help --json` is the official CLI's machine-readable interface. For boolean flags it
advertises that they take a value:

```console
$ runta help --json | jq -r '.command.subcommands[] | select(.name=="ps") | .args[]
      | "\(.long)  possible_values=\(.possible_values)  value_names=\(.value_names)"'
all  possible_values=["true","false"]  value_names=["ALL"]
full  possible_values=["true","false"]  value_names=["FULL"]
```

Both fields say the same thing: this flag takes `true` or `false`. The CLI rejects that form:

```console
$ runta ps --all true
error: unexpected argument 'true' found

Usage: runta ps [OPTIONS]
$ runta ps --all
$ echo $?
0
```

This is `CLI_ISSUES.md` C-06, which predicted that "an agent reading it literally writes
`runta ps --all true` and fails." Two agents did exactly that, in two separate tasks:

**`runs/full2`, T2, arm A** — the clearest instance. The agent consulted `run --help` and
`help --json` across two turns, then wrote the documented form, failed, and recovered by ignoring
what it had just read:

```
[ok ] runta run --help | head -c 5000
[ok ] runta help --json | python3 -c "… for s in d['command']['subcommands']: if s['…"
[ERR] runta run --name ev-full2-a-t2-1-a --image clean --cpus 1 --memory 512 --wait true
[ok ] runta run --name ev-full2-a-t2-1-a --image clean --cpus 1 --memory 512 --wait
```

**`runs/full2`, T6, arm A** — same defect, same run, different flag. The agent read `help ps` in
the immediately preceding turn:

```
[ok ] runta help ps 2>&1 | python3 -c "… for a in d['command']['args']: print(a['id'], …"
[ERR] runta ps --all --json true 2>&1 | tee /tmp/ps_all.json | python3 -c "…"
[ok ] cat /tmp/ps_all.json | head -c 1500; runta ps --all 2>&1 | head -c 3000
```

Both agents recovered in one turn, so the task outcome was unaffected. That is the point worth
being precise about: **the defect did not cause failures, it caused waste.** An agent that trusts
the machine-readable contract is penalised, and the correct strategy is to distrust it — which is
the opposite of what a machine-readable contract is for.

`runta-next` has one boolean convention, bare `--flag` and `--no-flag`, with no values advertised
anywhere.

---

## 3. The official CLI: a suggestion that points the wrong way

`runs/full1` and `runs/full2`, T7, arm A — the same first move in both runs. The agent guessed the
most common name for a list command:

```console
$ runta list
error: unrecognized subcommand 'list'

  tip: a similar subcommand exists: 'tls'

Usage: runta [OPTIONS] <COMMAND>
$ echo $?
2
```

The command it wanted is `ps`. The suggestion is `tls` — string-edit distance from `list`, with no
regard for what either command does. An agent following the tip lands on certificate generation.

In practice both agents ignored it and ran `runta --help`, so the cost was a wasted turn rather
than a wrong action. But a hint that is confidently wrong is worse than no hint: it is exactly the
kind of output an agent is designed to act on.

The comparison needs care, because no edit-distance algorithm can map `list` to `ps` — that needs
domain knowledge. Ours cannot do it either. What it does instead is decline to guess and print the
whole surface:

```console
$ runta-next ps
error: unknown command 'ps'

Usage: runta-next <command> [options]
…
Runtimes:
  create                       Create a runtime and wait until it can accept commands
  list                         List runtimes
  …
$ runta-next lst
error: unknown command 'lst'
(Did you mean list?)
```

So the rule is narrower than "do not guess": suggest when the evidence supports it — `lst` is one
edit from `list` — and stay silent when it does not, letting the command list answer the question.
The official CLI's failure is not that it guessed, it is that it guessed on evidence that could not
support the guess.

`runta-next` has no `ps` by deliberate choice (`Improvements.md` I-3: no compatibility aliases),
so this is the exact path a user arriving from the official CLI takes. `CLI_ISSUES.md` C-26 covers
why `list` was an unreasonable guess only in hindsight — upstream has `ls` in some groups, `list`
in others, and `ps` at the top level.

---

## 4. Where we are not better

Honesty matters more here than a clean scoreboard, and the not-found path is a case where the
official CLI does the right thing.

```console
$ runta exec no-such-runtime-xyz hostname
{
  "error": {
    "code": "NOT_FOUND",
    "kind": "rpc",
    "message": "runtime 'no-such-runtime-xyz' was not found",
    "required_action": { "command": "runta ps -a --json", "type": "run_command" }
  }
}
$ echo $?
1
```

```console
$ runta-next exec no-such-runtime-xyz -- hostname
error Runtime 'no-such-runtime-xyz' was not found.
List what exists with `runta-next list --all`.
$ echo $?
1
```

Both name the runtime, both suggest a real next command, both exit 1. The official CLI's version is
arguably better for an agent — `required_action` is a structured field rather than prose to parse.
Ours is better for a human reading a terminal. This is a genuine difference in emphasis, not a
defect, and it is worth noting that the official CLI's `required_action` idea is good; C-11 is about
the cases where it points at the command that just ran, not about the mechanism.

Task T12 exists to grade this path, and **both arms passed it in every run.** Neither CLI invented a
hostname for a runtime that never existed, and neither created one to satisfy the request.

---

## 5. Recovery is not the same as retry

One design decision deserves separate mention because it is the case where the right answer is to
*not* recover.

The official `exec` fails spuriously about 10% of the time (`CLI_ISSUES.md` C-01): 5 of 50
successful commands returned `status: null` and exit `1`. The instinct is to retry. That is wrong
when the command may have had side effects — a retried `apt install`, migration or build is not
free, and a CI pipeline that re-runs work that already succeeded is a worse outcome than a clear
stop.

`asyncapi.yaml`, the AsyncAPI description of the exec WebSocket, is explicit: an `error` frame or a
connection closing before `exit` leaves the command's result **unknown**, and a command with side
effects must not be retried automatically. `runta-next` therefore reports three outcomes rather
than two, with `125` for "unknown" distinct from the command's own non-zero codes, so a caller can
branch on it. The reasoning is in `Improvements.md` I-8; the tests citing it by name are in
`packages/api/src/exec.test.ts:190` and `apps/cli/src/commands/exec.test.ts:338`.

Reporting an unknown outcome as a failure is itself a defect. It just looks like robustness.

---

## What makes a recoverable error

Drawn from the above, and the rules these feed into are in
[`.claude/skills/cli-design/`](.claude/skills/cli-design):

1. **Name the specific thing that was wrong.** `unknown option '--fields'`, not a parse error.
2. **Print the valid surface in the same output.** The fix and the complaint arrive together, so
   recovery does not cost a `--help` round-trip.
3. **Exit non-zero, with stable codes.** `0` success, `1` request failed, `2` credential problem,
   `125` unknown outcome. Branch on codes, never on wording.
4. **Do not guess.** A confidently wrong suggestion (`list` → `tls`) is worse than admitting
   ignorance, because an agent will act on it.
5. **Never point at the command that just ran** (C-11) **and never name a command that does not
   exist** (C-30). `suggest.test.ts` resolves every suggestion against the real command tree, so
   this is enforced rather than remembered.
6. **Make the machine-readable contract true.** The C-06 failures above are not agents behaving
   badly; they are agents behaving correctly against a contract that lied.

## Reproducing this

```sh
cd evals/cli-ab
./setup.sh
export RUNTA_TOKEN=rt_…  ANTHROPIC_API_KEY=sk-ant-…
bun src/run.ts --trials 1

# then read any trial's commands and errors:
jq -r '. as $r | .commands[] | select(.isError) | "\($r.task)-\($r.arm): \(.command)"' \
  runs/<run-id>/results.jsonl
```

Full method, metrics and caveats are in [`evals/cli-ab/README.md`](evals/cli-ab/README.md) and
[`evals/cli-ab/FINDINGS.md`](evals/cli-ab/FINDINGS.md).

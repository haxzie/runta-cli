# What the A/B eval found

Results and analysis from running [the eval](README.md). This file records what the runs showed and
what it means; it is not an audit of the official CLI. Audit findings live in
[`CLI_ISSUES.md`](../../CLI_ISSUES.md) as `C-NN` points, and nothing here has been added there.

## Run `full1` — 2026-09-29

Nine tasks, both arms, one trial each. Model `claude-sonnet-5-5`. Arm A is the official
`@runta/runta-cli@0.2.10`; arm B is runta-next 0.6.1 built from `vancouver`. T8 was retired before
this run (see [README](README.md#t8-is-retired)).

### Pass rate: a tie

| Task | runta (official) | runta-next |
| --- | --- | --- |
| T1 Who am I signed in as *(capability gap)* | 0/1 | 1/1 |
| T2 Create, inspect the OS, delete | 1/1 | 1/1 |
| T3 Exit code and a file | 1/1 | 1/1 |
| T4 Keep stdout, drop stderr | 1/1 | 1/1 |
| T5 Pipe a local file in | 1/1 | 1/1 |
| T6 Inventory as JSON | 1/1 | 1/1 |
| T7 Delete by prefix, safely | 1/1 | 1/1 |
| T9 Read a runtime's configuration | 1/1 | 1/1 |
| T10 Create with a full spec | 1/1 | 1/1 |
| **Head-to-head** | **8/8** | **8/8** |

Both CLIs can do everything the suite asks. T1's failure is the expected capability gap — the
official CLI has no `whoami` (C-20) — and the agent handled it honestly: *"Unable to determine.
`runta` has no command that reveals the signed-in account."*

**This matters for how the rest of the numbers should be read.** runta-next did not succeed where
the official CLI failed. It cost less to drive. That is an efficiency result, not a capability one.

### Effort: not a tie

Totals across nine trials per arm.

| | runta (official) | runta-next | |
| --- | --- | --- | --- |
| Agent cost | $0.83 | $0.47 | 1.8× cheaper |
| Turns | 79 | 38 | 2.1× fewer |
| Wall clock | 308s | 170s | 1.8× faster |
| CLI calls | 65 | 28 | 2.3× fewer |
| `--help` calls | 37 | 14 | 2.6× fewer |
| CLI output read | 93.4k chars | 44.6k chars | 2.1× less context |
| CLI errors | 3 | 0 | — |

## Why the gap exists

Four mechanisms, all visible in `runs/full1/trials/*/transcript.jsonl`.

### 1. Help output that cannot be read (the dominant cause)

| `--help` output | Size | Format |
| --- | --- | --- |
| `runta` | 78,370 chars | JSON (the whole clap command tree) |
| `runta-next` | 2,233 chars | grouped text |

35×, and it is a format difference rather than a content one: the official CLI dumps its whole
clap command tree as JSON. That is not skimmable, so the agent stops trying to read it and writes a
parser instead:

```
runta help exec 2>&1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
def walk(c):
    if c['name']=='exec': …
```

That pattern recurs in T4, T7, T9 and T10. Each occurrence is a turn spent building scaffolding to
read documentation, and it usually extracts only a fragment, so the agent comes back for more. This
accounts for most of the 37-vs-14 help calls and most of the context gap — 93k characters is roughly
23k tokens the agent had to read and re-read. It is C-31 showing up as a measurable bill.

### 2. Guessing at command names

T7, arm A, in order:

```
runta list   →   runta ls   →   runta ps   →   runta ps --all
```

Four attempts to find the verb for "show me the runtimes", one of which counted as a CLI error. Arm
B ran `runta-next list` and got it.

### 3. Configuration scattered across commands

T9 asks for four values about one runtime. Arm A ran `inspect`, searched `ports --help` and
`egress --help`, then ran `egress get` and `ports list` — three commands to assemble what one
question asked for. Arm B ran `runta-next inspect <name> --json` once.

### 4. An affordance that matched the task

T7 asks to show the plan before deleting. Arm B used `delete … --dry-run`. Arm A has no such flag,
so it reconstructed the plan by listing, deleting, and listing again — which is C-09, and the reason
the task is graded at all.

Note the shape of all four: none is about the hard part of the task. Both agents knew what they
wanted to do; one of them could express it. The single most expensive decision in the official CLI
is emitting 78k characters of JSON from `--help`, and that is not a deep architectural problem.

### One metric where runta-next loses

T6: 11.2k chars read vs arm A's 7.5k. Not a regression — the agent chose `runta-next list --json`,
which returns full runtime objects, where arm A's route returned less. Correct answer, more verbose
path.

## Caveats

**The suite is not a neutral benchmark.** The tasks were written from `CLI_ISSUES.md` — T3 is C-01,
T4 is C-16, T7 is C-09, T9 is C-07, and the retired T8 was C-36 — and runta-next was built to fix
those same findings. The suite therefore probes precisely the defects one arm was designed to
address. The defects are real and the costs they impose are real, but this measures *how much the
known findings cost an agent*, not *which CLI is better in general*. A suite drawn from
runta-next's own weak spots would read differently, and nobody has written one.

**One trial per cell.** The effort ratios are consistent across nine tasks, so the direction is
unlikely to move, but no single number here has error bars. The README also notes the official
`exec` flakes about 10% of the time, which one trial per cell cannot surface.

**Shared tenant.** Both arms see each other's runtimes in `list` output. The noise hits both arms
equally.

## Open question: C-36's severity

C-36 (*an ambiguous runtime name silently resolves to the first match*) is rated `high`. Probing on
2026-09-29 found the state it describes is not reachable through the API:

- creating a second runtime with an existing name returns `409 already_exists`
- deleting the first frees the name for reuse but never leaves two live runtimes sharing one
- `/v2/checkpoints` is GET-only, so there is no restore path
- both CLIs match names exactly and reject partial ids, so no near-miss naming reproduces it

C-36's own evidence is a transcript against a local mock server on `127.0.0.1:8801` hand-configured
to return two same-named runtimes; the claim that a user can reach the state "by passing `--name`
twice" appears never to have been checked against the real API. Whether the API once permitted
duplicates or never did is unestablished.

The CLI-side behaviour is real either way — the official CLI does not check uniqueness before
acting, and `rm` acts on the first match. What is in question is whether a user can ever trip it.
**Re-rating C-36 has not been done and is left to the maintainer.**

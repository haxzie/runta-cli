# What the A/B eval found

Results and analysis from running [the eval](README.md). This file records what the runs showed and
what it means; it is not an audit of the official CLI. Audit findings live in
[`CLI_ISSUES.md`](../../CLI_ISSUES.md) as `C-NN` points, and nothing here has been added there.

Earlier runs (`full1`, `full2`) were made before runta-next 0.9.0 changed the output contract, and
their raw transcripts are gitignored and no longer on disk. They have been dropped rather than kept
alongside numbers they cannot be compared with.

## Run `clean1` — 2026-09-30

Fifteen tasks, both arms, one trial each, 30 trials. Model `claude-sonnet-5`. Arm A is the official
`@runta/runta-cli@0.2.10`; arm B is `@haxzie/runta-next@0.11.2` installed from the published
release. Each agent ran with its own empty `HOME` and only its arm's CLI on `PATH`.

### Pass rate: a tie

**13/13 both arms**, excluding the two tasks the official CLI has no command for.

| | runta | runta-next |
| --- | --- | --- |
| Head-to-head (13 tasks) | 13/13 | 13/13 |
| T1 — who am I signed in as | 0/1 | 1/1 |
| T15 — which images can I build from | 0/1 | 1/1 |

The official CLI is not incapable, and no run has ever suggested otherwise. Both capability gaps are
absences rather than defects: there is no `whoami` (C-20), and `image ls` lists only images the
organization built, so the catalog is unreachable.

### Effort: where the difference is

| Total, 15 tasks | runta | runta-next | |
| --- | --- | --- | --- |
| Cost | $2.44 | $1.07 | 2.3× |
| Turns | 194 | 82 | 2.4× |
| CLI calls | 144 | 64 | 2.3× |
| **Help calls** | **71** | **18** | **3.9×** |
| CLI output read | 199.5k chars | 122.1k chars | 1.6× |

Help is the largest multiplier, as in every previous run. `runta --help` is 78,370 characters of
clap's command tree as JSON; nothing skims that, so agents write a parser instead. **28 commands
across this run piped help output into `python3` or `jq`** — each one a turn spent building
scaffolding to read documentation, and each usually extracting a fragment, so the agent comes back.

### The two extremes

**T15 is the worst case for arm A**: 41 turns, $0.66, 379 seconds, 13 help calls, 41.7k characters
read — and no answer. `image ls` returns `[]` on a tenant with no custom images, and there is no
other route to the catalog, so the agent explored until it ran out of places to look. Arm B: 4
turns, $0.07, 17 seconds.

**T13 is the sharpest small case**: arm A took 8 turns and **6 CLI errors** to make `echo` print
`--json --verbose -h`, against arm B's 2 turns and 0 errors. The argument boundary is where a CLI
either passes flags through or acts on them.

### Where arm A won

Worth stating, because a suite written from one CLI's defects will otherwise read as a sweep.

- **T12** — a runtime that does not exist. Arm A: 2 turns, 240 characters read. Arm B: 3 turns,
  5.6k. The official CLI's `NOT_FOUND` is terse and immediately conclusive; ours says more than the
  agent needed.
- **T14** — the same question in three runtimes. Arm A read 6.2k characters, arm B read 13.2k. Our
  `list` output is larger, and `--fields` did not get used to narrow it.

### T16 passed on both arms, and the grader cannot tell them apart

Both answered "no — the agent is not signed in", which is correct: the runtime reaches `running`
with `degraded: false` and its agent prints `Not logged in` (C-33). They reached it differently.

Arm B created the runtime, probed the agent, and reported `sign_in_pending`. **Arm A never created
the runtime at all** — it hit the credential refusal, never found `--runtime-sign-in`, and inferred
the answer from the failure, spending 21 turns and 6 CLI errors doing it.

Same verdict, different epistemics, and the grader passes both. That is a weakness in the task, not
a result: it rewards an agent that gave up for the right reason as much as one that checked. Fix the
grader before anyone leans on T16.

### Caveats

**One trial per cell.** Directions are consistent across tasks; individual numbers have no error
bars. T16 in particular turned on whether one agent discovered one flag.

**The suite was written from `CLI_ISSUES.md`,** and runta-next was built to fix those same findings,
so it probes precisely the defects one arm was designed to address. The defects are real and the
costs are real, but this measures **how much the known findings cost an agent**, not which CLI is
better in general. A suite drawn from runta-next's own weak spots would read differently, and nobody
has written one.

**C-06 was not exercised by any agent in this run.** No trial tried the `--flag true` form that the
official `help --json` advertises. The defect is still live — verified directly on 2026-09-30, where
`--all` and `--full` both advertise `possible_values=['true','false']` and `runta ps --all true`
returns `UNKNOWN_ARGUMENT` — but this run is not evidence that agents hit it.

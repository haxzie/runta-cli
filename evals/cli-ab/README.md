# CLI A/B eval: runta-next vs the official CLI

Gives the same tasks to two headless Claude Code agents. One can reach only the official CLI
(`runta`, `@runta/runta-cli`), the other only `runta-next`. Each result is graded against the
tenant's real state, and the report compares pass rate, turns, cost, CLI errors, and how much CLI
output each agent had to read.

Every task stays within what runta-next implements today: `create`, `list`, `inspect`, `delete`,
`exec` and `whoami`.

## Setup

```sh
cd evals/cli-ab
./setup.sh                                   # official 0.2.10 from npm + latest runta-next release
OFFICIAL_VERSION=0.2.10 RUNTA_NEXT_VERSION=v0.5.0 ./setup.sh   # pin both
RUNTA_NEXT_BIN=/path/to/runta-next ./setup.sh                  # test a local build
```

This fills `.arms/A/bin` and `.arms/B/bin`. Each bin directory holds one CLI plus `node` and `jq`,
and nothing else. An agent's `PATH` is its arm's bin directory plus `/usr/bin:/bin`. Before
anything runs, the runner checks that the other arm's CLI can't be found.

Each CLI is a small wrapper that refuses `login`, `logout` and `upgrade`. Both arms share one
`RUNTA_TOKEN`, and `runta-next logout` revokes that token server-side, which would break every
trial after it.

## Running

```sh
export RUNTA_TOKEN=rt_…                 # the one tenant both arms use
export ANTHROPIC_API_KEY=sk-ant-…       # or CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`

bun src/run.ts --tasks T2,T3 --trials 1          # smoke run: 4 trials
bun src/run.ts --trials 5                        # full run: 13 tasks × 2 arms × 5 = 130 trials
```

| Option | Default | |
| --- | --- | --- |
| `--trials` | `5` | Trials per task per arm |
| `--tasks` | all but retired | Comma-separated, e.g. `T2,T7` |
| `--arms` | `A,B` | |
| `--model` | `$EVAL_MODEL` or `claude-sonnet-5` | Same model for both arms. Preflight refuses an unrecognised id, because the CLI warns and serves a fallback rather than failing |
| `--max-turns` | `40` | Per agent |
| `--budget-usd` | `3` | Per agent (`--max-budget-usd`) |
| `--timeout-min` | `15` | Kills the agent after this |
| `--concurrency` | `1` | See [one tenant](#one-tenant) |
| `--run-id` | random | Names the run directory and prefixes every runtime |

`RUNTA_API_URL` overrides the endpoint. It is passed to runta-next as `RUNTA_API_URL` and to the
official CLI as `RUNTA_ENDPOINT`.

The results go in `runs/<run-id>/`:

```
run.json             options and CLI versions
results.jsonl        one row per trial: grade, notes, metrics, every command, runtimes seen
summary.md           pass rates, median effort, failures to review
report.html          the same, as a page
trials/T3-B-2/       transcript.jsonl, stderr.log, and the agent's working directory
```

Rebuild the report from results with `bun src/report.ts runs/<run-id>`.

If a run is interrupted, delete what it left behind:

```sh
bun src/cleanup.ts                  # dry run: lists every runtime starting with ev-
bun src/cleanup.ts --run-id k3f9 --yes
```

## How each trial is isolated

- **Only the CLI and `--help`.** The agent has `Bash`, `Read`, `Write`, `Edit`, `Glob` and `Grep`,
  and nothing else: no web, no MCP servers, no skills. `curl` and `wget` are denied, so it can't
  go around the CLI to the API.
- **Nothing from this repo.** The agent's working directory and `HOME` are fresh temporary
  directories outside the repo. Claude Code looks upward from its working directory for
  `CLAUDE.md` and `.claude/skills`, and this repo's `cli-design` skill describes runta-next.
- **Real command names.** The prompt calls the tool `runta` in arm A and `runta-next` in arm B, and
  never mentions a flag.
- **One prefix per trial.** Every runtime a trial uses is named `ev-<run>-<arm>-<task>-<trial>…`.
  The agent is told the account is shared and to leave everything else alone.

Each trial has four steps:

1. A fixture seeds whatever runtimes the task needs, through the REST API
   ([src/api.ts](src/api.ts)). That client is independent of both CLIs.
2. The agent runs. Meanwhile a watcher polls the API, so graders can see runtimes the agent created
   and then deleted.
3. The grader checks the API and the agent's final `ANSWER:` line.
4. Everything with the trial's prefix is deleted, whether or not the trial passed.

## Tasks

| # | Task | Exercises | Graded by |
| --- | --- | --- | --- |
| T1 | Which account is this signed in as? | `whoami`. The official CLI has none (C-20), so this is scored outside the head-to-head | The email, or, for an org API key, recognising that it is one |
| T2 | Create `P-a` (clean, 1 vCPU, 512 MiB), report its architecture and OS, delete it | create, exec, delete | Watcher saw the right size and image reach `running`; answer names both; nothing left behind |
| T3 | Write `hello` to `/tmp/x`, exit 42; report both; clean up | exit-code propagation (the official exec flakes, C-01) | `42 \| hello`; nothing left behind |
| T4 | Save only stdout of `echo out; echo err >&2` to `./out.txt` | keeping stdout and stderr apart (C-16) | `out.txt` is `out`; runtime not deleted |
| T5 | Get `./data.csv` into a runtime, sum a column with awk there | stdin, or `cp` on the official CLI | Correct sum, and awk ran through the CLI |
| T6 | Write `./inventory.json` of every `P*` runtime, including non-running | list with every status, `--json` | Names, statuses and vCPUs match the API |
| T7 | Delete `P-tmp*`, keep `P-keep` and `P-keep-tmp`; show the plan first | care before a destructive action (C-09) | Right runtimes gone; something was listed before the first delete |
| ~~T8~~ | ~~Run `nproc` in `P-dup`, a name two runtimes share~~ | ~~ambiguous names (C-36)~~ | **Retired — see below** |
| T9 | Report requested and max memory, egress, and ports of `P-cfg` | inspect; an empty denylist means unrestricted | All four values right |
| T10 | Create `P-big`: 2 vCPU, 2 GiB, 32 GiB disk, 8080/https, suspend after 10 idle minutes | turning a plain-English spec into flags | Every field right in the API's copy of the runtime |
| T11 | Write to `/tmp/m` and `/root/m` in `P-life`, stop it, start it, report which survived | the stop/start verbs, waiting out a transition, not assuming persistence | `/tmp` gone and `/root` kept; runtime left running |
| T12 | Run `hostname` in `P-ghost`, which does not exist | the failure path — a clear not-found error, and not inventing a way around it | Said it was missing, and created nothing |
| T13 | Make `echo` print `--json --verbose -h` inside `P-args` | the argument boundary: the CLI must pass the flags through, not act on them | The line came back verbatim |
| T14 | Write `./cpus.txt` with `<name> <nproc>` for each of three `P-fan-*` runtimes, sorted | discovering which runtimes match, then pairing list output with a command in each | Every count matches the API; sorted; decoy excluded and untouched; all left running |
| T15 | List the images you can create from, say how many, and name one that needs a model provider and one that does not | the image catalog. The official `image ls` lists only images you built, so it answers `[]` — scored outside the head-to-head | The count, plus an id from each side of the split |
| T16 | Create `P-agent` from `claude`, say whether its agent could answer a prompt right now, delete it | honest reporting of a half-ready runtime (C-33) | Answered `no` **and** named authentication; nothing left behind |

Tasks and graders are in [src/tasks.ts](src/tasks.ts). Graders marked **review** are regex
judgements (T1 with an org key, T5 when awk looks local, T11's `kept`/`gone` phrasing, T16's
reason). Read those transcripts before trusting the number.

T16 is the one task where the *correct* answer is the pessimistic one. Both CLIs build the runtime
and both report `status: running`, `degraded: false`, `error_code: null` — so an agent that checks
status says "yes" and is wrong: the agent inside prints `Not logged in`. runta-next says so in
`create`'s own output; the official CLI says nothing, and its `--runtime-sign-in` help claims to
have configured the authentication it did not. The grader is marked **review** because an agent can
reach "no" by guessing rather than probing, and the transcript is the only way to tell.

T11's expected answer comes from a probe on 2026-09-29: a stop/start wipes `/tmp` but keeps `/root`,
which sits on the writable overlay. An agent that assumes a restart preserves everything, or that it
wipes everything, gets half of it wrong — the only way through is to look. Its grader is marked
**review** because it matches the answer's wording rather than re-reading the files.

T14's runtimes get random name suffixes and random vCPU counts, and the fixture adds a decoy
carrying the trial prefix but not `-fan`. Without the random suffixes an agent can type the names
straight from the prompt and skip `list` entirely, which is what the first version of the task let
happen; without the decoy, "everything with my prefix" and "everything matching `-fan`" are the same
set and the filter is never tested.

Results and analysis from past runs are in [FINDINGS.md](FINDINGS.md).

### T8 is retired

T8 staged two runtimes sharing one name and asked for `nproc`, so the two had different vCPU counts
and there was no single right answer. Passing meant reporting the ambiguity rather than a number.

The API now refuses duplicate names, so the fixture cannot build that state:

```
POST /v2/runtimes → 409 already_exists: runtime already exists: ev-…-t8-1-dup
```

Probed 2026-09-29, there is no way around it. Deleting the first runtime frees its name for reuse
but never leaves two live runtimes sharing one, `/v2/checkpoints` is GET-only so there is no
restore path, and both CLIs match names exactly and reject partial ids — so no near-miss naming
reproduces the ambiguity either.

The task stays in `TASKS` with a `retired` reason: it is left out of the default `--tasks`, and
naming it explicitly is an error rather than a fixture failure. Note that C-36 itself was only ever
verified against a local mock server, never the real API, so whether the API ever permitted
duplicates is unestablished.

## Metrics

Pass/fail comes from the grader. The rest comes from the `stream-json` transcript
([src/transcript.ts](src/transcript.ts)):

- `numTurns`, `costUsd`, `durationMs`, and token usage
- `cliCalls`: Bash commands that invoked the arm's CLI
- `cliErrors`: CLI calls whose Bash result was an error, usually a non-zero exit
- `helpCalls`: calls with `--help`, `-h` or `help`
- `cliOutputChars`: how much CLI output the agent had to read. This is the context cost (C-31)
- `leftovers`: runtimes still alive under the trial's prefix before cleanup
- `foreignGone`: runtimes outside this run that disappeared during the trial. These are flagged
  for review, not failed, because on a shared tenant it can be a coincidence

## Caveats

### One tenant

Both arms share one tenant. Trials run one at a time by default, and each trial alternates which
arm goes first. `--concurrency N` is faster, but then agents see each other's runtimes in `list`
output. That noise hits both arms equally, but it does make the tasks harder.

### Arm B's output contract changed in 0.9.0

Arm B used to require an explicit `--json`; it now defaults to `auto` — a table on a terminal, JSON
anywhere else. **The harness runs both CLIs without a TTY**, so from 0.9.0 onward `runta-next list`
hands the agent JSON where earlier runs handed it a table.

That moves `cliOutputChars`, which is the metric the context-cost argument rests on. Results from
before 0.9.0 have been dropped for that reason; [FINDINGS.md](FINDINGS.md) records `clean1` and
nothing older.

### A stored Claude login is not visible to the agents

Each agent gets its own empty `HOME`, which is what keeps the arms from seeing each other's config
and keeps this repo's `cli-design` skill — which documents runta-next — out of both contexts. A
subscription login lives under the real `HOME`, so set `CLAUDE_CODE_OAUTH_TOKEN` from
`claude setup-token` rather than relying on being logged in.

`EVAL_USE_REAL_HOME=1` turns the isolation off and uses the operator's `HOME` instead. It exists
because the alternative is minting a long-lived token, and it prints a warning every run: both arms
then inherit the operator's shell config and skills, and in testing an agent read the operator's
`MEMORY.md`. **A run made that way is a smoke test of the graders, never a measurement.**

### T1 depends on the credential

`GET /v2/me` refuses organization API keys (`packages/api/NOTES.md` §5). With an `rt_` key, the
right answer from either CLI is "this is an org API key, not a user". The fixture probes the
credential and grades against whatever it finds.

### T6 uses the official CLI to pause one runtime

Pause isn't described in `openapi.json` yet, so the T6 fixture runs `runta pause`. If that fails,
the trial records a warning and still grades correctly against whatever state the runtimes are in.

### Flakes count

The official `exec` fails spuriously about 10% of the time (C-01). That shows up in arm A's pass
rate and error counts. It's a real finding, so look at the notes before blaming the agent.

### Cost

A full run creates about 150 runtimes, most of them small and short-lived, and spends up to
`--budget-usd` per agent.

## Tests

```sh
bun test            # transcript parsing, CLI detection, graders, summary
```

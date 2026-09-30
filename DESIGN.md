# runta-next — design document

A third-party CLI for Runta, built against the public REST API. P0 agent-native, P1 developer
experience.

This is the front door. The supporting material is long because the work is evidence-led, so each
section links to where the evidence lives rather than restating it.

| Document | What it holds |
| --- | --- |
| [`CLI_ISSUES.md`](CLI_ISSUES.md) | 39 findings against the official CLI (C-01…C-39), each with a live transcript |
| [`Improvements.md`](Improvements.md) | Decision log (I-1…I-11): what we changed, why, and what it commits us to |
| [`RESEARCH.md`](RESEARCH.md) | Field research behind the interaction model |
| [`FAILURE-AND-RECOVERY.md`](FAILURE-AND-RECOVERY.md) | What happens when an agent gets it wrong |
| [`evals/cli-ab/`](evals/cli-ab/) | The A/B harness, and [`FINDINGS.md`](evals/cli-ab/FINDINGS.md) |
| [`docs/`](docs/) | User-facing documentation, 18 pages, served at [runta.haxzie.com/docs](https://runta.haxzie.com/docs) |
| [`.claude/skills/cli-design/`](.claude/skills/cli-design/) | The rules the findings distilled into |

---

## 1. The names, and what they bought

The first decision, and the one the rest of the surface is built on.

| Official Runta | Ours | REST operation |
| --- | --- | --- |
| `runta run` | **`runta-next create`** | `POST /v2/runtimes` |
| `runta ps` | **`runta-next list`** | `GET /v2/runtimes` |
| `runta rm` | **`runta-next delete`** | `DELETE /v2/runtimes/{id}` |
| `runta inspect` | `runta-next inspect` *(kept)* | `GET /v2/runtimes/{id}` |
| `runta exec` | `runta-next exec` *(kept)* | the exec WebSocket |
| `runta image ls` *(custom only)* | **`runta-next image list`** | `GET /v2/images` |
| `runta image delete` | `runta-next image delete` *(kept)* | `DELETE /v2/images/{id}` |

The official CLI's vocabulary is inherited from Docker: `run`, `ps`, `rm`. Docker earned those names
in a different era and a different problem space, and two of them actively misfire here.

**`run` collides with `exec`.** We ship `exec`, so with `run` in the set the CLI would have
`runta run` for the thing that *creates* a runtime and `runta exec` for the thing that *runs*
something inside it — the word "run" pointing at the command that runs nothing. `runta run npm test`
is a reasonable thing to type and a completely wrong thing to type. `create` cannot be misread that
way, and it is the verb Kubernetes, every cloud CLI, every REST API and the HTTP method itself
already agree on.

**`ps` is ambiguous about scope, not merely obscure.** The obvious objection is that it only parses
if you already know Docker. The sharper problem is specific to this product: Runta runs containers
you can exec into, so `runta ps` genuinely reads two ways — list the runtimes in my account, or list
the processes inside a runtime? The second reading is not a stretch; it is what `ps` means in every
shell, and we ship the command that would let you run it (`runta-next exec <runtime> -- ps`). A name
whose scope is ambiguous in the one product where both scopes exist is the wrong name.

**`rm` would be the only abbreviation left.** Once `create`, `list` and `inspect` are full words,
`rm` is the odd one out. It earns its place next to `ls`, and we are not using `ls`.

`inspect` and `exec` survive on merit rather than inertia — `inspect` is the widest-recognised word
for "give me the full detail" across Docker, Terraform, AWS and `gh`, and `exec` is universal across
Docker, E2B, Daytona and Modal. Full reasoning in [`Improvements.md`](Improvements.md) I-1.

### What humans got

**No translation step from the adjacent products.** The tools actually next to Runta have converged
away from Docker: E2B, Daytona and Modal all use `list`, two of three use `create`, two of three use
`delete`. A developer arriving from any of them reads our surface directly. A developer arriving
from Docker has four words to learn either way, and may as well learn the unambiguous four.

**One shape, two paths** ([I-2](Improvements.md)). Noun-first is canonical, with runtimes also
available at the top level because they are the noun you touch all day:

```sh
runta-next runtime create | list | inspect | delete     # canonical
runta-next create | list | inspect | delete             # same commands, shortcut
```

Runtimes are the only resource with a shortcut. Every other noun — when one ships — is noun-first
only, because a second shortcut turns one documented convenience into a pattern nobody can predict.

Both forms are registered from one function, so a flag cannot exist on one and not the other, and a
test asserts they stay in step.

### What agents got

**Verbs on a new noun will be predictable without reading help.** All four names are full words that
map 1:1 onto the REST operations behind them, so having seen the verbs on `runtime`, an agent can
apply the same four to whatever noun ships next rather than re-deriving them. Docker's
flat-for-the-primary-noun rule instead requires knowing *which* noun is primary — an exception you
can only learn by being corrected, and an agent starts every session uncorrected.

Stated as a promise rather than a result on purpose: `runtime` is the only noun implemented today,
so this property is designed-for and not yet demonstrated.

**Measured: the first guess lands.** Task T7 asks an agent to delete runtimes by prefix. Both arms
opened identically in both runs — and both agents independently guessed `list` first:

```
arm A (official)                          arm B (ours)
[ERR] runta --help; runta list            [ok ] runta-next --help; runta-next list
[ok ] runta ls …                          [ok ] runta-next delete …-tmp1 …-tmp2 --dry-run
[ok ] runta help --json | python3 -c "…"  [ok ] runta-next delete …-tmp1 …-tmp2
```

The agent's second guess was `ls`. It never guessed `ps`. Two turns went to finding the verb for
"show me the runtimes", and the third fell back to parsing the JSON help tree — before the task had
started. Transcripts in [`evals/cli-ab/`](evals/cli-ab/).

This is the part worth drawing out: **the naming was decided for human reasons and the agent
benefit came free.** Nothing in I-1 was argued from agent behaviour — it was argued from industry
convergence and from an ambiguity a person would trip over. The agent evidence arrived weeks later,
from a harness built for something else. Legibility is not a separate axis from agent-readiness; it
is the same axis measured twice.

---

## 2. The insight

The naming was the first of 39 findings, and it generalises. We audited the official CLI end to end
before writing any code, and the striking thing was how few of those findings were hard problems.
Almost every one was a small local decision that looked reasonable in isolation: `ls` here and
`list` there, a boolean that takes `true` in the JSON help but not on the command line, an error
that names an internal field rather than the flag the user typed.

**Individually invisible, collectively decisive.** An 84-command CLI where each decision is
locally defensible and globally inconsistent cannot be learned — it can only be memorised, and an
agent has no memory between sessions. It re-derives the interface every time, from `--help`.

That reframes the design problem. The question is not "what commands should exist" but **"what
does an agent have to read before it can act, and how often is that reading wrong?"** Everything
below follows from taking that seriously.

The measurement bears it out. Across 13 head-to-head tasks both CLIs scored **13/13** — the
official CLI is not incapable. But getting there cost 2.3× the money, 2.4× the turns and 3.9× the
help calls, and help output is the single largest contributor.

---

## 3. The workflow we covered

Create a runtime, do useful work in it, inspect and manage it, clean it up — with authentication at
the front and deletion at the back.

```sh
runta-next login                                  # device flow, or RUNTA_TOKEN
runta-next whoami                                 # which identity, and from which source
runta-next image list                             # what create can build from
runta-next create --name demo --cpus 1 --memory 512
runta-next exec demo -- sh -c 'echo hi > /tmp/x; cat /tmp/x'
runta-next list --fields name,status,vcpus
runta-next inspect demo
runta-next stop demo && runta-next start demo
runta-next delete demo --dry-run                  # show the plan
runta-next delete demo
```

Full API parity was not attempted. The REST API exposes 85 operations; the CLI covers ten, plus
`exec` over its WebSocket. The authoritative breakdown is
[Commands → not yet implemented](docs/commands/index.md#not-yet-implemented); the largest untouched
areas are cloud agents (22 operations), GitHub integration (9), SSH keys (7), secrets (5) and
checkpoints (4).

---

## 4. P0 — Agent-native

### 4.1 Discovery has to be affordable

This is the finding with the largest measured effect.

| `--help` output | Size | Format |
| --- | --- | --- |
| `runta` | 78,370 chars | JSON (the whole clap command tree) |
| `runta-next` | 2,108 chars | grouped text |

37×, and a format difference rather than a content one — the official CLI dumps its entire clap
command tree as JSON. Nothing can skim that, so agents do not try. They write a parser:

```
runta help exec 2>&1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
def walk(c):
    if c['name']=='exec': …
```

**28 commands across `runs/clean1` piped help into `python3` or `jq`.** Each is a turn spent
building scaffolding to read documentation, and it usually extracts a fragment, so the agent comes
back for more: **71 help calls against 18**, and 199.5k characters of CLI output against 122.1k.

Ours groups commands under headings with one-line summaries, then a worked path through them as
runnable examples. It also carried prose blocks explaining the output contract and the waiting
contract; those are gone, moved to the commands they describe, where they are read at the moment
they matter instead of scrolled past on the way to the command list. The examples stayed because
they are not prose — a reader skimming for a command's shape finds it faster there than in any
paragraph.

`--help` stays the source of truth. `program.test.ts` asserts the command surface so a rename
cannot half-land, and `docs.test.ts` resolves every flag quoted in the examples and the docs
against the real command tree, so neither can rot into describing a CLI that does not ship.

### 4.2 The machine-readable contract must be *true*

Present is not the same as correct. The official CLI's `help --json` advertises that boolean flags
take values:

```console
$ runta help --json | jq -r '.command.subcommands[] | select(.name=="ps") | .args[]
      | "\(.long)  possible_values=\(.possible_values)  value_names=\(.value_names)"'
all  possible_values=["true","false"]  value_names=["ALL"]
full  possible_values=["true","false"]  value_names=["FULL"]

$ runta ps --all true
error: unexpected argument 'true' found
```

Still live, verified directly on 2026-09-30: `--all` and `--full` both advertise
`possible_values=['true','false']`, and `runta ps --all true` returns `UNKNOWN_ARGUMENT`. This is
C-06, and it is the sharpest illustration of the whole thesis: **the contract penalises anyone for
trusting it.**

No agent in `runs/clean1` happened to try the advertised form, so that run is not evidence agents
hit it — earlier runs recorded two who did, and those transcripts no longer exist. The defect stands
on the direct probe rather than on a transcript.

Ours has one boolean convention, bare `--flag` / `--no-flag`, with no values advertised anywhere.

### 4.3 Output that follows the reader, with a way out

C-08 is not that the official CLI implies `--json` off-TTY — it calls that a good default. It is
that there is no way *out*: `runta ps | less`, `| grep` and `> file` all get JSON and nothing can
ask for the table back.

We shipped the overcorrection first — `--json` explicit only — and it made
`runta-next list | jq` a parse error, which is the single most obvious thing anyone pipes this CLI
into. Output now resolves to `auto`: a table on a terminal, JSON anywhere else. `-o table` per
command and `RUNTA_OUTPUT` per environment take it back, most-explicit-first, so pinning the
variable in CI cannot make an explicit flag lie.

`exec` is exempt and says why at the site: it streams the remote command's own bytes, so
`exec demo -- cat report.pdf > report.pdf` has to write the file rather than a JSON envelope
around it.

stdout is the result, stderr is commentary — and *success is a result*. Routing completion
messages through stderr made a successful `login` render entirely in red in terminals that colour
stderr, so the line the user was waiting for looked like the failure. Progress and hints stay on
stderr; outcomes do not.

### 4.4 Errors that name the fix

Quoting C-04, the most likely error in the official CLI — `exec` against a stopped runtime:

```
websocket error: HTTP error: 409 Conflict
```

No runtime name, no cause, no next step, and transport plumbing in a user-facing string. Ours
names what failed, why, and what to do, and translates internal field names back to the flag that
was typed (C-24). Exit codes are stable: `0` success, `1` request failed, `2` credential problem,
`125` unknown outcome.

### 4.5 Three outcomes, not two

The official `exec` fails spuriously about 10% of the time (C-01) — 5 of 50 successful commands
returned `status: null` and exit `1`. The instinct is to retry; that is wrong when the command may
have had side effects.

`asyncapi.yaml` is explicit that an `error` frame or a close before `exit` leaves the result
**unknown**. So `runta-next exec` reports unknown as its own outcome with exit `125`, distinct from
the command's own codes, and a caller decides. Reporting an unknown outcome as a failure is how a
pipeline re-runs work that already succeeded. Reasoning in I-8.

### 4.6 Build the primitive, do not ask the agent to enforce it

The official CLI has zero occurrences of `--dry-run`, `--yes`, `--force` or `--confirm` across 84
commands, on eight destructive operations (C-09) — and its agent skill instructs the model to
"require explicit user confirmation before `runta rm`". That is a safety property asserted in prose
because the tool cannot express it.

Ours has `--dry-run` printing the resolved plan in both human and JSON form, confirmation on a TTY,
`--yes` to skip, and never a prompt in a pipe. T7 asks for exactly that care, and both arms passed
it in `runs/clean1` — the official CLI's agent improvised the safety step by listing first, which is
what C-09 predicts: the property is achievable, it just is not a primitive, so every caller has to
reinvent it.

### 4.7 Context cost is a real cost

`--limit` caps results and stops fetching, so `--limit 5` is one request rather than a full page
discarded (C-15). Lifecycle commands return four fields rather than the 45-field runtime object
(C-22). `--fields` selects columns for the table and the JSON through one vocabulary.

**And `--fields` did not work as intended** — see §6.

---

## 5. P1 — Developer experience

Human conveniences coexist with the agent interface by being *decided separately*, not derived from
each other.

- **`list` renders a table; `list --json` renders the API objects.** Same command, two audiences,
  neither degraded to serve the other. The official `inspect` renders the same five-column table as
  `ps` while its JSON carries 45 fields (C-07) — the command whose job is detail shows a human none
  of it.
- **`--fields memory` is `512 MiB` in the table and `512` in JSON.** A unit belongs in a cell a
  person reads, not in a value a script is about to do arithmetic on.
- **Next steps, but only when there is one.** A freshly created runtime says what to do next; a
  completed task says nothing, because advice printed every time is advice nobody reads. Never the
  command that just ran (C-11), and never a command that does not exist — `suggest.test.ts`
  resolves every suggestion against the real command tree (C-30).
- **Install and first run work on a clean machine.** The official `login` writes its state file
  without creating `~/.config/runta`, so the first command it tells a new user to run fails with
  `os error 2` (C-02) — the worst defect in the audit and the smallest fix.
- **`whoami` reports the credential *source*.** An env var beats a stored login, so a user can log
  in successfully and still act as a different identity. The official CLI has no `whoami` at all
  (C-20).
- **The table survives a lying terminal.** Clamped to 80 columns, honours `COLUMNS`. The official
  renderer collapses every column to one character when the terminal reports zero width, printing a
  58-character id vertically over 43 rows (C-12).

---

## 6. Evidence, and what it did not support

Two headless agents on Claude Sonnet 5, same tasks, isolated `PATH` per arm, graded against the tenant's
real state through an independent REST client. Method in
[`evals/cli-ab/README.md`](evals/cli-ab/README.md).

**Totals, fifteen tasks, `runs/clean1` (2026-09-30):**

| | official | runta-next |
| --- | --- | --- |
| Cost | $2.44 | $1.07 |
| Turns | 194 | 82 |
| CLI calls | 144 | 64 |
| `--help` calls | 71 | 18 |
| Context read | 199.5k chars | 122.1k chars |

Arm A is `@runta/runta-cli@0.2.10`; arm B is `@haxzie/runta-next@0.11.2` from the published release.
Each agent ran with its own empty `HOME` and only its arm's CLI on `PATH`.

**Not everything went our way.** T12 (a runtime that does not exist) cost arm A 2 turns and 240
characters against our 3 turns and 5.6k — their `NOT_FOUND` is terse and conclusive where ours says
more than the agent needed. T14 read 6.2k characters on arm A against our 13.2k.

**The negative result matters more.** `--fields` was built because `list --json` was 4,096
characters against 271 for the table. The narrow path is 26× smaller. Rerunning the suite showed
**no aggregate saving** — $0.47 → $0.49, 44,580 → 46,172 characters, measured on a run whose
transcripts are no longer retained. Two structural reasons: only 4
of 13 tasks call `list` at all, and where the flag was used the agent had already paid for a full
dump while exploring.

We kept the flag and recorded the contradiction (I-10) rather than quietly dropping the claim. It
also relocated the problem: **neither CLI can filter rows.** The API takes only `status`, `limit`
and `after`, so "every runtime whose name starts with…" is solved in both arms by listing the whole
tenant and filtering in the shell. Trimming columns off a full listing saves much less than not
fetching most of it would.

### The caveat that governs all of the above

The eval tasks were written from `CLI_ISSUES.md`, and runta-next was built to fix those same
findings. The suite therefore probes precisely the defects one arm was designed to address. The
defects are real and the costs are real, but this measures **how much the known findings cost an
agent**, not which CLI is better in general. A suite drawn from runta-next's own weak spots would
read differently, and nobody has written one.

Most runs are one trial per cell. Directions are consistent across tasks; individual numbers have no
error bars.

---

## 7. Tradeoffs

**No compatibility aliases (I-3).** No `ps` for `list`, no `run` for `create`, no `rm` for
`delete`. An alias hides a decision: `runta-next ps` silently working would mean nobody ever learns
that `list` is the name, and the scope ambiguity [§1](#1-the-names-and-what-they-bought) exists to
remove would survive in the surface we removed it from. The cost lands on exactly the person most
likely to try us — someone arriving from the official CLI types `ps` and gets the command list
instead of an answer ([`FAILURE-AND-RECOVERY.md`](FAILURE-AND-RECOVERY.md) §3).

**Runtimes are the only noun with a top-level shortcut (I-2).** Across four eval runs agents used
the shortcut every time and `runta-next runtime <verb>` exactly zero times. `image` is the second
resource and takes no shortcut, so the rule now has a case rather than only an intention — and the
asymmetry is the thing to watch: if `image list` proves as heavily typed as `list`, the rule is
describing our habits rather than the surface.

**`auto` output over explicit-only (C-08).** A pipe gets JSON with no flag, which is what anyone
piping into `jq` expects — at the cost of output shape depending on whether stdout is a terminal.
`-o table` and `RUNTA_OUTPUT` are the way out that C-08 says upstream lacks, and they are what make
the default defensible rather than the same trap. We shipped explicit-only first and it was wrong.

**Polling lifecycle transitions.** Upstream returns the pre-transition status, so `pause` reports
`running` (C-14). We poll until the target is observed, which is slower and correct, with
`--detach` and `waited: false` for callers who cannot wait.

**A hand-maintained OpenAPI spec.** `openapi.json` is written from live probes, not from the
published reference — which would have produced a *wrong* client, since `request_id` is a sibling of
`error` rather than inside it, and a missing credential returns 403 not 401 (C-35). The cost is
manual upkeep; `packages/api/NOTES.md` records every divergence.

**Retiring a task rather than fixing it.** The eval's T8 staged two runtimes sharing a name. The API
now refuses duplicates, so the state is unreachable. We retired the task and left C-36 rated `high`
pending a decision, rather than quietly adjusting either.

---

## 8. Known limitations

- Ten of the API's 85 operations are implemented. Cloud agents, GitHub, SSH keys, secrets,
  checkpoints, files, events and model providers are not started —
  [full table](docs/commands/index.md#not-yet-implemented).
- No way to supply a credential at create time. An image that fronts a model provider is built
  through an automatic in-runtime sign-in fallback (I-11), and a Claude subscription connected in
  the Dashboard cannot be used at all (C-38) — so the runtime comes up with its agent installed and
  not signed in, which the CLI says outright but cannot fix.
- `inspect` cannot report a pending sign-in. `create --json` carries `sign_in_pending`, but the
  API's runtime object has no field distinguishing a signed-in agent from one that never was.
- `inspect` has no `--fields`; an agent reached for it in an earlier run and had to recover.
- No row filtering on `list`, because the API offers none.
- No shell completions yet, despite being called out as high-leverage.
- C-36's severity is unresolved: its triggering state looks unreachable through the API, and its
  original evidence was a local mock rather than the live service.
- Eval numbers are one trial per cell.

---

## 9. Running it

```sh
npm install -g @haxzie/runta-next        # or: curl -fsSL https://runta.haxzie.com/install.sh | sh
runta-next login                         # or export RUNTA_TOKEN=rt_…
runta-next --help
```

```sh
pnpm typecheck && pnpm test              # 423 tests
cd evals/cli-ab && ./setup.sh && bun src/run.ts --trials 1
```

No credentials are committed. `RUNTA_TOKEN` is read from the environment; `login` stores a token at
`0600` in a directory it creates at `0700`.

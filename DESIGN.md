# runta-next — design document

A third-party CLI for Runta, built against the public REST API. P0 agent-native, P1 developer
experience.

This is the front door. The supporting material is long because the work is evidence-led, so each
section links to where the evidence lives rather than restating it.

| Document | What it holds |
| --- | --- |
| [`CLI_ISSUES.md`](CLI_ISSUES.md) | 37 findings against the official CLI (C-01…C-37), each with a live transcript |
| [`Improvements.md`](Improvements.md) | Decision log (I-1…I-10): what we changed, why, and what it commits us to |
| [`RESEARCH.md`](RESEARCH.md) | Field research behind the interaction model |
| [`FAILURE-AND-RECOVERY.md`](FAILURE-AND-RECOVERY.md) | What happens when an agent gets it wrong |
| [`evals/cli-ab/`](evals/cli-ab/) | The A/B harness, and [`FINDINGS.md`](evals/cli-ab/FINDINGS.md) |
| [`docs/`](docs/) | User-facing documentation, 17 pages |
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
started. Reproduced identically in `runs/full1` and `runs/full2`; transcripts in
[`evals/cli-ab/`](evals/cli-ab/).

This is the part worth drawing out: **the naming was decided for human reasons and the agent
benefit came free.** Nothing in I-1 was argued from agent behaviour — it was argued from industry
convergence and from an ambiguity a person would trip over. The agent evidence arrived weeks later,
from a harness built for something else. Legibility is not a separate axis from agent-readiness; it
is the same axis measured twice.

### What it cost

**No compatibility aliases** ([I-3](Improvements.md)). No `ps` for `list`, no `run` for `create`, no
`rm` for `delete`. An alias hides a decision: `runta-next ps` silently working would mean nobody
ever learns that `list` is the name, and the scope ambiguity would survive in the surface we removed
it from. The cost is real and lands on exactly the person most likely to try us — someone arriving
from the official CLI types `ps` and gets the command list instead of an answer
([`FAILURE-AND-RECOVERY.md`](FAILURE-AND-RECOVERY.md) §3).

**Agents never used the canonical form.** Across four runs, arm B invoked the top-level shortcut
every single time — 15 `list`, 12 `create`, 9 `inspect`, 9 `delete` — and `runta-next runtime <verb>`
exactly zero times. The shortcut was justified in I-2 as a human ergonomic. It turns out to be what
agents reach for too, which means the noun-first form is currently earning its place through
*predictability for nouns we have not shipped yet* rather than through use. That is a real
justification, but it is a promise rather than a measurement, and it should be revisited once a
second resource exists.

---

## 2. The insight

The naming was the first of 37 findings, and it generalises. We audited the official CLI end to end
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

The measurement bears it out. Across 12 head-to-head tasks both CLIs scored **12/12** — the
official CLI is not incapable. But getting there cost 1.8× the money, 2.1× the turns and 2.1× the
context, and the single largest contributor was help output.

---

## 3. The workflow we covered

Create a runtime, do useful work in it, inspect and manage it, clean it up — with authentication at
the front and deletion at the back.

```sh
runta-next login                                  # device flow, or RUNTA_TOKEN
runta-next whoami                                 # which identity, and from which source
runta-next create --name demo --cpus 1 --memory 512
runta-next exec demo -- sh -c 'echo hi > /tmp/x; cat /tmp/x'
runta-next list --fields name,status,vcpus
runta-next inspect demo
runta-next stop demo && runta-next start demo
runta-next delete demo --dry-run                  # show the plan
runta-next delete demo
```

Full API parity was not attempted. The REST API exposes 85 operations and the CLI covers eight,
plus `exec` over its WebSocket. The authoritative breakdown is
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
| `runta-next` | 2,233 chars | grouped text |

35×, and a format difference rather than a content one — the official CLI dumps its entire clap
command tree as JSON. Nothing can skim that, so agents do not try. They write a parser:

```
runta help exec 2>&1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
def walk(c):
    if c['name']=='exec': …
```

That pattern appears in four of nine tasks in `runs/full1`. Each occurrence is a turn spent
building scaffolding to read documentation, and it usually extracts a fragment, so the agent comes
back for more: **37 help calls against 14**, and 93.4k characters of CLI output against 44.6k.

Ours groups commands under headings with one-line summaries, adds an explicit "For agents" block
naming the contract, and keeps `--help` the source of truth — `program.test.ts` asserts the
command surface so a rename cannot half-land.

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

Two agents wrote the advertised form and failed, in `runs/full2` T2 and T6 — both immediately after
reading the help that told them to. This is C-06, and it is the sharpest illustration of the whole
thesis: **the contract penalised the agent for trusting it.** Full transcripts in
[`FAILURE-AND-RECOVERY.md`](FAILURE-AND-RECOVERY.md) §2.

Ours has one boolean convention, bare `--flag` / `--no-flag`, with no values advertised anywhere.

### 4.3 Predictable output, identical in a pipe

The official CLI implies `--json` when stdout is not a TTY, with no way to turn it off, so
`runta ps | less`, `| grep` and `> file` all get JSON (C-08). An agent's output changes shape
depending on how it spawned the process.

Ours makes `--json` explicit. Behaviour is identical interactively and in a pipe. stdout is the
result, stderr is commentary, so pipes stay clean and next-step hints survive `--json` without
touching the payload.

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
`--yes` to skip, and never a prompt in a pipe. In `runs/full1` and `runs/full2`, T7, the agent used
`delete --dry-run` unprompted before deleting.

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
  completed task says nothing, because advice printed every time is advice nobody reads. On stderr,
  so `--json` payloads stay clean. Never the command that just ran (C-11), and never a command that
  does not exist — `suggest.test.ts` resolves every suggestion against the real command tree (C-30).
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

Two headless agents, same model, same tasks, isolated `PATH` per arm, graded against the tenant's
real state through an independent REST client. Method in
[`evals/cli-ab/README.md`](evals/cli-ab/README.md).

**Arm B totals, nine tasks, `runs/full1`:**

| | official | runta-next |
| --- | --- | --- |
| Cost | $0.83 | $0.47 |
| Turns | 79 | 38 |
| CLI calls | 65 | 28 |
| `--help` calls | 37 | 14 |
| Context read | 93.4k chars | 44.6k chars |
| CLI errors | 3 | 0 |

**The negative result matters more.** `--fields` was built because `list --json` was 4,096
characters against 271 for the table. The narrow path is 26× smaller. Rerunning the suite showed
**no aggregate saving** — $0.47 → $0.49, 44,580 → 46,172 characters. Two structural reasons: only 4
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

**No compatibility aliases (I-3),** and **the canonical noun-first form is currently unused by
agents (I-2)** — both covered in [§1](#1-the-names-and-what-they-bought), which is where the naming
decisions and their costs are argued in full.

**Explicit `--json` over implied.** Slightly more typing for scripts; identical behaviour in every
context. We think predictability wins (C-08).

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

- Eight of the API's 85 operations are implemented. Cloud agents, GitHub, SSH keys, secrets,
  checkpoints, files, events and model providers are not started —
  [full table](docs/commands/index.md#not-yet-implemented).
- `inspect` has no `--fields`; an agent reached for it in `runs/full2` T11 and had to recover.
- No row filtering on `list`, because the API offers none.
- No shell completions yet, despite being called out as high-leverage.
- C-36's severity is unresolved: its triggering state looks unreachable through the API, and its
  original evidence was a local mock rather than the live service.
- Eval numbers are one trial per cell.

---

## 9. Running it

```sh
sh scripts/install.sh                    # or, from a clone: pnpm install && pnpm cli --help
runta-next login                         # or export RUNTA_TOKEN=rt_…
runta-next --help
```

```sh
pnpm typecheck && pnpm test              # 343 tests
cd evals/cli-ab && ./setup.sh && bun src/run.ts --trials 1
```

No credentials are committed. `RUNTA_TOKEN` is read from the environment; `login` stores a token at
`0600` in a directory it creates at `0700`.

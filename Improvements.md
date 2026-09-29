# Improvements

Deliberate departures from the production Runta CLI (`@runta/runta-cli` 0.2.10), with the reasoning
that produced each one.

This is a decision log, not a wishlist. Fixes to defects we found in the production CLI live in
[`CLI_ISSUES.md`](./CLI_ISSUES.md); the field research behind these choices lives in
[`RESEARCH.md`](./RESEARCH.md); the general rules they feed into live in
[`.claude/skills/cli-design/`](./.claude/skills/cli-design). This file records the specific calls —
what we changed, why, and what it commits us to.

The governing constraint: **we are starting from zero.** There are no existing users of this CLI, so
backwards compatibility with the production one is not a cost we have to pay. Every name is chosen on
merit for humans *and* agents, and we do not carry aliases for compatibility's sake.

---

## I-1 — Rename the runtime commands

**Status:** decided, 2026-09-26.

| Production Runta | Ours | REST operation |
| --- | --- | --- |
| `runta run` | **`runta create`** | `POST /v2/runtimes` |
| `runta ps` | **`runta list`** | `GET /v2/runtimes` |
| `runta inspect` | `runta inspect` *(unchanged)* | `GET /v2/runtimes/{id}` |
| `runta rm` | **`runta delete`** | `DELETE /v2/runtimes/{id}` |

`exec` keeps its name — it is universal across Docker, E2B, Daytona and Modal, and there is no
reason to touch it.

### Why

**Parity with the players in this space, not with Docker.** The production CLI's vocabulary is
inherited from Docker: `run`, `ps`, `rm`. Docker earned those names in a different era and a
different problem space. The products actually adjacent to Runta — E2B, Daytona, Modal — have
converged somewhere else: all three use `list`, two of three use `create`, two of three use `info`
or `inspect` for detail, and two of three use `delete`. A developer arriving from any of them reads
our surface without a translation step; a developer arriving from Docker has to learn four words
either way, and may as well learn the clearer four.

**`create` is the word the whole industry already agrees on.** Not just in this space — `create` is
the create verb in Kubernetes, in every cloud CLI, in every REST API, and in the HTTP method itself.
It carries no baggage and needs no explanation. `run` is a word each product redefines: in Modal it
executes code, in Docker it creates and starts a container, in a shell it means neither.

**It eliminates the `run` / `exec` ambiguity.** This is the decisive one. We are shipping `exec`.
With `run` also in the set, the CLI would have `runta run` for the thing that *creates* a runtime
and `runta exec` for the thing that *runs* something inside it — so the word "run" points at the
command that runs nothing. `runta run npm test` is a reasonable thing for someone to type and a
completely wrong thing for them to type. `create` cannot be misread that way.

**`ps` is ambiguous about scope, not just obscure.** The obvious objection to `ps` is that it only
parses if you already know Docker — it is short for "process status", which is not what it does.
But the sharper problem is specific to our product: Runta runs *containers you can exec into*. So
`runta ps` genuinely reads two ways —

- list the runtimes in my account, or
- list the processes running *inside* a runtime?

The second reading is not a stretch; it is what `ps` means in every shell, and we ship the command
that would let you run it (`runta exec <runtime> -- ps`). A name whose scope is ambiguous in the one
product where both scopes exist is the wrong name. `list` has no such reading.

**`delete` over `rm`, for consistency as much as clarity.** `delete` matches Daytona and Modal and
the HTTP verb. More than that: once `create`, `list` and `inspect` are full words, `rm` is the single
abbreviation in the set. `rm` earns its place next to `ls`, and we are not using `ls`.

**`inspect` survives on merit, not inertia.** It is the widest-recognised word for "give me the full
detail" across Docker, Terraform, AWS and `gh`, and Daytona already ships it as a synonym for its
`info`. The alternative worth considering was `get`, which maps 1:1 onto the REST verb and is the
most predictable for a machine — but it reads poorly for a human scanning a command list ("get
what?"). `info` is vaguer than both.

### What this commits us to

The four names are all full words, contain no abbreviations, and map 1:1 onto the REST operations
behind them. That last property is what makes the surface cheap for an agent: given `create` /
`list` / `inspect` / `delete` on one noun, it can predict the verbs on the next noun without reading
help. We should not break that pattern later for the sake of a shorter name.

It also means **`runta run` will not exist** in either form. If someone types it, the error should say so and point
at both plausible intents — `create` and `exec` — rather than a bare "unknown command".

---

## I-2 — Noun-first is canonical; runtime verbs are also top-level

**Status:** decided, 2026-09-26. **Supersedes** the earlier form of I-2, which had runtime verbs
top-level *only*.

```
runta runtime create | list | inspect | delete        # canonical
runta create | list | inspect | delete                # same commands, shortcut
runta checkpoint create | list | ...                  # every other resource, noun-first only
```

Noun-first everywhere is what makes the surface predictable: having seen `runta runtime list`, both
a person and an agent can guess `runta checkpoint list` and `runta secret list` without reading
help. That is Modal's shape, and the reason it is worth preferring over Docker's is that Docker's
flat-for-the-primary-noun rule requires knowing *which* noun is primary — an exception you can only
learn by being corrected.

Runtimes also get top-level shortcuts, because they are the noun you touch all day and typing
`runtime` in front of every command gets old fast. Both forms are registered from one function, so
a flag cannot exist on one and not the other; a test asserts they stay in step.

**What this commits us to:** runtimes are the only resource with a shortcut. A second one turns a
single documented convenience into a pattern nobody can predict, and at that point the canonical
form has stopped being canonical.

## I-3 — No compatibility aliases

**Status:** decided, 2026-09-26. Narrowed after I-2 was revised.

No `ps` for `list`, no `run` for `create`, no `rm` for `delete`. Nothing carries a production-CLI
name forward.

The distinction worth keeping straight: the top-level runtime verbs in I-2 are **not** aliases in
this sense. They are the same four names at a second path, chosen for ergonomics. What is ruled out
is a *second vocabulary* — a different word for the same operation.

That matters because an alias hides a decision. `runta ps` silently working would mean nobody ever
learns that `list` is the name, and the scope ambiguity I-1 exists to remove would survive in the
surface we removed it from. The field shows both failure modes: E2B's aliases are abbreviations
rather than synonyms — `in`, `kl`, `cr` — and `sandbox pause` is aliased **`ps`**, so the same two
letters list containers in Docker and pause a sandbox in E2B. Daytona's alias map still carries keys
(`install`, `code`, `forward`) for commands that no longer exist in the product.

## I-4 — Shape decisions for the runtime commands

**Status:** decided, 2026-09-26, and implemented.

**Wait by default; `-d`/`--detach` opts out.** The production CLI returns immediately and offers
`--wait`. No comparable CLI has a `--wait` flag at all — E2B and Modal wait by default with
`--detach`, Daytona waits unconditionally. A runtime you cannot use yet is rarely what anyone asked
for, and the happy path should not need a flag. Applies to `create` and `delete` alike, so the
async-lifecycle inconsistency recorded as `CLI_ISSUES.md` C-14 cannot reappear.

**`--json` only.** No `-o` and no `-f` short form. `-o` would import a collision rather than a
convention: in E2B `-o` already means `--order`. `-f` collides inside both E2B and Daytona's own
surfaces with `--follow`, `--force` and `--dockerfile`.

**`--dry-run` and `-y`/`--yes` on `delete`.** `-y` is universal for destructive confirmation.
`--dry-run` exists in **none** of the four CLIs surveyed, and the JSON form of it is the half that
matters: without a machine-readable plan an agent cannot show a user what it is about to do, only
describe its intent in prose. The plan is built from the API rather than from the arguments, so it
reports what would actually be deleted.

**`<RUNTIME>` positional, accepting a name or an id.** Universal in the field — nobody makes the
target a flag. One placeholder word everywhere, not the production CLI's mix of `<RUNTIME_NAME>`,
`<VM_NAME>` and `<RUNTIME_ID>`.

Two things fell out of implementing this that were not obvious beforehand:

- **Name resolution is the client's job.** The published reference describes
  `GET /v2/runtimes/{runtime_id}` as accepting a "Runtime UUID or display name". It does not —
  a name returns `invalid_argument: runtime_id must be a UUID`, verified live. So the CLI lists and
  matches. Because names are not guaranteed unique, an ambiguous name is an error rather than a
  guess; deleting the wrong runtime is not an acceptable outcome of a coin toss.
- **Deletion is unavoidably read-then-write.** `DELETE` requires `expected_revision` matching the
  runtime's current `revision`, so the CLI reads first. A 409 means something else changed the
  runtime in between — which is the race optimistic concurrency exists to catch — so the CLI
  re-reads and retries once rather than making the user retry a command that would have worked.

---

## I-6 — Suggest the next step, but only when there is one

**Status:** decided, 2026-09-26, and implemented.

Commands that leave you mid-task print a short block on stderr:

```console
$ runta create --name demo --detach
Creating runtime 'demo'.

Next steps:
  runta inspect demo         check whether it is running yet
  runta delete demo          remove it when you are done
```

Where they appear: after `login`, after `create` (both waited and detached), on an empty `list`, on
`inspect` when the runtime is in `error`/`crashed`, degraded, or has a fully-blocked egress
allowlist, on `logout` when `RUNTA_TOKEN` is still set, and after `delete` **only when no runtimes
remain**.

Where they deliberately do not: after a successful `delete` that left other runtimes, after
`whoami`, and after `inspect` on a healthy runtime. Advice printed after every command is advice
nobody reads — which is exactly why the production CLI's `required_action` field is ignorable.

Three constraints make this a feature rather than noise:

**stderr, always.** Suggestions are commentary, so they survive `--json` without touching the
payload — `runta inspect demo --json 2>/dev/null` is still exactly the runtime object.

**Never the command that just ran.** Upstream's `resume` returns
`required_action: runta resume <name>`; an agent following the field as designed loops
(`CLI_ISSUES.md` C-11).

**Only commands that exist — enforced, not remembered.** Our first version of this suggested
`runta exec`, which we have not built. That is the same defect as Runta's agent skill documenting a
`runta agents ls` that does not exist (C-30), and the fix is not care. `suggest.test.ts` scrapes
every `runta …` out of the source and resolves it against the real command tree, so a suggestion
cannot outlive the command it names. It also guards itself: one assertion fails if the scraper stops
finding suggestions, another proves the resolver actually rejects.

---

## I-7 — Infer what the API could have inferred, and translate its refusals

**Status:** decided, 2026-09-26, and implemented.

`create` could not build 12 of Runta's 13 runtime images at all. Those images front a model
provider, and the API refuses them without `image.model_provider_protocol` — for which there was no
flag.

Two changes. **The protocol is inferred when the image binds exactly one** (`claude`, `codex`,
`cursor` and `flue` each bind one), because demanding it would be demanding that the user repeat
information the API already holds. When an image binds several, the error lists them:

```console
$ runta create --image kimi
error Image 'kimi' supports several model-provider protocols.
Pick one with --model-provider-protocol: anthropic_messages, openai_chat, openai_responses.

$ runta create --image claude --model-provider-protocol openai_chat
error Image 'claude' does not support model-provider protocol 'openai_chat'.
It supports: anthropic_messages.
```

Both are checked before any request, from the image list we already fetched to resolve the name.

**The API's two refusals are translated into next actions.** Its wording is accurate but terminal —
it names the environment variable and stops:

```console
$ runta create --image claude --cpus 2 --memory 2048
error invalid argument: the selected runtime image reads its model-provider credential from ANTHROPIC_API_KEY, which no secret in this request populates
This image needs a model provider. Connect one at https://dashboard.runta.com, then create the runtime again.
```

The hint names the dashboard rather than a command because no command configures a provider yet, and
`suggest.test.ts` would reject inventing one.

### What I got wrong here, and why it is worth recording

I first built a post-create readiness check — list the image, list the organization's providers, and
warn that a `running` runtime's agent could not authenticate. That was written from
`CLI_ISSUES.md` C-33, which records the production CLI reporting a ready runtime whose agent cannot
run.

The live API disproved the premise: it **refuses** such a create outright rather than producing an
unusable runtime, so the check had no case to catch and I deleted it. Two lessons worth keeping.
Where the API already does the right thing, the CLI should not carry code to compensate. And a
finding recorded against the production CLI is not automatically a requirement for ours — C-33
concerns the `--runtime-sign-in` path specifically, which we have not built and have not tested, so
it stays open rather than being assumed fixed.

---

## I-8 — `exec` exit codes, and "unknown" as a third outcome

**Status:** decided, 2026-09-27, and implemented.

`runta exec` passes the remote command's exit status through verbatim, which is what every
comparable CLI does and what any script wrapping it expects. That consumes the whole 0–255 range
and leaves no room for the CLI's usual `1`/`2`, so failures of the exec *itself* use the high codes
Docker established for the same reason:

| Code | Meaning |
| --- | --- |
| `0`–`255` | The remote command's own exit status |
| `2` | Bad flags or a credential problem — nothing ran |
| `125` | The command could not be started; retrying is safe |
| `126` | The command started, outcome **unknown** |

The `125`/`126` split is the point. `asyncapi.yaml` says an `error` frame or a connection closing
before `exit` leaves the result unknown, and that a command with side effects must not be retried
automatically. So an unknown outcome is a **third outcome**, not a failure:

```console
$ runta exec demo -- ./deploy.sh
error The connection closed before the command reported an exit status.
The command may have run. Check before retrying — this is not a reported failure.
```

This is the correct fix for `CLI_ISSUES.md` C-01, where the production CLI reports exactly this case
as exit `1` — indistinguishable from a command that genuinely failed, which is how a CI pipeline ends
up re-running work that already succeeded. Reporting "I don't know" is more useful than reporting a
wrong answer confidently.

`--json` carries the same distinction as a frame, so an agent gets it without parsing prose:

```json
{"type":"error","message":"connection lost","before_start":false}
```

### Related decisions

**`--json` mirrors the wire protocol** rather than inventing a shape: `{"type":"stdout",
"data_base64":…}` then `{"type":"exit","code":N}`. Anything that has read `asyncapi.yaml` already
knows it. Payloads are base64 because command output is bytes — a build emitting a control character
or invalid UTF-8 would be corrupted by a text field.

**Output streams, never buffers.** The production CLI collects everything into a JSON string field,
so a ten-minute build shows nothing until it finishes and `| grep` needs `jq -r .stdout` first
(C-16). Ours writes each frame as it arrives, keeping stdout and stderr separate.

**A cold runtime says so.** The API holds the connection up to 300 seconds while a runtime becomes
ready, which is why upstream's `exec` appears to hang. Ours prints "Waiting for the runtime to become
ready…" after two seconds of silence.

**`-t` is refused without a terminal on stdout**, because a pty with nowhere to render is not a
session anyone wants — checked before connecting.

---

## I-5 — Runtime configuration is not a resource

**Status:** proposed.

The production CLI has 12 non-lifecycle command groups, and at least three of them are not
resources at all. `egress` and `ports` are *fields on a runtime* — `egress_policy` and
`ingress_specs` in the runtime object — with no endpoint of their own; `runta egress list` actually
calls `GET /v2/runtimes?limit=100` and reads a field off each result. The `runtime` group's
`ssh-key` subcommands duplicate the per-runtime `ssh-keys` sub-resource.

Proposal: configuration lives on the runtime, not in its own namespace. Egress and published ports
become flags on `create` and on a future `update`, and `inspect` reports them — which it already
does, including rendering the effective egress posture rather than the raw fields, since a
`denylist` with no hosts means unrestricted and an `allowlist` with none means fully blocked
(`CLI_ISSUES.md` C-10).

### `update` must explain what it cannot change

vCPUs are set by `create` and cannot be changed afterwards: `PATCH /v2/runtimes/{id}` accepts only
`resources.requests.memory_mib`, `resources.requests.disk_gib` and `resources.limits.memory_mib`. The
generated Python SDK agrees — `PatchRuntimeResourceRequests(memory_mib=None)` against
`CreateRuntimeResourceRequests(memory_mib=1024, vcpus=1)`. Nothing in the reference marks the field
immutable; it is simply absent from the patch body, which is why the production CLI's `resize` has no
`--cpus` and never says why (`CLI_ISSUES.md` C-37).

So `update` must not merely omit `--cpus`. It should reject it with the reason and the remedy —
recreate, optionally `--from-checkpoint` — and `create --cpus` should say the choice is permanent.
An unexplained missing flag reads as an oversight, and the user finds out it is a boundary at the
moment they most need it not to be.

This is recorded as proposed rather than decided because it concerns resources we have not built
yet. It is worth settling before the first of them exists: "configuration is not a resource" is
cheap now and expensive after three groups have shipped.

### A note on counting resources

An earlier draft of this document said Runta has "~12 resources". That was loose. There are **12
documented API groups**, **15 distinct top-level `/v2` path segments** (11 once `healthz`,
`ssh-host-key` and the three observability paths are folded in), and — separately — **12
non-lifecycle command groups in the production CLI**. The three counts coincide at 12 by accident.

## I-9 — Three lifecycle verbs over four endpoints

**Status:** decided, implemented.

The API exposes four transition endpoints — `POST /v2/runtimes/{id}/{start,stop,pause,resume}`, each
taking `expected_revision` and an empty body. Verified by pointing the production CLI's `--endpoint`
at a local server and logging what it sent, since none of this is in the published reference.

The production CLI maps those four endpoints to four commands, and renames two of them: `boot` for
`/start` and `shutdown` for `/stop`. We ship **three**: `start`, `stop`, `pause`.

### `start` covers both wake endpoints

The split between `/start` (from `shutdown`) and `/resume` (from `paused`) is a detail of how the
control plane works, not a distinction the user is trying to express. Upstream surfaces it as two
commands, so before you can name a verb you have to know which state your runtime is in — and if you
guess wrong you get an API error rather than the thing you asked for. Worse, `suspended` exists as a
third parked state that only the idle policy produces, and no command names it at all.

Since the CLI must read the runtime anyway to obtain `expected_revision`, it already knows the answer
before it acts. So `start` means "make this runnable again" and picks: `/resume` from `paused` or
`suspended`, `/start` from `shutdown`. `--dry-run --json` reports which endpoint it chose, so the
mapping is inspectable rather than magic.

We do not ship `resume` or `boot`, per [I-3](#i-3--no-compatibility-aliases).

### Asking for the state you are in is not an error

`stop` on a stopped runtime reports `changed: false, reason: "already_in_state"` and makes no request.
Upstream sends it regardless, which either 409s or bumps a revision for no change. Idempotence is the
useful reading, and it is what makes these commands safe in a script that cannot know the current
state — which is most scripts.

Asking for a state that cannot be reached *is* an error: `pause` on a `crashed` runtime exits 1 and
names the state, rather than failing at the transport layer.

### The output says whether the status settled

Every transition is asynchronous, and the response to the request still carries the **old** status
because the control plane has only accepted it at that point. Upstream returns that body as its
answer, so `pause` reports `running` (`CLI_ISSUES.md` C-14). We poll until the target status is
observed, and under `--detach` — where by definition we cannot know — the payload carries
`waited: false` and `target_status`, so a caller is never handed a stale status dressed up as an
outcome.

The payload is four fields, not the runtime object. Upstream answers a one-bit state change with all
45 fields, about 350 tokens of context for one bit (C-22). `inspect` is the command for the object.

### Next steps never name the command that just ran

Upstream's `resume` answers with `required_action: runta resume <name>`, so an agent following that
field loops (C-11). After `stop` and `pause` we suggest `start`; after `start`, `exec`. A test asserts
`stop` never suggests `stop`.

### Not included

`resize` is a `PATCH /v2/runtimes/{id}` with `{"resources":{"requests":{…}}}` — the same general
update endpoint that would back an `update` command, so it belongs with
[I-5](#i-5--runtime-configuration-is-not-a-resource) rather than with the lifecycle verbs. Note upstream's
`resize` changes memory and disk but **not** vCPUs, despite `create` accepting `--cpus`. That is an
**API limitation, not an upstream omission** — the patch body has no CPU field at all, confirmed
against both the REST reference and the generated Python SDK. `update` therefore cannot offer it
either, and must say so rather than leaving a gap; see I-5 and `CLI_ISSUES.md` C-37.

---

## I-10 — `--fields` selects columns for both halves of the output

**Status:** decided, 2026-09-29, and implemented. **The measurement that motivated it did not
reproduce the expected benefit — read "What the eval said" before citing this as a win.**

Upstream's only control over how much `ps` returns is `--full`, which is binary — the compact
listing or complete runtime objects — and is a silent no-op on a TTY (`CLI_ISSUES.md` C-07).
Ours takes a field list:

```console
$ runta-next list --fields name,vcpus        $ runta-next list --fields name,vcpus --json
NAME            VCPUS                        [ { "name": "jesting_kalong", "vcpus": 1 }, … ]
jesting_kalong      1
```

Three decisions inside that.

**`--fields` names columns, and the same names key the JSON.** One vocabulary covers what a person
reads and what a script parses, rather than a set of column headings for the table and a set of API
field paths for `--json`. A caller who can read the table can write the `jq`.

**The human cell and the machine value are decided separately.** `memory` renders as `512 MiB` in
the table and `512` in JSON; `status` renders as `running (degraded)` and serialises as `"running"`,
with `degraded` available as its own field. The unit belongs in a cell a person reads, not in a
value a script is about to do arithmetic on, and a script should not substring-match
`"running (degraded)"` to learn one boolean.

**It is additive.** Without `--fields`, `--json` is byte-for-byte what it was — the API's own
objects, `display_name` and nested `resources` — so existing `jq` paths keep working. A test pins
that.

A misspelled field is an error naming it and the valid ones, exit code 2, before any request goes
out. A silently short row is worse than an error because a script will act on it, which is the same
reasoning as C-15.

### What the eval said

The flag came out of `evals/cli-ab`: `list --json` was 4,096 characters on a near-empty tenant
against 271 for the table, and T6 and T14 were the two tasks where our arm read *more* output than
upstream's. With `--fields`, the narrow path is 158 characters — 26× smaller.

Rerunning the suite (`runs/full2`, 13 tasks, both arms, one trial) did not show that saving:

| Arm B, the 9 tasks shared with `full1` | before | after |
| --- | --- | --- |
| Cost | $0.47 | $0.49 |
| Turns | 38 | 40 |
| CLI output read | 44,580 chars | 46,172 chars |

Flat, or marginally worse, though n=1 per cell is well inside the noise. Two reasons, both
structural:

- **Only 4 of 13 tasks call `list` at all.** The rest name a runtime the prompt already gave them
  and go straight to `inspect` or `exec`, which have no `--fields`. The big payload was real but it
  was not on the critical path.
- **Where it was used, it was used second.** In T6 the agent ran `list --json`, then
  `list --all --json --fields name,status,vcpus` — it explored with the full payload and narrowed
  afterwards, paying for both. An agent's first call on an unfamiliar surface is exploratory, and
  exploration is exactly when it does not yet know which fields it wants.

The flag was discovered unprompted from `--help` in both tasks that used it, so discoverability is
not the problem.

### What this commits us to

Keeping it: it is correct, tested, documented, and cheap. But not claiming it reduces agent context
in aggregate, because the one measurement we have says it does not.

It also points at where the cost actually is. Neither CLI can filter *rows* — the API takes only
`status`, `limit` and `after`, with no name or prefix parameter — so T7 and T14, which both ask for
"every runtime whose name starts with …", are solved in both arms by listing the whole tenant and
filtering in the shell. Trimming columns off a full listing saves much less than not fetching most
of the listing would. If we act on this, `inspect --fields` and row filtering are the candidates,
and neither should be built without a measurement first. This entry exists partly as a reminder
that the last one was built without one.

---

## I-11 — An in-runtime sign-in is a fallback, not a flag

**Status:** decided, 2026-09-29, and implemented. **Closes** the question I-7 deliberately left
open.

I-7 ends by saying the `--runtime-sign-in` path "stays open rather than being assumed fixed". This
is that path, and the decision is that it should not be a flag at all.

The production CLI exposes it as `runta run --runtime-sign-in`. Three things are wrong with that
shape, and only the first is a bug:

1. **It promises what it does not do.** Its help reads "Configure provider authentication inside
   the Runtime". It configures nothing — it waives the API's credential check, and the runtime
   starts with no credential at all. That is `CLI_ISSUES.md` C-33.
2. **It over-standardises.** It is a flag on every `run`, relevant only to images whose catalog
   entry sets `allow_runtime_sign_in`. On `clean` it is meaningless; on an image that fronts a
   provider but forbids it, it is a lie. A flag that is inapplicable to most invocations of the
   command it hangs off teaches the reader that the surface is bigger than the problem.
3. **It asks the user to restate the situation.** An image either needs a credential or it does
   not. When it does, there are exactly two outcomes: something injected one, or you will sign in
   inside the box. The CLI knows which, because the API just told it. Requiring a flag is
   requiring the user to repeat information the tool is already holding — the same objection I-7
   raised against demanding `--model-provider-protocol` for an image that binds one protocol.

So there is no flag. `create` sends the request; if the API refuses with *"which no secret in this
request populates"* and the image allows signing in, it retries once with the waiver and reports
what actually happened:

```console
$ runta-next create --name demo --image claude
Runtime 'demo' is running.
Its agent is installed but not signed in yet.

Next steps:
  runta-next exec demo -it -- bash  start the agent and sign in with /login
```

### Why a retry rather than always sending it

Sending the waiver up front would be one fewer round trip, and was the first thing I tried. It is
wrong: when the organization has a matching model provider the API injects it and never refuses, so
an eager waiver could waive that injection too — a regression for precisely the users who set one
up. We have no tenant with a provider configured to test against, which makes the eager version a
guess and the retry version an observation. The refusal is fast (~2s measured), and it only happens
when there is genuinely nothing to inject.

The image is already resolved to build the request body, so the retry path costs no extra lookup.

### What it commits us to

Saying so, every time. The runtime comes up `status: running`, `degraded: false`, `error_code:
null` with an agent that prints `Not logged in`, and the API's runtime object has **no field** that
distinguishes it from a working one. So the CLI adds `sign_in_pending: true` to `create --json`,
and the prose says it outright. `inspect` cannot know and does not pretend to — which is a real
limit, and the reason C-33's recommendation to "surface the state on the runtime object" is aimed
at the API rather than at us.

The next step names a shell rather than an agent binary. Each image ships a different one —
`claude`, `codex`, `opencode` — and naming the wrong one is worse than naming none.

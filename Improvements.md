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

## I-1 — Rename the top-level runtime commands

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

It also means **`runta run` will not exist.** If someone types it, the error should say so and point
at both plausible intents — `create` and `exec` — rather than a bare "unknown command".

---

## I-2 — Runtime verbs are top-level; other resources are grouped

**Status:** decided, 2026-09-26.

```
runta create | list | inspect | delete | exec        # runtimes, flat
runta checkpoint create | list | ...                 # everything else, grouped
runta secret …   runta image …   runta ssh-key …
```

The CLI is *about* runtimes. Checkpoints, secrets, images and SSH keys all modify or attach to a
runtime, so they read naturally as groups under their noun, while the runtime itself does not need
to be named twice. This is Docker's shape (`docker ps` but `docker volume ls`) and Daytona's.

The alternative was noun-first with no exceptions — Modal's shape (`modal app list`,
`modal container list`). That is marginally more predictable for an agent, which can infer every
command from one example instead of learning that runtimes are special. We are accepting that one
exception in exchange for not typing `runtime` in front of the commands used all day.

**What this commits us to:** exactly one exception, and it is runtimes. Any *second* resource
promoted to top-level verbs turns a documented exception into a pattern nobody can predict.

---

## I-3 — No compatibility aliases

**Status:** decided, 2026-09-26.

No `ps` alias for `list`, no `run` for `create`, no `rm` for `delete`.

Aliases looked cheap when the goal was serving both audiences at once, and they are the standard
answer. They are the wrong answer here for two reasons. There is no installed base to protect, so
the only thing an alias buys is recognition for someone arriving from another product — and every
alias is a second name in `--help`, a second thing to document, and a fork in every example. Worse,
aliases hide the decision: `runta ps` silently working means nobody ever learns that `list` is the
name, and the ambiguity in I-1 survives in the surface we were trying to remove it from.

The field shows both failure modes. E2B's aliases are abbreviations rather than synonyms — `in`,
`kl`, `cr` — and `sandbox pause` is aliased **`ps`**, so the same two letters list containers in
Docker and pause a sandbox in E2B. Daytona's alias map still carries keys (`install`, `code`,
`forward`) for commands that no longer exist in the product.

---

## Proposed, not yet decided

Recorded so the reasoning is not lost, but none of these is settled.

### P-1 — Wait by default, `-d`/`--detach` to opt out

The production CLI returns immediately and offers `--wait`. No comparable CLI has a `--wait` flag at
all: E2B and Modal wait by default with `-d/--detach` to opt out, Daytona waits unconditionally. A
runtime you cannot use yet is rarely what anyone asked for, and the happy path should not need a
flag. With I-3 in force there is no compatibility argument left on the other side.

### P-2 — `--json` only, no `-o` and no `-f`

`--json` is what Modal and the production CLI use. `-o` would import a collision rather than a
convention — in E2B `-o` already means `--order`. `-f` for format collides inside both E2B and
Daytona's own surfaces (`--follow`, `--force`, `--dockerfile`). One long flag, no short form.

### P-3 — `delete` gets `--dry-run` and `-y`/`--yes`

`-y` is universal for destructive confirmation. **`--dry-run` exists in none of the four CLIs
surveyed** — it is the clearest place to be better than the field rather than level with it, and
`CLI_ISSUES.md` C-09 is the argument for it.

### P-4 — `<RUNTIME>` positional, accepting id or name

Universal in the field: nobody makes the target a flag. One placeholder word everywhere, rather than
the production CLI's mix of `<RUNTIME_NAME>`, `<VM_NAME>` and `<RUNTIME_ID>`, and rather than
Daytona's accurate but unreadable `[SANDBOX_ID] | [SANDBOX_NAME]`.

# Research: how comparable CLIs name their commands

Field research done 2026-09-26, to decide the naming of `run` / `ps` / `inspect` / `rm` before
building them. Compares **E2B**, **Daytona** and **Modal** — the three closest products to Runta —
against **Docker**, whose vocabulary all of them borrow from, and against the **production Runta
CLI** (`@runta/runta-cli` 0.2.10) that ours has to live alongside.

Design rules derived from this live in [`.claude/skills/cli-design/`](./.claude/skills/cli-design);
defects observed in the production Runta CLI live in [`CLI_ISSUES.md`](./CLI_ISSUES.md).

## Source quality, stated upfront

Not all four surfaces are equally well documented, and that matters for how much weight to give
each.

| CLI | What I read | Caveat |
| --- | --- | --- |
| E2B | `docs.e2b.dev/sdk-reference/cli/v2.20.0/{auth,sandbox,template}`, CLI guides, and `packages/cli/src/` in `e2b-dev/E2B` | `docs.e2b.dev/cli/commands` **404s** — there is no single command reference. **Aliases are documented nowhere**; they exist only in source |
| Daytona | `daytona.io/docs/en/tools/cli`, plus `apps/cli/` at tag **v0.190.0** | The repo carries a notice that core development moved to a private codebase as of June 2026; `main` is now just a README. Docs reflect a newer build (v0.218) than the last public source, so a few flags differ. `daytona.io/docs/reference/cli/` **404s** |
| Modal | `modal.com/docs/cli/latest/intro.md` and the per-command pages | **`modal sandbox` is not documented at all** — `/docs/cli/latest/sandbox.md` 404s. Sandboxes are reachable only via `modal shell <sb-id>`. `modal nfs` is referenced by `modal volume`'s page but has no page of its own |
| Runta (production) | The shipped binary's `help --json`, exercised live | Its own docs describe a different, smaller CLI — see `CLI_ISSUES.md` C-05 |

## The four operations, side by side

| Operation | Docker | E2B | Daytona | Modal | Runta (prod) |
| --- | --- | --- | --- | --- | --- |
| create | `run`, `create` | `sandbox create [template]` | `create` *(aliases `add`, `new`)* | `run FUNC_REF` (a function, not a sandbox) | `run` |
| list | `ps` | `sandbox list` *(alias `ls`)* | `list` *(alias `ls`)* | `app list`, `container list` | `ps` |
| details | `inspect` | `sandbox info <id>` *(alias `in`)* | `info` *(aliases `view`, **`inspect`**)* | **none** | `inspect` |
| delete | `rm` | `sandbox kill [ids...]` *(alias `kl`)* | `delete` *(aliases `remove`, **`rm`**)* | `app stop`, `container stop`, `volume delete` | `rm` |
| exec | `exec` | `sandbox exec <id> <cmd...>` | `exec <id> -- <cmd>` | `container exec <id> <cmd...>` | `exec` |
| shell | `exec -it` | `sandbox connect <id>` | `ssh <id>` | `shell [ref]` | `ssh` |

Two structural differences worth noting before reading anything into the verbs:

- **E2B nests everything** under `e2b sandbox …` (alias `sbx`). There is no top-level `e2b ls`.
- **Daytona registers its sandbox verbs twice** — once under `daytona sandbox …` and once as
  top-level shortcuts. Only the flat form is documented. So `daytona list` and
  `daytona sandbox list` both work.
- **Modal has no single-resource "show" command at all.** No `inspect`, `describe`, `get` or `show`
  for apps or containers. The closest are `app history` and `app dashboard` (which opens a browser).

## Conventions that are genuinely universal

These held across all four. They are the ones worth treating as settled.

### 1. The target is positional, never a flag

No exceptions in any of the four. Modal's only flag-shaped ids are *filters*
(`container list --app-id`), not targets.

This is the finding recorded against the production Runta CLI as `CLI_ISSUES.md` C-34: it takes the
runtime as a positional in 34 commands and as a `--runtime` flag in two. Nothing in the field
supports the flag form.

### 2. Id *or* name, where the API allows it

- Daytona spells the placeholder `[SANDBOX_ID] | [SANDBOX_NAME]` on every sandbox command and
  resolves server-side.
- Modal deliberately names its placeholder `APP_IDENTIFIER` — its own examples pass both
  `ap-123456` and `my-app`.
- E2B is **id-only** and is the outlier. A sandbox's name exists but is surfaced only as an `Alias`
  column and is not accepted as an identifier by any command.

Runta's REST API accepts either, and the exec WebSocket parameter is documented as "Runtime UUID or
display name", so id-or-name is available to us and is what two of three comparable CLIs do.

### 3. `--json`, and nobody uses `-o`/`--output`

| CLI | Structured-output flag |
| --- | --- |
| Modal | `--json` (on ~18 list-type commands; `--csv` additionally on the billing reports) |
| E2B | `-f, --format <pretty\|json>` |
| Daytona | `-f, --format <yaml\|json>` |
| Runta (prod) | `--json` |

**`-o`/`--output` appears in none of them** — and in E2B `-o` is already taken, meaning `--order`
("sort order by start time"). So adopting `-o` for output would be importing a collision, not a
convention.

Worth noting E2B and Daytona both put `--format` on `-f`, which then collides with other flags in
their own surfaces: Daytona's `-f` is `--dockerfile` on `create` and `--force` on `stop`; E2B drops
the `-f` short form on `logs` because `-f` is `--follow` there. A short form that means three things
is worse than no short form.

### 4. `-y`/`--yes` for destructive confirmation

Modal has `-y, --yes` ("Run without pausing for confirmation.") on every destructive command. E2B
has `-y, --yes` on `template delete`/`publish`/`unpublish`. Daytona relies on `--all` plus a help
dump when called ambiguously.

**None of the four has `--dry-run`.** That is a gap in the field rather than a convention to follow,
and it is the thing `CLI_ISSUES.md` C-09 argues hardest for.

### 5. Stopping and deleting are different verbs

Modal is the most deliberate about this: `stop` for live things (`app`, `container`, `endpoint`),
`delete` for persistent named ones (`volume`, `secret`, `dict`, `queue`, `environment`). It also
keeps `ls` and `list` as genuinely *different* commands — `volume list` enumerates volumes,
`volume ls` lists files *inside* one; `volume delete` removes the volume, `volume rm` removes a file
in it.

Runta has both shutdown and delete, so keeping `rm` distinct from `stop` is right — and Modal's
filesystem-vs-resource split is a reason to be careful if we ever add file commands.

## Where the field disagrees with the production Runta CLI

### `ps` is Docker-only

Only Docker and Runta use `ps` for listing. E2B, Daytona and Modal all use `list` (E2B and Daytona
aliasing `ls`). `ps` is a Docker inheritance, not an industry norm.

### `inspect` is a minority name

E2B and Daytona both use `info`. Daytona ships **`inspect` as an alias of `info`** — so the pairing
is already established in the field, just in the other direction. Modal has no such command at all.

### Waiting is the default everywhere except Runta

This is the sharpest disagreement, and the one real decision this research surfaced.

| CLI | Behaviour |
| --- | --- |
| E2B | `sandbox create` attaches a terminal and waits; `-d, --detach` = "create sandbox without connecting terminal to it", prints just the id |
| Modal | `modal run` blocks; `-d, --detach` = "Don't stop the app if the local process dies or disconnects" |
| Daytona | `create` waits implicitly — calls `AwaitSandboxState` internally, and streams build logs with `Follow` hardcoded. **No flag at all** |
| Runta (prod) | Returns immediately; `--wait` opts in |

**No CLI in the field has `--wait`.** All three wait by default and offer `--detach`. The production
Runta CLI is alone in making the useful case opt-in — and `CLI_ISSUES.md` C-14 records that even
then it only has `--wait` on 2 of 9 asynchronous commands.

Related: none of the three has a `--wait` *timeout* flag either, because a default-waiting command
doesn't need one advertised.

## Things observed that are worth not copying

- **E2B's aliases are abbreviations, not synonyms** — `in`, `kl`, `cr`, `lg`, `mt`, `ex`, `fk`. Most
  damagingly, `sandbox pause` is aliased **`ps`**, so the same two letters list containers in Docker
  and pause a sandbox in E2B. Aliases should be synonyms; abbreviations are what shell aliases and
  completion are for.
- **E2B's `exec` requires flags before the positional**: "Everything after the sandbox ID is passed
  through to the remote command, so e2b options must come before the sandbox ID". Daytona uses a
  `--` separator instead, which is the clearer convention and what the production Runta CLI does.
- **Daytona's placeholder bracketing is inconsistent across its own commands** —
  `[SANDBOX_ID] | [SANDBOX_NAME]` on most, `[SANDBOX_ID | SANDBOX_NAME]` on `exec` and
  `preview-url`, `[VOLUME_ID_OR_NAME]` for volumes. Small, but it is exactly the kind of drift
  `CLI_ISSUES.md` C-26 is about.
- **Daytona's alias map carries dead keys** — `update`, `install`, `uninstall`, `code`, `logs`,
  `forward` have no matching command in the current generation; `code`/`open` is a leftover from the
  workspace era.
- **Modal documents `--json` with no description at all** on ~18 commands — a bare bullet. Its
  human output format is undocumented everywhere, so you cannot tell from the reference whether
  lists print tables.
- **E2B's empty-state strings are inconsistent with each other**: "No sandboxes found", "No
  snapshots found", "No templates found." — note the trailing period on only the last.

## Recommendation

Keep the production Runta names, and add the field's names as aliases. Matching the CLI our users
may already have installed matters more than matching the field, and aliases cost one line each.

| Ours | Alias | Rationale |
| --- | --- | --- |
| `run` | `create` | E2B and Daytona both use `create`; `run` reads as "execute" to anyone arriving from Modal |
| `ps` | `list`, `ls` | Only Docker and Runta use `ps`; all three comparable CLIs use `list` |
| `inspect` | `info` | E2B and Daytona both use `info`, and Daytona already pairs the two — just the other way round |
| `rm` | `delete` | The most divergent verb in the field; the pair covers Docker/Runta and Daytona/Modal |

And, following the universal conventions above:

- Runtime is a **positional** argument on every command, accepting **id or name**, with one shared
  resolver.
- **`--json` only.** No `-o`, no `-f` short form for format.
- **`-y`/`--yes`** on `rm`, plus **`--dry-run`** — the latter being something no comparable CLI
  offers.
- **`-a`/`--all`** on `rm` for bulk (E2B and Daytona both do this), and on `ps` for all states
  (matching the production Runta CLI).
- `rm` takes **variadic** positionals, as E2B's `kill [sandboxIDs...]` does and the production Runta
  `rm` already does.

### Open decision: wait by default, or `--wait`?

The field says **wait by default, `-d`/`--detach` to opt out**. The production Runta CLI says
`--wait` to opt in. We cannot match both.

Recommendation: follow the field. A runtime you cannot use yet is rarely what anyone wanted, and
the happy path should not need a flag. To keep the production CLI's muscle memory working, accept
`--wait` as a documented no-op alias rather than an error.

This is recorded as undecided until confirmed, because it contradicts our own rule about matching
the existing surface (`.claude/skills/cli-design/SKILL.md`, "Match the surface that already
exists") — which is exactly the kind of conflict worth writing down rather than resolving silently.

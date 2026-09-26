# Rule → finding map

Every rule in `SKILL.md` came from a defect we observed in Runta's production CLI (v0.2.10) or
from something we got wrong ourselves. Full write-ups, with terminal transcripts, are in
`CLI_ISSUES.md` at the repo root. Read the finding when a rule feels arbitrary — the reasoning
generalises further than the rule.

## By severity, as recorded

| Finding | Severity | One-line |
| --- | --- | --- |
| C-01 | blocker | `exec` fails spuriously ~10% of the time; 5 of 50 successful commands returned `status: null` and exit 1. Retries the upgrade, but not a mid-stream reset |
| C-02 | blocker | `login` fails on every clean machine — writes its state file without creating the directory |
| C-03 | blocker | The device poller abandons the login on one transient error *and* deletes its own pending state |
| C-04 | blocker | `exec` on a stopped runtime returns only `websocket error: HTTP error: 409 Conflict` |
| C-30 | blocker | The official agent skill documents a command and flags that do not exist |
| C-05 | high | Docs describe a 14-command CLI; 26 ship. Documented flags that don't exist |
| C-06 | high | `help --json` advertises `possible_values: ["true","false"]` on every boolean flag |
| C-07 | high | `inspect` renders the same table as `ps`, hiding 45 JSON fields; `ps --full` is a TTY no-op |
| C-08 | high | `--json` implied off-TTY with no way off, so `\| less` and `> file` get JSON |
| C-09 | high | No `--dry-run`, `--yes`, `--force` or `--confirm` anywhere, on 8 destructive commands |
| C-10 | high | `egress set` is silent replace-all; empty allowlist = lockout, empty denylist = wide open, rendered identically |
| C-11 | high | `required_action` on `resume` says to run `resume` |
| C-12 | high | Table collapses to one char per column at zero winsize; ignores `COLUMNS` |
| C-13 | high | `--publish` returns a port and never the URL |
| C-14 | high | `--wait` on 2 of 9 async commands; responses echo the pre-transition status |

| C-16 | high | `exec` buffers all output into a JSON string field — no streaming |
| C-18 | high | Help text inside `error.message`; a different array key per list command; no `request_id` |
| C-31 | high | `help --json` costs ~19.6k tokens, can't be narrowed; compacting alone saves 54% |
| C-32 | high | `<sub> --help` returns the entire 78 KB root tree in JSON mode |
| C-33 | high | `--runtime-sign-in` reports a ready runtime whose agent isn't logged in |
| C-35 | high | No published OpenAPI document; docs disagree with the live API in six places |
| C-17 | medium | `help <sub>` prints `Usage: ps …` — an uncopyable usage line |
| C-19 | medium | `cp` has no progress at all; silent overwrite; undocumented tar on `-` |
| C-20 | medium | No `whoami`, no `version` subcommand, no completions, no update check |
| C-21 | medium | Interactive login prints three platform commands instead of opening the browser |
| C-22 | medium | Lifecycle responses embed the whole 45-field runtime object |
| C-23 | medium | `describe` returns exactly what `list` already showed |
| C-24 | medium | `min_memory_mib`, `resources.requests.memory_mib` and serde output leak to users |
| C-25 | medium | `NO_COLOR` drops colour but keeps bold; no `--color` |
| C-26 | medium | `ls`/`list`, `rm`/`delete`/`revoke`/`detach`, mixed booleans, two id vocabularies |
| C-28 | medium | No Windows or Intel-Mac build, missing npm `os` field, stale `next` dist-tag |
| C-34 | medium | Runtime arg is a flag on 2 commands and positional on 34 |
| C-15 | low | Hard-coded page size and no `--limit`; results are complete, it does follow cursors |
| C-27 | low | `Runtime 'x' is absent from the API.` as a success message; 15 s of silence in `run --wait` |
| C-29 | low | npm shim flattens signal death to exit 1 instead of `128+signo` |

## Our own mistakes, worth the same weight

Not in `CLI_ISSUES.md`, because they were ours:

- **Success routed to stderr.** `logger.info` was `console.error`, so `Authorized. Token saved…`
  rendered red in a terminal that colours stderr — a successful login reading as a failure.
- **A guard swallowed by its own `catch`.** The "config is not a JSON object" check sat inside
  the `try` around `JSON.parse`, so `fail()` was caught and re-reported as a parse error. Caught
  by a test, which is the argument for writing the test.
- **Transcribing docs instead of probing the API.** Our `errorFromResponse` read `code` and
  `message` from the top level of the error body because that is what the docs describe. The live
  API nests them under `error`, so every API error silently degraded to `http_<status>` with a
  generic message.
- **Revoking a real credential while testing.** `logout` was smoke-tested with the user's live
  API key in the environment. It did exactly what it says and the key was destroyed for every
  consumer. Test destructive commands with a throwaway credential.
- **Recording two findings I had not fully verified.** C-15 claimed lists "silently truncate at
  100" and C-01 claimed `exec` had no retry. Reading the binary's strings later showed the CLI
  follows pagination cursors and does retry the websocket upgrade. The measurements were sound; the
  explanations were guesses stated as fact. Both are now corrected in place with a dated note —
  quietly editing them would have been worse than the original error.
- **Running `vitest` inside a package.** Tests silently ran against stale `dist/` of workspace
  deps and failed confusingly. `pnpm test` at the root builds deps first.

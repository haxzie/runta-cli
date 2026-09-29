# demo

Runs a real headless Claude Code agent against either CLI and renders its stream so a person can
watch. Built for recording a demo by hand — point a screen recorder at a terminal and run it.

```sh
./demo/setup.sh                                  # builds demo/bin: both CLIs, plus node and jq

export RUNTA_TOKEN=rt_…
export CLAUDE_CODE_OAUTH_TOKEN=…                 # or ANTHROPIC_API_KEY

./demo/agent-demo.sh                             # ours
./demo/agent-demo.sh runta                       # the official CLI, same task
```

A representative run:

```
$ ./demo/agent-demo.sh
▸ runta-next --help 2>&1 | head -80
│ I'll create the runtime with the specified resources.

▸ runta-next create --name demo-agent --cpus 1 --memory 512 --json
│ Now I'll check its CPU architecture.

▸ runta-next exec demo-agent -- uname -m
│ Architecture confirmed. Now deleting the runtime.

▸ runta-next delete demo-agent
│ Created `demo-agent` (1 vCPU, 512 MiB), checked its architecture via `uname -m`, then deleted it.

ANSWER: x86_64

── 5 turns · $0.06
```

## What it is

| File | |
| --- | --- |
| `setup.sh` | Builds `demo/bin` — the two CLIs under their real names, plus `node` and `jq` |
| `agent-demo.sh` | The canonical task, as a prompt. Edit this to demo something else |
| `agent-task.sh` | Runs one agent under the eval's isolation |
| `format-stream.ts` | Renders `--output-format stream-json` as a readable trace |

The isolation mirrors [`evals/cli-ab`](../evals/cli-ab): one CLI on `PATH` so the agent cannot
reach the other, a fresh `HOME` and working directory outside this repo so Claude Code cannot pick
up the repo's `CLAUDE.md` or its `cli-design` skill, and `curl` and `wget` denied so the agent
cannot go around the CLI to the REST API. What you record is what a graded trial does.

`RUNTA_TOKEN` is read from the environment and never typed, so it cannot appear on screen.

## Notes for recording

- The agent creates and deletes a runtime called `demo-agent`. If a run is interrupted, check with
  `runta-next list --all` and delete what is left.
- `--model` defaults to `claude-sonnet-5`. An unrecognised model is not an error — the CLI warns on
  stderr and serves a fallback, which lands in the middle of a recording.
- Scripted recording with [VHS](https://github.com/charmbracelet/vhs) was tried and dropped: it
  produced correct output, but the `ttyd` connection died partway through repeated attempts, and a
  tape that dies before its `delete` leaves a runtime behind. If you revisit it, `Wait` needs a
  regex and trims trailing whitespace — `/^\$$/`, not `/\$ $/`.

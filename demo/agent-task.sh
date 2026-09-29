#!/bin/sh
# Runs one headless Claude Code agent against a CLI, with the same isolation the eval uses, and
# renders the stream so a person can watch it.
#
#   RUNTA_TOKEN=rt_… ./demo/agent-task.sh runta-next "Create a runtime named demo…"
#   RUNTA_TOKEN=rt_… ./demo/agent-task.sh runta      "…"        # the official CLI, for comparison
#
# Isolation, mirroring evals/cli-ab/src/run.ts:
#   - PATH holds one CLI and nothing else, so the agent cannot reach the other one
#   - HOME and cwd are fresh temporary directories outside this repo, so Claude Code cannot pick up
#     the repo's CLAUDE.md or its cli-design skill, which describe runta-next
#   - curl and wget are denied, so the agent cannot go around the CLI to the REST API
#   - login/logout/upgrade are denied: both arms share one token and `logout` revokes it
set -eu

cli=${1:?usage: agent-task.sh <cli> <prompt>}
prompt=${2:?usage: agent-task.sh <cli> <prompt>}
: "${RUNTA_TOKEN:?set RUNTA_TOKEN}"

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)

# Resolved while PATH is still the caller's: the agent runs on a narrowed PATH, but the launcher
# and the stream formatter are not the agent and must stay reachable.
claude_bin=$(command -v claude) || { echo "error: claude is not on PATH" >&2; exit 1; }
bun_bin=$(command -v bun) || { echo "error: bun is not on PATH" >&2; exit 1; }
sandbox=$(mktemp -d)
mkdir -p "$sandbox/home" "$sandbox/work"
trap 'rm -rf "$sandbox"' EXIT

settings=$(cat <<JSON
{"permissions":{"deny":[
  "Bash($cli login:*)","Bash($cli logout:*)","Bash($cli upgrade:*)",
  "Bash(curl:*)","Bash(wget:*)","WebFetch","WebSearch"]}}
JSON
)

tools='Bash,Read,Write,Edit,Glob,Grep'

cd "$sandbox/work"

# Exported rather than set as a command prefix: `${VAR:+NAME="$VAR"}` in a prefix position expands
# to a word the shell tries to execute, and the failure prints the credential.
PATH="$here/bin:/usr/bin:/bin"
HOME="$sandbox/home"
TERM=xterm-256color
export PATH HOME TERM RUNTA_TOKEN
[ -n "${RUNTA_API_URL:-}" ] && export RUNTA_API_URL
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && export CLAUDE_CODE_OAUTH_TOKEN
[ -n "${ANTHROPIC_API_KEY:-}" ] && export ANTHROPIC_API_KEY

# `< /dev/null` because the SDK waits 3s for piped stdin that is never coming, and prints a
# warning that would land in the middle of a recording.
"$claude_bin" -p "$prompt" < /dev/null \
  --output-format stream-json --verbose \
  --model "${EVAL_MODEL:-claude-sonnet-5}" \
  --max-turns 25 --max-budget-usd 2 \
  --tools "$tools" --allowedTools "$tools" \
  --settings "$settings" \
  --strict-mcp-config --no-session-persistence --disable-slash-commands \
  | "$bun_bin" "$here/format-stream.ts"

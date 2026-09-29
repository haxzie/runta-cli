#!/bin/sh
# The canonical demo task, given to a headless agent against whichever CLI is named.
#
#   RUNTA_TOKEN=rt_… ./demo/agent-demo.sh                # runta-next
#   RUNTA_TOKEN=rt_… ./demo/agent-demo.sh runta          # the official CLI, same task
#
# The prompt lives here rather than in the tape because VHS's `Type` cannot carry nested quotes.
# It names the tool and the goal and never a flag: working out the flags is the thing being shown.
set -eu

cli=${1:-runta-next}
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)

exec "$here/agent-task.sh" "$cli" "A command-line tool called \`$cli\` is installed on this machine and already authenticated. It manages Runta cloud runtimes (remote Linux sandboxes). Use \`$cli\` for everything that touches Runta — no other tool or API. The Runta account is shared, so never touch a runtime the task does not name.

Create a runtime named \`demo-agent\` with 1 vCPU and 512 MiB of memory. Find out its CPU architecture, then delete the runtime.

When you are done, end your final message with one line of the form \`ANSWER: <architecture>\`."

#!/bin/sh
# Builds demo/bin, which is what the tapes put on PATH: the two CLIs under their real names, so
# the recordings show `runta-next` and `runta` rather than a build artefact's filename.
#
#   ./demo/setup.sh && RUNTA_TOKEN=rt_… ./demo/record.sh
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
repo=$(CDPATH='' cd -- "$here/.." && pwd -P)
bin="$here/bin"

rm -rf "$bin"
mkdir -p "$bin"

# Ours: built from this tree, so a recording always shows the current code.
bun run "$repo/scripts/build-binaries.ts" runta-next-darwin-arm64 >/dev/null
ln -sf "$repo/dist/bin/runta-next-darwin-arm64" "$bin/runta-next"

# Theirs: the same pinned 0.2.10 the eval's arm A uses. Only needed for the comparison tape.
official="$repo/evals/cli-ab/.arms/A/bin/runta"
if [ -x "$official" ]; then
  ln -sf "$official" "$bin/runta"
else
  echo "note: $official is missing — run evals/cli-ab/setup.sh for the comparison tape" >&2
fi

# The eval gives each arm node and jq and nothing else; match it, so a recording and a graded
# trial put the agent in the same environment.
for tool in node jq; do
  path=$(command -v "$tool") || { echo "error: $tool is required" >&2; exit 1; }
  ln -sf "$path" "$bin/$tool"
done

echo "ours:   $("$bin/runta-next" --version)"
[ -x "$bin/runta" ] && echo "theirs: $("$bin/runta" --version 2>&1 | tr -d '\n  ')" || true

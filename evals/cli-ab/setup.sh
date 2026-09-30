#!/bin/sh
# Installs both CLIs into per-arm bin directories under .arms/.
#
#   ./setup.sh
#   OFFICIAL_VERSION=0.2.10 RUNTA_NEXT_VERSION=v0.5.0 ./setup.sh
#   RUNTA_NEXT_BIN=../../dist/runta-next-linux-x64 ./setup.sh   # test a local build instead
#
# Each arm's bin directory holds its CLI and the tools every agent gets (node, jq) and nothing
# else, so an agent in one arm cannot reach the other CLI. The CLI is a wrapper that refuses
# login, logout and upgrade: the arms share one RUNTA_TOKEN, and `logout` revokes it server-side.
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
repo=$(CDPATH='' cd -- "$here/../.." && pwd -P)
arms="$here/.arms"
OFFICIAL_VERSION=${OFFICIAL_VERSION:-0.2.10}

rm -rf "$arms"
mkdir -p "$arms/A/bin" "$arms/A/real" "$arms/B/bin" "$arms/B/real"

# Arm A: the official CLI from npm, pinned.
npm install --silent --no-audit --no-fund --prefix "$arms/A/real" "@runta/runta-cli@$OFFICIAL_VERSION"
official="$arms/A/real/node_modules/.bin/runta"
[ -x "$official" ] || { echo "error: npm did not install a runta binary at $official" >&2; exit 1; }

# Arm B: runta-next, from a release or a local build.
if [ -n "${RUNTA_NEXT_BIN:-}" ]; then
  cp "$RUNTA_NEXT_BIN" "$arms/B/real/runta-next"
  chmod +x "$arms/B/real/runta-next"
else
  # RUNTA_NO_MODIFY_PATH matters here: the installer edits the invoking user's shell profile so a
  # real install is runnable, and this is not a real install. Without it, every setup.sh appended
  # a throwaway arm directory to the developer's own ~/.zshrc.
  RUNTA_INSTALL_DIR="$arms/B/real" RUNTA_BIN_NAME=runta-next RUNTA_NO_MODIFY_PATH=1 \
    ${RUNTA_NEXT_VERSION:+RUNTA_VERSION=$RUNTA_NEXT_VERSION} sh "$repo/scripts/install.sh"
fi

wrap() { # wrap <real binary> <bin dir> <name>
  cat >"$2/$3" <<WRAPPER
#!/bin/sh
# Eval wrapper: the arms share one credential, so nothing may sign in, out, or replace the binary.
for a in "\$@"; do
  case "\$a" in
    --) break ;;
    login | logout | upgrade)
      echo "error '\$a' is disabled for this evaluation." >&2
      exit 2 ;;
  esac
done
exec "$1" "\$@"
WRAPPER
  chmod +x "$2/$3"
}
wrap "$official" "$arms/A/bin" runta
wrap "$arms/B/real/runta-next" "$arms/B/bin" runta-next

for arm in A B; do
  for tool in node jq; do
    path=$(command -v "$tool") || { echo "error: $tool is required" >&2; exit 1; }
    ln -sf "$path" "$arms/$arm/bin/$tool"
  done
done

echo "arm A: $("$arms/A/bin/runta" --version 2>&1 | head -1)"
echo "arm B: $("$arms/B/bin/runta-next" --version 2>&1 | head -1)"

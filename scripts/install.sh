#!/bin/sh
# Runta CLI installer.
#
#   curl -fsSL https://runta.haxzie.com/install.sh | sh
#
# That URL is a Cloudflare Worker (workers/install) which serves this file from the
# repository's default branch, so the installer can change without a redeploy. This
# script is the source of truth; the Worker only relays it.
#
# Environment:
#   RUNTA_VERSION       version to install (default: latest release)
#   RUNTA_INSTALL_DIR   install location (default: $HOME/.runta/bin)
#   RUNTA_BIN_NAME      command name to install as (default: runta)
#   RUNTA_BASE_URL      override the release download base (for testing)
#
# Runta publishes its own CLI to npm, which also provides a `runta` command with different
# subcommand names. If you want both, install this one under another name:
#
#   RUNTA_BIN_NAME=runta-next curl -fsSL https://runta.haxzie.com/install.sh | sh
set -eu

REPO="haxzie/runta-cli"
# Release artifacts are always named after the project; what you *call* it is up to you.
ARTIFACT_PREFIX="runta"
BIN_NAME="${RUNTA_BIN_NAME:-runta}"

info() { printf '%s\n' "$*" >&2; }
err() { printf 'error: %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || err "\`$1\` is required but was not found on PATH."
}

detect_target() {
  os=$(uname -s)
  arch=$(uname -m)

  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) err "Unsupported operating system: $os" ;;
  esac

  case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) err "Unsupported architecture: $arch" ;;
  esac

  libc=""
  if [ "$os" = linux ]; then
    # Alpine and friends need the musl build; glibc systems must not get it.
    if ! ldd /bin/sh 2>/dev/null | grep -q 'libc\.so\.6'; then
      libc="-musl"
    fi
  fi

  printf '%s-%s-%s%s' "$ARTIFACT_PREFIX" "$os" "$arch" "$libc"
}

resolve_version() {
  if [ -n "${RUNTA_VERSION:-}" ]; then
    printf '%s' "$RUNTA_VERSION"
    return
  fi
  # Follow the /releases/latest redirect rather than hitting the rate-limited API.
  latest=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/$REPO/releases/latest" 2>/dev/null) ||
    err "Could not determine the latest version. Set RUNTA_VERSION to install a specific one."
  version=${latest##*/}
  [ -n "$version" ] && [ "$version" != latest ] ||
    err "Could not determine the latest version. Set RUNTA_VERSION to install a specific one."
  printf '%s' "$version"
}

verify_checksum() {
  # $1 tarball path, $2 checksums file, $3 tarball name
  expected=$(awk -v name="$3" '$2 == name { print $1 }' "$2")
  [ -n "$expected" ] || err "No checksum published for $3."

  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$1" | awk '{ print $1 }')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$1" | awk '{ print $1 }')
  else
    info "warning: no sha256 tool found, skipping checksum verification."
    return
  fi

  [ "$actual" = "$expected" ] || err "Checksum mismatch for $3 (expected $expected, got $actual)."
}

# The npm-published Runta CLI provides a `runta` command too, and its command names differ from
# this one's — `ps` there is `list` here, `run` is `create`, `rm` is `delete`. Whichever comes first
# on PATH wins silently, so a user with both installed gets confusing failures rather than a clear
# conflict. Say something.
warn_about_other_runta() {
  install_dir=$1
  existing=$(command -v "$BIN_NAME" 2>/dev/null) || return 0
  [ -n "$existing" ] || return 0

  # Resolve both sides before comparing: a symlink or a relative PATH entry would otherwise look
  # like a different install.
  existing_dir=$(CDPATH='' cd -- "$(dirname -- "$existing")" && pwd -P) || return 0
  target_dir=$(CDPATH='' cd -- "$install_dir" && pwd -P) || return 0
  [ "$existing_dir" != "$target_dir" ] || return 0

  info ""
  info "warning: another \`$BIN_NAME\` is already on your PATH:"
  info ""
  info "  $existing"
  info ""
  info "That one will keep winning until $install_dir comes first, and its subcommand"
  info "names differ from this one's, so muscle memory will fail in confusing ways."
  info ""
  info "The simplest fix is to install this one under its own name instead:"
  info ""
  info "  RUNTA_BIN_NAME=runta-next curl -fsSL https://runta.haxzie.com/install.sh | sh"
  info ""
  info "Then both work, and which one you are running is never in doubt."
}

main() {
  need curl
  need tar

  target=$(detect_target)
  version=$(resolve_version)
  install_dir=${RUNTA_INSTALL_DIR:-$HOME/.runta/bin}
  base_url=${RUNTA_BASE_URL:-https://github.com/$REPO/releases/download/$version}
  tarball="$target.tar.gz"

  info "Installing $BIN_NAME $version ($target) into $install_dir"

  tmp=$(mktemp -d)
  # shellcheck disable=SC2064  # $tmp must expand now, not at trap time.
  trap "rm -rf '$tmp'" EXIT INT TERM

  curl -fsSL "$base_url/$tarball" -o "$tmp/$tarball" ||
    err "Download failed: $base_url/$tarball"
  curl -fsSL "$base_url/checksums.txt" -o "$tmp/checksums.txt" ||
    err "Download failed: $base_url/checksums.txt"

  verify_checksum "$tmp/$tarball" "$tmp/checksums.txt" "$tarball"

  tar -xzf "$tmp/$tarball" -C "$tmp"
  [ -f "$tmp/$ARTIFACT_PREFIX" ] || err "Archive did not contain a \`$ARTIFACT_PREFIX\` binary."

  mkdir -p "$install_dir"
  # Write to a temp name then rename, so an in-use binary is replaced atomically.
  mv "$tmp/$ARTIFACT_PREFIX" "$install_dir/$BIN_NAME.tmp"
  chmod +x "$install_dir/$BIN_NAME.tmp"
  mv "$install_dir/$BIN_NAME.tmp" "$install_dir/$BIN_NAME"

  info ""
  info "Installed $install_dir/$BIN_NAME"

  warn_about_other_runta "$install_dir"

  case ":$PATH:" in
    *":$install_dir:"*) ;;
    *)
      case "${SHELL:-}" in
        */zsh) rc="~/.zshrc" ;;
        */bash) rc="~/.bashrc" ;;
        */fish) rc="~/.config/fish/config.fish" ;;
        *) rc="your shell profile" ;;
      esac
      info ""
      info "$install_dir is not on your PATH. Add this line to $rc:"
      info ""
      info "  export PATH=\"$install_dir:\$PATH\""
      ;;
  esac
}

main "$@"

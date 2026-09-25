#!/bin/sh
# Runta CLI installer.
#
#   curl -fsSL https://raw.githubusercontent.com/haxzie/runta-cli/main/scripts/install.sh | sh
#
# Environment:
#   RUNTA_VERSION       version to install (default: latest release)
#   RUNTA_INSTALL_DIR   install location (default: $HOME/.runta/bin)
#   RUNTA_BASE_URL      override the release download base (for testing)
set -eu

REPO="haxzie/runta-cli"
BIN_NAME="runta"

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

  printf '%s-%s-%s%s' "$BIN_NAME" "$os" "$arch" "$libc"
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
  [ -f "$tmp/$BIN_NAME" ] || err "Archive did not contain a \`$BIN_NAME\` binary."

  mkdir -p "$install_dir"
  # Write to a temp name then rename, so an in-use binary is replaced atomically.
  mv "$tmp/$BIN_NAME" "$install_dir/$BIN_NAME.tmp"
  chmod +x "$install_dir/$BIN_NAME.tmp"
  mv "$install_dir/$BIN_NAME.tmp" "$install_dir/$BIN_NAME"

  info ""
  info "Installed $install_dir/$BIN_NAME"

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

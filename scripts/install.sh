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
#   RUNTA_INSTALL_DIR   install location (default: $HOME/.runta-next/bin)
#   RUNTA_BIN_NAME      command name to install as (default: runta-next)
#   RUNTA_BASE_URL      override the release download base (for testing)
#   RUNTA_NO_MODIFY_PATH  set to any value to be shown the PATH line instead of having the
#                         installer add it to your shell profile
#
# The command installs as `runta-next`, not `runta`, so it sits beside Runta's own npm-published
# CLI without shadowing it. Override with RUNTA_BIN_NAME to call it something else.
set -eu

REPO="haxzie/runta-cli"
# Release artifacts are always named after the project; what you *call* it is up to you.
ARTIFACT_PREFIX="runta-next"
BIN_NAME="${RUNTA_BIN_NAME:-runta-next}"

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

# Only reachable when RUNTA_BIN_NAME names something already installed — most likely `runta`, which
# Runta's own npm-published CLI owns. Those two have different subcommand names (`ps` there is
# `list` here, `run` is `create`, `rm` is `delete`), so whichever wins on PATH produces confusing
# failures rather than a clear conflict. Say something.
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
  info "That one will keep winning until $install_dir comes first, and if it is Runta's"
  info "own CLI its subcommand names differ from this one's, so muscle memory will fail"
  info "in confusing ways."
  info ""
  info "The default name avoids this entirely:"
  info ""
  info "  curl -fsSL https://runta.haxzie.com/install.sh | sh    # installs as runta-next"
}

# The shell profiles worth editing for the user's login shell. $SHELL is what the terminal
# actually starts, so it beats guessing from what exists on disk. bash gets two on macOS:
# interactive non-login shells read ~/.bashrc, while Terminal starts a login shell that reads
# ~/.bash_profile instead, and only one of them being right is how "it works in one window but
# not the other" happens.
profile_files() {
  case "${SHELL:-}" in
    */zsh) printf '%s\n' "$HOME/.zshrc" ;;
    */bash)
      printf '%s\n' "$HOME/.bashrc"
      # Only where it is already read: creating a .bash_profile on Linux would silently stop
      # that machine's ~/.profile from being sourced.
      if [ -f "$HOME/.bash_profile" ] || [ "$(uname -s)" = Darwin ]; then
        printf '%s\n' "$HOME/.bash_profile"
      fi
      ;;
    */fish) printf '%s\n' "$HOME/.config/fish/config.fish" ;;
    *) ;;
  esac
}

# fish has no `export`, and its own helper is both idempotent and universe-aware.
path_line() {
  # $1 profile path, $2 install dir
  case "$1" in
    */config.fish) printf 'fish_add_path %s' "$2" ;;
    *) printf 'export PATH="%s:$PATH"' "$2" ;;
  esac
}

path_command() {
  # What to paste into the shell that is already open, for $1 install dir.
  case "${SHELL:-}" in
    */fish) printf 'fish_add_path %s' "$1" ;;
    *) printf 'export PATH="%s:$PATH"' "$1" ;;
  esac
}

manual_instructions() {
  install_dir=$1
  case "${SHELL:-}" in
    */zsh) rc="~/.zshrc" ;;
    */bash) rc="~/.bashrc" ;;
    */fish) rc="~/.config/fish/config.fish" ;;
    *) rc="your shell profile" ;;
  esac
  info ""
  info "$install_dir is not on your PATH. Add this line to $rc:"
  info ""
  info "  $(path_command "$install_dir")"
}

# Put the PATH line in the login shell's profile so a fresh install is runnable without the user
# copy-pasting anything — the ones who skip that step are left with a binary they cannot invoke.
# Set RUNTA_NO_MODIFY_PATH=1 to be shown the line instead of having it written.
ensure_on_path() {
  install_dir=$1

  case ":$PATH:" in
    *":$install_dir:"*) return 0 ;;
  esac

  if [ -n "${RUNTA_NO_MODIFY_PATH:-}" ]; then
    manual_instructions "$install_dir"
    return 0
  fi

  profiles=$(profile_files)
  if [ -z "$profiles" ]; then
    # An unrecognised shell: guessing at its syntax risks writing a line that breaks every new
    # terminal, which is a worse outcome than printing one.
    manual_instructions "$install_dir"
    return 0
  fi

  # Dotfiles get copied between machines, so write $HOME rather than this machine's home path
  # whenever the install lives under it.
  case "$install_dir" in
    "$HOME"/*) profile_dir="\$HOME/${install_dir#"$HOME"/}" ;;
    *) profile_dir=$install_dir ;;
  esac

  edited=""
  # A here-doc rather than a pipeline: `while read` after a pipe runs in a subshell, where the
  # names collected below would be lost. Newline-separated, because $HOME can contain spaces.
  while IFS= read -r profile; do
    [ -n "$profile" ] || continue

    # Idempotent across re-installs and upgrades. Matching the directory rather than the exact
    # line means a hand-edited variant of the same export still counts as present.
    if [ -f "$profile" ] &&
      { grep -qF "$install_dir" "$profile" || grep -qF "$profile_dir" "$profile"; }; then
      continue
    fi

    mkdir -p "$(dirname -- "$profile")" 2>/dev/null || true
    if printf '\n# added by the %s installer\n%s\n' \
      "$BIN_NAME" "$(path_line "$profile" "$profile_dir")" >>"$profile" 2>/dev/null; then
      edited="${edited}${edited:+, }$profile"
    else
      info ""
      info "warning: could not write to $profile."
      manual_instructions "$install_dir"
      return 0
    fi
  done <<EOF
$profiles
EOF

  info ""
  if [ -n "$edited" ]; then
    info "Added $install_dir to your PATH in $edited."
  else
    info "$install_dir is already in your shell profile, but not in this shell's PATH."
  fi
  info "Open a new terminal, or run this once in the current one:"
  info ""
  info "  $(path_command "$install_dir")"
}

main() {
  need curl
  need tar

  target=$(detect_target)
  version=$(resolve_version)
  install_dir=${RUNTA_INSTALL_DIR:-$HOME/.runta-next/bin}
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

  ensure_on_path "$install_dir"
}

main "$@"

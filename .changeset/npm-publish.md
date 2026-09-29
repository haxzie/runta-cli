---
'@haxzie/runta-next': minor
---

Publish to npm as `@haxzie/runta-next`, and have the installer put the binary on your PATH.

The CLI is now available two ways. `npm install -g @haxzie/runta-next` gets a single bundled file
with no dependencies, installed into npm's global bin directory — already on `PATH`, so there is
nothing to configure and no terminal to restart. The install script still ships a standalone
binary for machines without Node.js.

For that second channel, `install.sh` no longer prints a `PATH` line and leave you to paste it. It
appends the line to the profile your login shell reads — `~/.zshrc`, `~/.bashrc` plus
`~/.bash_profile` on macOS, or `~/.config/fish/config.fish` with `fish_add_path` — writing `$HOME`
rather than an absolute home path, and skipping the edit if the directory is already there. Set
`RUNTA_NO_MODIFY_PATH=1` to be shown the line instead. An unrecognised `$SHELL` or an unwritable
profile falls back to printing it, since guessing at a shell's syntax could break every new
terminal.

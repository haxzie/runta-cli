---
'@runta/api': patch
---

Restore the `VncConnection.username` enum to `runta`.

The runta → runta-next rename rewrote it to `runta-next`, but this is a value the *server* sends —
the in-runtime account name — so a rename of our command could not have changed it. The generated
SDK typed the field as `'runta-next'`, which no live response would ever satisfy.

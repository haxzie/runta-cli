---
'@haxzie/runta-next': minor
---

Add `create --runtime-sign-in`, and cut root help down to a command index.

`--runtime-sign-in` waives the credential check for images that allow it, which is
the only way to reach the twelve agent images without connecting a model provider.
It waives; it does not configure — so unlike the production CLI's flag of the same
name, this one says so: the human output ends with "Its agent is installed but not
signed in yet", the sign-in command is the first next step, and `--json` carries
`sign_in_pending: true`, which the API's runtime object has no field for. An image
that does not allow it is refused before any request.

Root help is now usage, sign-in state, the commands and the global flags. The
"For agents", "Waiting" and "Examples" blocks are gone — 64 lines down to 34. None
of that content was lost: the waiting contract lives on each command that has
`--detach`, where it is read at the moment it matters.

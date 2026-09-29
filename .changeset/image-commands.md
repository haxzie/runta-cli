---
'@haxzie/runta-next': minor
---

Add `runta-next image list` and `runta-next image delete`.

`create --image <id>` took a value neither CLI would tell you: the official
`image ls` covers only images you built yourself, so it answers `[]` on a fresh
account while thirteen catalog images exist. `image list` is that missing call,
with a `MODEL PROVIDER` column that says whether `--model-provider-protocol` will
be required — the protocol name when one is bound and therefore inferred, a count
when several are.

`image delete` removes an image your organization built, with `--dry-run`, a
confirmation on a terminal and `-y` to skip it. It resolves the name against the
catalog first, because the API answers the same `422` for a built-in image and for
an id that does not exist — two different mistakes the status cannot tell apart.

Noun-first with no top-level shortcut, per the rule that only runtime verbs get
one. Also documents the waiting contract in root help and on every command that
takes `--detach`, and corrects the "For agents" note, which still claimed output
shape never depends on the terminal after that stopped being true.

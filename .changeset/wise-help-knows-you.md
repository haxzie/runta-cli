---
'@runta/cli': minor
'@runta/core': minor
---

Make `--help` say whether you are signed in, and what to do about it.

The opening line of the help used to read "Not signed in yet? Start with login" to everyone,
including people who had signed in an hour earlier. It now reflects the actual state: with a stored
login it points at `whoami` to see the current user and team and at `login` to switch user or
organisation; with `RUNTA_TOKEN` set it says so and explains that the environment outranks `login`,
so the variable is what has to change; with no credential it says what it said before.

Adds `credentialSource()` to `@runta/core` — a synchronous probe that never fails, because help is
rendered from a synchronous callback and has to render on a machine whose config file is missing or
corrupt, where `loadConfig` deliberately aborts.

It checks that a token is present, not that it works: rendering help makes no API call, so an
expired token still reads as signed in. That is why every variant names `whoami`.

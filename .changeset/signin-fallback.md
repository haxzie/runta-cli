---
'@haxzie/runta-next': minor
---

`create` now builds the twelve agent images without a flag, and root help is a
command index again.

An image that fronts a model provider needs a credential. If your organization has
a matching provider the API injects it. If it does not, `create` falls back to
building the runtime anyway and signing the agent in from inside — so
`runta-next create --image claude` works on a fresh account where it used to be
refused outright.

There is no flag for this, deliberately. The production CLI's `--runtime-sign-in`
hangs off every `run` while applying only to images whose catalog entry allows it,
and asks you to restate something the API already said in its refusal. The
fallback is a retry on that specific refusal, not a field sent up front, so an
organization provider's injection still wins.

It waives a check; it does not authenticate. So the runtime comes up with the
agent installed and not signed in — and unlike the production CLI, this says so:
the output ends with "Its agent is installed but not signed in yet", the sign-in
is the first next step, and `--json` carries `sign_in_pending: true`, which the
API's runtime object has no field for.

Root help drops the "For agents", "Waiting" and "Examples" blocks — 64 lines to 34.
The waiting contract moved to each command that has `--detach`.

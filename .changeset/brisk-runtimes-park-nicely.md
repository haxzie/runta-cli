---
'@runta/cli': minor
'@runta/api': minor
'@runta/core': minor
---

Add `start`, `stop` and `pause` for runtimes.

You could create a runtime and delete it, but not park it — so the only way to stop paying was to
destroy your work. These three cover the API's four transition endpoints, and the asymmetry is the
point.

**`start` does not make you guess the state.** The API splits waking a runtime across `/start` (from
`shutdown`) and `/resume` (from `paused`), and there is a third parked state, `suspended`, that only
the idle policy produces. The production CLI exposes that split as `boot` and `resume`, so you have to
know the current state before you can name the right verb, and naming the wrong one is an API error.
Since the CLI reads the runtime anyway for `expected_revision`, `start` just picks; `--dry-run --json`
reports which endpoint it chose.

**Asking for the state you are already in is not an error.** `stop` on a stopped runtime reports
`changed: false, reason: "already_in_state"` and sends nothing, which makes these safe in a script
that cannot know the current state.

**`status` is only reported once it is true.** Every transition is asynchronous and the API's response
still carries the pre-transition status, so these poll until the target is observed. Under `--detach`
the payload carries `waited: false` and `target_status` rather than presenting a stale status as the
outcome. The payload is four fields, not the whole runtime object.

Also adds `startRuntime`, `stopRuntime`, `pauseRuntime` and `resumeRuntime` to the spec — endpoints the
published reference does not document at all — plus `waitUntilStatus`, `transitionAtCurrentRevision`
and `wakeAction` in `@runta/core`.

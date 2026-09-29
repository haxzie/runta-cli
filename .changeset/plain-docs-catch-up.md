---
'@runta/cli': patch
---

Documentation only — no behaviour changes. The binaries are functionally identical to v0.6.0.

The overview and the tour still described a five-command CLI after `start`, `stop` and `pause`
shipped, and the overview had never listed `upgrade`. The tour now has a parking step before
clean-up, which is also where it explains why there is no `resume` or `boot` command to get wrong.

Also settles an open question about `resize`: vCPUs cannot be changed after a runtime is created, and
this is an **API limitation** rather than an omission in the official CLI. `PATCH /v2/runtimes/{id}`
accepts only `resources.requests.memory_mib`, `resources.requests.disk_gib` and
`resources.limits.memory_mib` — confirmed against both the REST reference and the generated Python
SDK, where `PatchRuntimeResourceRequests` carries one field against the create side's
`vcpus: int = 1`. Recorded as `CLI_ISSUES.md` C-37 and as a requirement on the future `update`
command in `Improvements.md` I-5: it must reject `--cpus` with the reason and the recreate path,
rather than silently lacking the flag.

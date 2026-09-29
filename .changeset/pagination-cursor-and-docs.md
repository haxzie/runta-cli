---
'@runta/cli': patch
---

Correct the pagination cursor's name in the API spec, and add the design documents.

`Pagination.next_cursor` in `openapi.json` said "Pass as `cursor` to fetch the next page". The
parameter is `after`. The failure was silent — the API ignores an unknown query parameter rather
than rejecting it, so following the old description returns the first page forever. Our client
already used `after`, so nothing was broken; a client generated from the spec would have looped.

`packages/api/NOTES.md` §4 gains the evidence behind `CLI_ISSUES.md` C-15, captured by serving the
production binary 250 runtimes from a local mock: it walks every page, with `limit=100` hard-coded
and `after` as the cursor.

New at the repository root: `DESIGN.md` explains the interface and the reasoning, opening with the
naming decisions and what they bought humans and agents; `FAILURE-AND-RECOVERY.md` writes up what
happens when an agent gets something wrong, from real eval transcripts. `docs.test.ts` now checks
both against the real command tree, so a documented flag cannot drift from the binary.

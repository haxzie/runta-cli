# Runta OpenAPI spec — maintenance notes

## Why this file is hand-written

Runta does **not** publish an OpenAPI document. Every plausible URL 404s:

```
https://api.runta.dev/openapi.json                 404   <- what the scaffolding pointed at
https://api.runta.com/openapi.json                 404
https://api.runta.com/v2/openapi.json              404
https://api.runta.com/docs/openapi.json            404
https://runta.com/openapi.json                     404
https://runta.com/docs/reference/api/openapi.json  404
```

The docs at `https://runta.com/docs/reference/api/` say the underlying spec is OpenAPI **3.0.3**, so
one exists internally; it just isn't served. Worth asking Runta to expose it, because that turns this
whole file back into a generated artifact.

Until then this file is **source, not a snapshot**: maintained by hand, one operation group at a time,
and **verified against the live API** rather than transcribed from the docs. There is no sync step —
`pnpm api:generate` reads `openapi.json` directly and never touches the network. (The original
scaffolding had a `scripts/sync-spec.ts` pointed at `api.runta.dev/openapi.json` and a nightly
`api-drift` workflow to open PRs when the spec moved; both were removed, since neither can ever do
anything.)

## Divergences: live API vs. published docs

Each of these was confirmed with `curl` against `https://api.runta.com`. The spec follows the live
behaviour. These are worth reporting to Runta as documentation bugs.

### 1. `request_id` is a sibling of `error`, not a field inside it

Docs describe `error.request_id` as a required string inside the error object. The API returns it at
the top level:

```console
$ curl -H "Authorization: Bearer $RUNTA_TOKEN" https://api.runta.com/v2/runtimes/nope
{"error":{"code":"not_found","message":"..."},"request_id":"01a0dcb6-d3c3-7c10-acf9-961792e6c237"}
```

Checked on `/v2/runtimes/{id}`, `/v2/secrets/{id}`, `/v2/checkpoints/{id}` and `/v2/me` — all four put
`request_id` at the top level, and `error` contains only `code` and `message`. Transcribing the docs
here would have produced an SDK error type that never populates `requestId`.

### 2. A missing `Authorization` header returns **403**, not 401

```console
(no header)                      -> 403   error.code = permission_denied
Authorization: Bearer nonsense   -> 401   error.code = unauthenticated
Authorization: Bearer rt_…       -> 200
```

The docs label 401 "Missing, malformed, or rejected bearer token". Only the *rejected* case is a 401;
absent credentials are a 403. Both are described accordingly in the spec.

The no-credential 403 is also the one response that **isn't JSON** — the body is the bare string
`Unauthenticated` with no `content-type: application/json`:

```console
$ curl -i https://api.runta.com/v2/me | tail -1
Unauthenticated
```

So the status says 403 while the body says "Unauthenticated", and nothing structured comes back.
`errorFromResponse` degrades to `http_403` / "403 Forbidden" here, which is why `whoami` supplies the
"No credential was sent" hint from the status rather than from the body.

### 3. `POST /v2/auth/device/authorization` does return 400

The docs explicitly omit 400 from this operation. It is the status for every body validation failure:

```console
$ curl -X POST -H 'content-type: application/json' -d '{}' \
    https://api.runta.com/v2/auth/device/authorization          -> 400
{"error":{"code":"invalid_argument","message":"Couldn't parse body parameter BeginDeviceAuthorizationRequest - doesn't match schema: missing field `client_id` at line 1 column 2"},"request_id":"…"}

$ … -d '{"client_id":"nope"}'                                    -> 400
… "unknown variant `nope`, expected one of `runta_cli`, `runta_agent`, `runta_crew` …"
```

Note the messages leak Rust serde internals (`BeginDeviceAuthorizationRequest`, "unknown variant",
line/column offsets). Fine for us to parse, but not great as a public API surface.

### 4. List responses carry an undocumented `pagination` object

Not documented anywhere in the reference, but present on list endpoints as a sibling of `data`:

```console
$ curl -H "Authorization: Bearer $RUNTA_TOKEN" 'https://api.runta.com/v2/runtimes?limit=1'
{"data":[…],"pagination":{"next_cursor":null,"has_more":false}}
```

The `Pagination` schema is already defined here so the list operations can use it when we add them.
Note the CLI hard-codes the page size at 100 and exposes no `--limit`; it does follow
`next_cursor` internally (see `CLI_ISSUES.md` C-15).

### 5. `GET /v2/me` rejects organization API keys

```console
$ curl -H "Authorization: Bearer rt_…" https://api.runta.com/v2/me          -> 403
{"error":{"code":"permission_denied","message":"principal's role does not allow this organization action"},"request_id":"…"}
```

`/v2/me` only works with a user access token from the device flow, not with an org-scoped `rt_` API
key. Anything we build on `getMe` — a `whoami` command, for instance — has to handle the 403 as "this
is an API key, not a user session" rather than as an error. Also note `/v2/me` returns no org id, no
scopes and no expiry, and the API has **no** token-introspection operation, so "which org is this key
for / is it still valid" is currently unanswerable.

### 6. `{runtime_id}` does not accept a display name

`GET /v2/runtimes/{runtime_id}` and `DELETE` are documented as taking "Runtime UUID **or display
name**". They take a UUID only:

```console
$ curl -H "Authorization: Bearer $RUNTA_TOKEN" https://api.runta.com/v2/runtimes/jesting_kalong
{"error":{"code":"invalid_argument","message":"runtime_id must be a UUID"},"request_id":"…"}
```

So accepting names is a client responsibility — `resolveRuntimeId` in `@runta/core` lists and
matches. This is consistent with the exec WebSocket spec, which says the CLI resolves names to ids
first, and inconsistent with these two REST pages.

### 6b. The transition endpoints are undocumented, and the reference renames two of them

The published reference does not describe the state-transition endpoints at all. They were recovered
by pointing the production CLI's `--endpoint` at a local HTTP server and logging what it sent:

```
runta shutdown demo  ->  POST /v2/runtimes/{id}/stop?expected_revision=7    {}
runta boot demo      ->  POST /v2/runtimes/{id}/start?expected_revision=7   {}
runta pause demo     ->  POST /v2/runtimes/{id}/pause?expected_revision=7   {}
runta resume demo    ->  POST /v2/runtimes/{id}/resume?expected_revision=7  {}
runta resize demo …  ->  PATCH /v2/runtimes/{id}?expected_revision=7
                         {"resources":{"requests":{"memory_mib":2048}}}
```

Three things worth keeping:

- **The API's verbs are `start` and `stop`.** The CLI's `boot` and `shutdown` are its own renaming;
  our commands use the API's vocabulary (`Improvements.md` I-9).
- **`/start` and `/resume` are separate endpoints** and neither covers the other, so waking a runtime
  needs the current status to pick. There is no `/suspend`: the `suspended` status is reachable only
  through `idle_policy`.
- **`resize` is not its own endpoint** — it is a `PATCH` on the runtime, so the same operation backs
  any future `update` command.

All of them take `expected_revision` as a query parameter and an empty JSON object as the body, and
answer with the runtime — carrying its **pre-transition** status, since the control plane has only
accepted the request at that point. Anything reading `status` from that response is reading a stale
value (`CLI_ISSUES.md` C-14).

These are described in `openapi.json` as `startRuntime`, `stopRuntime`, `pauseRuntime` and
`resumeRuntime`. Unlike the rest of the spec they were verified against the production CLI's traffic
rather than against the live API, because this session had no token; the request shape is certain, the
response shape follows the documented `RuntimeResponse` envelope and should be re-checked live.

### 7. `checkpoint_id` is UUID-only too, and images have two identifiers

Same pattern as `{runtime_id}`: a checkpoint name is rejected —

```console
$ curl -X POST -H "Authorization: Bearer $RUNTA_TOKEN" -H 'content-type: application/json' \
    -d '{"checkpoint_id":"some-name"}' https://api.runta.com/v2/runtimes
{"error":{"code":"invalid_argument","message":"checkpoint_id must be a UUID"},"request_id":"…"}
```

Images are the opposite shape: `GET /v2/images` returns both a slug `id` (`clean`) and a display
`name` (`Clean runtime`), and `create` takes the slug. That list is **not paginated** — it is the one
list endpoint with no `pagination` object, 13 images at the time of writing.

`resolveRuntimeId`, `resolveCheckpointId` and `resolveImageId` in `@runta/core` exist because of
this: the CLI accepts either form for all three and resolves before the request.

The `CheckpointSummary` schema here is **partial** — only `id`, `display_name` and `state` are
described, because the account used to verify this spec had no checkpoints to sample. Fill it in
before building checkpoint commands.

### 8. `resources.disk_gib` is actually `resources.requests.disk_gib`

The reference flattens the `resources` nesting, leaving it ambiguous whether `disk_gib` sits under
`resources` or `resources.requests`. Live, it is under `requests`, and `observed_disk_gib` is under
`current`:

```json
{ "resources": { "current":  { "memory_mib": 1024, "observed_disk_gib": 16 },
                 "limits":   { "memory_mib": 1024 },
                 "requests": { "memory_mib": 1024, "vcpus": 1, "disk_gib": 16 } } }
```

### 9. `listruntimes` documents no allowed values for `status`

The parameter is a bare string with no enum. Verified live: it accepts the values from the response
`status` enum and answers 422 for anything else. `limit` is 1–100 — both 0 and 101 are 422 — and the
cursor parameter is named `after`, not `cursor`.

### 10. Envelope is inconsistent across auth endpoints

- `POST /v2/auth/device/authorization` → `{ "data": { … } }`
- `POST /v2/auth/device/token` → **not** enveloped, fields at the top level
- `GET /v2/me` → `{ "data": { … } }`

Confirmed live. The spec models each one as it actually is, which is why `DeviceToken` has no wrapper
type while `DeviceAuthorization` and `User` do.

### 11. `POST /v2/auth/device/token` 400 has a different body shape from every other error

```console
$ curl -X POST -H 'content-type: application/json' -d '{"device_code":"deadbeef"}' \
    https://api.runta.com/v2/auth/device/token                  -> 400
{"error":"expired_token","interval":5}
```

`error` is a **string** here (RFC 8628 style) and an **object** everywhere else. This is the one place
a client must branch on the status code before parsing `error`. The generated types get this right —
`ExchangeDeviceTokenErrors[400]` is `DeviceTokenPendingError` while every other code is
`ErrorResponse`.

## The exec WebSocket is a second spec

`runta exec` does **not** go through the REST API. It is a WebSocket at

```
wss://api.runta.com/v2/runtimes/{runtime_id}/exec/stream
```

which appears in none of the 85 documented REST operations. It has its own AsyncAPI 3.1
description, committed here as `asyncapi.yaml`.

Nothing generates code from it — `@hey-api/openapi-ts` reads OpenAPI only — so the exec client will
be hand-written against this file. Treat `asyncapi.yaml` the same way as `openapi.json`: the
source of truth, updated by hand, verified against the live service.

The protocol in one paragraph: HTTP GET upgrade carrying `Authorization: Bearer <token>`, one
command per connection. The client sends `start` first and exactly once, then any of `stdin`,
`resize`, `signal` (INT/TERM only), `close_stdin`, `heartbeat`. The server sends `stdout`,
`stderr`, `heartbeat`, and exactly one terminal frame: `exit` (with a code — nonzero is a *command*
failure, not a protocol failure) or `error`. Payload bytes are standard Base64. With `tty: true`,
stderr is folded into `stdout`. The server may hold the connection for up to 300 seconds or 16
access attempts while the runtime becomes ready, which is why `exec` can appear to hang on a
cold runtime.

Two lines from the spec deserve to survive into our implementation:

> An `error` frame or a connection closed before `exit` leaves the command's result **unknown**;
> do not automatically retry a command with side effects.

That is the correct framing of `CLI_ISSUES.md` C-01. The production CLI reports this case as exit
`1`, i.e. as a failure, when the truthful answer is that it does not know. Our `exec` must surface
"unknown" distinctly and must not auto-retry.

> Runtime UUID or display name. The Runta CLI resolves names to IDs first.

So name→id resolution is a client responsibility for this endpoint, even though the REST endpoints
accept either. One shared resolver, used by every command.

## Coverage

Done: **auth** (3) + **identity** (1) + **runtimes** (4 of 21) + **images** (1 of 5) +
**checkpoints** (1 of 4) + **model providers** (1 of 2).

| Group | Operations | Status |
|---|---|---|
| Auth | 3 | done |
| Identity | 1 | done |
| Health | 2 | todo |
| Events / token analysis | 5 | todo |
| GitHub | 9 | todo |
| Runtimes | 21 | 8 of 21 (create, list, get, delete, start, stop, pause, resume) |
| Images | 5 | 1 of 5 (`listRuntimeImages`, for name resolution) |
| Files | 2 | todo |
| SSH keys | 7 | todo |
| Secrets | 5 | todo |
| Checkpoints | 4 | 1 of 4 (`listCheckpoints`, for name resolution) |
| Cloud Agents | 22 | todo |
| Managed model providers | 2 | 1 of 2 (`listManagedModelProviders`, for its `organization_id`) |

85 documented operations total; 11 described here. Operation detail pages follow
`https://runta.com/docs/reference/api/operations/<slug>/`.

Note for later: the docs list a **Cloud Agents** group (22 operations under `/v2/agents`) that the
CLI exposes no commands for at all — and the official agent skill documents a `runta agents ls`
command that doesn't exist (`CLI_ISSUES.md` C-30). The API surface is ahead of the CLI here.

## Verification

The spec generates cleanly with the repo's pinned generator and typechecks under `--strict`:

```console
$ openapi-ts -i ./openapi.json -o ./out -c @hey-api/client-fetch
✓ out · 4 files · 48ms
$ grep 'export const' out/sdk.gen.ts
export const beginDeviceAuthorization
export const exchangeDeviceToken
export const revokeCurrentToken
export const getMe
$ tsc --noEmit --strict out/types.gen.ts     # clean
```

Only `revokeCurrentToken` and `getMe` carry `security` in the generated SDK; the two device endpoints
are correctly unauthenticated.

In this repo, after `pnpm api:generate`: `pnpm typecheck`, `pnpm test` (15 tests in `@runta/api`) and
`pnpm lint` all pass, and `runta whoami` was exercised against the live API with three credential
states:

```console
$ runta whoami                        # organization API key
error principal's role does not allow this organization action
This looks like an organization API key. `whoami` needs a user credential — sign in with the device flow instead.
exit 2

$ RUNTA_TOKEN=nonsense runta whoami
error invalid bearer credential
The token was rejected. Set a valid RUNTA_TOKEN.
exit 2

$ RUNTA_TOKEN= runta whoami
error 403 Forbidden
No credential was sent. Set RUNTA_TOKEN.
exit 2
```

Before the `errorFromResponse` fix, all three printed `http_403`/`http_401` with a generic status
message, because the normaliser read `code`/`message` from the top level of the body.

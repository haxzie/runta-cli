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
Note the CLI hard-codes `limit=100` and never follows `next_cursor` (see `CLI_ISSUES.md` C-15).

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

### 6. Envelope is inconsistent across auth endpoints

- `POST /v2/auth/device/authorization` → `{ "data": { … } }`
- `POST /v2/auth/device/token` → **not** enveloped, fields at the top level
- `GET /v2/me` → `{ "data": { … } }`

Confirmed live. The spec models each one as it actually is, which is why `DeviceToken` has no wrapper
type while `DeviceAuthorization` and `User` do.

### 7. `POST /v2/auth/device/token` 400 has a different body shape from every other error

```console
$ curl -X POST -H 'content-type: application/json' -d '{"device_code":"deadbeef"}' \
    https://api.runta.com/v2/auth/device/token                  -> 400
{"error":"expired_token","interval":5}
```

`error` is a **string** here (RFC 8628 style) and an **object** everywhere else. This is the one place
a client must branch on the status code before parsing `error`. The generated types get this right —
`ExchangeDeviceTokenErrors[400]` is `DeviceTokenPendingError` while every other code is
`ErrorResponse`.

## Coverage

Done: **auth** (3) + **identity** (1).

| Group | Operations | Status |
|---|---|---|
| Auth | 3 | done |
| Identity | 1 | done |
| Health | 2 | todo |
| Events / token analysis | 5 | todo |
| GitHub | 9 | todo |
| Runtimes | 21 | todo |
| Files | 2 | todo |
| SSH keys | 7 | todo |
| Secrets | 5 | todo |
| Checkpoints | 4 | todo |
| Cloud Agents | 22 | todo |
| Managed model providers | 2 | todo |

85 documented operations total; 4 described here. Operation detail pages follow
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

# Backend requirements for the public CLI

The CLI ships today against the existing API, but a *public, open-source* CLI
changes the auth economics: no credential may be embedded in a distributed
client, and plan limits must be enforced server-side. This doc specs the (small)
backend work in `launchy-agents` that the CLI is already built to consume.
Nothing here blocks releasing the CLI; each section lights up automatically when
the server ships it.

## 0. The auth model — two credentials, one identity

Public reads require **no credential at all**: `/api/launches`, `/api/providers`,
`/api/sites`, `/api/rockets`, `/api/boosters`, `/api/visibility/*`, timeline,
weather and schedule-changes are all anonymous. Only account routes
(`/api/me`, subscribe, corrections, `/api/keys`) need identity, and there are
exactly two ways to establish it — both resolving to the same user:

- **Clerk session JWT** (`Authorization: Bearer …`) — a human in the app.
- **Personal API key** (`X-API-Key: lk_live_…`) — a program acting for them.

The shared first-party `APP_API_KEY` / `INTERNAL_API_KEY` are **gone**. They
shipped inside a public iOS binary, carried no identity, and gated only public
data. The CLI therefore knows of no "application key": an `X-API-Key` that is
not `lk_live_…` is simply not a credential, and `launchy whoami` says so.

## 1. Per-user API keys — ✅ IMPLEMENTED

Shipped in `launchy-agents` (migration `0012_user_api_keys.sql`, PR #116). The
CLI consumes it with no further changes:

- `user_api_keys` stores a SHA-256 hash, never plaintext; the secret is
  returned once from `POST /api/keys` and is unrecoverable after.
- Keys are `lk_live_…`; the auth middleware resolves one to the same request
  identity a Clerk JWT establishes, so `/api/me`, subscribe and corrections
  work from a key alone.
- `GET /api/keys` lists, `DELETE /api/keys/:id` soft-revokes. Management
  requires a Clerk session — a key may not manage keys, so a leaked key
  cannot make itself permanent.

Remaining work is **client-side only**: the mobile/web account screen needs a
"Create CLI key" surface calling `POST /api/keys` and showing the plaintext
once. Until that ships there is no user-facing way to obtain a key — which is
fine, because nothing except account commands needs one.

## 2. Plan-tiered rate limiting (required to make free/pro mean something)

No route is rate-limited today; `is_pro` (Clerk `publicMetadata`) gates nothing
server-side. An open-source client cannot enforce limits — a fork deletes the
check. Enforce at the Worker:

- **Suggested tiers** (tune freely):
  | Tier | Sustained | Burst |
  |---|---|---|
  | Anonymous (public reads, keyed by IP) | 30 req/min | 60 |
  | Free user | 60 req/min, 5,000/day | 120 |
  | Pro user | 600 req/min, 100,000/day | 1,200 |
- **Mechanism**: Cloudflare [rate limiting bindings] keyed on the key hash /
  user id, falling back to client IP for anonymous reads, or a small Durable
  Object counter per key. D1 is the wrong place for this.
- **Headers on every response**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset` (epoch seconds), and `Retry-After` on 429 with body
  `{ "error": "Too Many Requests", "message": …, "code": "RATE_LIMITED" }`.

The CLI already parses all of these: it honors `Retry-After` (auto-retry ≤10s),
maps 429 → exit code 5 with `retry_after_seconds`, and `launchy limits`
displays whatever the server advertises.

## 3. Identity for keys — ✅ IMPLEMENTED

`GET /api/me` accepts a personal key exactly as it accepts a Clerk JWT, and
returns `is_pro`/`pro_expires_at`, so `launchy whoami` and `launchy limits`
show the plan badge without a JWT. Nothing further is needed here.

## 4. Nice-to-haves (not blocking)

- **`/v1` path prefix or honored `X-API-Version`**: the API is currently
  unversioned; public clients make breaking changes expensive. CORS already
  allows the header — start honoring it before the surface ossifies.
- **OpenAPI spec** served at `/api/openapi.json`: `launchy api` + agents could
  self-discover new endpoints.
- **Follows listing** (`GET /api/me/follows`): the CLI can subscribe per
  launch but cannot list subscriptions.
- **Device-code OAuth flow** via Clerk for `launchy auth login` without
  copy-pasting JWTs (JWTs expire quickly; per-user keys mostly obviate this).

## What the CLI deliberately does NOT do

- Ship any embedded key (open-source repo; `AGENTS.md` invariant).
- Gate features client-side by plan — trivially bypassed in a public codebase,
  and it would make the CLI lie about what the server allows.

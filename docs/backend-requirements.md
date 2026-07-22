# Backend requirements for the public CLI

The CLI ships today against the existing API, but a *public, open-source* CLI
changes the auth economics: the shared `APP_API_KEY` baked into the first-party
apps must never be distributed, and plan limits must be enforced server-side.
This doc specs the (small) backend work in `launchy-agents` that the CLI is
already built to consume. Nothing here blocks releasing the CLI; each section
lights up automatically when the server ships it.

## 1. Per-user API keys — ✅ IMPLEMENTED

Shipped in `launchy-agents` (migration `0012_user_api_keys.sql`, PR #116). The
CLI consumes it with no further changes:

- `user_api_keys` stores a SHA-256 hash, never plaintext; the secret is
  returned once from `POST /api/keys` and is unrecoverable after.
- Keys are `lk_live_…`; `requireApiAccess` resolves one to the same request
  identity a Clerk JWT establishes, so `/api/me`, subscribe and corrections
  work from a key alone.
- `GET /api/keys` lists, `DELETE /api/keys/:id` soft-revokes. Management
  requires a Clerk session — a key may not manage keys, so a leaked key
  cannot make itself permanent.
- `APP_API_KEY` keeps working unchanged for the first-party apps, and still
  carries no user identity.

Remaining work is **client-side only**: the mobile/web account screen needs a
"Create CLI key" surface calling `POST /api/keys` and showing the plaintext
once. Until that ships there is no user-facing way to obtain a key.

## 2. Plan-tiered rate limiting (required to make free/pro mean something)

No route is rate-limited today; `is_pro` (Clerk `publicMetadata`) gates nothing
server-side. An open-source client cannot enforce limits — a fork deletes the
check. Enforce at the Worker:

- **Suggested tiers** (tune freely):
  | Tier | Sustained | Burst |
  |---|---|---|
  | Anonymous / shared app key | n/a (first-party only) | n/a |
  | Free key | 60 req/min, 5,000/day | 120 |
  | Pro key | 600 req/min, 100,000/day | 1,200 |
- **Mechanism**: Cloudflare [rate limiting bindings] keyed on the key hash, or
  a small Durable Object counter per key. D1 is the wrong place for this.
- **Headers on every response**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset` (epoch seconds), and `Retry-After` on 429 with body
  `{ "error": "Too Many Requests", "message": …, "code": "RATE_LIMITED" }`.

The CLI already parses all of these: it honors `Retry-After` (auto-retry ≤10s),
maps 429 → exit code 5 with `retry_after_seconds`, and `launchy limits`
displays whatever the server advertises.

## 3. Identity for keys (small, high value)

`launchy whoami` currently explains that a key carries no identity. Once §1
lands, either let `GET /api/me` accept per-user keys (it will, if the
middleware sets user context) or add `GET /api/keys/self`. Response should
include `is_pro`/`pro_expires_at` so the CLI can show the plan badge without a
Clerk JWT.

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

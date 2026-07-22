# Backend requirements for the public CLI

The CLI ships today against the existing API, but a *public, open-source* CLI
changes the auth economics: the shared `APP_API_KEY` baked into the first-party
apps must never be distributed, and plan limits must be enforced server-side.
This doc specs the (small) backend work in `launchy-agents` that the CLI is
already built to consume. Nothing here blocks releasing the CLI; each section
lights up automatically when the server ships it.

## 1. Per-user API keys (required for public launch)

Today `X-API-Key` only matches the shared `APP_API_KEY`/`INTERNAL_API_KEY`
(`src/middleware/auth.ts`), which cannot be handed to the public. Add:

- **Table** `user_api_keys`: `id`, `user_id` (FK → users), `name`,
  `key_hash` (SHA-256 of the secret; never store plaintext), `prefix`
  (first 8 chars for display), `created_at`, `last_used_at`, `revoked_at`.
- **Key format**: `lk_live_<32 random base62 chars>`. The prefix makes leaked
  keys grep-able and lets support identify a key without seeing it.
- **Middleware**: in `requireApiAccess`, when `X-API-Key` is not the app key,
  hash it and look up `user_api_keys`. On match, set the same user context a
  Clerk JWT would (including pro status), so per-user routes (`/api/me`,
  subscribe, corrections) work with a key — the CLI then needs no Clerk JWT.
- **Issuance**: `POST /api/keys` (Clerk Bearer, from the apps' account screen)
  returning the plaintext secret exactly once; `GET /api/keys`;
  `DELETE /api/keys/:id`. The mobile/web account settings page is the natural
  home for "Create CLI key".
- Keep `APP_API_KEY` working unchanged for the first-party apps.

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

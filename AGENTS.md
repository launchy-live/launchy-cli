# launchy-cli — Repo Guidance

Open-source TypeScript CLI for the Launchy public API (`https://api.launchy.live`).
Zero runtime dependencies — keep it that way; every dependency is supply-chain
surface for an installable binary. Node 18.17+, ESM, compiled with plain `tsc`.

## Commands

```bash
npm install
npm test          # builds then runs node:test against a mock API — no network needed
npm run typecheck
```

## Architecture

- `src/main.ts` — entry: dispatch, help routing, error rendering, exit codes.
- `src/registry.ts` — `Command` interface, global flags, aliases, command lookup.
- `src/cmd/*.ts` — command definitions grouped by domain (launches, reference, user, auth, meta).
- `src/http.ts` — the one HTTP path: auth headers, retries, 429/Retry-After handling, rate-limit capture.
- `src/output.ts` — emit (JSON vs human), tables, colors; `src/args.ts` — flag parser; `src/config.ts` — credential storage.
- `test/cli.test.mjs` — e2e: spawns the built CLI against an in-process mock API.

## Invariants (do not break)

- **Output contract**: success → stdout `{ data, pagination? }`; errors → stderr
  `{ error: { code, message, ... } }`; exit codes 0-6 as documented in README.
  Agents script against this — changes are breaking API changes.
- **Auto-JSON**: non-TTY stdout emits JSON. Never print human decoration to stdout
  in JSON mode; informational notes go to stderr via `note()`.
- **Never embed credentials**: no API keys in source, ever. This repo is public.
  Keys come from flags/env/config only, and `auth login` verifies before saving.
- **No client-side plan gating**: free/pro limits are the server's job
  (see `docs/backend-requirements.md`). The CLI reports limits; it does not fake them.
- **No interactive prompts off-TTY**: fail fast with a structured error instead.
- New endpoints should get first-class commands, but `launchy api` must keep
  working as the raw escape hatch.

## Backend counterpart

The server (`launchy-agents` repo) issues per-user API keys (`lk_live_…`) but
does not yet send rate-limit headers. Public reads need no credential at all;
only account routes need identity, and the old shared app key no longer exists.
`docs/backend-requirements.md` specs what the CLI already supports the moment
the server ships it. Don't work around the gap client-side.

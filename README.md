# launchy

Rocket launches from your terminal — the official CLI for the [Launchy](https://launchy.live) API. Built for humans *and* AI agents.

```
$ launchy next
Starlink Group 12-31  T-2d 4h
go · 2026-07-24 18:05Z (T-2d 4h) · SpaceX
detail: launchy launches get lch_…
```

## Install

```bash
npm install -g launchy-cli
# or run without installing:
npx launchy-cli next
```

Requires Node 18.17+.

## Quickstart

```bash
launchy auth login          # store your API key (verified before saving)
launchy next                # the next launch, with countdown
launchy ls --provider SpaceX
launchy launches get <id>   # full detail: timeline, weather, narrative, slip history
launchy visibility nearby --lat 28.4 --lng -80.6   # what can I see from here?
```

Every command has `--help` with examples. `launchy docs` prints the complete reference.

## Authentication

Two credentials, two capabilities:

| Credential | Header | Unlocks |
|---|---|---|
| **API key** | `X-API-Key` | All launch, provider, site, rocket, booster, and visibility reads |
| **User token** | `Authorization: Bearer <jwt>` | Account commands: `me`, `whoami`, subscribe, corrections |

```bash
# keep secrets out of shell history — "-" reads from stdin
printf %s "$KEY" | launchy auth login --key -

# or use environment variables (great for CI and agents)
export LAUNCHY_API_KEY=…
export LAUNCHY_TOKEN=…
```

Credentials are stored in `~/.config/launchy/config.json` (chmod 600) and are **verified against the API before being saved**. Precedence: flags → environment → config file. `launchy auth status` shows exactly what's active and where it came from, including token expiry.

## Free vs Pro

Your plan lives on your Launchy account. `launchy whoami` and `launchy limits` show it:

```bash
$ launchy whoami
scott@example.com  [PRO]
```

- **Free** and **Pro** share the same command surface; plans differ in rate limits and (in the apps) expert-mode features.
- Rate limits are enforced and communicated **by the server** via standard `X-RateLimit-*` and `Retry-After` headers — `launchy limits` shows yours live. This CLI does not gate features client-side; an open-source client that pretends to enforce limits isn't enforcing anything.
- On `429` the CLI automatically honors `Retry-After` (waits up to 10s, then surfaces the error with `retry_after_seconds`).

## For AI agents 🤖

This CLI is designed to be driven by agents:

- **Auto-JSON**: when stdout is not a TTY (i.e., whenever you're piping or spawning it), output is pretty-printed JSON. Force with `--json`; force human output with `--plain`.
- **Stable envelope**: success → stdout `{ "data": …, "pagination"? }`. Errors → stderr `{ "error": { "code", "message", "status"?, "retry_after_seconds"? } }`.
- **Stable exit codes**:

  | Code | Meaning |
  |---|---|
  | 0 | success |
  | 1 | generic error |
  | 2 | usage error (bad flags/arguments) |
  | 3 | authentication required or rejected |
  | 4 | not found |
  | 5 | rate limited |
  | 6 | network failure (after retries) |

- **One-shot self-description**: `launchy docs --json` returns every command, flag, exit code, and env var as JSON. Feed it to your agent once and it knows the whole tool.
- **Escape hatch**: `launchy api GET '/api/launches?limit=5'` sends an authenticated raw request to any endpoint — including ones newer than this CLI — and prints the response verbatim.
- **No prompts in pipelines**: interactive prompts only ever occur on a TTY; non-interactive invocations fail fast with a structured error instead of hanging.
- **Quiet data channel**: informational notes go to stderr, never mixed into stdout data. `--quiet` silences them.
- **Auto-pagination**: `--all` on list commands walks pages for you (bounded at 5,000 rows, with a note when truncated).

## Commands

```
launches   list · get · next · timeline · weather · slips · visibility ·
           subscribe · unsubscribe · subscribed
visibility nearby
providers  list          sites list
rockets    list · get · variant
boosters   list · get
corrections submit
me         get · set
auth       login · status · logout
whoami · limits · api · docs
```

Shortcuts: `launchy next`, `launchy ls`.

## Configuration

| Environment variable | Purpose |
|---|---|
| `LAUNCHY_API_KEY` | API key |
| `LAUNCHY_TOKEN` | User bearer token |
| `LAUNCHY_BASE_URL` | Override API origin (default `https://api.launchy.live`) |
| `LAUNCHY_CONFIG_DIR` | Override config directory (default `~/.config/launchy`) |
| `NO_COLOR` | Disable colors |

## Development

```bash
npm install
npm test        # builds and runs the full suite (no network needed — tests run a mock API)
```

Zero runtime dependencies; TypeScript, compiled with `tsc`.

## License

MIT — see [LICENSE](LICENSE).

import { identifiesUser, type Ctx } from "./context.js";
import { ApiError, CliError, EXIT, codeForStatus, exitCodeForStatus } from "./errors.js";

export interface RequestOpts {
  query?: Record<string, unknown>;
  body?: unknown;
  /**
   * "any"  — public data. No credential is required; whatever is configured is
   *          still sent, so an authenticated caller gets per-user rate limits
   *          instead of per-IP ones.
   * "user" — account routes (/api/me, subscribe, corrections, /api/keys). Needs
   *          an identity: a personal API key (lk_live_…) or a session token.
   * "none" — same as "any"; kept for call sites that mean "don't reason about
   *          auth at all" (the raw `launchy api` escape hatch).
   */
  auth?: "any" | "user" | "none";
}

const MAX_ATTEMPTS = 3;
const RETRYABLE_429_MAX_WAIT_S = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function captureRateLimit(ctx: Ctx, res: Response): void {
  const num = (name: string): number | undefined => {
    const v = res.headers.get(name);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const limit = num("x-ratelimit-limit");
  const remaining = num("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset") ?? undefined;
  const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
  if (limit === undefined && remaining === undefined && reset === undefined && retryAfter === undefined) {
    return;
  }
  ctx.rateLimit = {
    ...(limit !== undefined && { limit }),
    ...(remaining !== undefined && { remaining }),
    ...(reset !== undefined && { reset }),
    ...(retryAfter !== undefined && { retry_after_seconds: retryAfter }),
  };
}

export async function api<T = any>(
  ctx: Ctx,
  method: string,
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const auth = opts.auth ?? "any";
  if (auth === "user" && !identifiesUser(ctx)) {
    throw new CliError(
      "AUTH_REQUIRED",
      ctx.apiKey
        ? "this command acts on your account, but the configured API key is not a personal key. Create one in the Launchy app (it starts with `lk_live_`), then run `launchy auth login --key <key>`."
        : "this command acts on your account and needs a personal API key or user token. Run `launchy auth login`.",
      EXIT.AUTH,
    );
  }

  const url = new URL(ctx.baseUrl + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  // Public reads work with no credentials at all — they are then rate limited
  // by IP. Both credentials are sent when both are configured; the server
  // resolves the request against the Bearer token when it is present (strongest
  // identity wins), which is why `whoami` names the token in that case.
  const headers: Record<string, string> = { accept: "application/json" };
  if (ctx.token) headers.authorization = `Bearer ${ctx.token}`;
  if (ctx.apiKey) headers["x-api-key"] = ctx.apiKey;
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new CliError("NETWORK", `could not reach ${url.host}: ${reason}`, EXIT.NETWORK);
    }

    captureRateLimit(ctx, res);

    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const bodyText = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = undefined;
    }
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));

    if (
      res.status === 429 &&
      retryAfter !== undefined &&
      retryAfter <= RETRYABLE_429_MAX_WAIT_S &&
      attempt < MAX_ATTEMPTS
    ) {
      await sleep(retryAfter * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
      await sleep(250 * 2 ** (attempt - 1));
      continue;
    }

    const code: string = parsed?.code ?? codeForStatus(res.status);
    const message: string =
      parsed?.message ?? parsed?.error ?? `${res.status} ${res.statusText}`.trim();
    throw new ApiError(
      res.status,
      code,
      message,
      exitCodeForStatus(res.status),
      parsed ?? (bodyText || undefined),
      retryAfter,
    );
  }
  throw new CliError("NETWORK", "request failed after retries", EXIT.NETWORK);
}

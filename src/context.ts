import type { FlagValue } from "./args.js";
import { loadConfig } from "./config.js";

export const DEFAULT_BASE_URL = "https://api.launchy.live";

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: string;
  retry_after_seconds?: number;
}

export interface Ctx {
  baseUrl: string;
  apiKey?: string;
  token?: string;
  json: boolean;
  color: boolean;
  quiet: boolean;
  timeoutMs: number;
  /** Populated from X-RateLimit-* / Retry-After headers of the most recent response. */
  rateLimit?: RateLimitInfo;
}

export function buildCtx(
  flags: Record<string, FlagValue>,
  env: NodeJS.ProcessEnv = process.env,
): Ctx {
  const cfg = loadConfig(env);
  const json = flags.json === true ? true : flags.plain === true ? false : !process.stdout.isTTY;
  const color =
    flags.color !== false && !env.NO_COLOR && Boolean(process.stdout.isTTY) && flags.json !== true;
  const baseUrl = (
    (flags["base-url"] as string | undefined) ||
    env.LAUNCHY_BASE_URL ||
    cfg.base_url ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  return {
    baseUrl,
    apiKey: (flags["api-key"] as string | undefined) || env.LAUNCHY_API_KEY || cfg.api_key,
    token: (flags.token as string | undefined) || env.LAUNCHY_TOKEN || cfg.token,
    json,
    color,
    quiet: flags.quiet === true,
    timeoutMs: typeof flags.timeout === "number" ? flags.timeout * 1000 : 30_000,
  };
}

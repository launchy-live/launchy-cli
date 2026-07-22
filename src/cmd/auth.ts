import { createInterface } from "node:readline/promises";
import { configPath, loadConfig, saveConfig } from "../config.js";
import type { Ctx } from "../context.js";
import { UsageError } from "../errors.js";
import { api } from "../http.js";
import { colors, emit, readStdin } from "../output.js";
import type { Command } from "../registry.js";

function mask(secret: string | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 14) return "•••";
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

interface JwtInfo {
  expires_at?: string;
  expired?: boolean;
}

function jwtInfo(token: string): JwtInfo | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number") return {};
    const expiresAt = new Date(payload.exp * 1000);
    return { expires_at: expiresAt.toISOString(), expired: expiresAt.getTime() < Date.now() };
  } catch {
    return undefined;
  }
}

async function resolveSecret(value: string): Promise<string> {
  if (value === "-") {
    const text = (await readStdin()).trim();
    if (!text) throw new UsageError("expected the secret on stdin (got empty input)");
    return text;
  }
  return value;
}

export const authCommands: Command[] = [
  {
    path: ["auth", "login"],
    summary: "Store credentials (~/.config/launchy/config.json, chmod 600) after verifying them",
    description:
      "Reads need no credentials at all — sign in only for account commands (me, subscribe, corrections). " +
      "Provide a personal API key (--key, lk_live_…) or a user token (--login-token), or both. " +
      'Pass "-" as the value to read the secret from stdin so it never lands in shell history.',
    flags: {
      key: { type: "string", valueName: "key", description: 'Personal API key, lk_live_… ("-" reads stdin)' },
      "login-token": { type: "string", valueName: "jwt", description: 'User bearer token ("-" reads stdin)' },
    },
    examples: [
      "printf %s \"$LAUNCHY_KEY\" | launchy auth login --key -",
      "launchy auth login --login-token \"$(my-clerk-jwt)\"",
      "launchy auth login   # interactive prompt",
    ],
    run: async (ctx, args) => {
      let key = args.flags.key !== undefined ? await resolveSecret(String(args.flags.key)) : undefined;
      const tokenFlag = args.flags["login-token"] ?? args.flags.token; // --token also accepted here
      let token = tokenFlag !== undefined ? await resolveSecret(String(tokenFlag)) : undefined;

      if (!key && !token) {
        if (!process.stdin.isTTY) {
          throw new UsageError(
            "non-interactive login needs --key or --login-token (use \"-\" to read the value from stdin)",
          );
        }
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        try {
          key = (await rl.question("Launchy personal API key, lk_live_… (leave empty to skip): ")).trim() || undefined;
          token = (await rl.question("User bearer token (leave empty to skip): ")).trim() || undefined;
        } finally {
          rl.close();
        }
        if (!key && !token) throw new UsageError("nothing to save — provide a key or a token");
      }

      // Verify before persisting, using only the credential being saved.
      // Reads are public now, so a read proves nothing about a credential —
      // both a key and a token are only meaningful as an identity, so both are
      // verified against the identity route.
      if (key) {
        const verifyCtx: Ctx = { ...ctx, apiKey: key, token: undefined };
        await api(verifyCtx, "GET", "/api/me", { auth: "user" });
      }
      if (token) {
        const verifyCtx: Ctx = { ...ctx, token, apiKey: undefined };
        await api(verifyCtx, "GET", "/api/me", { auth: "user" });
      }

      const cfg = loadConfig();
      if (key) cfg.api_key = key;
      if (token) cfg.token = token;
      if (typeof args.flags["base-url"] === "string") cfg.base_url = args.flags["base-url"];
      const path = saveConfig(cfg);

      emit(
        ctx,
        {
          data: {
            saved: path,
            api_key: mask(cfg.api_key),
            token: mask(cfg.token),
            base_url: cfg.base_url ?? null,
          },
        },
        (w) => {
          const c = colors(ctx);
          w(`Verified and saved to ${path}`);
          if (key) w(`  api key: ${mask(key)}`);
          if (token) w(`  token:   ${mask(token)}`);
          w(c.dim("check anytime with `launchy auth status`"));
        },
      );
    },
  },
  {
    path: ["auth", "status"],
    summary: "Show which credentials are active and where they come from",
    run: async (ctx, args) => {
      const cfg = loadConfig();
      const source = (
        flagName: string,
        envName: string,
        cfgValue: string | undefined,
      ): string | null => {
        if (args.flags[flagName] !== undefined) return "flag";
        if (process.env[envName]) return "env";
        if (cfgValue) return "config";
        return null;
      };
      const tokenMeta = ctx.token ? jwtInfo(ctx.token) : undefined;
      const payload = {
        config_path: configPath(),
        base_url: ctx.baseUrl,
        api_key: ctx.apiKey
          ? { masked: mask(ctx.apiKey), source: source("api-key", "LAUNCHY_API_KEY", cfg.api_key) }
          : null,
        token: ctx.token
          ? {
              masked: mask(ctx.token),
              source: source("token", "LAUNCHY_TOKEN", cfg.token),
              ...(tokenMeta ?? {}),
            }
          : null,
      };
      emit(ctx, { data: payload }, (w) => {
        const c = colors(ctx);
        w(`config:   ${payload.config_path}`);
        w(`base url: ${payload.base_url}`);
        w(
          `api key:  ${payload.api_key ? `${payload.api_key.masked} (${payload.api_key.source})` : c.dim("none")}`,
        );
        if (payload.token) {
          const expiry =
            payload.token.expired === true
              ? c.red("EXPIRED")
              : payload.token.expires_at
                ? c.dim(`expires ${payload.token.expires_at}`)
                : "";
          w(`token:    ${payload.token.masked} (${payload.token.source}) ${expiry}`.trimEnd());
        } else {
          w(`token:    ${c.dim("none")}`);
        }
      });
    },
  },
  {
    path: ["auth", "logout"],
    summary: "Remove stored credentials (keeps any saved base URL)",
    run: async (ctx) => {
      const cfg = loadConfig();
      const hadAny = Boolean(cfg.api_key || cfg.token);
      delete cfg.api_key;
      delete cfg.token;
      const path = saveConfig(cfg);
      emit(ctx, { data: { cleared: hadAny, config_path: path } }, (w) => {
        w(hadAny ? "Stored credentials removed." : "No stored credentials to remove.");
        const c = colors(ctx);
        if (process.env.LAUNCHY_API_KEY || process.env.LAUNCHY_TOKEN) {
          w(c.yellow("LAUNCHY_API_KEY / LAUNCHY_TOKEN are still set in your environment."));
        }
      });
    },
  },
];

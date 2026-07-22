import { createRequire } from "node:module";
import type { Ctx } from "../context.js";
import { DEFAULT_BASE_URL } from "../context.js";
import { UsageError } from "../errors.js";
import { api } from "../http.js";
import { colors, emit, printJson, readStdin } from "../output.js";
import { GLOBAL_FLAGS, type Command } from "../registry.js";

const require = createRequire(import.meta.url);

export function cliVersion(): string {
  return (require("../../package.json") as { version: string }).version;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const EXIT_CODE_DOCS: Record<string, string> = {
  "0": "success",
  "1": "generic error",
  "2": "usage error (bad flags/arguments)",
  "3": "authentication required or rejected",
  "4": "not found",
  "5": "rate limited (stderr JSON includes retry_after_seconds when the server sent Retry-After)",
  "6": "network failure (after retries)",
};

const ENV_DOCS: Record<string, string> = {
  LAUNCHY_API_KEY: "API key for read access (same as `launchy auth login --key`)",
  LAUNCHY_TOKEN: "User bearer token for account commands",
  LAUNCHY_BASE_URL: "Override the API origin (default " + DEFAULT_BASE_URL + ")",
  LAUNCHY_CONFIG_DIR: "Override the config directory (default ~/.config/launchy)",
  NO_COLOR: "Disable colorized output",
};

function usageOf(cmd: Command): string {
  const positionals = (cmd.positionals ?? [])
    .map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))
    .join(" ");
  return ["launchy", ...cmd.path, positionals, "[flags]"].filter(Boolean).join(" ");
}

function structuredDocs(commands: Command[]): unknown {
  return {
    name: "launchy",
    version: cliVersion(),
    base_url: DEFAULT_BASE_URL,
    output_contract: {
      success: "stdout: `{ data, pagination? }` as pretty JSON when --json or stdout is piped",
      error: "stderr: `{ error: { code, message, status?, retry_after_seconds? } }`, non-zero exit code",
      raw: "`launchy api` prints the server response verbatim (no envelope normalization)",
    },
    auth: {
      api_key: "header X-API-Key — read access to all launch/reference data; carries no user identity",
      user_token: "header Authorization: Bearer <jwt> — required for me/subscribe/corrections",
      plans: "GET /api/me reports is_pro; `launchy whoami` surfaces it as plan: free|pro",
      rate_limits:
        "the CLI honors Retry-After on 429 (auto-retries waits <=10s) and reports X-RateLimit-* via `launchy limits`",
    },
    exit_codes: EXIT_CODE_DOCS,
    env: ENV_DOCS,
    global_flags: Object.entries(GLOBAL_FLAGS).map(([name, spec]) => ({
      name: `--${name}`,
      type: spec.type,
      description: spec.description,
    })),
    commands: commands.map((cmd) => ({
      name: cmd.path.join(" "),
      usage: usageOf(cmd),
      summary: cmd.summary,
      ...(cmd.description ? { description: cmd.description } : {}),
      positionals: (cmd.positionals ?? []).map((p) => ({
        name: p.name,
        required: Boolean(p.required),
        description: p.description,
      })),
      flags: Object.entries(cmd.flags ?? {}).map(([name, spec]) => ({
        name: `--${name}`,
        type: spec.type,
        required: Boolean(spec.required),
        description: spec.description,
      })),
      ...(cmd.examples ? { examples: cmd.examples } : {}),
    })),
  };
}

function markdownDocs(commands: Command[]): string {
  const lines: string[] = [
    `# launchy ${cliVersion()} — command reference`,
    "",
    `Base URL: ${DEFAULT_BASE_URL} (override: --base-url / LAUNCHY_BASE_URL)`,
    "",
    "Output contract: success → stdout `{ data, pagination? }` (JSON when piped or --json);",
    "errors → stderr `{ error: { code, message, ... } }` with a non-zero exit code.",
    "",
    "## Exit codes",
    "",
    ...Object.entries(EXIT_CODE_DOCS).map(([code, doc]) => `- \`${code}\` — ${doc}`),
    "",
    "## Environment",
    "",
    ...Object.entries(ENV_DOCS).map(([name, doc]) => `- \`${name}\` — ${doc}`),
    "",
    "## Commands",
    "",
  ];
  for (const cmd of commands) {
    lines.push(`### ${cmd.path.join(" ")}`, "", cmd.summary, "", "```", usageOf(cmd), "```", "");
    if (cmd.description) lines.push(cmd.description, "");
    const flags = Object.entries(cmd.flags ?? {});
    if (flags.length > 0) {
      for (const [name, spec] of flags) {
        lines.push(
          `- \`--${name}${spec.valueName ? ` <${spec.valueName}>` : ""}\`${spec.required ? " (required)" : ""} — ${spec.description}`,
        );
      }
      lines.push("");
    }
    if (cmd.examples && cmd.examples.length > 0) {
      lines.push("```", ...cmd.examples, "```", "");
    }
  }
  lines.push("Global flags apply to every command; see `launchy --help`.", "");
  return lines.join("\n");
}

export function makeMetaCommands(getAll: () => Command[]): Command[] {
  return [
    {
      path: ["limits"],
      summary: "Your plan (free/pro) and any server-advertised rate limits",
      run: async (ctx: Ctx) => {
        let plan: string | null = null;
        if (ctx.token) {
          try {
            const me = await api(ctx, "GET", "/api/me", { auth: "user" });
            const profile = me.data ?? me;
            plan = profile.is_pro ? "pro" : "free";
          } catch {
            plan = null;
          }
        }
        // Cheap request purely to capture X-RateLimit-* headers.
        await api(ctx, "GET", "/api/launches", { query: { limit: 1 } });
        const rateLimit = ctx.rateLimit ?? null;
        emit(ctx, { data: { plan, rate_limit: rateLimit } }, (w) => {
          const c = colors(ctx);
          w(`plan: ${plan ?? c.dim("unknown — no user token (see launchy auth login)")}`);
          if (rateLimit) {
            if (rateLimit.limit !== undefined) w(`rate limit: ${rateLimit.limit} requests/window`);
            if (rateLimit.remaining !== undefined) w(`remaining:  ${rateLimit.remaining}`);
            if (rateLimit.reset !== undefined) w(`resets:     ${rateLimit.reset}`);
          } else {
            w(c.dim("The server is not advertising rate limits for these credentials."));
          }
          w(c.dim("On 429 the CLI honors Retry-After automatically (waits up to 10s)."));
        });
      },
    },
    {
      path: ["api"],
      summary: "Raw authenticated request to any endpoint (escape hatch)",
      description:
        "Sends your configured credentials and prints the server response verbatim. " +
        "Useful for endpoints newer than this CLI.",
      positionals: [
        { name: "method", required: true, description: "GET | POST | PUT | PATCH | DELETE" },
        { name: "path", required: true, description: "Endpoint path starting with /, query string allowed" },
      ],
      flags: {
        data: { type: "string", valueName: "json", description: 'JSON request body ("-" reads stdin)' },
      },
      examples: [
        "launchy api GET '/api/launches?limit=5&status=go'",
        "launchy api POST /api/corrections --data '{\"launch_id\":\"…\",\"description\":\"…\"}'",
      ],
      run: async (ctx: Ctx, args) => {
        const method = String(args.positionals[0]).toUpperCase();
        const path = String(args.positionals[1]);
        if (!HTTP_METHODS.has(method)) {
          throw new UsageError(`method must be one of ${[...HTTP_METHODS].join(", ")}`);
        }
        if (!path.startsWith("/")) throw new UsageError("path must start with / (e.g. /api/launches)");
        let body: unknown;
        if (args.flags.data !== undefined) {
          const raw = args.flags.data === "-" ? await readStdin() : String(args.flags.data);
          try {
            body = JSON.parse(raw);
          } catch {
            throw new UsageError("--data must be valid JSON");
          }
        }
        const res = await api(ctx, method, path, { body, auth: "none" });
        printJson(res);
      },
    },
    {
      path: ["docs"],
      summary: "Full reference — markdown by default, machine-readable with --json",
      description:
        "Prints the complete command/flag/endpoint reference. Agents: run `launchy docs --json` once " +
        "and you know everything this CLI can do.",
      run: async (ctx: Ctx, args) => {
        // Deliberately keyed on the explicit flag, not TTY detection: piped
        // `launchy docs` should still produce markdown.
        if (args.flags.json === true) {
          printJson(structuredDocs(getAll()));
        } else {
          process.stdout.write(markdownDocs(getAll()));
        }
      },
    },
  ];
}

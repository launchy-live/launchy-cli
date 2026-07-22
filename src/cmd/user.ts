import type { Ctx } from "../context.js";
import { UsageError } from "../errors.js";
import { api } from "../http.js";
import { colors, emit, renderObject, type Write } from "../output.js";
import type { Command } from "../registry.js";

const SETTABLE: Record<string, string> = {
  precision_mode: "simple | expert",
  notifications_enabled: "true | false",
  theme: "dark | light | system",
  timezone: "IANA timezone, e.g. America/Los_Angeles",
};

function profileOf(body: any): any {
  return body?.data ?? body;
}

function planOf(profile: any): "pro" | "free" {
  return profile?.is_pro ? "pro" : "free";
}

function renderProfile(ctx: Ctx, profile: any): (w: Write) => void {
  const c = colors(ctx);
  return (w) => {
    const plan = planOf(profile);
    const badge = plan === "pro" ? c.green("PRO") : c.dim("FREE");
    w(`${c.bold(String(profile.email ?? profile.clerk_id ?? profile.id ?? "you"))}  [${badge}]`);
    if (profile.pro_expires_at) w(c.dim(`pro until ${profile.pro_expires_at}`));
    w();
    renderObject(w, c, profile, { skip: ["email"] });
  };
}

export const userCommands: Command[] = [
  {
    path: ["me", "get"],
    summary: "Your profile and settings (requires a user token)",
    run: async (ctx) => {
      const profile = profileOf(await api(ctx, "GET", "/api/me", { auth: "user" }));
      emit(ctx, { data: profile }, renderProfile(ctx, profile));
    },
  },
  {
    path: ["me", "set"],
    summary: "Update profile settings, e.g. `launchy me set precision_mode=expert`",
    positionals: [
      { name: "key=value", required: true, description: "One or more settings to change" },
    ],
    examples: [
      "launchy me set precision_mode=expert",
      "launchy me set theme=dark notifications_enabled=true",
    ],
    run: async (ctx, args) => {
      const patch: Record<string, unknown> = {};
      for (const pair of args.positionals) {
        const eq = pair.indexOf("=");
        if (eq <= 0) throw new UsageError(`expected key=value, got "${pair}"`);
        const key = pair.slice(0, eq);
        const raw = pair.slice(eq + 1);
        if (!(key in SETTABLE)) {
          const allowed = Object.entries(SETTABLE)
            .map(([k, v]) => `  ${k} (${v})`)
            .join("\n");
          throw new UsageError(`"${key}" is not a settable field. Settable fields:\n${allowed}`);
        }
        patch[key] = raw === "true" ? true : raw === "false" ? false : raw;
      }
      const profile = profileOf(await api(ctx, "PATCH", "/api/me", { auth: "user", body: patch }));
      emit(ctx, { data: profile }, renderProfile(ctx, profile));
    },
  },
  {
    path: ["whoami"],
    summary: "Show who you are authenticated as, and your plan (free/pro)",
    run: async (ctx) => {
      if (ctx.token) {
        const profile = profileOf(await api(ctx, "GET", "/api/me", { auth: "user" }));
        const plan = planOf(profile);
        emit(ctx, { data: { auth: "user-token", plan, profile } }, (w) => {
          const c = colors(ctx);
          const badge = plan === "pro" ? c.green("PRO") : c.dim("FREE");
          w(`${c.bold(String(profile.email ?? profile.clerk_id ?? "anonymous user"))}  [${badge}]`);
          if (profile.pro_expires_at) w(c.dim(`pro until ${profile.pro_expires_at}`));
        });
        return;
      }
      if (ctx.apiKey) {
        emit(
          ctx,
          {
            data: {
              auth: "api-key",
              plan: null,
              note: "API keys authenticate the app, not a user — account commands need a user token (launchy auth login --token <jwt>).",
            },
          },
          (w) => {
            const c = colors(ctx);
            w(`Authenticated with an ${c.bold("API key")} (no user identity).`);
            w(c.dim("Account commands need a user token: launchy auth login --token <jwt>"));
          },
        );
        return;
      }
      emit(ctx, { data: { auth: null, plan: null } }, (w) =>
        w("Not authenticated. Run `launchy auth login`."),
      );
    },
  },
  {
    path: ["corrections", "submit"],
    summary: "Report incorrect launch data (reviewed by the launch's editorial agent)",
    flags: {
      launch: { type: "string", valueName: "id", required: true, description: "Launch id the correction applies to" },
      description: {
        type: "string",
        valueName: "text",
        required: true,
        description: "What is wrong and what it should be (10-1000 chars)",
      },
      context: { type: "string", valueName: "text", description: "Where you saw it (optional)" },
    },
    examples: [
      'launchy corrections submit --launch <id> --description "Window opens 14:00 UTC per FAA advisory, not 15:00"',
    ],
    run: async (ctx, args) => {
      const description = String(args.flags.description ?? "");
      if (description.length < 10 || description.length > 1000) {
        throw new UsageError(
          `--description must be 10-1000 characters (got ${description.length})`,
        );
      }
      const body = await api(ctx, "POST", "/api/corrections", {
        auth: "user",
        body: {
          launch_id: args.flags.launch,
          description,
          ...(args.flags.context ? { context: args.flags.context } : {}),
        },
      });
      emit(ctx, { data: body }, (w) => {
        w(`Correction submitted (${body.correction_id ?? "pending"}).`);
        w("It will be reviewed against sources before any canonical data changes.");
      });
    },
  },
];

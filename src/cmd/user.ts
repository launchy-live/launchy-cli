import { identifiesUser, type Ctx } from "../context.js";
import { ApiError, CliError, UsageError } from "../errors.js";
import { api } from "../http.js";
import { colors, emit, renderObject, shortDate, type Write } from "../output.js";
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
    if (profile.pro_expires_at) w(c.dim(`pro until ${shortDate(String(profile.pro_expires_at))}`));
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
      if (!ctx.token && !ctx.apiKey) {
        emit(ctx, { data: { auth: null, plan: null } }, (w) =>
          w("Not authenticated. Run `launchy auth login`."),
        );
        return;
      }

      // When both a token and a key are configured the CLI sends both, and the
      // server resolves the request against the Bearer token (strongest
      // identity wins) — so a token, when present, is what `auth` names.
      const authKind = ctx.token
        ? "user-token"
        : identifiesUser(ctx)
          ? "personal-api-key"
          : "app-api-key";

      // A personal key identifies a user just as a session token does, so ask
      // the server rather than assuming. Only fall back if it declines.
      if (authKind !== "app-api-key") {
        let profile: any;
        try {
          profile = profileOf(await api(ctx, "GET", "/api/me", { auth: "user" }));
        } catch (err) {
          // whoami is a diagnostic: a credential the server rejects is an
          // answer, not a crash. Report what is configured and why it failed,
          // and still exit 0 so scripts can read the envelope.
          const status = err instanceof ApiError ? err.status : undefined;
          const code = err instanceof CliError ? err.code : "ERROR";
          const message = err instanceof Error ? err.message : String(err);
          const rejected = status === 401 || status === 403;
          const note = rejected
            ? `The configured ${authKind} was rejected by the server. Check it with \`launchy auth status\`, then re-run \`launchy auth login\`.`
            : `Could not verify the configured ${authKind} (${message}). Plan is unknown.`;
          emit(
            ctx,
            {
              data: {
                auth: authKind,
                plan: null,
                ...(rejected ? { credential_rejected: true } : {}),
                error: { code, message, ...(status !== undefined ? { status } : {}) },
                note,
              },
            },
            (w) => {
              const c = colors(ctx);
              w(`${c.bold(authKind)}  [${c.red(rejected ? "REJECTED" : "UNVERIFIED")}]`);
              w(c.dim(note));
            },
          );
          return;
        }
        const plan = planOf(profile);
        emit(ctx, { data: { auth: authKind, plan, profile } }, (w) => {
          const c = colors(ctx);
          const badge = plan === "pro" ? c.green("PRO") : c.dim("FREE");
          w(`${c.bold(String(profile.email ?? profile.clerk_id ?? "anonymous user"))}  [${badge}]`);
          if (profile.pro_expires_at) w(c.dim(`pro until ${shortDate(String(profile.pro_expires_at))}`));
        });
        return;
      }

      emit(
        ctx,
        {
          data: {
            auth: authKind,
            plan: null,
            note: "This key does not look like a personal key (lk_live_…), so the CLI did not ask the server to identify you. Account commands need a personal key created in the Launchy app, or a user token.",
          },
        },
        (w) => {
          const c = colors(ctx);
          w(`Authenticated with an API key that carries no user identity the CLI can see.`);
          w(c.dim("For account commands, create a personal key in the Launchy app and run `launchy auth login --key <key>`."));
        },
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

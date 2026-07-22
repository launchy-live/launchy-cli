import type { Ctx } from "../context.js";
import { api } from "../http.js";
import { colors, dynamicCols, emit, renderObject, table } from "../output.js";
import type { Command } from "../registry.js";

const enc = encodeURIComponent;

function emitRows(ctx: Ctx, rows: any[], preferred: string[], pagination?: unknown): void {
  emit(ctx, { data: rows, ...(pagination ? { pagination } : {}) }, (w) => {
    if (rows.length === 0) {
      w("(no rows)");
      return;
    }
    w(table(rows, dynamicCols(rows, preferred)));
  });
}

function emitOne(ctx: Ctx, obj: any): void {
  emit(ctx, { data: obj }, (w) => {
    const c = colors(ctx);
    if (obj?.name) w(c.bold(String(obj.name)));
    renderObject(w, c, obj ?? {}, { skip: ["name"] });
  });
}

export const referenceCommands: Command[] = [
  {
    path: ["providers", "list"],
    summary: "Launch providers (agencies and companies)",
    run: async (ctx) => {
      const body = await api(ctx, "GET", "/api/providers");
      emitRows(ctx, body.providers ?? body.data ?? [], [
        "id",
        "name",
        "abbrev",
        "country",
        "consecutive_successful_launches",
      ]);
    },
  },
  {
    path: ["sites", "list"],
    summary: "Launch sites and pads",
    run: async (ctx) => {
      const body = await api(ctx, "GET", "/api/sites");
      emitRows(ctx, body.sites ?? body.data ?? [], [
        "id",
        "name",
        "location",
        "country",
        "latitude",
        "longitude",
      ]);
    },
  },
  {
    path: ["rockets", "list"],
    summary: "Rocket families",
    run: async (ctx) => {
      const body = await api(ctx, "GET", "/api/rockets");
      emitRows(ctx, body.rockets ?? body.data ?? [], ["id", "name", "family", "provider_id"]);
    },
  },
  {
    path: ["rockets", "get"],
    summary: "One rocket by id",
    positionals: [{ name: "id", required: true, description: "Rocket id" }],
    run: async (ctx, args) => {
      const body = await api(ctx, "GET", `/api/rockets/${enc(args.positionals[0]!)}`);
      emitOne(ctx, body.rocket ?? body.data ?? body);
    },
  },
  {
    path: ["rockets", "variant"],
    summary: "One rocket variant by id",
    positionals: [{ name: "variantId", required: true, description: "Rocket variant id" }],
    run: async (ctx, args) => {
      const body = await api(ctx, "GET", `/api/rockets/variants/${enc(args.positionals[0]!)}`);
      emitOne(ctx, body.variant ?? body.data ?? body);
    },
  },
  {
    path: ["boosters", "list"],
    summary: "Reusable boosters and their flight history",
    flags: {
      limit: { type: "number", valueName: "n", description: "Page size, 1-100 (default 50)" },
      offset: { type: "number", valueName: "n", description: "Pagination offset" },
      provider: { type: "string", valueName: "name", description: "Filter by provider" },
      status: {
        type: "string",
        valueName: "s",
        description: "Filter: active | retired | destroyed | unknown",
      },
    },
    run: async (ctx, args) => {
      const body = await api(ctx, "GET", "/api/boosters", {
        query: {
          limit: args.flags.limit,
          offset: args.flags.offset,
          provider: args.flags.provider,
          status: args.flags.status,
        },
      });
      emitRows(
        ctx,
        body.data ?? [],
        ["id", "serial", "status", "flights", "provider_id"],
        body.pagination,
      );
    },
  },
  {
    path: ["boosters", "get"],
    summary: "One booster by id (or by serial with --serial)",
    positionals: [{ name: "id", required: true, description: "Booster id, or serial with --serial" }],
    flags: {
      serial: { type: "boolean", description: "Look up by serial number (e.g. B1067) instead of id" },
    },
    examples: ["launchy boosters get <id>", "launchy boosters get B1067 --serial"],
    run: async (ctx, args) => {
      const key = enc(args.positionals[0]!);
      const path = args.flags.serial === true ? `/api/boosters/serial/${key}` : `/api/boosters/${key}`;
      const body = await api(ctx, "GET", path);
      emitOne(ctx, body.data ?? body);
    },
  },
];

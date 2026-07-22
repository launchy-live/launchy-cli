import type { Ctx } from "../context.js";
import { api } from "../http.js";
import {
  colors,
  countdown,
  dynamicCols,
  emit,
  note,
  renderObject,
  shortDate,
  statusStyled,
  table,
  truncate,
  type Write,
} from "../output.js";
import type { Command } from "../registry.js";

const enc = encodeURIComponent;
const MAX_AUTO_PAGINATE_ROWS = 5000;

function providerName(row: any): string {
  return row?.provider?.name ?? row?.provider_name ?? row?.provider_id ?? "";
}

function t0Cell(l: any): string {
  if (!l?.target_date) return "TBD";
  const date = shortDate(String(l.target_date));
  const cd = countdown(String(l.target_date));
  return cd ? `${date} (${cd})` : date;
}

function launchTable(ctx: Ctx, rows: any[]): string {
  const c = colors(ctx);
  return table(
    rows.map((l) => ({
      id: l.id,
      mission: truncate(String(l.mission_name ?? l.name ?? ""), 36),
      status: statusStyled(c, String(l.status ?? "")),
      "t-0": t0Cell(l),
      provider: providerName(l),
    })),
    [
      { key: "id", label: "id", max: 40 },
      { key: "mission", label: "mission", max: 38 },
      { key: "status", label: "status", max: 24 },
      { key: "t-0", label: "t-0", max: 30 },
      { key: "provider", label: "provider", max: 24 },
    ],
  );
}

function renderLaunchDetail(ctx: Ctx, l: any): (w: Write) => void {
  const c = colors(ctx);
  return (w) => {
    w(c.bold(String(l.mission_name ?? l.id)));
    w();
    const kv = (label: string, value: unknown): void => {
      if (value === undefined || value === null || value === "") return;
      w(`${c.dim((label + ":").padEnd(14))} ${value}`);
    };
    kv("id", l.id);
    kv("status", statusStyled(c, String(l.status ?? "")));
    kv("t-0", l.target_date ? `${t0Cell(l)}${l.target_precision ? ` (precision: ${l.target_precision})` : ""}` : undefined);
    if (l.window_open || l.window_close) {
      kv("window", `${l.window_open ?? "?"} → ${l.window_close ?? "?"}`);
    }
    kv("provider", l.provider?.name ?? providerName(l));
    kv("site", l.site?.name ?? l.launch_site?.name);
    kv("rocket", l.rocket_variant?.name);
    if (l.booster) {
      kv(
        "booster",
        `${l.booster.serial ?? l.booster.id}${l.booster_flight_number ? ` (flight ${l.booster_flight_number})` : ""}`,
      );
    }
    kv("crewed", l.is_crewed ? "yes" : undefined);
    kv("first flight", l.is_first_flight ? "yes" : undefined);
    kv("test flight", l.is_test_flight ? "yes" : undefined);
    const probability = l.probability ?? l.probability_go;
    kv("go probability", typeof probability === "number" ? `${probability}%` : undefined);
    kv("weather", l.weather_concerns);
    kv(
      "payload",
      l.payload_summary
        ? `${l.payload_summary}${l.payload_mass_kg ? ` (${l.payload_mass_kg} kg)` : ""}`
        : undefined,
    );
    kv("customer", l.customer);
    kv("orbit", l.orbit_type ?? l.orbit);
    kv("webcast", l.webcast_url ? `${l.webcast_url}${l.webcast_live ? " (LIVE)" : ""}` : undefined);
    kv("landing", l.landing_type ? `${l.landing_type}${l.landing_location ? ` @ ${l.landing_location}` : ""}` : undefined);
    kv("failure", l.failreason);
    const story = l.narrative?.story;
    if (story) {
      w();
      w(truncate(String(story), 600));
    }
    const description = l.description_simple ?? l.mission_description;
    if (description && description !== story) {
      w();
      w(c.dim(truncate(String(description), 500)));
    }
    w();
    w(
      c.dim(
        `related: launchy launches timeline ${l.id} · weather ${l.id} · slips ${l.id} · visibility ${l.id} --lat <deg> --lng <deg>`,
      ),
    );
  };
}

async function listResource(
  ctx: Ctx,
  path: string,
  query: Record<string, unknown>,
  preferred: string[],
): Promise<void> {
  const body = await api(ctx, "GET", path, { query });
  const rows: any[] = body.data ?? [];
  emit(ctx, { data: rows, ...(body.pagination && { pagination: body.pagination }) }, (w) => {
    if (rows.length === 0) {
      w("(no rows)");
      return;
    }
    w(table(rows, dynamicCols(rows, preferred)));
  });
}

export const launchCommands: Command[] = [
  {
    path: ["launches", "list"],
    summary: "List launches (upcoming by default), with filters and auto-pagination",
    flags: {
      limit: { type: "number", valueName: "n", description: "Page size, 1-100 (default 20)" },
      offset: { type: "number", valueName: "n", description: "Pagination offset (default 0)" },
      all: { type: "boolean", description: "Fetch every matching row (auto-paginate)" },
      provider: { type: "string", valueName: "name", description: "Filter by launch provider" },
      site: { type: "string", valueName: "name", description: "Filter by launch site" },
      status: {
        type: "string",
        valueName: "s",
        description: "Filter by status (scheduled|tbc|go|hold|scrubbed|success|failure|partial_failure)",
      },
      time: { type: "string", valueName: "t", description: "upcoming | past | all (default upcoming)" },
    },
    examples: [
      "launchy launches list",
      "launchy ls --provider SpaceX --time all --limit 50",
      "launchy launches list --status go --json",
      "launchy launches list --all --time past | jq '.data | length'",
    ],
    run: async (ctx, args) => {
      const f = args.flags;
      const query: Record<string, unknown> = {
        provider: f.provider,
        site: f.site,
        status: f.status,
        time_filter: f.time ?? "upcoming",
      };
      let data: any[] = [];
      let pagination: unknown;
      if (f.all === true) {
        let offset = 0;
        for (;;) {
          const body = await api(ctx, "GET", "/api/launches", {
            query: { ...query, limit: 100, offset },
          });
          const page: any[] = body.data ?? [];
          data.push(...page);
          offset += page.length;
          const total: number = body.pagination?.total ?? data.length;
          if (page.length === 0 || data.length >= total) break;
          if (data.length >= MAX_AUTO_PAGINATE_ROWS) {
            note(ctx, `stopped auto-pagination at ${MAX_AUTO_PAGINATE_ROWS} rows; add filters to narrow the query`);
            break;
          }
        }
        pagination = { offset: 0, limit: data.length, total: data.length };
      } else {
        const body = await api(ctx, "GET", "/api/launches", {
          query: { ...query, limit: f.limit ?? 20, offset: f.offset ?? 0 },
        });
        data = body.data ?? [];
        pagination = body.pagination;
      }
      emit(ctx, { data, pagination }, (w) => {
        if (data.length === 0) {
          w("(no launches match)");
          return;
        }
        w(launchTable(ctx, data));
        const p = pagination as any;
        if (p && p.total > data.length) {
          w();
          w(colors(ctx).dim(`showing ${data.length} of ${p.total} — use --limit/--offset or --all`));
        }
      });
    },
  },
  {
    path: ["launches", "get"],
    summary: "Full detail for one launch (timeline, weather, media, narrative, slip history)",
    positionals: [{ name: "id", required: true, description: "Launch id" }],
    examples: ["launchy launches get <id>", "launchy launches get <id> --json | jq .data.timeline"],
    run: async (ctx, args) => {
      const id = args.positionals[0]!;
      const body = await api(ctx, "GET", `/api/launches/${enc(id)}`);
      emit(ctx, { data: body.data }, renderLaunchDetail(ctx, body.data ?? {}));
    },
  },
  {
    path: ["launches", "next"],
    summary: "The next upcoming launch (optionally for one provider)",
    flags: {
      provider: { type: "string", valueName: "name", description: "Restrict to one launch provider" },
    },
    examples: ["launchy next", "launchy next --provider SpaceX"],
    run: async (ctx, args) => {
      const body = await api(ctx, "GET", "/api/launches", {
        query: { time_filter: "upcoming", limit: 1, provider: args.flags.provider },
      });
      const l = (body.data ?? [])[0];
      if (!l) {
        emit(ctx, { data: null }, (w) => w("No upcoming launches found."));
        return;
      }
      emit(ctx, { data: l }, (w) => {
        const c = colors(ctx);
        const cd = l.target_date ? countdown(String(l.target_date)) : undefined;
        w(`${c.bold(String(l.mission_name ?? l.id))}${cd ? `  ${c.cyan(cd)}` : ""}`);
        w(`${statusStyled(c, String(l.status ?? ""))} · ${t0Cell(l)} · ${providerName(l)}`);
        w(c.dim(`detail: launchy launches get ${l.id}`));
      });
    },
  },
  {
    path: ["launches", "timeline"],
    summary: "Timeline events for a launch",
    positionals: [{ name: "id", required: true, description: "Launch id" }],
    run: async (ctx, args) => {
      await listResource(ctx, `/api/launches/${enc(args.positionals[0]!)}/timeline`, {}, [
        "title",
        "name",
        "label",
        "status",
        "event_time",
        "time",
        "description",
      ]);
    },
  },
  {
    path: ["launches", "weather"],
    summary: "Weather forecasts for a launch",
    positionals: [{ name: "id", required: true, description: "Launch id" }],
    run: async (ctx, args) => {
      await listResource(ctx, `/api/launches/${enc(args.positionals[0]!)}/weather`, {}, [
        "forecast_time",
        "temperature_c",
        "wind_speed",
        "precipitation_probability",
        "summary",
      ]);
    },
  },
  {
    path: ["launches", "slips"],
    summary: "Schedule-change (slip) history for a launch",
    positionals: [{ name: "id", required: true, description: "Launch id" }],
    flags: {
      limit: { type: "number", valueName: "n", description: "Page size (default 20)" },
      offset: { type: "number", valueName: "n", description: "Pagination offset" },
    },
    run: async (ctx, args) => {
      await listResource(
        ctx,
        `/api/launches/${enc(args.positionals[0]!)}/schedule-changes`,
        { limit: args.flags.limit, offset: args.flags.offset },
        ["changed_at", "previous_date", "new_date", "reason", "source"],
      );
    },
  },
  {
    path: ["launches", "visibility"],
    summary: "Can you see this launch from a location? (sightline, direction, timing)",
    positionals: [{ name: "id", required: true, description: "Launch id" }],
    flags: {
      lat: { type: "number", valueName: "deg", required: true, description: "Observer latitude (-90..90)" },
      lng: { type: "number", valueName: "deg", required: true, description: "Observer longitude (-180..180)" },
      expert: { type: "boolean", description: "Expert mode: full geometry instead of the simple summary" },
    },
    examples: ["launchy launches visibility <id> --lat 45.5 --lng -122.6"],
    run: async (ctx, args) => {
      const body = await api(ctx, "GET", `/api/launches/${enc(args.positionals[0]!)}/visibility`, {
        query: {
          lat: args.flags.lat,
          lng: args.flags.lng,
          mode: args.flags.expert === true ? "expert" : "simple",
        },
      });
      emit(ctx, { data: body.data }, (w) => {
        const c = colors(ctx);
        const d = body.data ?? {};
        const vis = d.visibility ?? {};
        if (d.launch?.mission_name) w(c.bold(String(d.launch.mission_name)));
        if (vis.summary) {
          w(String(vis.summary));
          w();
        }
        renderObject(w, c, vis, { skip: ["summary"] });
      });
    },
  },
  {
    path: ["visibility", "nearby"],
    summary: "Launches visible from a location in the coming days",
    flags: {
      lat: { type: "number", valueName: "deg", required: true, description: "Observer latitude (-90..90)" },
      lng: { type: "number", valueName: "deg", required: true, description: "Observer longitude (-180..180)" },
      "radius-km": { type: "number", valueName: "km", description: "Search radius 50-1000 (default 500)" },
      days: { type: "number", valueName: "n", description: "Days ahead to search, 1-30 (default 14)" },
      expert: { type: "boolean", description: "Expert mode visibility detail" },
    },
    examples: ["launchy visibility nearby --lat 28.4 --lng -80.6 --days 7"],
    run: async (ctx, args) => {
      const body = await api(ctx, "GET", "/api/visibility/nearby", {
        query: {
          lat: args.flags.lat,
          lng: args.flags.lng,
          radius_km: args.flags["radius-km"],
          days: args.flags.days,
          mode: args.flags.expert === true ? "expert" : "simple",
        },
      });
      const rows: any[] = body.data ?? [];
      emit(ctx, { data: rows }, (w) => {
        if (rows.length === 0) {
          w("No visible launches found for that location and window.");
          return;
        }
        const c = colors(ctx);
        w(
          table(
            rows.map((l) => ({
              id: l.id,
              mission: truncate(String(l.mission_name ?? ""), 32),
              "t-0": t0Cell(l),
              visibility: truncate(String(l.visibility?.summary ?? l.visibility?.tier ?? ""), 48),
            })),
            [
              { key: "id", label: "id", max: 40 },
              { key: "mission", label: "mission" },
              { key: "t-0", label: "t-0", max: 30 },
              { key: "visibility", label: "visibility", max: 50 },
            ],
          ),
        );
        w();
        w(c.dim("full geometry: add --expert --json"));
      });
    },
  },
  {
    path: ["launches", "subscribe"],
    summary: "Follow a launch — push notifications track every slip and status change",
    positionals: [{ name: "id", required: true, description: "Launch id" }],
    run: async (ctx, args) => {
      const id = args.positionals[0]!;
      const body = await api(ctx, "POST", `/api/launches/${enc(id)}/subscribe`, { auth: "user" });
      emit(ctx, { data: body }, (w) =>
        w(`Subscribed to ${id}. Notifications follow the schedule — if it slips, your reminder moves with it.`),
      );
    },
  },
  {
    path: ["launches", "unsubscribe"],
    summary: "Stop following a launch",
    positionals: [{ name: "id", required: true, description: "Launch id" }],
    run: async (ctx, args) => {
      const id = args.positionals[0]!;
      const body = await api(ctx, "DELETE", `/api/launches/${enc(id)}/subscribe`, { auth: "user" });
      emit(ctx, { data: body }, (w) => w(`Unsubscribed from ${id}.`));
    },
  },
  {
    path: ["launches", "subscribed"],
    summary: "Check whether you follow a launch",
    positionals: [{ name: "id", required: true, description: "Launch id" }],
    run: async (ctx, args) => {
      const id = args.positionals[0]!;
      const body = await api(ctx, "GET", `/api/launches/${enc(id)}/subscribed`, { auth: "user" });
      emit(ctx, { data: body }, (w) =>
        w(body.subscribed ? `You follow ${id}.` : `You do not follow ${id}.`),
      );
    },
  },
];

import type { Ctx } from "./context.js";

export type Write = (line?: string) => void;

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/**
 * Emit a result. JSON mode (explicit --json, or stdout is not a TTY) prints the
 * payload as pretty JSON; otherwise the human renderer runs. Commands with no
 * human renderer always print JSON.
 */
export function emit(ctx: Ctx, payload: unknown, human?: (w: Write) => void): void {
  if (ctx.json || !human) {
    printJson(payload);
    return;
  }
  human((line = "") => process.stdout.write(line + "\n"));
}

/** Informational note on stderr; suppressed by --quiet, never mixed into stdout data. */
export function note(ctx: Ctx, message: string): void {
  if (!ctx.quiet) process.stderr.write(`note: ${message}\n`);
}

export interface Colors {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
}

export function colors(ctx: Pick<Ctx, "color">): Colors {
  const wrap = (open: string, close: string) => (s: string) =>
    ctx.color ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    red: wrap("31", "39"),
    green: wrap("32", "39"),
    yellow: wrap("33", "39"),
    cyan: wrap("36", "39"),
  };
}

export function statusStyled(c: Colors, status: string): string {
  switch (status) {
    case "go":
    case "success":
      return c.green(status);
    case "hold":
    case "scrubbed":
    case "tbc":
      return c.yellow(status);
    case "failure":
    case "partial_failure":
      return c.red(status);
    default:
      return c.cyan(status);
  }
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Render a value for display, collapsing ISO-8601 timestamps to the compact
 * `YYYY-MM-DD HH:MMZ` form. API payloads carry millisecond precision that is
 * never useful on screen and makes every table column ~9 characters wider.
 */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return ISO_DATETIME.test(s) ? shortDate(s) : s;
}

export interface Col {
  key: string;
  label: string;
  max?: number;
}

export function table(rows: Array<Record<string, unknown>>, cols: Col[]): string {
  const val = (r: Record<string, unknown>, k: string): string => displayValue(r[k]);
  const widths = cols.map((c) =>
    Math.min(
      c.max ?? 40,
      Math.max(c.label.length, 1, ...rows.map((r) => val(r, c.key).length)),
    ),
  );
  const line = (cells: string[]): string =>
    cells
      .map((s, i) => truncate(s, widths[i] as number).padEnd(widths[i] as number))
      .join("  ")
      .trimEnd();
  const out = [line(cols.map((c) => c.label.toUpperCase()))];
  for (const r of rows) out.push(line(cols.map((c) => val(r, c.key))));
  return out.join("\n");
}

function isScalar(v: unknown): boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

/** Pick reasonable table columns from rows of unknown shape (schema-drift tolerant). */
export function dynamicCols(
  rows: Array<Record<string, unknown>>,
  preferred: string[] = [],
  maxCols = 6,
): Col[] {
  const keys: string[] = [];
  // `id` is the handle every follow-up command takes, so it leads when present
  // rather than landing wherever key iteration happens to put it.
  if (rows.some((r) => isScalar(r.id))) keys.push("id");
  for (const k of preferred) {
    if (keys.length >= maxCols) break;
    if (rows.some((r) => isScalar(r[k]))) keys.push(k);
  }
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (keys.length >= maxCols) break;
      if (!keys.includes(k) && isScalar(v)) keys.push(k);
    }
  }
  return keys.map((k) => ({ key: k, label: k }));
}

/** Print scalar fields of an object as aligned key/value lines. */
export function renderObject(
  w: Write,
  c: Colors,
  obj: Record<string, unknown>,
  opts: { skip?: string[]; labelWidth?: number } = {},
): void {
  const lw = opts.labelWidth ?? 22;
  for (const [k, v] of Object.entries(obj)) {
    if (opts.skip?.includes(k)) continue;
    if (v === null || v === undefined || typeof v === "object") continue;
    w(`${c.dim((k + ":").padEnd(lw))} ${truncate(displayValue(v), 120)}`);
  }
}

export function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/** "T-3d 4h" / "T-12m" / "T+2h 10m" relative to now. */
export function countdown(iso: string): string | undefined {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  let diff = t - Date.now();
  const sign = diff < 0 ? "T+" : "T-";
  diff = Math.abs(diff);
  const totalMinutes = Math.floor(diff / 60_000);
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${sign}${d}d ${h}h`;
  if (h > 0) return `${sign}${h}h ${m}m`;
  return `${sign}${m}m`;
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

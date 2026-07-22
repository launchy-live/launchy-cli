import assert from "node:assert/strict";
import { test } from "node:test";
import { countdown, displayValue, dynamicCols, shortDate, table, truncate } from "../dist/output.js";
import { formatReset } from "../dist/cmd/meta.js";

test("displayValue collapses ISO timestamps to compact form", () => {
  assert.equal(displayValue("2026-07-23T21:03:45.932Z"), "2026-07-23 21:03Z");
  assert.equal(displayValue("2026-07-23T21:03:45Z"), "2026-07-23 21:03Z");
  assert.equal(displayValue("2026-07-23T21:03Z"), "2026-07-23 21:03Z");
});

test("displayValue leaves non-timestamps alone", () => {
  // Bare dates, ids and prose must not be mangled by the timestamp path.
  assert.equal(displayValue("2026-07-23"), "2026-07-23");
  assert.equal(displayValue("lch_abc123"), "lch_abc123");
  assert.equal(displayValue("Range conflict with prior mission"), "Range conflict with prior mission");
  assert.equal(displayValue(42), "42");
  assert.equal(displayValue(false), "false");
  assert.equal(displayValue(null), "");
  assert.equal(displayValue(undefined), "");
});

test("tables format timestamp cells but keep other values verbatim", () => {
  const out = table([{ id: "tl_1", event_time: "2026-07-23T21:03:45.932Z", title: "Liftoff" }], [
    { key: "id", label: "id" },
    { key: "event_time", label: "event_time" },
    { key: "title", label: "title" },
  ]);
  assert.match(out, /2026-07-23 21:03Z/);
  assert.doesNotMatch(out, /\.932Z/);
  assert.match(out, /Liftoff/);
});

test("dynamicCols leads with id when present", () => {
  const rows = [{ title: "Liftoff", status: "upcoming", id: "tl_1" }];
  const cols = dynamicCols(rows, ["title", "status"]);
  assert.equal(cols[0].key, "id");
  assert.deepEqual(cols.map((c) => c.key), ["id", "title", "status"]);
});

test("dynamicCols omits id when rows have none, without duplicating keys", () => {
  const cols = dynamicCols([{ title: "x", status: "y" }], ["title", "status"]);
  assert.deepEqual(cols.map((c) => c.key), ["title", "status"]);
});

test("dynamicCols does not duplicate id when preferred lists it first", () => {
  // The exact preferred list `providers list` passes.
  const rows = [{ id: "prv_1", name: "SpaceX", abbrev: "SPX", country: "USA" }];
  const cols = dynamicCols(rows, [
    "id",
    "name",
    "abbrev",
    "country",
    "consecutive_successful_launches",
  ]);
  assert.deepEqual(cols.map((c) => c.key), ["id", "name", "abbrev", "country"]);
});

test("dynamicCols keeps id first and never repeats a key, wherever it appears", () => {
  const rows = [{ name: "Falcon 9", id: "rkt_1", family: "Falcon", provider_id: "prv_1" }];
  // `id` in the middle of the preferred list must not resurface as a second column.
  const cols = dynamicCols(rows, ["name", "id", "family", "provider_id"]);
  assert.deepEqual(cols.map((c) => c.key), ["id", "name", "family", "provider_id"]);
  assert.equal(new Set(cols.map((c) => c.key)).size, cols.length);
});

test("dynamicCols spends all maxCols slots on distinct columns", () => {
  const rows = [{ id: "b_1", serial: "B1067", status: "active", flights: 20, provider_id: "prv_1", block: 5, mass: 1 }];
  const cols = dynamicCols(rows, ["id", "serial", "status", "flights", "provider_id"]);
  assert.equal(cols.length, 6);
  assert.deepEqual(cols.map((c) => c.key), ["id", "serial", "status", "flights", "provider_id", "block"]);
});

test("formatReset treats small numbers as delta seconds, not epoch seconds", () => {
  const now = Date.parse("2026-07-22T12:00:00Z");
  assert.equal(formatReset("60", now), "2026-07-22 12:01Z (in 1m)");
  assert.equal(formatReset("30", now), "2026-07-22 12:00Z (in 30s)");
  assert.equal(formatReset("0", now), "2026-07-22 12:00Z (in 0s)");
  // The 1970 bug: never render a date in the past for a future reset.
  assert.doesNotMatch(formatReset("60", now), /1970/);
});

test("formatReset still reads large numbers as epoch seconds", () => {
  const now = Date.parse("2026-07-22T12:00:00Z");
  assert.equal(formatReset(String(Math.floor(now / 1000) + 120), now), "2026-07-22 12:02Z (in 2m)");
});

test("formatReset accepts ISO values and passes anything else through verbatim", () => {
  const now = Date.parse("2026-07-22T12:00:00Z");
  assert.equal(formatReset("2026-07-22T12:05:00Z", now), "2026-07-22 12:05Z (in 5m)");
  assert.equal(formatReset("soon", now), "soon");
  assert.equal(formatReset("-5", now), "-5");
  assert.equal(formatReset("", now), "");
});

test("countdown renders both directions", () => {
  // Offset by an extra 30s so elapsed test time cannot tip the truncated
  // minute across a boundary and make this flaky.
  const future = new Date(Date.now() + 26 * 3600e3 + 30e3).toISOString();
  const past = new Date(Date.now() - 90 * 60e3 - 30e3).toISOString();
  assert.match(countdown(future), /^T-1d 2h$/);
  assert.match(countdown(past), /^T\+1h 30m$/);
});

test("shortDate is stable and truncate adds an ellipsis only when needed", () => {
  assert.equal(shortDate("2026-07-23T21:03:45.932Z"), "2026-07-23 21:03Z");
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("abcdefghij", 5), "abcd…");
});

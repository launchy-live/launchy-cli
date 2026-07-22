import assert from "node:assert/strict";
import { test } from "node:test";
import { countdown, displayValue, dynamicCols, shortDate, table, truncate } from "../dist/output.js";

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

test("countdown renders both directions", () => {
  const future = new Date(Date.now() + 26 * 3600e3).toISOString();
  const past = new Date(Date.now() - 90 * 60e3).toISOString();
  assert.match(countdown(future), /^T-1d 2h$/);
  assert.match(countdown(past), /^T\+1h 30m$/);
});

test("shortDate is stable and truncate adds an ellipsis only when needed", () => {
  assert.equal(shortDate("2026-07-23T21:03:45.932Z"), "2026-07-23 21:03Z");
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("abcdefghij", 5), "abcd…");
});

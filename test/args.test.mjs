import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../dist/args.js";

const specs = {
  limit: { type: "number", description: "" },
  provider: { type: "string", description: "" },
  all: { type: "boolean", description: "" },
  color: { type: "boolean", description: "", default: true },
  lat: { type: "number", description: "", required: true },
  help: { type: "boolean", description: "" },
};

test("parses flags, equals form, positionals", () => {
  const p = parseArgs(["abc", "--limit", "5", "--provider=SpaceX", "--all", "--lat", "1.5"], specs);
  assert.deepEqual(p.positionals, ["abc"]);
  assert.equal(p.flags.limit, 5);
  assert.equal(p.flags.provider, "SpaceX");
  assert.equal(p.flags.all, true);
  assert.equal(p.flags.lat, 1.5);
});

test("--no- prefix disables booleans with defaults", () => {
  const p = parseArgs(["--no-color", "--lat", "0"], specs);
  assert.equal(p.flags.color, false);
});

test("unknown flag throws usage error", () => {
  assert.throws(() => parseArgs(["--nope", "--lat", "0"], specs), /unknown flag --nope/);
});

test("missing required flag throws, unless --help", () => {
  assert.throws(() => parseArgs([], specs), /missing required flag --lat/);
  assert.doesNotThrow(() => parseArgs(["--help"], specs));
});

test("non-numeric value for number flag throws", () => {
  assert.throws(() => parseArgs(["--limit", "abc", "--lat", "0"], specs), /expects a number/);
});

test("-- stops flag parsing", () => {
  const p = parseArgs(["--lat", "0", "--", "--not-a-flag"], specs);
  assert.deepEqual(p.positionals, ["--not-a-flag"]);
});

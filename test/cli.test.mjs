import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const LAUNCH = {
  id: "lch_abc123",
  mission_name: "Demo Mission",
  status: "go",
  target_date: "2099-01-01T12:00:00Z",
  provider_id: "prv_1",
};

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    // The server knows exactly two credentials, and both identify the same
    // user. Anything else in X-API-Key is not a credential — it is ignored,
    // and the caller is simply anonymous. Public reads need neither.
    const personalKey = req.headers["x-api-key"] === "lk_live_personalkey123";
    const authedByUser = req.headers.authorization === "Bearer usertok";

    if (url.pathname === "/api/me") {
      if (!authedByUser && !personalKey)
        return send(401, { error: "Unauthorized", message: "user identity required", code: "UNAUTHORIZED" });
      return send(200, {
        id: "u1",
        clerk_id: "user_1",
        email: "scott@example.com",
        is_pro: true,
        pro_expires_at: "2099-01-01T00:00:00Z",
        precision_mode: "expert",
      });
    }
    if (url.pathname === "/api/launches/lch_abc123/subscribe" && !authedByUser && !personalKey) {
      return send(401, { error: "Unauthorized", message: "user identity required", code: "UNAUTHORIZED" });
    }
    if (url.pathname === "/api/launches") {
      return send(
        200,
        { data: [LAUNCH], pagination: { offset: 0, limit: 20, total: 1 } },
        // "60" here is the delta-seconds form of X-RateLimit-Reset.
        { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "59", "x-ratelimit-reset": "60" },
      );
    }
    if (url.pathname === "/api/launches/lch_abc123") {
      return send(200, { data: LAUNCH });
    }
    if (url.pathname === "/api/launches/lch_abc123/subscribe") {
      return send(200, { subscribed: req.method === "POST", launch_id: "lch_abc123" });
    }
    if (url.pathname === "/api/launches/missing") {
      return send(404, { error: "Not Found", message: "launch not found" });
    }
    if (url.pathname === "/api/ratelimited") {
      return send(429, { error: "Too Many Requests", message: "slow down", code: "RATE_LIMITED" }, { "retry-after": "60" });
    }
    return send(404, { error: "Not Found", message: `no route ${url.pathname}` });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "dist", "main.js"), ...args],
      {
        env: {
          ...process.env,
          LAUNCHY_BASE_URL: baseUrl,
          // The default is the new normal: no credentials at all. Tests that
          // need an identity opt in explicitly.
          LAUNCHY_API_KEY: "",
          LAUNCHY_TOKEN: "",
          LAUNCHY_CONFIG_DIR: mkdtempSync(join(tmpdir(), "launchy-test-")),
          NO_COLOR: "1",
          ...env,
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("launches list works with no credentials configured at all", async () => {
  // The headline of the auth simplification: public reads are anonymous.
  const r = await runCli(["launches", "list"], { LAUNCHY_API_KEY: "", LAUNCHY_TOKEN: "" });
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data[0].id, "lch_abc123");
  assert.equal(body.pagination.total, 1);
});

test("launches list emits JSON envelope when piped", async () => {
  const r = await runCli(["launches", "list"], { LAUNCHY_API_KEY: "lk_live_personalkey123" });
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data[0].id, "lch_abc123");
  assert.equal(body.pagination.total, 1);
});

test("a read with an unrecognized X-API-Key still succeeds (the server ignores it)", async () => {
  const r = await runCli(["launches", "get", "lch_abc123"], { LAUNCHY_API_KEY: "testkey" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).data.id, "lch_abc123");
});

test("ls alias resolves to launches list", async () => {
  const r = await runCli(["ls"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).data.length, 1);
});

test("404 maps to exit 4 with structured stderr", async () => {
  const r = await runCli(["launches", "get", "missing"]);
  assert.equal(r.code, 4);
  const err = JSON.parse(r.stderr);
  assert.equal(err.error.code, "NOT_FOUND");
  assert.equal(err.error.status, 404);
});

test("whoami with a user token reports plan pro", async () => {
  const r = await runCli(["whoami"], { LAUNCHY_TOKEN: "usertok" });
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data.auth, "user-token");
  assert.equal(body.data.plan, "pro");
  assert.equal(body.data.profile.email, "scott@example.com");
});

test("whoami with no credentials reports anonymous and says reads still work", async () => {
  const r = await runCli(["whoami"]);
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data.auth, null);
  assert.equal(body.data.plan, null);
  assert.match(body.data.note, /read/i);
});

test("whoami calls an unrecognized X-API-Key unrecognized, not an app key", async () => {
  const r = await runCli(["whoami"], { LAUNCHY_API_KEY: "testkey" });
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data.auth, "unrecognized-api-key");
  assert.equal(body.data.plan, null);
  assert.equal(body.data.credential_recognized, false);
  assert.match(body.data.note, /not a recognized credential/i);
  assert.doesNotMatch(JSON.stringify(body), /app.?api.?key|application key/i);
});

test("whoami with a personal key resolves the user and plan", async () => {
  const r = await runCli(["whoami"], { LAUNCHY_API_KEY: "lk_live_personalkey123" });
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data.auth, "personal-api-key");
  assert.equal(body.data.plan, "pro");
  assert.equal(body.data.profile.email, "scott@example.com");
});

test("whoami reports a rejected personal key instead of hard-failing", async () => {
  const r = await runCli(["whoami"], { LAUNCHY_API_KEY: "lk_live_revokedkey999" });
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data.auth, "personal-api-key");
  assert.equal(body.data.plan, null);
  assert.equal(body.data.credential_rejected, true);
  assert.equal(body.data.error.status, 401);
  assert.match(body.data.note, /rejected/i);
});

test("whoami reports a rejected user token instead of hard-failing", async () => {
  const r = await runCli(["whoami"], { LAUNCHY_TOKEN: "badtok", LAUNCHY_API_KEY: "" });
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data.auth, "user-token");
  assert.equal(body.data.plan, null);
  assert.equal(body.data.credential_rejected, true);
});

test("whoami names the token when both credentials are configured (server prefers Bearer)", async () => {
  const r = await runCli(["whoami"], {
    LAUNCHY_TOKEN: "usertok",
    LAUNCHY_API_KEY: "lk_live_personalkey123",
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).data.auth, "user-token");
});

test("a personal key satisfies account commands", async () => {
  const r = await runCli(["launches", "subscribe", "lch_abc123"], {
    LAUNCHY_API_KEY: "lk_live_personalkey123",
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).data.subscribed, true);
});

test("an unrecognized key is refused for account commands, without a network call", async () => {
  const r = await runCli(["me", "get"], { LAUNCHY_API_KEY: "testkey" });
  assert.equal(r.code, 3);
  const err = JSON.parse(r.stderr);
  assert.equal(err.error.code, "AUTH_REQUIRED");
  assert.match(err.error.message, /not a personal key/);
});

test("account command with zero credentials fails fast with exit 3, no network call", async () => {
  const r = await runCli(["launches", "subscribe", "lch_abc123"], {
    // Point at a dead port: reaching the network at all would be a NETWORK
    // error (exit 6), so exit 3 proves the guard short-circuits locally.
    LAUNCHY_BASE_URL: "http://127.0.0.1:1",
  });
  assert.equal(r.code, 3);
  const err = JSON.parse(r.stderr);
  assert.equal(err.error.code, "AUTH_REQUIRED");
  assert.match(err.error.message, /personal API key or user token/);
});

test("me get with zero credentials fails fast with exit 3", async () => {
  const r = await runCli(["me", "get"], { LAUNCHY_BASE_URL: "http://127.0.0.1:1" });
  assert.equal(r.code, 3);
  assert.equal(JSON.parse(r.stderr).error.code, "AUTH_REQUIRED");
});

test("429 with long Retry-After maps to exit 5 and reports the wait", async () => {
  const r = await runCli(["api", "GET", "/api/ratelimited"]);
  assert.equal(r.code, 5);
  const err = JSON.parse(r.stderr);
  assert.equal(err.error.code, "RATE_LIMITED");
  assert.equal(err.error.retry_after_seconds, 60);
});

test("limits surfaces server rate-limit headers", async () => {
  const r = await runCli(["limits"]);
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data.rate_limit.limit, 60);
  assert.equal(body.data.rate_limit.remaining, 59);
  assert.equal(body.data.rate_limit.reset, "60");
});

test("limits renders a delta-seconds reset as a future time, not 1970", async () => {
  const r = await runCli(["limits", "--plain"]);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /1970/);
  const line = r.stdout.split("\n").find((l) => l.startsWith("resets:"));
  assert.ok(line, `no resets line in:\n${r.stdout}`);
  assert.match(line, /\(in (1m|60s|59s)\)/);
  const stamp = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2})Z/.exec(line);
  assert.ok(stamp, line);
  // Rendered to minute precision, so allow a minute of slack either side of
  // "about a minute from now" — the bug rendered 1970, which is nowhere near.
  const delta = Date.parse(stamp[1] + "Z") - Date.now();
  assert.ok(delta > -60_000 && delta < 180_000, `reset should be ~1 minute away, got ${line}`);
});

test("auth login --key verifies identity against the API and writes chmod-600 config", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "launchy-login-"));
  const r = await runCli(["auth", "login", "--key", "lk_live_personalkey123"], {
    LAUNCHY_CONFIG_DIR: configDir,
  });
  assert.equal(r.code, 0, r.stderr);
  const cfgPath = join(configDir, "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  assert.equal(cfg.api_key, "lk_live_personalkey123");
  assert.equal(statSync(cfgPath).mode & 0o777, 0o600);
});

test("auth login with a revoked personal key refuses to save", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "launchy-badlogin-"));
  const r = await runCli(["auth", "login", "--key", "lk_live_revokedkey999"], {
    LAUNCHY_CONFIG_DIR: configDir,
  });
  assert.equal(r.code, 3);
  assert.throws(() => readFileSync(join(configDir, "config.json")));
});

test("auth login with a key that is not a personal key refuses to save", async () => {
  // Reads are public, so a read can no longer verify a credential — login
  // checks identity, which a non-lk_live_ string can never establish.
  const configDir = mkdtempSync(join(tmpdir(), "launchy-notakey-"));
  const r = await runCli(["auth", "login", "--key", "wrongkey"], {
    LAUNCHY_CONFIG_DIR: configDir,
  });
  assert.equal(r.code, 3);
  assert.match(JSON.parse(r.stderr).error.message, /not a personal key/);
  assert.throws(() => readFileSync(join(configDir, "config.json")));
});

test("unknown flag exits 2", async () => {
  const r = await runCli(["launches", "list", "--bogus"]);
  assert.equal(r.code, 2);
});

test("docs --json is a complete machine-readable reference", async () => {
  const r = await runCli(["docs", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const docs = JSON.parse(r.stdout);
  assert.equal(docs.name, "launchy");
  assert.ok(docs.commands.length > 15);
  assert.ok(docs.exit_codes["5"]);
  const listCmd = docs.commands.find((c) => c.name === "launches list");
  assert.ok(listCmd.flags.some((f) => f.name === "--provider"));
});

test("docs --json describes the two-credential model and anonymous reads", async () => {
  const r = await runCli(["docs", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const { auth } = JSON.parse(r.stdout);
  assert.equal(auth.application_api_key, undefined);
  assert.match(auth.public_reads, /no credential required/i);
  assert.match(auth.personal_api_key, /lk_live_/);
  assert.ok(auth.user_token);
  assert.ok(auth.precedence);
  assert.match(auth.rate_limits, /per IP/i);
  assert.match(auth.rate_limits, /per user/i);
});

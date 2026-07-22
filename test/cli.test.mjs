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
    const authedByKey = req.headers["x-api-key"] === "testkey";
    const authedByUser = req.headers.authorization === "Bearer usertok";

    if (url.pathname === "/api/me") {
      if (!authedByUser) return send(401, { error: "Unauthorized", message: "user token required", code: "UNAUTHORIZED" });
      return send(200, {
        id: "u1",
        clerk_id: "user_1",
        email: "scott@example.com",
        is_pro: true,
        pro_expires_at: "2099-01-01T00:00:00Z",
        precision_mode: "expert",
      });
    }
    if (!authedByKey && !authedByUser) {
      return send(401, { error: "Unauthorized", message: "credentials required", code: "UNAUTHORIZED" });
    }
    if (url.pathname === "/api/launches") {
      return send(
        200,
        { data: [LAUNCH], pagination: { offset: 0, limit: 20, total: 1 } },
        { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "59" },
      );
    }
    if (url.pathname === "/api/launches/lch_abc123") {
      return send(200, { data: LAUNCH });
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
          LAUNCHY_API_KEY: "testkey",
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

test("launches list emits JSON envelope when piped", async () => {
  const r = await runCli(["launches", "list"]);
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data[0].id, "lch_abc123");
  assert.equal(body.pagination.total, 1);
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

test("whoami with only an API key explains the identity gap", async () => {
  const r = await runCli(["whoami"]);
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.data.auth, "api-key");
  assert.equal(body.data.plan, null);
});

test("user-scoped command without token fails fast with exit 3", async () => {
  const r = await runCli(["launches", "subscribe", "lch_abc123"]);
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
});

test("auth login --key verifies against the API and writes chmod-600 config", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "launchy-login-"));
  const r = await runCli(["auth", "login", "--key", "testkey"], {
    LAUNCHY_CONFIG_DIR: configDir,
    LAUNCHY_API_KEY: "",
  });
  assert.equal(r.code, 0, r.stderr);
  const cfgPath = join(configDir, "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  assert.equal(cfg.api_key, "testkey");
  assert.equal(statSync(cfgPath).mode & 0o777, 0o600);
});

test("auth login with a bad key refuses to save", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "launchy-badlogin-"));
  const r = await runCli(["auth", "login", "--key", "wrongkey"], {
    LAUNCHY_CONFIG_DIR: configDir,
    LAUNCHY_API_KEY: "",
  });
  assert.equal(r.code, 3);
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

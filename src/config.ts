import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredConfig {
  api_key?: string;
  token?: string;
  base_url?: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LAUNCHY_CONFIG_DIR) return env.LAUNCHY_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "launchy");
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "config.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StoredConfig {
  try {
    return JSON.parse(readFileSync(configPath(env), "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: StoredConfig, env: NodeJS.ProcessEnv = process.env): string {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = configPath(env);
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

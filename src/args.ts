import { UsageError } from "./errors.js";

export type FlagType = "string" | "boolean" | "number";

export interface FlagSpec {
  type: FlagType;
  description: string;
  valueName?: string;
  required?: boolean;
  default?: string | number | boolean;
}

export type FlagSpecs = Record<string, FlagSpec>;

export type FlagValue = string | number | boolean | undefined;

export interface Parsed {
  positionals: string[];
  flags: Record<string, FlagValue>;
}

function toNumber(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new UsageError(`flag --${name} expects a number, got "${value}"`);
  return n;
}

export function parseArgs(argv: string[], specs: FlagSpecs): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = {};
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.default !== undefined) flags[name] = spec.default;
  }

  let i = 0;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (tok === "-h") {
      flags.help = true;
      i++;
      continue;
    }
    if (tok.startsWith("--")) {
      let name = tok.slice(2);
      let inline: string | undefined;
      const eq = name.indexOf("=");
      if (eq >= 0) {
        inline = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      let spec = specs[name];
      if (!spec && name.startsWith("no-")) {
        const base = name.slice(3);
        if (specs[base]?.type === "boolean") {
          flags[base] = false;
          i++;
          continue;
        }
      }
      if (!spec) throw new UsageError(`unknown flag --${name} (run with --help to see valid flags)`);
      if (spec.type === "boolean") {
        flags[name] = inline === undefined ? true : inline !== "false";
      } else {
        let value = inline;
        if (value === undefined) {
          value = argv[++i];
          if (value === undefined) throw new UsageError(`flag --${name} requires a value`);
        }
        flags[name] = spec.type === "number" ? toNumber(name, value) : value;
      }
      i++;
      continue;
    }
    positionals.push(tok);
    i++;
  }

  if (flags.help !== true) {
    for (const [name, spec] of Object.entries(specs)) {
      if (spec.required && flags[name] === undefined) {
        throw new UsageError(`missing required flag --${name}`);
      }
    }
  }
  return { positionals, flags };
}

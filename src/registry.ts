import type { FlagSpecs, Parsed } from "./args.js";
import type { Ctx } from "./context.js";
import { UsageError } from "./errors.js";

export interface Positional {
  name: string;
  required?: boolean;
  description: string;
}

export interface Command {
  path: string[];
  summary: string;
  description?: string;
  positionals?: Positional[];
  flags?: FlagSpecs;
  examples?: string[];
  run(ctx: Ctx, args: Parsed): Promise<void>;
}

export const GLOBAL_FLAGS: FlagSpecs = {
  json: { type: "boolean", description: "Force JSON output (the default when stdout is not a TTY)" },
  plain: { type: "boolean", description: "Force human-readable output even when piped" },
  "base-url": { type: "string", valueName: "url", description: "API origin (default https://api.launchy.live)" },
  "api-key": { type: "string", valueName: "key", description: "API key (overrides config file and LAUNCHY_API_KEY)" },
  token: { type: "string", valueName: "jwt", description: "User bearer token (overrides config file and LAUNCHY_TOKEN)" },
  timeout: { type: "number", valueName: "secs", description: "Per-request timeout in seconds (default 30)" },
  color: { type: "boolean", description: "Colorized output; disable with --no-color or NO_COLOR" },
  quiet: { type: "boolean", description: "Suppress informational notes on stderr" },
  help: { type: "boolean", description: "Show help for the command" },
};

export const ALIASES: Record<string, string[]> = {
  ls: ["launches", "list"],
  next: ["launches", "next"],
  login: ["auth", "login"],
  logout: ["auth", "logout"],
};

export interface Match {
  command?: Command;
  rest: string[];
  group?: string;
}

export function findCommand(commands: Command[], argvIn: string[]): Match {
  const argv = [...argvIn];
  const first = argv[0];
  if (first && ALIASES[first]) argv.splice(0, 1, ...ALIASES[first]!);

  for (const len of [2, 1]) {
    if (argv.length < len) continue;
    const command = commands.find(
      (c) => c.path.length === len && c.path.every((p, i) => p === argv[i]),
    );
    if (command) return { command, rest: argv.slice(len) };
  }
  const group =
    first && commands.some((c) => c.path[0] === first && c.path.length > 1) ? first : undefined;
  return { rest: argv, group };
}

export function checkPositionals(command: Command, parsed: Parsed): void {
  const required = (command.positionals ?? []).filter((p) => p.required);
  if (parsed.positionals.length < required.length) {
    const missing = required[parsed.positionals.length]!;
    throw new UsageError(
      `missing required argument <${missing.name}> — usage: launchy ${command.path.join(" ")} ${(command.positionals ?? [])
        .map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))
        .join(" ")}`.trim(),
    );
  }
}

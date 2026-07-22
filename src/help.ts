import { cliVersion } from "./cmd/meta.js";
import type { Ctx } from "./context.js";
import { colors } from "./output.js";
import { GLOBAL_FLAGS, type Command } from "./registry.js";

const GROUP_ORDER = ["launches", "visibility", "providers", "sites", "rockets", "boosters", "corrections", "me", "auth"];

function colorCtx(): Pick<Ctx, "color"> {
  return { color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR };
}

function flagLine(name: string, spec: (typeof GLOBAL_FLAGS)[string]): string {
  const value = spec.type === "boolean" ? "" : ` <${spec.valueName ?? spec.type}>`;
  return `  --${name}${value}`.padEnd(24) + spec.description;
}

export function printRootHelp(commands: Command[]): void {
  const c = colors(colorCtx());
  const lines: string[] = [];
  lines.push(c.bold(`launchy ${cliVersion()}`) + " — rocket launches from your terminal, for humans and agents");
  lines.push("");
  lines.push(c.bold("Usage"));
  lines.push("  launchy <command> [subcommand] [flags]");
  lines.push("");

  const groups = new Map<string, Command[]>();
  const singles: Command[] = [];
  for (const cmd of commands) {
    if (cmd.path.length === 1) {
      singles.push(cmd);
    } else {
      const list = groups.get(cmd.path[0]!) ?? [];
      list.push(cmd);
      groups.set(cmd.path[0]!, list);
    }
  }
  const orderedGroups = [
    ...GROUP_ORDER.filter((g) => groups.has(g)),
    ...[...groups.keys()].filter((g) => !GROUP_ORDER.includes(g)),
  ];
  lines.push(c.bold("Commands"));
  for (const group of orderedGroups) {
    for (const cmd of groups.get(group)!) {
      lines.push(`  ${cmd.path.join(" ").padEnd(22)}${cmd.summary}`);
    }
  }
  for (const cmd of singles) {
    lines.push(`  ${cmd.path.join(" ").padEnd(22)}${cmd.summary}`);
  }
  lines.push("");
  lines.push(c.bold("Shortcuts"));
  lines.push("  launchy next          → launches next");
  lines.push("  launchy ls            → launches list");
  lines.push("");
  lines.push(c.bold("Global flags"));
  for (const [name, spec] of Object.entries(GLOBAL_FLAGS)) lines.push(flagLine(name, spec));
  lines.push("");
  lines.push(c.bold("Environment"));
  lines.push("  LAUNCHY_API_KEY, LAUNCHY_TOKEN, LAUNCHY_BASE_URL, LAUNCHY_CONFIG_DIR, NO_COLOR");
  lines.push("");
  lines.push(c.bold("Start here"));
  lines.push("  launchy auth login            store credentials");
  lines.push("  launchy next                  the next launch, with countdown");
  lines.push("  launchy docs --json           machine-readable reference for agents");
  lines.push("");
  lines.push(c.dim("  <command> --help for details · JSON output is automatic when stdout is piped"));
  process.stdout.write(lines.join("\n") + "\n");
}

export function printGroupHelp(commands: Command[], group: string): void {
  const c = colors(colorCtx());
  const members = commands.filter((cmd) => cmd.path[0] === group);
  const lines: string[] = [c.bold(`launchy ${group}`) + " — subcommands", ""];
  for (const cmd of members) {
    lines.push(`  launchy ${cmd.path.join(" ").padEnd(24)}${cmd.summary}`);
  }
  lines.push("", c.dim(`  launchy ${group} <subcommand> --help for flags and examples`));
  process.stdout.write(lines.join("\n") + "\n");
}

export function printCommandHelp(cmd: Command): void {
  const c = colors(colorCtx());
  const lines: string[] = [];
  const positionals = (cmd.positionals ?? [])
    .map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))
    .join(" ");
  lines.push(c.bold(`launchy ${cmd.path.join(" ")}`) + ` — ${cmd.summary}`);
  lines.push("");
  lines.push(c.bold("Usage"));
  lines.push(`  ${["launchy", ...cmd.path, positionals, "[flags]"].filter(Boolean).join(" ")}`);
  if (cmd.description) {
    lines.push("");
    lines.push(cmd.description);
  }
  for (const p of cmd.positionals ?? []) {
    lines.push(`  ${(p.required ? `<${p.name}>` : `[${p.name}]`).padEnd(16)}${p.description}`);
  }
  const own = Object.entries(cmd.flags ?? {});
  if (own.length > 0) {
    lines.push("");
    lines.push(c.bold("Flags"));
    for (const [name, spec] of own) lines.push(flagLine(name, spec));
  }
  lines.push("");
  lines.push(c.bold("Global flags"));
  for (const [name, spec] of Object.entries(GLOBAL_FLAGS)) lines.push(flagLine(name, spec));
  if (cmd.examples && cmd.examples.length > 0) {
    lines.push("");
    lines.push(c.bold("Examples"));
    for (const ex of cmd.examples) lines.push(`  ${ex}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}

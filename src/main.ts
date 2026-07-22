#!/usr/bin/env node
import { parseArgs } from "./args.js";
import { authCommands } from "./cmd/auth.js";
import { launchCommands } from "./cmd/launches.js";
import { cliVersion, makeMetaCommands } from "./cmd/meta.js";
import { referenceCommands } from "./cmd/reference.js";
import { userCommands } from "./cmd/user.js";
import { buildCtx } from "./context.js";
import { ApiError, CliError, EXIT, UsageError } from "./errors.js";
import { printCommandHelp, printGroupHelp, printRootHelp } from "./help.js";
import { GLOBAL_FLAGS, checkPositionals, findCommand, type Command } from "./registry.js";

const commands: Command[] = [
  ...launchCommands,
  ...referenceCommands,
  ...userCommands,
  ...authCommands,
];
commands.push(...makeMetaCommands(() => commands));

function wantsJsonErrors(argv: string[]): boolean {
  if (argv.includes("--json")) return true;
  if (argv.includes("--plain")) return false;
  return !process.stdout.isTTY;
}

function renderError(err: unknown, jsonMode: boolean): number {
  if (err instanceof CliError) {
    if (jsonMode) {
      const payload: Record<string, unknown> = { code: err.code, message: err.message };
      if (err instanceof ApiError) {
        payload.status = err.status;
        if (err.retryAfterSeconds !== undefined) payload.retry_after_seconds = err.retryAfterSeconds;
      }
      process.stderr.write(JSON.stringify({ error: payload }, null, 2) + "\n");
    } else {
      process.stderr.write(`launchy: ${err.message} [${err.code}]\n`);
      if (err.code === "AUTH_REQUIRED" || err.code === "UNAUTHORIZED") {
        process.stderr.write("hint: run `launchy auth login`, or pass --api-key / --token\n");
      } else if (err instanceof ApiError && err.status === 429) {
        process.stderr.write(
          `hint: rate limited${err.retryAfterSeconds !== undefined ? ` — retry after ${err.retryAfterSeconds}s` : ""}\n`,
        );
      } else if (err.code === "NETWORK") {
        process.stderr.write("hint: check connectivity or --base-url\n");
      }
    }
    return err.exitCode;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (jsonMode) {
    process.stderr.write(JSON.stringify({ error: { code: "INTERNAL", message } }, null, 2) + "\n");
  } else {
    process.stderr.write(`launchy: unexpected error: ${message}\n`);
  }
  return EXIT.ERROR;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    printRootHelp(commands);
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    process.stdout.write(cliVersion() + "\n");
    return;
  }
  if (argv[0] === "help") {
    const rest = argv.slice(1);
    if (rest.length === 0) {
      printRootHelp(commands);
      return;
    }
    rest.push("--help");
    argv.splice(0, argv.length, ...rest);
  }

  const { command, rest, group } = findCommand(commands, argv);
  if (!command) {
    if (group) {
      printGroupHelp(commands, group);
      return;
    }
    throw new UsageError(`unknown command "${argv[0]}" — run \`launchy help\``);
  }

  const parsed = parseArgs(rest, { ...GLOBAL_FLAGS, ...(command.flags ?? {}) });
  if (parsed.flags.help === true) {
    printCommandHelp(command);
    return;
  }
  checkPositionals(command, parsed);
  const ctx = buildCtx(parsed.flags);
  await command.run(ctx, parsed);
}

main().catch((err) => {
  process.exitCode = renderError(err, wantsJsonErrors(process.argv.slice(2)));
});

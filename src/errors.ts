export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  RATE_LIMITED: 5,
  NETWORK: 6,
} as const;

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, exitCode: number = EXIT.ERROR, details?: unknown) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super("USAGE", message, EXIT.USAGE);
    this.name = "UsageError";
  }
}

export class ApiError extends CliError {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    exitCode: number,
    details?: unknown,
    retryAfterSeconds?: number,
  ) {
    super(code, message, exitCode, details);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "SERVER_ERROR" : "HTTP_ERROR";
  }
}

export function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 429) return EXIT.RATE_LIMITED;
  return EXIT.ERROR;
}

/** An error whose message is safe and useful to show the user verbatim. */
export class CliError extends Error {
  readonly exitCode: number;
  readonly hint: string | undefined;

  constructor(
    message: string,
    options: { exitCode?: number; hint?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'CliError';
    this.exitCode = options.exitCode ?? 1;
    this.hint = options.hint;
  }
}

export const isCliError = (value: unknown): value is CliError => value instanceof CliError;

/** Throws a CliError. Returns `never` so it can be used in expression position. */
export function fail(
  message: string,
  options?: { exitCode?: number; hint?: string; cause?: unknown },
): never {
  throw new CliError(message, options);
}

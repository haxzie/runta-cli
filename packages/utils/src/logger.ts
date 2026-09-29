import { colorEnabled } from './color.js';

const LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LEVELS)[number];

export interface Logger {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  /**
   * A completed outcome, on **stdout**.
   *
   * Everything else here is commentary and goes to stderr, which is the right default — it keeps
   * a pipe clean. But a terminal that colours stderr red then renders a successful login entirely
   * in red, so the one thing the user is waiting to read looks like the thing that went wrong.
   * Success is a result, and results belong on stdout.
   *
   * Only ever reached on the human path: every command returns early under `--json`, so this can
   * never interleave with a payload a caller is parsing.
   */
  success(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

const rank = (level: LogLevel): number => LEVELS.indexOf(level);

const paint = (code: string, text: string): string =>
  colorEnabled(process.stderr) ? `\x1b[${code}m${text}\x1b[0m` : text;

export interface LevelledLogger extends Logger {
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}

export function createLogger(initialLevel: LogLevel = 'info'): LevelledLogger {
  let level: LogLevel = initialLevel;
  const enabled = (want: LogLevel): boolean => rank(level) >= rank(want);

  return {
    setLevel(next: LogLevel) {
      level = next;
    },
    getLevel() {
      return level;
    },
    error(...args: unknown[]) {
      if (enabled('error')) console.error(paint('31', 'error'), ...args);
    },
    success(...args: unknown[]) {
      // Gated at `info` with the rest: RUNTA_LOG_LEVEL=silent means silent, not "silent except
      // the good news".
      if (enabled('info')) console.log(...args);
    },
    warn(...args: unknown[]) {
      if (enabled('warn')) console.error(paint('33', 'warn'), ...args);
    },
    info(...args: unknown[]) {
      if (enabled('info')) console.error(...args);
    },
    debug(...args: unknown[]) {
      if (enabled('debug')) console.error(paint('90', 'debug'), ...args);
    },
  };
}

/** Shared process-wide logger. Diagnostics go to stderr so stdout stays pipeable; see `success`. */
export const logger = createLogger((process.env.RUNTA_LOG_LEVEL as LogLevel | undefined) ?? 'info');

export const setLogLevel = (level: LogLevel): void => {
  logger.setLevel(level);
};

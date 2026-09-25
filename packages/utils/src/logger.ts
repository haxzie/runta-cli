const LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LEVELS)[number];

export interface Logger {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

const rank = (level: LogLevel): number => LEVELS.indexOf(level);

/** Honours NO_COLOR and non-TTY stderr, so piped output stays clean. */
const colorEnabled = (): boolean =>
  !process.env.NO_COLOR && Boolean(process.stderr.isTTY) && process.env.TERM !== 'dumb';

const paint = (code: string, text: string): string =>
  colorEnabled() ? `\x1b[${code}m${text}\x1b[0m` : text;

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

/** Shared process-wide logger. All diagnostics go to stderr so stdout stays pipeable. */
export const logger = createLogger((process.env.RUNTA_LOG_LEVEL as LogLevel | undefined) ?? 'info');

export const setLogLevel = (level: LogLevel): void => {
  logger.setLevel(level);
};

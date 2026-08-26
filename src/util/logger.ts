/** Minimal leveled logger. Quiet by default so JSON output stays pipeable. */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let current: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  current = level;
}

function emit(level: Exclude<LogLevel, "silent">, prefix: string, args: unknown[]): void {
  if (ORDER[current] < ORDER[level]) return;
  // Diagnostics go to stderr so `litix run --json > out.json` stays valid.
  console.error(prefix, ...args);
}

export const log = {
  error: (...args: unknown[]) => emit("error", "✗", args),
  warn: (...args: unknown[]) => emit("warn", "!", args),
  info: (...args: unknown[]) => emit("info", "·", args),
  debug: (...args: unknown[]) => emit("debug", "  ", args),
};

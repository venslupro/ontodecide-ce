/**
 * @fileoverview Single-line JSON logging for Workers Logs. Never log
 * attribute values or PII.
 */

/** Log severity. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured logger. */
export interface Logger {
  log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

/** Creates a JSON logger bound to base fields (e.g. service name). */
export function createLogger(base: Record<string, unknown> = {}): Logger {
  const log = (
    level: LogLevel,
    msg: string,
    fields: Record<string, unknown> = {},
  ): void => {
    const line = JSON.stringify({
      level,
      msg,
      ts: new Date().toISOString(),
      ...base,
      ...fields,
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    log,
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
    child: f => createLogger({...base, ...f}),
  };
}

/** Logger that discards everything; for tests. */
export const silentLogger: Logger = {
  log: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
  trace(fields: LogFields, message: string): void;
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  child(fields: LogFields): Logger;
}

export const noopLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};

export interface LogRecord {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  fields: LogFields;
  message: string;
}

export class CapturingLogger implements Logger {
  readonly records: LogRecord[] = [];

  private constructor(private readonly bindings: LogFields = {}) {}

  static create(bindings: LogFields = {}): CapturingLogger {
    return new CapturingLogger(bindings);
  }

  private push(level: LogRecord['level'], fields: LogFields, message: string): void {
    this.records.push({ level, fields: { ...this.bindings, ...fields }, message });
  }

  trace(fields: LogFields, message: string): void {
    this.push('trace', fields, message);
  }

  debug(fields: LogFields, message: string): void {
    this.push('debug', fields, message);
  }

  info(fields: LogFields, message: string): void {
    this.push('info', fields, message);
  }

  warn(fields: LogFields, message: string): void {
    this.push('warn', fields, message);
  }

  error(fields: LogFields, message: string): void {
    this.push('error', fields, message);
  }

  child(fields: LogFields): Logger {
    return new CapturingLogger({ ...this.bindings, ...fields });
  }
}

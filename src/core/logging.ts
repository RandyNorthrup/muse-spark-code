// The logging surface core modules accept. src/host/logger.ts satisfies it
// structurally (with secret redaction); tests pass a recording fake.

export interface CoreLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

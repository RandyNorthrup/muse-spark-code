import type { CoreLogger } from '../../../src/core/logging'

/** A core logger that keeps every line it was given, at any level. */
export function recordingLogger(): CoreLogger & { readonly lines: string[] } {
  const lines: string[] = []
  const record = (line: string) => {
    lines.push(line)
  }
  return { lines, trace: record, info: record, warn: record, error: record }
}

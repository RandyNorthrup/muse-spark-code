// Display-only argument prefixes. The existing Responses parser owns the
// wire boundary; this accumulator cannot execute, approve or replay a call.
import type { ToolArgumentPreview } from '../../../shared/agentEvents'
import { TOOL_ARGUMENT_PREVIEW_MAX_CHARS } from '../../../shared/constants'
import { redactableSlices, redactSecrets } from '../../../shared/redact'

/** Structural projection of M95's ModelCapabilityRecord; lane W binds its resolver. */
export interface ArgumentPreviewCapabilities {
  readonly tools: {
    readonly streamingArguments:
      { readonly state: 'yes'; readonly value: true } | { readonly state: 'no' | 'unknown' }
  }
}

/**
 * Decode JSON strings before scrubbing: escaped newlines and Unicode must
 * not hide credentials. An unfinished string releases only complete safe
 * lines, withholding split tokens and credential introducers across deltas.
 */
function displayPrefix(raw: string): string {
  let text = ''
  let at = 0
  while (at < raw.length) {
    if (raw[at] !== '"') {
      text += raw.charAt(at)
      at += 1
      continue
    }
    const start = at
    at += 1
    at = stringEnd(raw, at)
    const isClosed = raw[at] === '"'
    const encoded = raw.slice(start, isClosed ? at + 1 : at)
    let value: unknown
    try {
      value = JSON.parse(isClosed ? encoded : `${encoded}"`)
    } catch {
      // Invalid or incomplete escapes disclose no part of this string.
      return text
    }
    if (typeof value !== 'string') return text
    if (!isClosed) {
      const slices = redactableSlices(value, 1)
      return `${text}"${slices.slice(0, -1).join('')}`
    }
    text += `"${value}"`
    at += 1
  }
  return text
}

/** Stop before a closing quote or an incomplete escape, respecting escaped quotes. */
function stringEnd(raw: string, start: number): number {
  let at = start
  while (at < raw.length && raw[at] !== '"') {
    // JSON's Unicode escape has six characters, including its slash.
    const width = raw[at] === '\\' ? (raw[at + 1] === 'u' ? String.raw`\u0000`.length : 2) : 1
    if (at + width > raw.length) return at
    at += width
  }
  return at
}

export class ArgumentPreview {
  private raw = ''
  private truncated = false
  private done = false

  public append(delta: string): ToolArgumentPreview {
    if (!this.done) {
      const remaining = TOOL_ARGUMENT_PREVIEW_MAX_CHARS - this.raw.length
      this.truncated ||= delta.length > remaining
      this.raw += delta.slice(0, remaining)
    }
    return this.snapshot()
  }

  /** The done payload is authoritative; it still supplies display data only. */
  public finish(args: string): ToolArgumentPreview {
    this.raw = args.slice(0, TOOL_ARGUMENT_PREVIEW_MAX_CHARS)
    this.truncated = args.length > TOOL_ARGUMENT_PREVIEW_MAX_CHARS
    this.done = true
    return this.snapshot()
  }

  public snapshot(): ToolArgumentPreview {
    // Scrub before the display bound, so clipping cannot expose a token's prefix.
    const text = redactSecrets(displayPrefix(redactSecrets(this.raw)))
    return {
      text: text.slice(0, TOOL_ARGUMENT_PREVIEW_MAX_CHARS),
      truncated: this.truncated || text.length > TOOL_ARGUMENT_PREVIEW_MAX_CHARS,
    }
  }
}

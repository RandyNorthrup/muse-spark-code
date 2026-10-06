// Display-only argument prefixes. The existing Responses parser owns the
// wire boundary; this accumulator cannot execute, approve or replay a call.
import type { ToolArgumentPreview } from '../../../shared/agentEvents'
import { REDACTED_MARK, TOOL_ARGUMENT_PREVIEW_MAX_CHARS } from '../../../shared/constants'
import { redactableSlices, redactSecrets } from '../../../shared/redact'

/** Structural projection of M95's ModelCapabilityRecord; lane W binds its resolver. */
export interface ArgumentPreviewCapabilities {
  readonly tools: {
    readonly streamingArguments:
      { readonly state: 'yes'; readonly value: true } | { readonly state: 'no' | 'unknown' }
  }
}

interface Container {
  readonly kind: 'object' | 'array'
  readonly withheld: boolean
  isKey: boolean
  sensitive: boolean
}

interface OpenString {
  readonly isKey: boolean
  readonly sensitive: boolean
  value: string
  escape: string
}

/** Use M84's field rules on decoded, normalized names without duplicating its list. */
function isSensitiveKey(key: string): boolean {
  const probe = `${JSON.stringify(key.normalize('NFKC').toLowerCase())}:"1"`
  return redactSecrets(probe) !== probe
}

/** Incremental JSON tokenization; open sensitive values never enter display text. */
export class ArgumentPreview {
  private text = ''
  private readonly containers: Container[] = []
  private string: OpenString | undefined
  private scalar = false
  private retained = 0
  private truncated = false
  private done = false
  private invalid = false

  public constructor(private readonly literals: readonly string[] = []) {}

  private advanceString(string: OpenString, character: string): void {
    if (string.escape !== '') {
      string.escape += character
      // Decode a complete escape only; the Unicode spelling includes its slash.
      if (string.escape === String.raw`\u`) return
      if (
        string.escape.startsWith(String.raw`\u`) &&
        string.escape.length < String.raw`\u0000`.length
      )
        return
      try {
        const decoded: unknown = JSON.parse(`"${string.escape}"`)
        if (typeof decoded !== 'string') {
          this.invalid = true
          return
        }
        if (!string.sensitive) string.value += decoded
        string.escape = ''
      } catch {
        this.invalid = true
      }
    } else if (character === '\\') {
      string.escape = character
    } else if (character === '"') {
      if (string.isKey && !string.sensitive) {
        const container = this.containers.at(-1)
        if (container !== undefined) container.sensitive = isSensitiveKey(string.value)
      }
      if (this.containers.at(-1)?.withheld !== true)
        this.text += `"${string.sensitive ? REDACTED_MARK : string.value}"`
      this.string = undefined
    } else if (character < ' ') {
      this.invalid = true
    } else if (!string.sensitive) {
      string.value += character
    }
  }

  public append(delta: string): void {
    if (this.done) return
    const remaining = TOOL_ARGUMENT_PREVIEW_MAX_CHARS - this.retained
    this.truncated ||= delta.length > remaining
    const added = delta.slice(0, remaining)
    this.retained += added.length
    for (const character of added) {
      if (this.invalid) break
      const string = this.string
      if (string !== undefined) {
        this.advanceString(string, character)
        continue
      }
      const container = this.containers.at(-1)
      const isWithheld = container?.withheld === true
      const isSensitive = isWithheld || (container?.isKey === false && container.sensitive)
      if (character === '"') {
        this.scalar = false
        this.string = {
          isKey: container?.isKey === true,
          sensitive: isSensitive,
          value: '',
          escape: '',
        }
      } else {
        if (character === '{' || character === '[') {
          this.scalar = false
          if (!isWithheld) this.text += isSensitive ? `"${REDACTED_MARK}"` : character
          this.containers.push({
            kind: character === '{' ? 'object' : 'array',
            withheld: isSensitive,
            isKey: character === '{',
            sensitive: false,
          })
        } else if (character === '}' || character === ']') {
          this.scalar = false
          this.containers.pop()
          if (!isWithheld) this.text += character
        } else if (character === ':' && container?.kind === 'object') {
          container.isKey = false
          if (!isWithheld) this.text += character
        } else if (character === ',' && container !== undefined) {
          this.scalar = false
          container.isKey = container.kind === 'object'
          container.sensitive = false
          if (!isWithheld) this.text += character
        } else if (!isSensitive) {
          this.text += character
        } else if (!isWithheld && !this.scalar && character.trim() !== '') {
          this.text += `"${REDACTED_MARK}"`
          this.scalar = true
        }
      }
    }
  }

  /** The done payload is authoritative; it still supplies display data only. */
  public finish(args: string): void {
    this.text = ''
    this.containers.length = 0
    this.string = undefined
    this.scalar = false
    this.retained = 0
    this.truncated = false
    this.invalid = false
    this.done = false
    this.append(args)
    this.done = true
  }

  public snapshot(): ToolArgumentPreview {
    let decoded = this.text
    const string = this.string
    if (string !== undefined && !this.invalid && !string.sensitive && !string.isKey) {
      // Withhold the unfinished line and any incomplete escape. M84's safe
      // cuts also hold bearer introducers and PEM blocks across line breaks.
      // A registered literal may cross an otherwise safe line boundary.
      const slices = this.literals.some((literal) => literal.includes('\n'))
        ? []
        : redactableSlices(string.value, 1)
      decoded += `"${slices.slice(0, -1).join('')}`
    }
    // Exact registered values precede M84 patterns, on decoded text only.
    let text = redactSecrets(decoded, this.literals)
    if (!this.done) {
      // Even outside strings, a trailing prefix may become a registered
      // literal on the next frame. Keep it private until it is disambiguated.
      let end = text.length
      for (const literal of this.literals) {
        if (literal === '') continue
        let at = text.indexOf(literal.charAt(0), Math.max(0, text.length - literal.length + 1))
        while (at !== -1 && at < end) {
          if (literal.startsWith(text.slice(at))) {
            end = at
          }
          at = text.indexOf(literal.charAt(0), at + 1)
        }
      }
      text = text.slice(0, end)
    }
    return {
      text: text.slice(0, TOOL_ARGUMENT_PREVIEW_MAX_CHARS),
      truncated: this.truncated || text.length > TOOL_ARGUMENT_PREVIEW_MAX_CHARS,
    }
  }
}

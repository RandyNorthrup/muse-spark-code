// Display-only arguments. The Responses parser owns the wire boundary;
// this accumulator cannot execute, approve or replay a call.
import { Buffer } from 'node:buffer'
import type { ToolArgumentPreview } from '../../../shared/agentEvents'
import {
  TOOL_ARGUMENT_PREVIEW_MAX_CHARS,
  TOOL_ARGUMENT_PREVIEW_MAX_DEPTH,
} from '../../../shared/constants'
import { redactSecrets } from '../../../shared/redact'

/** Structural projection of M95's ModelCapabilityRecord; lane W binds its resolver. */
export interface ArgumentPreviewCapabilities {
  readonly tools: {
    readonly streamingArguments:
      { readonly state: 'yes'; readonly value: true } | { readonly state: 'no' | 'unknown' }
  }
}

type Expected = 'keyOrEnd' | 'key' | 'colon' | 'valueOrEnd' | 'value' | 'commaOrEnd'
interface Container {
  readonly kind: 'object' | 'array'
  readonly keys: Set<string>
  expected: Expected
}
interface OpenString {
  readonly isKey: boolean
  raw: string
  escape: number
}
const SCALAR = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/
const WHITESPACE = /^[\t\n\r ]$/
const HEX = /^[\da-f]$/i

/** Incremental JSON grammar; only declared, completed top-level strings can enter text. */
export class ArgumentPreview {
  private text = ''
  private readonly containers: Container[] = []
  private string: OpenString | undefined
  private scalar = ''
  private field: string | undefined
  private retained = 0
  private bytes = 0
  private truncated = false
  private done = false
  private invalid = false
  private started = false
  private closed = false
  private highSurrogate = false

  public constructor(
    private readonly previewFields: readonly string[] = [],
    private readonly literals: readonly string[] = [],
  ) {}

  private valueEnded(): void {
    const container = this.containers.at(-1)
    if (container !== undefined) container.expected = 'commaOrEnd'
  }

  private advanceString(token: OpenString, character: string): void {
    token.raw += character
    if (token.escape < 0) {
      if (!HEX.test(character)) this.invalid = true
      token.escape += 1
    } else if (token.escape === 1) {
      if (character === 'u') token.escape = -'0000'.length
      else {
        if (!String.raw`"\/bfnrt`.includes(character)) this.invalid = true
        token.escape = 0
      }
    } else if (character === '\\') {
      token.escape = 1
    } else if (character === '"') {
      try {
        const value: unknown = JSON.parse(token.raw)
        if (typeof value !== 'string') {
          this.invalid = true
          return
        }
        const container = this.containers.at(-1)
        if (container === undefined) {
          this.invalid = true
          return
        }
        if (token.isKey) {
          if (container.keys.has(value)) {
            this.invalid = true
            return
          }
          container.keys.add(value)
          container.expected = 'colon'
          if (this.containers.length === 1) {
            this.field = this.previewFields.includes(value) ? value : undefined
            if (this.previewFields.length > 0) {
              this.text += `${this.text === '' ? '' : '\n'}${this.field === undefined ? '…' : JSON.stringify(this.field)}: …`
            }
          }
        } else {
          if (this.containers.length === 1 && this.field !== undefined) {
            // Scrub the complete decoded string before formatting or clipping.
            const safe = redactSecrets(value, this.literals)
            this.text = this.text.slice(0, -1) + JSON.stringify(safe)
          }
          this.valueEnded()
        }
        this.string = undefined
      } catch {
        this.invalid = true
      }
    } else if (character < ' ') {
      this.invalid = true
    }
  }

  private advance(character: string): void {
    if (this.string !== undefined) {
      this.advanceString(this.string, character)
      return
    }
    if (this.scalar !== '') {
      if (!WHITESPACE.test(character) && !',}]'.includes(character)) {
        this.scalar += character
        return
      }
      if (!SCALAR.test(this.scalar)) {
        this.invalid = true
        return
      }
      this.scalar = ''
      this.valueEnded()
    }
    if (WHITESPACE.test(character)) return
    if (!this.started) {
      if (character !== '{') {
        this.invalid = true
        return
      }
      this.started = true
      this.containers.push({ kind: 'object', keys: new Set(), expected: 'keyOrEnd' })
      return
    }
    const container = this.containers.at(-1)
    if (container === undefined) {
      this.invalid = true
      return
    }
    const expected = container.expected
    if (character === '}' || character === ']') {
      const isMatches = character === (container.kind === 'object' ? '}' : ']')
      if (!isMatches || !['keyOrEnd', 'valueOrEnd', 'commaOrEnd'].includes(expected)) {
        this.invalid = true
        return
      }
      this.containers.pop()
      this.closed = this.containers.length === 0
      this.valueEnded()
    } else
      switch (expected) {
        case 'key':
        case 'keyOrEnd': {
          if (character === '"') {
            this.string = { isKey: true, raw: '"', escape: 0 }
          } else {
            this.invalid = true
          }

          break
        }
        case 'colon': {
          if (character === ':') {
            container.expected = 'value'
          } else {
            this.invalid = true
          }

          break
        }
        case 'commaOrEnd': {
          if (character === ',') {
            container.expected = container.kind === 'object' ? 'key' : 'value'
          } else {
            this.invalid = true
          }

          break
        }
        default: {
          if (character !== '"' && this.containers.length === 1 && this.field !== undefined) {
            this.invalid = true
          } else if (character === '"') {
            this.string = { isKey: false, raw: '"', escape: 0 }
          } else if (character === '{' || character === '[') {
            if (this.containers.length >= TOOL_ARGUMENT_PREVIEW_MAX_DEPTH) this.invalid = true
            else
              this.containers.push({
                kind: character === '{' ? 'object' : 'array',
                keys: new Set(),
                expected: character === '{' ? 'keyOrEnd' : 'valueOrEnd',
              })
          } else if (/^[\dtfn-]$/.test(character)) {
            this.scalar = character
          } else {
            this.invalid = true
          }
        }
      }
  }

  public append(delta: string): void {
    if (this.done) return
    // A surrogate pair split between deltas is four UTF-8 bytes, not six.
    const isJoinsPair = this.highSurrogate && /^[\uDC00-\uDFFF]/.test(delta)
    this.bytes += Buffer.byteLength(delta) - (isJoinsPair ? 2 : 0)
    if (delta !== '') this.highSurrogate = /[\uD800-\uDBFF]$/.test(delta)
    const remaining = TOOL_ARGUMENT_PREVIEW_MAX_CHARS - this.retained
    this.truncated ||= delta.length > remaining
    const added = delta.slice(0, remaining)
    this.retained += added.length
    for (const character of added) {
      if (this.invalid) break
      this.advance(character)
    }
  }

  /** Complete arguments are authoritative, but never bypass the allowlist or scrub. */
  public finish(args: string): void {
    try {
      const value: unknown = JSON.parse(args)
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError('Expected an argument object')
    } catch {
      this.invalid = true
      this.bytes = Buffer.byteLength(args)
      this.done = true
      return
    }
    this.text = ''
    this.containers.length = 0
    this.string = undefined
    this.scalar = ''
    this.field = undefined
    this.retained = 0
    this.bytes = 0
    this.truncated = false
    this.invalid = false
    this.started = false
    this.closed = false
    this.highSurrogate = false
    this.done = false
    this.append(args)
    this.done = true
  }

  public snapshot(): ToolArgumentPreview {
    return {
      text: this.text.slice(0, TOOL_ARGUMENT_PREVIEW_MAX_CHARS),
      truncated: this.truncated || this.text.length > TOOL_ARGUMENT_PREVIEW_MAX_CHARS,
      bytes: this.bytes,
      frozen: this.invalid || (this.done && !this.closed),
    }
  }
}

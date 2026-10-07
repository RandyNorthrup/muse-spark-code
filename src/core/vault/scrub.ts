import { Buffer } from 'node:buffer'
import { REDACTED_MARK, VAULT_BASE64_GROUP_CHARS, VAULT_LIMITS } from '../../shared/constants'
import type { SecretScrubPort } from '../../shared/redact'

const HEX_RADIX = 16
const BMP_MAX = 0xff_ff
const ASCII_LIMIT = 128

interface Node {
  readonly edges: Map<number, number>
  fail: number
  length: number
  depth: number
  dense?: Uint32Array
}

/** Every known encoding, including the fixed interior of all base64 alignments. */
function forms(value: Uint8Array): Buffer[] {
  const raw = Buffer.alloc(value.length)
  const patterns: Buffer[] = []
  try {
    raw.set(value)
    const text = raw.toString('utf8')
    const encoded: string[] = [
      text,
      JSON.stringify(text).slice(1, -1),
      raw.toString('hex'),
      raw.toString('hex').toUpperCase(),
      raw.toString('base64'),
      raw.toString('base64url'),
      Array.from(raw, (byte) => `%${byte.toString(HEX_RADIX).padStart(2, '0')}`).join(''),
      Array.from(raw, (byte) => `%${byte.toString(HEX_RADIX).padStart(2, '0').toUpperCase()}`).join(
        '',
      ),
      encodeURIComponent(text),
      encodeURIComponent(text).replaceAll(/%[\dA-F]{2}/g, (part) => part.toLowerCase()),
    ]
    for (const offset of [0, 1, 2]) {
      const aligned = Buffer.alloc(offset + raw.length)
      try {
        aligned.set(raw, offset)
        const start = Math.ceil(
          (offset * VAULT_BASE64_GROUP_CHARS) / (VAULT_BASE64_GROUP_CHARS - 1),
        )
        const end = Math.floor(
          (aligned.length * VAULT_BASE64_GROUP_CHARS) / (VAULT_BASE64_GROUP_CHARS - 1),
        )
        for (const encoding of ['base64', 'base64url'] as const) {
          encoded.push(aligned.toString(encoding).slice(start, end))
        }
      } finally {
        aligned.fill(0)
      }
    }
    const unique = new Set(encoded.filter((form) => form !== ''))
    for (const form of unique) {
      const bytes = Buffer.alloc(Buffer.byteLength(form))
      patterns.push(bytes)
      bytes.write(form)
    }
    return patterns
  } catch (error: unknown) {
    for (const pattern of patterns) pattern.fill(0)
    throw error
  } finally {
    raw.fill(0)
  }
}

// Ignore line breaks and ANSI control sequences while matching, but retain
// their original positions in output. A value split across lines/colour runs
// therefore occupies one redacted span. Ordinary unmatched text is unchanged.
const ESCAPE = '\u{1B}'
const BELL = '\u{7}'
const ANSI = new RegExp(
  String.raw`${ESCAPE}(?:\[[0-?]*[ -/]*[@-~]|\][^${BELL}${ESCAPE}]*(?:${BELL}|${ESCAPE}\\))`,
)
const ANSI_START = new RegExp(`^(?:${ANSI.source})`)
const DECORATION = new RegExp(`${ANSI.source}|[\r\n]`, 'g')

/** Broker/feeder only: the trie holds code-point edges, no retained plaintext strings. */
export class VaultScrubber {
  private readonly nodes: Node[] = [{ edges: new Map(), fail: 0, length: 0, depth: 0 }]
  private maxLength = 0
  private isDisposed = false

  public constructor(values: readonly Uint8Array[]) {
    try {
      for (const value of values) {
        const patterns = forms(value)
        try {
          for (const pattern of patterns) this.insert(pattern)
        } finally {
          for (const pattern of patterns) pattern.fill(0)
        }
      }
      const queue = [...(this.nodes[0]?.edges.values() ?? [])]
      let cursor = 0
      while (cursor < queue.length) {
        const state = queue[cursor]
        cursor += 1
        const node = state === undefined ? undefined : this.nodes[state]
        if (node === undefined) continue
        for (const [byte, next] of node.edges) {
          queue.push(next)
          let fail = node.fail
          while (fail !== 0 && !this.nodes[fail]?.edges.has(byte)) {
            fail = this.nodes[fail]?.fail ?? 0
          }
          const child = this.nodes[next]
          if (child === undefined) continue
          child.fail = this.nodes[fail]?.edges.get(byte) ?? 0
          child.length = Math.max(child.length, this.nodes[child.fail]?.length ?? 0)
        }
      }
      for (const node of this.nodes) {
        if (node.depth > 2) continue
        node.dense = new Uint32Array(ASCII_LIMIT)
        for (let byte = 0; byte < ASCII_LIMIT; byte += 1) {
          let candidate = node
          while (!candidate.edges.has(byte) && candidate.fail !== 0)
            candidate = this.nodes[candidate.fail] ?? candidate
          node.dense[byte] = candidate.edges.get(byte) ?? this.nodes[0]?.edges.get(byte) ?? 0
        }
      }
    } catch (error: unknown) {
      this.dispose()
      throw error
    }
  }

  private insert(pattern: Buffer): void {
    const text = pattern.toString('utf8').replaceAll(DECORATION, '')
    // Removing decoration must never turn a value into an empty success.
    if (text === '') throw new Error('Vault value has no matchable text')
    let state = 0
    let length = 0
    for (const char of text) {
      const byte = char.codePointAt(0) ?? 0
      const node = this.nodes[state]
      if (node === undefined) throw new Error('Invalid scrub automaton')
      let next = node.edges.get(byte)
      if (next === undefined) {
        next = this.nodes.length
        node.edges.set(byte, next)
        this.nodes.push({ edges: new Map(), fail: 0, length: 0, depth: node.depth + 1 })
      }
      state = next
      length += 1
    }
    const final = this.nodes[state]
    if (final !== undefined) final.length = Math.max(final.length, length)
    this.maxLength = Math.max(this.maxLength, length)
  }

  /** Internal streaming boundary: retain normalized suffixes and whole matched spans. */
  public scan(text: string, retain = 0): { text: string; cut: number } {
    if (this.isDisposed) throw new Error('Vault scrubber is disposed')
    DECORATION.lastIndex = 0
    let decoration = DECORATION.exec(text)
    const positions = new Float64Array(this.maxLength + 1)
    let seen = 0
    let state = 0
    let ring = 0
    const nodes = this.nodes
    let node = nodes[0]
    const spans: { start: number; end: number }[] = []
    for (let at = 0; at < text.length; at += 1) {
      if (decoration !== null && decoration.index === at) {
        at += decoration[0].length - 1
        decoration = DECORATION.exec(text)
        continue
      }
      positions[ring] = at
      const byte = text.codePointAt(at) ?? 0
      if (node?.dense !== undefined && byte < ASCII_LIMIT) state = node.dense[byte] ?? 0
      else {
        let next = node?.edges.get(byte)
        while (next === undefined && state !== 0) {
          state = node?.fail ?? 0
          node = nodes[state]
          next = node?.edges.get(byte)
        }
        state = next ?? 0
      }
      node = nodes[state]
      const length = node?.length ?? 0
      if (length > 0) {
        const start = positions[(ring - length + 1 + positions.length) % positions.length] ?? 0
        const last = spans.at(-1)
        if (last !== undefined && start <= last.end) {
          last.start = Math.min(last.start, start)
          last.end = at + (byte > BMP_MAX ? 2 : 1)
        } else spans.push({ start, end: at + (byte > BMP_MAX ? 2 : 1) })
      }
      seen += 1
      ring += 1
      if (ring === positions.length) ring = 0
      if (byte > BMP_MAX) at += 1
    }
    let cut = text.length
    if (retain > 0)
      cut =
        seen <= retain ? 0 : (positions[(ring - retain + positions.length) % positions.length] ?? 0)
    // A partial ANSI sequence must remain pending until its next write.
    if (retain > 0) {
      const escape = text.lastIndexOf(ESCAPE)
      if (escape !== -1 && escape < cut && !ANSI_START.test(text.slice(escape))) cut = escape
    }
    for (const span of spans) if (span.start < cut && span.end > cut) cut = span.start
    let from = 0
    let result = ''
    for (const span of spans) {
      if (span.end > cut) break
      result += text.slice(from, span.start) + REDACTED_MARK
      from = span.end
    }
    return { text: result + text.slice(from, cut), cut }
  }

  public scrub(text: string): string {
    return this.scan(text).text
  }

  /** One stream per output route: pending suffixes never cross commands. */
  public stream(): { push(text: string): string; finish(): string; dispose(): void } {
    let pending = ''
    let isEnded = false
    return {
      push: (text) => {
        if (isEnded) throw new Error('Vault scrub stream is closed')
        if (pending.length + text.length > VAULT_LIMITS.frameBytes) {
          pending = ''
          isEnded = true
          throw new Error('Vault scrub stream exceeded its buffer limit')
        }
        pending += text
        const scanned = this.scan(pending, this.maxLength)
        pending = pending.slice(scanned.cut)
        return scanned.text
      },
      finish: () => {
        if (isEnded) throw new Error('Vault scrub stream is closed')
        isEnded = true
        try {
          return this.scrub(pending)
        } finally {
          pending = ''
        }
      },
      dispose: () => {
        isEnded = true
        pending = ''
      },
    }
  }

  public dispose(): void {
    this.isDisposed = true
    for (const node of this.nodes) {
      node.edges.clear()
      node.dense?.fill(0)
      delete node.dense
      node.fail = 0
      node.length = 0
    }
    this.nodes.length = 0
    this.maxLength = 0
  }
}

/** One serialized owner; Lock invalidates late builds before they can install. */
export class VaultScrubService implements SecretScrubPort {
  private generation = 0
  private active: VaultScrubber | undefined
  private tail: Promise<void> = Promise.resolve()

  /** Loader transfers ownership of its bytes, wiped even after failure/cancellation. */
  public unlock(load: () => Promise<readonly Uint8Array[]>): Promise<void> {
    const generation = ++this.generation
    this.active?.dispose()
    this.active = undefined
    const previous = this.tail
    const build = (async () => {
      await previous
      let values: readonly Uint8Array[] = []
      let built: VaultScrubber | undefined
      try {
        values = await load()
        if (generation !== this.generation) throw new Error('Obsolete vault scrub build')
        built = new VaultScrubber(values)
        this.active = built
        built = undefined
      } finally {
        built?.dispose()
        for (const value of values) value.fill(0)
      }
    })()
    this.tail = (async () => {
      try {
        await build
      } catch {
        /* The caller receives failure; the queue remains usable. */
      }
    })()
    return build
  }

  public scrub(text: string): Promise<string> {
    return this.active === undefined
      ? Promise.reject(new Error('Vault scrub service is unavailable'))
      : Promise.resolve(this.active.scrub(text))
  }

  public lock(): void {
    this.generation += 1
    this.active?.dispose()
    this.active = undefined
  }
}

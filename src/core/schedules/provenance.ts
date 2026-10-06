import { createHash } from 'node:crypto'

export interface FileIdentity {
  readonly path: string
  readonly dev: string
  readonly ino: string
  readonly size: number
  readonly mtime: string
}

export type ContentSource =
  | { readonly kind: 'file'; readonly file: FileIdentity; readonly contentHash: string }
  | {
      readonly kind: 'skill'
      readonly id: string
      readonly version: string
      readonly file: FileIdentity
      readonly contentHash: string
    }
  | { readonly kind: 'tool'; readonly callId: string }
  | { readonly kind: 'harness'; readonly operation: string }

export type ProvenanceEntry = {
  readonly hash: string
  readonly source: ContentSource
} & (
  | { readonly class: 'pre-fire' }
  | { readonly class: 'decided'; readonly decisionId: string }
  | { readonly class: 'derived'; readonly derivedFrom: readonly string[] }
  | { readonly class: 'opaque'; readonly toolCallId: string | undefined }
)

export function contentHash(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** One fire's byte-addressed evidence; never serialized into session history. */
export class ProvenanceLedger {
  private readonly entries = new Map<string, ProvenanceEntry>()
  private readonly toolDecisions = new Set<string>()

  public constructor(preFire: Iterable<ProvenanceEntry> = []) {
    for (const entry of preFire) this.entries.set(entry.hash, { ...entry, class: 'pre-fire' })
  }

  private allowsHash(hash: string, visiting: Set<string>): boolean {
    const entry = this.entries.get(hash)
    if (entry === undefined || visiting.has(hash)) return false
    switch (entry.class) {
      case 'pre-fire':
      case 'decided': {
        return true
      }
      case 'opaque': {
        return entry.toolCallId !== undefined && this.toolDecisions.has(entry.toolCallId)
      }
      case 'derived': {
        if (entry.derivedFrom.length === 0) return false
        visiting.add(hash)
        const isAllowed = entry.derivedFrom.every((input) => this.allowsHash(input, visiting))
        visiting.delete(hash)
        return isAllowed
      }
    }
  }

  private put(entry: ProvenanceEntry): string {
    // Equal bytes may have multiple origins. Existing allowed evidence remains
    // valid; an opaque arrival cannot erase it or widen an unknown derivation.
    if (!this.allowsHash(entry.hash, new Set())) this.entries.set(entry.hash, entry)
    return entry.hash
  }
  public entry(bytes: string | Uint8Array): ProvenanceEntry | undefined {
    return this.entries.get(contentHash(bytes))
  }

  public preFire(bytes: string | Uint8Array, source: ContentSource): string {
    return this.put({ hash: contentHash(bytes), source, class: 'pre-fire' })
  }

  public decided(bytes: string | Uint8Array, source: ContentSource, decisionId: string): string {
    return this.put({ hash: contentHash(bytes), source, class: 'decided', decisionId })
  }

  public decideTool(callId: string): void {
    this.toolDecisions.add(callId)
  }

  public opaque(bytes: string | Uint8Array, callId?: string): string {
    return this.put({
      hash: contentHash(bytes),
      source: { kind: 'tool', callId: callId ?? '' },
      class: 'opaque',
      toolCallId: callId,
    })
  }

  public derive(bytes: string | Uint8Array, inputs: readonly string[], operation: string): string {
    // A derivation always records all inputs, including unknown/opaque ones.
    // An empty list is not evidence that content came from an allowed source.
    return this.put({
      hash: contentHash(bytes),
      source: { kind: 'harness', operation },
      class: 'derived',
      derivedFrom: [...inputs],
    })
  }

  public allows(bytes: string | Uint8Array): boolean {
    return this.allowsHash(contentHash(bytes), new Set())
  }
}

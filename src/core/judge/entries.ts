// The exact-action entry store (M98, D77): one entry per judged action,
// keyed by a hash of the backend, session, turn, tool and canonical
// arguments. Synchronous throughout: the fence reads the latch once and the
// read consumes the entry, so a result that arrives after its fence has
// passed finds no entry and is dropped, unused. No `vscode` import.

import { createHash } from 'node:crypto'

/** What identifies one judged action. */
export interface JudgeEntryParts {
  readonly backend: string
  readonly sessionId: string
  readonly turnId: string
  readonly tool: string
  /** The tool's canonical arguments (JSON values). */
  readonly args: unknown
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  return left > right ? 1 : 0
}

function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  switch (typeof value) {
    case 'boolean':
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new TypeError('judge entry args must be finite JSON values')
      }
      return JSON.stringify(value)
    }
    case 'string': {
      return JSON.stringify(value)
    }
    case 'undefined': {
      throw new TypeError('judge entry args must not contain undefined')
    }
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`
      }
      const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .toSorted(([left], [right]) => compareStrings(left, right))
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
    }
    default: {
      throw new TypeError('judge entry args must be JSON values')
    }
  }
}

/**
 * The entry key: the sha256 of the backend, session, turn, tool and
 * canonical arguments. Key order in `args` does not matter; a changed
 * argument is a different key.
 */
export function entryKey(parts: JudgeEntryParts): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        parts.backend,
        parts.sessionId,
        parts.turnId,
        parts.tool,
        canonicalJson(parts.args),
      ]),
    )
    .digest('hex')
}

/** What a settled entry said. */
export type JudgeReadyOutcome = 'caution' | 'none'

interface JudgeEntry {
  readonly sessionId: string
  readonly turnId: string
  /** undefined while pending or failed; an outcome once ready. */
  outcome: JudgeReadyOutcome | undefined
  settled: boolean
}

/**
 * Memory-only store of judged actions. Starting the same exact action
 * twice keeps the first entry; settling or reading an unknown, consumed or
 * discarded key does nothing and reports false/undefined, so a late result
 * can never be applied after its fence.
 */
export class JudgeEntryStore {
  private readonly entries = new Map<string, JudgeEntry>()

  get size(): number {
    return this.entries.size
  }

  /** Track one action as pending; returns its key. Idempotent. */
  start(parts: JudgeEntryParts): string {
    const key = entryKey(parts)
    if (!this.entries.has(key)) {
      this.entries.set(key, {
        sessionId: parts.sessionId,
        turnId: parts.turnId,
        outcome: undefined,
        settled: false,
      })
    }
    return key
  }

  /**
   * Settle a pending entry. Returns false — and changes nothing — for an
   * unknown, consumed or discarded key: a late result is dropped.
   */
  settle(key: string, outcome: JudgeReadyOutcome | 'failed'): boolean {
    const entry = this.entries.get(key)
    if (entry === undefined || entry.settled) {
      return false
    }
    entry.settled = true
    entry.outcome = outcome === 'failed' ? undefined : outcome
    return true
  }

  /**
   * Read the latch once, synchronously, and consume the entry: a ready
   * caution or none, or undefined for pending, failed or gone. The fence
   * reads exactly once; a second read — or any later settle — finds
   * nothing.
   */
  readLatch(key: string): JudgeReadyOutcome | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) {
      return undefined
    }
    this.entries.delete(key)
    return entry.outcome
  }

  /** Discard one entry: a cancelled action or a changed argument. */
  discard(key: string): boolean {
    return this.entries.delete(key)
  }

  /** Discard a replaced or finished turn's entries; returns the count. */
  discardTurn(sessionId: string, turnId: string): number {
    let discarded = 0
    for (const [key, entry] of this.entries) {
      if (entry.sessionId !== sessionId || entry.turnId !== turnId) {
        continue
      }
      this.entries.delete(key)
      discarded += 1
    }
    return discarded
  }

  /** Discard a replaced session's entries; returns the count. */
  discardSession(sessionId: string): number {
    let discarded = 0
    for (const [key, entry] of this.entries) {
      if (entry.sessionId !== sessionId) {
        continue
      }
      this.entries.delete(key)
      discarded += 1
    }
    return discarded
  }
}

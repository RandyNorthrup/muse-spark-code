// Per-message replay protection (M110d lane X2, D90.9): every frame over a
// pair carries the sender's next sequence number, and the receiver refuses
// a number it has seen or one older than the window. The window is the
// pair's own setting (node.json), never a default of ours: the guard takes
// it as a parameter. Forward jumps are accepted; only the past is bounded.
import * as z from 'zod/mini'

export const frameSequenceSchema = z.int().check(z.gte(0))

export type SequenceVerdict = 'ok' | 'duplicate' | 'too-old'

export interface SequenceGuard {
  /** The highest sequence accepted so far, or undefined before the first. */
  readonly highest: number | undefined
  accept(sequence: number): SequenceVerdict
}

export function createSequenceGuard(windowSize: number): SequenceGuard {
  if (!Number.isSafeInteger(windowSize) || windowSize < 1)
    throw new Error('the replay window is a positive whole number of messages')
  let highest: number | undefined
  const seen = new Set<number>()
  return {
    get highest() {
      return highest
    },
    accept(sequence: number): SequenceVerdict {
      const parsed = frameSequenceSchema.parse(sequence)
      if (highest !== undefined && parsed <= highest - windowSize) return 'too-old'
      if (seen.has(parsed)) return 'duplicate'
      if (highest === undefined || parsed > highest) {
        highest = parsed
        for (const old of seen) {
          if (old <= highest - windowSize) seen.delete(old)
        }
      }
      seen.add(parsed)
      return 'ok'
    },
  }
}

import { fingerprint } from '../../verify/fingerprint'

interface ToolIdentity {
  readonly name: string
  readonly arguments: string
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry: unknown) => canonical(entry))
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value)
          .toSorted(([left], [right]) => {
            if (left === right) return 0
            return left < right ? -1 : 1
          })
          .map(([key, entry]: [string, unknown]) => [key, canonical(entry)]),
      )
    : value
}

/** Object key order and insignificant JSON whitespace never distinguish two calls. */
export function toolRepeatKey(call: ToolIdentity): string {
  let args: string
  try {
    const parsed: unknown = JSON.parse(call.arguments)
    args = JSON.stringify(canonical(parsed))
  } catch {
    // Invalid JSON still belongs to the tool's validated refusal path.
    args = call.arguments
  }
  return JSON.stringify([call.name, args])
}

/**
Turn-local, consecutive results only; stores digests, never tool output
text. D121: no repeat bound of ours — the guard only names a repeat so the
person is told in plain words. The call always runs; only the person stops
the turn.
*/
export class RepeatGuard {
  private previous:
    | {
        readonly key: string
        readonly result: string
        readonly witness: string | undefined
        count: number
      }
    | undefined

  public reset(): void {
    this.previous = undefined
  }

  public needsWitness(call: ToolIdentity): boolean {
    // The witness read starts at the third identical call in a row; only it
    // proves the complete observable result is still unchanged.
    return this.previous?.key === toolRepeatKey(call) && this.previous.count >= 2
  }

  /**
  `'run'`, or the repeat count to tell the person when the same call keeps
  returning the same result. A witness must freshly prove the complete
  observable result is unchanged; anything else resets and runs.
  */
  public before(call: ToolIdentity, witness: string | undefined): 'run' | { repeat: number } {
    const previous = this.previous
    if (previous?.key !== toolRepeatKey(call)) return 'run'
    if (witness === undefined || witness !== previous.witness) {
      this.reset()
      return 'run'
    }
    return previous.count >= 2 ? { repeat: previous.count + 1 } : 'run'
  }

  public observe(call: ToolIdentity, output: unknown, witness: string | undefined): void {
    const key = toolRepeatKey(call)
    const result = fingerprint(JSON.stringify(canonical(output)))
    const count =
      this.previous?.key === key && this.previous.result === result ? this.previous.count + 1 : 1
    this.previous = { key, result, witness, count }
  }
}

import { fingerprint } from '../../verify/fingerprint'
import { TOOL_REPEAT_LIMIT } from '../../../shared/constants'

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

/** Turn-local, consecutive results only; stores digests, never tool output text. */
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
    return (
      this.previous?.key === toolRepeatKey(call) && this.previous.count >= TOOL_REPEAT_LIMIT - 1
    )
  }

  /** A witness must freshly prove the complete observable result is unchanged. */
  public before(call: ToolIdentity, witness: string | undefined): 'run' | 'skip' | 'stuck' {
    const previous = this.previous
    if (previous?.key !== toolRepeatKey(call)) return 'run'
    if (witness === undefined || witness !== previous.witness) {
      this.reset()
      return 'run'
    }
    if (previous.count < TOOL_REPEAT_LIMIT - 1) return 'run'
    previous.count += 1
    return previous.count === TOOL_REPEAT_LIMIT ? 'skip' : 'stuck'
  }

  public observe(call: ToolIdentity, output: unknown, witness: string | undefined): void {
    const key = toolRepeatKey(call)
    const result = fingerprint(JSON.stringify(canonical(output)))
    const count =
      this.previous?.key === key && this.previous.result === result ? this.previous.count + 1 : 1
    this.previous = { key, result, witness, count }
  }
}

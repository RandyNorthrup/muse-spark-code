import { fingerprint } from '../../verify/fingerprint'
import { TOOL_REPEAT_LIMIT, TOOL_REPEAT_STOP_LIMIT } from '../../../shared/constants'

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

/** What the guard says about a finished call: nothing, warn the model, or stop the turn. */
export type RepeatVerdict = 'ok' | 'warn' | 'stuck'

// A one-element array: `toolRepeatKey` always encodes two elements.
const CONTINUATION_KEY = JSON.stringify(['output-continuation'])

/**
 * Turn-local, consecutive results only; stores digests, never tool output text.
 * One policy for every tool class (lane LIMITSFIX, F4, D113): the same call
 * with the same arguments and the same result is a repeat. The 3rd tells the
 * model to change approach and the 5th stops the turn. A call whose result
 * changed (a poll of a running command, a wait on output) is never a repeat.
 * A tool with a trusted witness of its unchanged result (a text read) is
 * additionally skipped instead of run again; every other tool runs, and its
 * result decides. A reply that continues past the output limit counts the
 * same way, its text being the result (`observeContinuation`).
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

  /** The one count: the same key and the same result, consecutively. */
  private record(key: string, output: unknown, witness: string | undefined): RepeatVerdict {
    const result = fingerprint(JSON.stringify(canonical(output)))
    const count =
      this.previous?.key === key && this.previous.result === result ? this.previous.count + 1 : 1
    this.previous = { key, result, witness, count }
    if (count >= TOOL_REPEAT_STOP_LIMIT) return 'stuck'
    return count >= TOOL_REPEAT_LIMIT ? 'warn' : 'ok'
  }

  public reset(): void {
    this.previous = undefined
  }

  public needsWitness(call: ToolIdentity): boolean {
    return (
      this.previous?.key === toolRepeatKey(call) && this.previous.count >= TOOL_REPEAT_LIMIT - 1
    )
  }

  /**
   * A witness must freshly prove the complete observable result is
   * unchanged. The 3rd identical call is skipped (the model is told to change
   * approach) and the call is not run again; the 5th stops the turn. Without
   * a witness the call simply runs: only its own result, seen by `observe`,
   * can make it a repeat. A witness that differs from the last one proves the
   * result changed, so the count starts over.
   */
  public before(call: ToolIdentity, witness: string | undefined): 'run' | 'skip' | 'stuck' {
    const previous = this.previous
    if (witness === undefined || previous?.key !== toolRepeatKey(call)) return 'run'
    if (witness !== previous.witness) {
      this.reset()
      return 'run'
    }
    if (previous.count < TOOL_REPEAT_LIMIT - 1) return 'run'
    previous.count += 1
    return previous.count >= TOOL_REPEAT_STOP_LIMIT ? 'stuck' : 'skip'
  }

  /** Records a finished call's result and says whether it makes a repeat the model or the person must hear about. */
  public observe(call: ToolIdentity, output: unknown, witness: string | undefined): RepeatVerdict {
    return this.record(toolRepeatKey(call), output, witness)
  }

  /**
   * A reply cut short by the output limit that continues on its own (D114)
   * joins the same policy: the continuation is the call and the text it
   * returned is its result. Its key cannot equal any tool call's.
   */
  public observeContinuation(text: string): RepeatVerdict {
    return this.record(CONTINUATION_KEY, text, undefined)
  }
}

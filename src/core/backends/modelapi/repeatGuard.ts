import { fingerprint } from '../../verify/fingerprint'
import { canonicalJson, toolRepeatKey, type ToolIdentity } from '../../judge/fast/reflex/loop'

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
    const result = fingerprint(JSON.stringify(canonicalJson(output)))
    const count =
      this.previous?.key === key && this.previous.result === result ? this.previous.count + 1 : 1
    this.previous = { key, result, witness, count }
  }
}

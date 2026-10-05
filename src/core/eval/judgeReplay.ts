// M98-U: measurements from labelled M75 replays, never approvals or test outcomes.
import type { JudgeFenceSample } from '../judge/use'

interface Totals {
  fences: number
  ready: number
  cautions: number
  correctCautions: number
}

export interface JudgeReplayMeasurement {
  readonly backend: string
  readonly fences: number
  readonly readyRate: number
  /** Undefined when no caution was made; zero is not an unmeasured precision. */
  readonly precision: number | undefined
  readonly cautions: number
}

export class JudgeReplayRecorder {
  private readonly totals = new Map<string, Totals>()

  /** The caller supplies the replay fixture's independent destructive-risk label. */
  public record(sample: JudgeFenceSample, isIndependentlyDestructive: boolean): void {
    if (sample.caution && !sample.ready) throw new Error('A pending judge cannot make a caution')
    const totals = this.totals.get(sample.backend) ?? {
      fences: 0,
      ready: 0,
      cautions: 0,
      correctCautions: 0,
    }
    totals.fences += 1
    totals.ready += sample.ready ? 1 : 0
    totals.cautions += sample.caution ? 1 : 0
    totals.correctCautions += isIndependentlyDestructive && sample.caution ? 1 : 0
    this.totals.set(sample.backend, totals)
  }

  public measurements(): readonly JudgeReplayMeasurement[] {
    return [...this.totals].map(([backend, totals]) => ({
      backend,
      fences: totals.fences,
      readyRate: totals.ready / totals.fences,
      precision: totals.cautions === 0 ? undefined : totals.correctCautions / totals.cautions,
      cautions: totals.cautions,
    }))
  }
}

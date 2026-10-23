// M98-U: measurements from labelled M75 replays, never approvals or test outcomes.
// M125-V: the fast decisions' paired measurements per backend and model —
// win, wall time, precision, recall and harm — from the judge arms'
// isolated runs. Labels come from an independent labelling pass (D77),
// never from the task's injected conditions or the run's own outcomes.
import {
  JUDGE_FAST_ACCURACY_MIN_LABELS,
  JUDGE_FAST_DECISION_HARM_MAX,
  JUDGE_FAST_HINT_MIN_PRECISION,
} from '../../shared/constants'
import type { JudgeFastTurnDecision } from '../../shared/judgeFastTurn'
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

const P50_QUANTILE = 0.5
const P95_QUANTILE = 0.95

/** Nearest-rank quantile over paired deltas, like the engine windows. */
function quantile(sorted: readonly number[], rank: number): number | undefined {
  if (sorted.length === 0) return undefined
  const at = Math.ceil(sorted.length * rank) - 1
  return sorted[Math.min(sorted.length - 1, at)]
}

/** One arm's run of one task: the turn's own numbers, never a delta. */
export interface JudgeFastArmRow {
  readonly backend: string
  readonly model: string
  readonly arm: string
  readonly taskId: string
  readonly passed: boolean
  readonly wallMs: number
  readonly attempts: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly recalls: number
  readonly failed: boolean
}

/** One decision's run of one task on one arm: did it act, and the truth. */
export interface JudgeFastDecisionRow {
  readonly backend: string
  readonly model: string
  readonly arm: string
  readonly taskId: string
  readonly decision: JudgeFastTurnDecision
  readonly acted: boolean
  readonly appliedTurns: number
  readonly evaluatedTurns: number
  /**
  Independent ground truth for this run, when a labelling pass judged
  it. Absent runs count toward the win and the wall time, never toward
  precision or recall.
  */
  readonly shouldFire?: boolean | undefined
}

/** Why a decision does not ship yet; absent when it ships. */
export const JUDGE_FAST_SHIP_BLOCKS = [
  'unmeasured',
  'no-win',
  'pass-regression',
  'wall-regression',
  'harm-above-bar',
  'precision-below-bar',
  'labels-below-minimum',
] as const
export type JudgeFastShipBlock = (typeof JUDGE_FAST_SHIP_BLOCKS)[number]

export interface JudgeFastMeasurement {
  readonly backend: string
  readonly model: string
  readonly decision: JudgeFastTurnDecision
  /** Tasks with both the arm and its baseline run. */
  readonly pairs: number
  /** Turns where the arm acted, across the paired runs. */
  readonly appliedTurns: number
  /** Pass-rate delta, arm minus baseline; undefined below one pair. */
  readonly winPass: number | undefined
  /** Paired wall-time deltas in milliseconds (arm minus baseline). */
  readonly wallP50DeltaMs: number | undefined
  readonly wallP95DeltaMs: number | undefined
  /** Paired medians of baseline-minus-arm: positive saves. */
  readonly callsAvoidedP50: number | undefined
  readonly inputTokensSavedP50: number | undefined
  readonly outputTokensSavedP50: number | undefined
  /** Over labelled runs only; undefined when none fired (precision) or none should (recall). */
  readonly precision: number | undefined
  readonly recall: number | undefined
  readonly labelled: number
  /** Harm events (a recall, a failed turn) on the arm and its baseline. */
  readonly harmOn: number
  readonly harmOff: number
  /** The arm's harm against its applied turns; undefined when none applied. */
  readonly harmShare: number | undefined
  readonly ships: boolean
  readonly blockedBy: readonly JudgeFastShipBlock[]
}

/** Decisions that ship a hint or note, so the precision bar gates them. */
const HINT_DECISIONS: ReadonlySet<JudgeFastTurnDecision> = new Set([
  'loop.stuck',
  'failure.unmentioned',
  'done.unbacked',
])

export class JudgeFastReplayRecorder {
  private readonly arms: JudgeFastArmRow[] = []
  private readonly decisions: JudgeFastDecisionRow[] = []
  private readonly baselines = new Map<string, string>()

  /** The baseline arm each measured arm pairs against (keep's carries compaction). */
  private measure(
    backend: string,
    model: string,
    decision: JudgeFastTurnDecision,
    rows: readonly JudgeFastDecisionRow[],
    armsByKey: ReadonlyMap<string, JudgeFastArmRow>,
  ): JudgeFastMeasurement {
    const wall: number[] = []
    const calls: number[] = []
    const input: number[] = []
    const output: number[] = []
    let pairs = 0
    let passedOn = 0
    let passedOff = 0
    let appliedTurns = 0
    let harmOn = 0
    let harmOff = 0
    let fired = 0
    let correctFires = 0
    let expectedFires = 0
    let labelled = 0
    for (const row of rows) {
      // Unpaired arms (the baselines themselves) carry no measurement:
      // labels and pairs count on the measured arm alone.
      const baseline = this.baselines.get(row.arm)
      if (baseline === undefined) continue
      const on = armsByKey.get(JSON.stringify([backend, model, row.arm, row.taskId]))
      const off = armsByKey.get(JSON.stringify([backend, model, baseline, row.taskId]))
      if (row.shouldFire !== undefined) {
        labelled += 1
        if (row.shouldFire) expectedFires += 1
        if (row.acted) {
          fired += 1
          if (row.shouldFire) correctFires += 1
        }
      }
      if (on === undefined || off === undefined) continue
      pairs += 1
      if (on.passed) passedOn += 1
      if (off.passed) passedOff += 1
      appliedTurns += row.appliedTurns
      harmOn += on.recalls + (on.failed ? 1 : 0)
      harmOff += off.recalls + (off.failed ? 1 : 0)
      wall.push(on.wallMs - off.wallMs)
      calls.push(off.attempts - on.attempts)
      input.push(off.inputTokens - on.inputTokens)
      output.push(off.outputTokens - on.outputTokens)
    }
    wall.sort((left, right) => left - right)
    calls.sort((left, right) => left - right)
    input.sort((left, right) => left - right)
    output.sort((left, right) => left - right)
    const wallP50 = quantile(wall, P50_QUANTILE)
    const wallP95 = quantile(wall, P95_QUANTILE)
    const callsP50 = quantile(calls, P50_QUANTILE)
    const inputP50 = quantile(input, P50_QUANTILE)
    const outputP50 = quantile(output, P50_QUANTILE)
    const precision = fired === 0 ? undefined : correctFires / fired
    const recall = expectedFires === 0 ? undefined : correctFires / expectedFires
    const harmShare = appliedTurns === 0 ? undefined : harmOn / appliedTurns
    const blockedBy = this.blockedBy({
      pairs,
      wallP50,
      wallP95,
      callsP50,
      inputP50,
      outputP50,
      precision,
      labelled,
      harmShare,
      decision,
      winPass: pairs === 0 ? undefined : passedOn / pairs - passedOff / pairs,
    })
    return {
      backend,
      model,
      decision,
      pairs,
      appliedTurns,
      winPass: pairs === 0 ? undefined : passedOn / pairs - passedOff / pairs,
      wallP50DeltaMs: wallP50,
      wallP95DeltaMs: wallP95,
      callsAvoidedP50: callsP50,
      inputTokensSavedP50: inputP50,
      outputTokensSavedP50: outputP50,
      precision,
      recall,
      labelled,
      harmOn,
      harmOff,
      harmShare,
      ships: blockedBy.length === 0,
      blockedBy,
    }
  }

  private blockedBy(measured: {
    readonly pairs: number
    readonly wallP50: number | undefined
    readonly wallP95: number | undefined
    readonly callsP50: number | undefined
    readonly inputP50: number | undefined
    readonly outputP50: number | undefined
    readonly precision: number | undefined
    readonly labelled: number
    readonly harmShare: number | undefined
    readonly decision: JudgeFastTurnDecision
    readonly winPass: number | undefined
  }): JudgeFastShipBlock[] {
    if (measured.pairs === 0) return ['unmeasured']
    const blocked: JudgeFastShipBlock[] = []
    const isWin =
      (measured.wallP50 ?? 0) < 0 ||
      (measured.callsP50 ?? 0) > 0 ||
      (measured.inputP50 ?? 0) > 0 ||
      (measured.outputP50 ?? 0) > 0
    if (!isWin) blocked.push('no-win')
    if ((measured.winPass ?? 0) < 0) blocked.push('pass-regression')
    if ((measured.wallP50 ?? 0) > 0 || (measured.wallP95 ?? 0) > 0) blocked.push('wall-regression')
    if (measured.harmShare !== undefined && measured.harmShare > JUDGE_FAST_DECISION_HARM_MAX)
      blocked.push('harm-above-bar')
    if (HINT_DECISIONS.has(measured.decision)) {
      if (measured.labelled < JUDGE_FAST_ACCURACY_MIN_LABELS) blocked.push('labels-below-minimum')
      if (measured.precision !== undefined && measured.precision < JUDGE_FAST_HINT_MIN_PRECISION)
        blocked.push('precision-below-bar')
    }
    return blocked
  }

  public pair(arm: string, baseline: string): void {
    this.baselines.set(arm, baseline)
  }

  public recordArm(row: JudgeFastArmRow): void {
    this.arms.push(row)
  }

  public recordDecision(row: JudgeFastDecisionRow): void {
    this.decisions.push(row)
  }

  public measurements(): readonly JudgeFastMeasurement[] {
    const armsByKey = new Map<string, JudgeFastArmRow>()
    for (const row of this.arms) {
      armsByKey.set(JSON.stringify([row.backend, row.model, row.arm, row.taskId]), row)
    }
    const groups = new Map<string, { rows: JudgeFastDecisionRow[]; sample: JudgeFastDecisionRow }>()
    for (const row of this.decisions) {
      const key = JSON.stringify([row.backend, row.model, row.decision])
      const group = groups.get(key)
      if (group === undefined) groups.set(key, { rows: [row], sample: row })
      else group.rows.push(row)
    }
    return [...groups].map(([, group]) =>
      this.measure(
        group.sample.backend,
        group.sample.model,
        group.sample.decision,
        group.rows,
        armsByKey,
      ),
    )
  }
}

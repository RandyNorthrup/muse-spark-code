// M125 lane V (D107): the fast replay recorder's paired math. Arm rows
// carry each run's own numbers; decision rows carry the isolated
// decision's firing and its independent label. Pairs compare arm minus
// baseline per task; precision and recall count labelled runs alone;
// the ship rule gates the win, the wall time, the harm share and, for
// hint checks, precision on the labelled minimum.
import { describe, expect, it } from 'vitest'
import {
  JudgeFastReplayRecorder,
  type JudgeFastArmRow,
  type JudgeFastDecisionRow,
} from '../../../src/core/eval/judgeReplay'

const BACKEND = 'modelApi'
const MODEL = 'muse-spark-1.3-contributor'

const arm = (
  armName: string,
  taskId: string,
  overrides: Partial<JudgeFastArmRow> = {},
): JudgeFastArmRow => ({
  backend: BACKEND,
  model: MODEL,
  arm: armName,
  taskId,
  passed: true,
  wallMs: 1000,
  attempts: 5,
  inputTokens: 1000,
  outputTokens: 200,
  recalls: 0,
  failed: false,
  ...overrides,
})

const decision = (
  armName: string,
  taskId: string,
  overrides: Partial<JudgeFastDecisionRow> = {},
): JudgeFastDecisionRow => ({
  backend: BACKEND,
  model: MODEL,
  arm: armName,
  taskId,
  decision: 'loop.stuck',
  acted: true,
  appliedTurns: 1,
  evaluatedTurns: 1,
  ...overrides,
})

describe('fast replay recorder', () => {
  it('pairs arm minus baseline per task', () => {
    const recorder = new JudgeFastReplayRecorder()
    recorder.pair('judge-loop', 'judge-off')
    recorder.recordArm(arm('judge-off', 't1', { wallMs: 2000, attempts: 7, inputTokens: 1200 }))
    recorder.recordArm(arm('judge-loop', 't1', { wallMs: 1500, attempts: 5, inputTokens: 900 }))
    recorder.recordArm(arm('judge-off', 't2', { wallMs: 3000, attempts: 8, inputTokens: 1300 }))
    recorder.recordArm(arm('judge-loop', 't2', { wallMs: 2400, attempts: 6, inputTokens: 1100 }))
    recorder.recordDecision(decision('judge-loop', 't1'))
    recorder.recordDecision(decision('judge-loop', 't2'))
    recorder.recordDecision(decision('judge-off', 't1', { acted: false, appliedTurns: 0 }))
    const [measured] = recorder.measurements()
    expect(measured).toMatchObject({
      backend: BACKEND,
      model: MODEL,
      decision: 'loop.stuck',
      pairs: 2,
      appliedTurns: 2,
      winPass: 0,
      wallP50DeltaMs: -600,
      wallP95DeltaMs: -500,
      callsAvoidedP50: 2,
      inputTokensSavedP50: 200,
      outputTokensSavedP50: 0,
      harmOn: 0,
      harmOff: 0,
      harmShare: 0,
    })
  })

  it('counts precision and recall over labelled runs alone', () => {
    const recorder = new JudgeFastReplayRecorder()
    recorder.pair('judge-loop', 'judge-off')
    for (const taskId of ['t1', 't2', 't3']) {
      recorder.recordArm(arm('judge-off', taskId))
      recorder.recordArm(arm('judge-loop', taskId))
    }
    recorder.recordDecision(decision('judge-loop', 't1', { acted: true, shouldFire: true }))
    recorder.recordDecision(decision('judge-loop', 't2', { acted: true, shouldFire: false }))
    recorder.recordDecision(decision('judge-loop', 't3', { acted: false }))
    const [measured] = recorder.measurements()
    expect(measured).toMatchObject({ pairs: 3, labelled: 2, precision: 0.5, recall: 1 })
  })

  it('leaves precision and recall unknown without labels', () => {
    const recorder = new JudgeFastReplayRecorder()
    recorder.pair('judge-loop', 'judge-off')
    recorder.recordArm(arm('judge-off', 't1'))
    recorder.recordArm(arm('judge-loop', 't1'))
    recorder.recordDecision(decision('judge-loop', 't1'))
    const [measured] = recorder.measurements()
    expect(measured).toMatchObject({
      pairs: 1,
      labelled: 0,
      precision: undefined,
      recall: undefined,
    })
  })

  it('reports unmeasured below one pair', () => {
    const recorder = new JudgeFastReplayRecorder()
    recorder.pair('judge-loop', 'judge-off')
    recorder.recordArm(arm('judge-loop', 't1'))
    recorder.recordDecision(decision('judge-loop', 't1'))
    const [measured] = recorder.measurements()
    expect(measured).toMatchObject({
      pairs: 0,
      ships: false,
      blockedBy: ['unmeasured'],
      winPass: undefined,
      wallP50DeltaMs: undefined,
    })
  })

  it('blocks a wall regression and a pass regression', () => {
    const recorder = new JudgeFastReplayRecorder()
    recorder.pair('judge-loop', 'judge-off')
    recorder.recordArm(arm('judge-off', 't1', { wallMs: 1000 }))
    recorder.recordArm(arm('judge-loop', 't1', { wallMs: 1500, passed: false }))
    recorder.recordDecision(decision('judge-loop', 't1'))
    const [measured] = recorder.measurements()
    expect(measured?.ships).toBe(false)
    expect(measured?.blockedBy).toContain('wall-regression')
    expect(measured?.blockedBy).toContain('pass-regression')
  })

  it('blocks harm above the bar against applied turns', () => {
    const recorder = new JudgeFastReplayRecorder()
    recorder.pair('judge-triage', 'judge-off')
    recorder.recordArm(arm('judge-off', 't1', { wallMs: 2000 }))
    recorder.recordArm(arm('judge-triage', 't1', { wallMs: 1000, recalls: 1 }))
    recorder.recordDecision(decision('judge-triage', 't1', { decision: 'triage.needFull' }))
    const [measured] = recorder.measurements()
    expect(measured).toMatchObject({ harmOn: 1, harmShare: 1, ships: false })
    expect(measured?.blockedBy).toContain('harm-above-bar')
  })

  it('blocks hint checks below the labelled minimum', () => {
    const recorder = new JudgeFastReplayRecorder()
    recorder.pair('judge-loop', 'judge-off')
    recorder.recordArm(arm('judge-off', 't1', { wallMs: 2000 }))
    recorder.recordArm(arm('judge-loop', 't1', { wallMs: 1000 }))
    recorder.recordDecision(decision('judge-loop', 't1', { acted: true, shouldFire: true }))
    const [measured] = recorder.measurements()
    expect(measured?.ships).toBe(false)
    expect(measured?.blockedBy).toContain('labels-below-minimum')
  })

  it('ships a behaviour decision on a clean win', () => {
    const recorder = new JudgeFastReplayRecorder()
    recorder.pair('judge-triage', 'judge-off')
    recorder.recordArm(arm('judge-off', 't1', { wallMs: 2000, attempts: 6 }))
    recorder.recordArm(arm('judge-triage', 't1', { wallMs: 1500, attempts: 5 }))
    recorder.recordDecision(decision('judge-triage', 't1', { decision: 'triage.needFull' }))
    const [measured] = recorder.measurements()
    expect(measured).toMatchObject({ ships: true, blockedBy: [] })
  })
})

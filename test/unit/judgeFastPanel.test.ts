// M125 lane U (D107): the window's fast-decision rolls. Turn events built
// by the real recorder join the newest-per-decision facts; the
// projection names each row's state and multiplies lane V's paired
// median by applied turns, leaving the saving unknown without it; the
// shared definition list shows the rolls in the panel and usage dialog.
import { describe, expect, it } from 'vitest'
import { FastPanelFacts } from '../../src/core/judge/fast/panelFacts'
import { FastTurnRecorder } from '../../src/core/judge/fast/turnRecord'
import { projectFastJudgePanel, projectJudgePanel } from '../../src/shared/judgePanel'
import {
  judgePanelSnapshotSchema,
  type JudgePanelFastFacts,
} from '../../src/shared/judgePanelSchema'
import { judgePanelRows } from '../../src/shared/judgePanelText'
import type { JudgeFastTurn } from '../../src/shared/judgeFastTurn'

const turn = (
  build: (recorder: FastTurnRecorder) => void,
  method = 'deterministic',
): JudgeFastTurn => {
  const recorder = new FastTurnRecorder()
  build(recorder)
  const event = recorder.event('turn-1', 'modelApi', method)
  if (event === undefined) throw new Error('the test turn evaluated nothing')
  return event
}

const fastFacts = (): JudgePanelFastFacts => ({
  decisions: [
    {
      decision: 'loop.stuck',
      raised: true,
      acted: true,
      reason: 'repeat',
      evaluated: 3,
      appliedTurns: 2,
    },
    {
      decision: 'triage.needFull',
      raised: true,
      acted: false,
      reason: 'no-window',
      evaluated: 4,
      appliedTurns: 0,
      noWindow: 2,
    },
    {
      decision: 'effort.lower',
      raised: false,
      acted: false,
      reason: 'broad',
      evaluated: 1,
      appliedTurns: 0,
    },
  ],
  totals: { turns: 5, appliedTurns: 2, raised: 6, acted: 2, judgeCalls: 0, judgeTokens: 0 },
  method: 'deterministic',
})

describe('fast panel facts', () => {
  it('reads undefined before the first turn record', () => {
    const facts = new FastPanelFacts()
    expect(facts.observed).toBe(false)
    expect(facts.facts()).toBeUndefined()
  })

  it('rolls one turn with its counts', () => {
    const facts = new FastPanelFacts()
    facts.observe(
      turn((recorder) => {
        recorder.observeLoop(true, true, 'repeat')
        recorder.observeTriage(false, false, 'no-window')
        recorder.observeEffort(false, false, 'broad')
      }),
    )
    expect(facts.observed).toBe(true)
    expect(facts.facts()).toMatchObject({
      decisions: [
        {
          decision: 'triage.needFull',
          raised: false,
          acted: false,
          evaluated: 1,
          appliedTurns: 0,
          noWindow: 1,
        },
        { decision: 'loop.stuck', raised: true, acted: true, evaluated: 1, appliedTurns: 1 },
        { decision: 'effort.lower', raised: false, acted: false, evaluated: 1, appliedTurns: 0 },
      ],
      totals: { turns: 1, appliedTurns: 1, raised: 1, acted: 1, judgeCalls: 0, judgeTokens: 0 },
      method: 'deterministic',
    })
  })

  it('keeps the newest record per decision and sums the counts', () => {
    const facts = new FastPanelFacts()
    facts.observe(
      turn((recorder) => {
        recorder.observeLoop(true, true, 'repeat')
        recorder.observeLoop(true, true, 'repeat')
      }),
    )
    facts.observe(
      turn((recorder) => {
        recorder.observeLoop(false, false, 'absent')
        recorder.observeEffort(true, false, 'lowest')
      }, 'engine-x'),
    )
    expect(facts.facts()).toMatchObject({
      decisions: [
        { decision: 'loop.stuck', raised: false, acted: false, reason: 'absent', evaluated: 3 },
        { decision: 'effort.lower', raised: true, acted: false, reason: 'lowest', evaluated: 1 },
      ],
      totals: { turns: 2, appliedTurns: 1, raised: 2, acted: 1 },
      method: 'engine-x',
    })
  })

  it('carries lane V medians alongside when measured', () => {
    const facts = new FastPanelFacts()
    facts.observe(
      turn((recorder) => {
        recorder.observeLoop(true, true, 'repeat')
      }),
    )
    expect(facts.facts({ 'loop.stuck': 12.5 })).toMatchObject({
      measuredMsPerTurn: { 'loop.stuck': 12.5 },
    })
    expect(facts.facts()?.measuredMsPerTurn).toBeUndefined()
  })
})

describe('fast panel projection', () => {
  it('names acted above raised above absent', () => {
    const snapshot = projectFastJudgePanel(fastFacts())
    expect(snapshot.rows.map((row) => [row.decision, row.state])).toEqual([
      ['loop.stuck', 'acted'],
      ['triage.needFull', 'raised'],
      ['effort.lower', 'absent'],
    ])
    expect(snapshot.rows[1]).toMatchObject({ reason: 'no-window', noWindow: 2 })
    expect(snapshot.method).toBe('deterministic')
  })

  it('leaves the saving unknown without a measured median', () => {
    const snapshot = projectFastJudgePanel(fastFacts())
    expect(snapshot.rows[0]?.savedMsPerTurn).toBeUndefined()
    expect(snapshot.rows[0]?.savedMsTotal).toBeUndefined()
    expect(snapshot.savedMsTotal).toBeUndefined()
  })

  it('multiplies the paired median by applied turns', () => {
    const snapshot = projectFastJudgePanel({
      ...fastFacts(),
      measuredMsPerTurn: { 'loop.stuck': 12.5, 'effort.lower': 4 },
    })
    expect(snapshot.rows[0]).toMatchObject({ savedMsPerTurn: 12.5, savedMsTotal: 25 })
    expect(snapshot.rows[1]?.savedMsTotal).toBeUndefined()
    expect(snapshot.rows[2]).toMatchObject({ savedMsPerTurn: 4, savedMsTotal: 0 })
    expect(snapshot.savedMsTotal).toBe(25)
  })

  it('refuses invalid fast facts', () => {
    const facts = fastFacts()
    expect(() =>
      projectFastJudgePanel({ ...facts, totals: { ...facts.totals, turns: -1 } }),
    ).toThrow(TypeError)
  })

  it('rides the panel snapshot only when the window has fast facts', () => {
    const base = {
      engine: 'off',
      effectiveSource: 'none',
      locality: 'not-local',
      experimental: false,
      confidential: true,
      billing: 'none',
      paidSourceSelected: false,
      consent: 'not-required',
    } as const
    const withFast = projectJudgePanel({ ...base, fast: fastFacts() })
    expect(withFast.fast?.rows).toHaveLength(3)
    expect(judgePanelSnapshotSchema.safeParse(withFast).success).toBe(true)
    const withoutFast = projectJudgePanel({ ...base })
    expect(withoutFast.fast).toBeUndefined()
  })
})

describe('fast panel rows', () => {
  it('shows the rolls and each evaluated decision', () => {
    const snapshot = projectJudgePanel({
      engine: 'off',
      effectiveSource: 'none',
      locality: 'not-local',
      experimental: false,
      confidential: true,
      billing: 'none',
      paidSourceSelected: false,
      consent: 'not-required',
      fast: fastFacts(),
    })
    const rows = judgePanelRows(snapshot)
    const byTerm = new Map(rows.map((row) => [row.term, row.detail]))
    expect(byTerm.get('Fast method')).toBe('deterministic')
    expect(byTerm.get('Fast turns')).toBe('5')
    expect(byTerm.get('Fast turns applied')).toBe('2')
    expect(byTerm.get('Judge calls')).toBe('0')
    expect(byTerm.get('Judge tokens')).toBe('0')
    expect(byTerm.get('Fast time saved')).toBeUndefined()
    expect(byTerm.get('loop.stuck')).toBe('Acted · repeat')
    expect(byTerm.get('triage.needFull')).toBe(
      'Raised, not applied · no-window, 2 without a window',
    )
    expect(byTerm.get('effort.lower')).toBe('Not raised · broad')
  })

  it('shows the saved time once a median joined', () => {
    const snapshot = projectJudgePanel({
      engine: 'off',
      effectiveSource: 'none',
      locality: 'not-local',
      experimental: false,
      confidential: true,
      billing: 'none',
      paidSourceSelected: false,
      consent: 'not-required',
      fast: { ...fastFacts(), measuredMsPerTurn: { 'loop.stuck': 2000 } },
    })
    const rows = judgePanelRows(snapshot)
    const saved = rows.find((row) => row.term === 'Fast time saved')
    expect(saved?.detail).toBe('4s')
  })

  it('shows no fast rows without fast facts', () => {
    const snapshot = projectJudgePanel({
      engine: 'off',
      effectiveSource: 'none',
      locality: 'not-local',
      experimental: false,
      confidential: true,
      billing: 'none',
      paidSourceSelected: false,
      consent: 'not-required',
    })
    const rows = judgePanelRows(snapshot)
    expect(rows.some((row) => row.term === 'Fast turns')).toBe(false)
    expect(rows.some((row) => row.term === 'loop.stuck')).toBe(false)
  })
})

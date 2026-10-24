// M125 lane U (D107): one turn's fast-decision record. The schema pins
// the wire; the recorder merges a turn's observations into the event in
// decision order; the reason helpers name real reflex verdicts (over the
// recorded exchanges in test/fixtures/judgeFast, captured 2026-10-22).
import { describe, expect, it } from 'vitest'
import { triageRoute } from '../../src/core/judge/fast/apply'
import {
  doneTurnReason,
  effortTurnReason,
  FastTurnRecorder,
  keepTurnReason,
  loopTurnReason,
  triageTurnReason,
} from '../../src/core/judge/fast/turnRecord'
import { judgeDoneClaim } from '../../src/core/judge/fast/reflex/done'
import { ruleEffort } from '../../src/core/judge/fast/reflex/effort'
import { detectLoop, type LoopSignal } from '../../src/core/judge/fast/reflex/loop'
import { triageOutput } from '../../src/core/judge/fast/reflex/triage'
import { judgeFastTurnSchema } from '../../src/shared/judgeFastTurn'
import { judgeFastFixture } from './helpers/judgeFastFixtures'

const signal = (): LoopSignal => ({ key: 'a', failed: false, outputDigest: '1' })

describe('fast turn record', () => {
  it('emits nothing when no decision was evaluated', () => {
    const recorder = new FastTurnRecorder()
    expect(recorder.evaluated).toBe(false)
    expect(recorder.event('turn-1', 'modelApi', 'deterministic')).toBeUndefined()
  })

  it('merges a turn into decision order with its counts', () => {
    const recorder = new FastTurnRecorder()
    recorder.observeLoop(true, true, 'repeat')
    recorder.observeTriage(false, false, 'no-window')
    recorder.observeTriage(false, false, 'no-window')
    recorder.observeTriage(true, true, 'pack')
    recorder.observeEffort(false, false, 'broad')
    const event = recorder.event('turn-1', 'museCode', 'deterministic')
    expect(event).toMatchObject({
      type: 'judgeFastTurn',
      turnId: 'turn-1',
      backend: 'museCode',
      method: 'deterministic',
      judgeCalls: 0,
      judgeTokens: 0,
    })
    expect(event?.decisions).toEqual([
      {
        decision: 'triage.needFull',
        evaluated: 3,
        raised: true,
        acted: true,
        reason: 'pack',
        noWindow: 2,
      },
      { decision: 'loop.stuck', evaluated: 1, raised: true, acted: true, reason: 'repeat' },
      { decision: 'effort.lower', evaluated: 1, raised: false, acted: false, reason: 'broad' },
    ])
    expect(judgeFastTurnSchema.safeParse(event).success).toBe(true)
    recorder.reset()
    expect(recorder.evaluated).toBe(false)
  })

  it('keeps the acted outcome over later misses', () => {
    const recorder = new FastTurnRecorder()
    recorder.observeTriage(true, true, 'pack')
    recorder.observeTriage(false, false, 'whole')
    expect(recorder.event('t', 'modelApi', 'deterministic')?.decisions).toEqual([
      { decision: 'triage.needFull', evaluated: 2, raised: true, acted: true, reason: 'pack' },
    ])
  })

  it('rejects an empty or misshapen turn', () => {
    expect(
      judgeFastTurnSchema.safeParse({
        type: 'judgeFastTurn',
        turnId: 't',
        backend: 'modelApi',
        method: 'deterministic',
        decisions: [],
        judgeCalls: 0,
        judgeTokens: 0,
      }).success,
    ).toBe(false)
    expect(
      judgeFastTurnSchema.safeParse({
        type: 'judgeFastTurn',
        turnId: '',
        backend: 'modelApi',
        method: 'deterministic',
        decisions: [
          { decision: 'loop.stuck', evaluated: 1, raised: true, acted: true, reason: 'repeat' },
        ],
        judgeCalls: 0,
        judgeTokens: 0,
      }).success,
    ).toBe(false)
    expect(
      judgeFastTurnSchema.safeParse({
        type: 'judgeFastTurn',
        turnId: 't',
        backend: 'modelApi',
        method: 'deterministic',
        decisions: [
          { decision: 'loop.stuck', evaluated: 1, raised: true, acted: true, reason: 'guessed' },
        ],
        judgeCalls: 0,
        judgeTokens: 0,
      }).success,
    ).toBe(false)
  })

  it('names real loop verdicts', () => {
    const stuck = detectLoop([signal(), signal(), signal()])
    expect(loopTurnReason(stuck, undefined)).toBe('repeat')
    const clear = detectLoop([signal(), signal()])
    expect(loopTurnReason(clear, undefined)).toBe('absent')
    expect(loopTurnReason(clear, true)).toBe('pinned')
  })

  it('names real triage routes', () => {
    const pack = triageRoute(triageOutput({ exitCode: 0, output: '  \n' }), 'none', false)
    expect(triageTurnReason(pack, undefined)).toBe('pack')
    const recognised = triageRoute(
      triageOutput({ exitCode: 2, output: judgeFastFixture('ls-missing.txt') }),
      'none',
      false,
    )
    expect(triageTurnReason(recognised, undefined)).toBe('whole')
    const lone = triageRoute(
      triageOutput({ exitCode: 0, output: judgeFastFixture('git-log.txt') }),
      'none',
      false,
    )
    expect(triageTurnReason(lone, undefined)).toBe('no-window')
    const parallel = triageRoute(
      triageOutput({ exitCode: 0, output: judgeFastFixture('git-log.txt') }),
      'real',
      false,
    )
    expect(triageTurnReason(parallel, undefined)).toBe('no-engine')
    expect(triageTurnReason(lone, true)).toBe('pinned')
  })

  it('names real effort rules', () => {
    const lower = ruleEffort({ request: 'format these files', filesTouched: 2 })
    expect(lower.decision).toBe('lower')
    expect(effortTurnReason(lower.decision === 'lower', true, true)).toBe('lowered')
    expect(effortTurnReason(lower.decision === 'lower', false, true)).toBe('pinned')
    const broad = ruleEffort({ request: 'why is this test red?', filesTouched: 0 })
    expect(broad.decision).toBe('miss')
    expect(effortTurnReason(broad.decision === 'lower', false, false)).toBe('broad')
    expect(effortTurnReason(true, false, false)).toBe('lowest')
    expect(effortTurnReason(false, true, true)).toBe('pinned')
  })

  it('names keep and done outcomes', () => {
    expect(keepTurnReason(true, false)).toBe('kept')
    expect(keepTurnReason(true, true)).toBe('pinned')
    expect(keepTurnReason(false, false)).toBe('absent')
    const backed = judgeDoneClaim({
      replyText: 'Done, the rename is complete.',
      toolOutputs: [{ exitCode: 0, output: judgeFastFixture('git-log.txt') }],
    })
    expect(doneTurnReason(backed.decision, undefined)).toBe('note')
    const unbacked = judgeDoneClaim({
      replyText: 'Done, all tests pass.',
      toolOutputs: [{ exitCode: 1, output: judgeFastFixture('vitest-failure.txt') }],
    })
    expect(doneTurnReason(unbacked.decision, undefined)).toBe('surface-note')
    const miss = judgeDoneClaim({ replyText: 'Done.', toolOutputs: [] })
    expect(doneTurnReason(miss.decision, undefined)).toBe('no-claim')
    expect(doneTurnReason(miss.decision, true)).toBe('pinned')
  })
})

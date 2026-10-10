// M117 W: gotcha G4 (stale base as a schedule risk) and the calibration
// engine dimension (durations and first-pass finding rates per engine).
// Repository default timeout; no skips.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fitCalibration } from '../../src/core/estimator/calibration/fit'
import {
  baseRisks,
  engineFindingRate,
  staleBaseLanes,
  staleBaseText,
} from '../../src/core/estimator/baseRisk'
import {
  estimateLaneSchema,
  estimateSectionSchema,
  type EstimateLane,
  type HistoryRecord,
} from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { fakeEstimate } from './helpers/estimator/fixtures'
import { fakeHistoryRecord } from './helpers/estimator/fixtures'
import { ESTIMATOR_AS_OF } from './helpers/estimator/fakes'

const AS_OF = '2026-10-06T12:00:00.000Z'
function lane(id: string, baseAsOf?: string): EstimateLane {
  return estimateLaneSchema.parse({
    ...estimateLaneSchema.parse(fakeEstimate().inputs.lanes[0]),
    id,
    ...(baseAsOf !== undefined && { baseAsOf }),
  })
}
function records(count: number, engine: HistoryRecord['engine'], prefix: string): HistoryRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    ...fakeHistoryRecord(`${prefix}-${String(index)}`),
    actualHours: index % 2 === 0 ? 2 : 8,
    engine,
  }))
}

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})
afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('M117 stale bases are a named schedule risk (G4)', () => {
  it('flags a base at the seven-day floor and spares fresh and unknown bases', () => {
    const lanes = [
      lane('M117:old', '2026-09-29T12:00:00.000Z'),
      lane('M117:fresh', '2026-10-05T12:00:00.000Z'),
      lane('M117:unknown'),
    ]
    expect(staleBaseLanes(lanes, AS_OF)).toEqual([{ laneId: 'M117:old', baseAgeDays: 7 }])
    expect(baseRisks(lanes, AS_OF)).toEqual([{ laneId: 'M117:old', kind: 'staleBase' }])
  })
  it('orders oldest first with a lane-id tiebreak, deterministically', () => {
    const lanes = [
      lane('M117:b', '2026-09-20T12:00:00.000Z'),
      lane('M117:a', '2026-09-20T12:00:00.000Z'),
      lane('M117:c', '2026-09-01T12:00:00.000Z'),
    ]
    expect(staleBaseLanes(lanes, AS_OF).map((stale) => stale.laneId)).toEqual([
      'M117:c',
      'M117:a',
      'M117:b',
    ])
    expect(staleBaseLanes(lanes, AS_OF)).toEqual(staleBaseLanes(lanes, AS_OF))
  })
  it('refuses a future base and an invalid snapshot time', () => {
    expect(() => staleBaseLanes([lane('M117:x', '2026-10-07T12:00:00.000Z')], AS_OF)).toThrow(
      /invalidBaseAge/,
    )
    expect(() => staleBaseLanes([lane('M117:x')], 'not-a-time')).toThrow(/invalidBaseAge/)
  })
  it('keeps section risks honest: named lanes only', () => {
    const section = fakeEstimate()
    const laneId = section.inputs.lanes[0]?.id ?? 'M117:missing'
    expect(
      estimateSectionSchema.parse({ ...section, risks: [{ laneId, kind: 'staleBase' }] }).risks,
    ).toEqual([{ laneId, kind: 'staleBase' }])
    expect(
      estimateSectionSchema.safeParse({
        ...section,
        risks: [{ laneId: 'M117:ghost', kind: 'staleBase' }],
      }).success,
    ).toBe(false)
  })
  it('names the stale lanes in the installed language', () => {
    setUiText(EN, BASE_LOCALE)
    expect(staleBaseText([{ laneId: 'M117:a' }, { laneId: 'M117:b' }])).toBe(
      'Stale base (M117:a, M117:b): rebase before starting.',
    )
  })
})

describe('M117 calibration fits per engine and re-fits after each lane', () => {
  it('fits one engine while the unscoped fit keeps every record', () => {
    const history = [...records(20, 'codex', 'M117:codex'), ...records(5, 'claude', 'M117:ai')]
    const codex = fitCalibration(
      history,
      'core',
      'linux-x64-builder',
      ESTIMATOR_AS_OF,
      'agentTime',
      'codex',
    )
    expect(codex.calibration).toMatchObject({
      engine: 'codex',
      basis: 'fitted',
      samples: 20,
    })
    const claude = fitCalibration(
      history,
      'core',
      'linux-x64-builder',
      ESTIMATOR_AS_OF,
      'agentTime',
      'claude',
    )
    expect(claude.calibration).toMatchObject({
      engine: 'claude',
      basis: 'uncalibratedPrior',
      samples: 5,
    })
    expect(
      fitCalibration(history, 'core', 'linux-x64-builder', ESTIMATOR_AS_OF).calibration,
    ).toMatchObject({ engine: undefined, samples: 25 })
  })
  it('re-fits when a finished lane joins the journal', () => {
    const history = records(20, 'grok', 'M117:grok')
    const before = fitCalibration(
      history,
      'core',
      'linux-x64-builder',
      ESTIMATOR_AS_OF,
      'agentTime',
      'grok',
    )
    expect(before.calibration.samples).toBe(20)
    const after = fitCalibration(
      [...history, { ...fakeHistoryRecord('M117:grok-20'), engine: 'grok' as const }],
      'core',
      'linux-x64-builder',
      ESTIMATOR_AS_OF,
      'agentTime',
      'grok',
    )
    expect(after.calibration.samples).toBe(21)
  })
  it('refuses an unknown engine without fitting', () => {
    expect(() =>
      fitCalibration(
        records(1, 'codex', 'M117:x'),
        'core',
        'linux-x64-builder',
        ESTIMATOR_AS_OF,
        'agentTime',
        'gpt' as never,
      ),
    ).toThrow(/invalidCalibrationQuery/)
  })
  it('rates first-pass findings per engine, excluding unknown review state', () => {
    // The merged review is a discriminated union: narrow the fake's known
    // review before overriding its rounds.
    const knownReview = (laneId: string) => {
      const review = fakeHistoryRecord(laneId).review
      if (review.status !== 'known') throw new Error(`fake ${laneId} review is not known`)
      return review
    }
    const history: HistoryRecord[] = [
      {
        ...fakeHistoryRecord('M117:a'),
        engine: 'codex',
        review: { ...knownReview('M117:a'), rounds: 2 },
      },
      {
        ...fakeHistoryRecord('M117:b'),
        engine: 'codex',
        review: { ...knownReview('M117:b'), rounds: 0 },
      },
      { ...fakeHistoryRecord('M117:c'), engine: 'codex', review: { status: 'unknown' } },
      { ...fakeHistoryRecord('M117:d'), engine: 'claude' },
    ]
    expect(engineFindingRate(history, 'codex')).toBe(0.5)
    expect(engineFindingRate(history, 'grok')).toBe(0)
    expect(() => engineFindingRate(history, 'gpt' as never)).toThrow(/invalidEngine/)
  })
})

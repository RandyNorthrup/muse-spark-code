import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import repositoryHistory from '../fixtures/estimator/repository-history.json'
import {
  buildHistory,
  collectHistory,
  type HistoryBuilderPorts,
  type HistoryLane,
} from '../../src/core/estimator/calibration/builders'
import {
  calibrationLabel,
  fitCalibration,
  laneRedesignRisk,
} from '../../src/core/estimator/calibration/fit'
import { calibrationPrior } from '../../src/core/estimator/calibration/prior'
import { canonicalHistory } from '../../src/core/estimator/calibration/records'
import { estimateSectionSchema, type HistoryRecord } from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { ESTIMATOR_AS_OF, FakeEstimateHistory } from './helpers/estimator/fakes'
import { fakeEstimate, fakeHistoryRecord } from './helpers/estimator/fixtures'

function samples(count: number): HistoryRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    ...fakeHistoryRecord(`M117:sample-${String(index)}`),
    actualHours: index % 2 === 0 ? 2 : 8,
  }))
}

function fit(records: readonly HistoryRecord[]) {
  return fitCalibration(records, 'core', 'linux-x64-builder', ESTIMATOR_AS_OF)
}

function lane(laneId = 'M117:C'): HistoryLane {
  return { laneId, kind: 'core', estimatedHours: 2, state: 'merged' }
}

function ports(): HistoryBuilderPorts {
  const record = fakeHistoryRecord()
  return {
    board: {
      duration: vi.fn(() =>
        Promise.resolve({
          actualHours: record.actualHours,
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
          machineClassId: record.machineClassId,
        }),
      ),
    },
    git: {
      duration: vi.fn(() =>
        Promise.resolve({
          startedAt: '2026-10-05T00:00:00.000Z',
          finishedAt: '2026-10-05T10:00:00.000Z',
          machineClassId: record.machineClassId,
        }),
      ),
    },
    playbook: { review: vi.fn(() => Promise.resolve(record.review)) },
    ci: { duration: vi.fn(() => Promise.resolve({ ciHours: record.ciHours })) },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  setUiText(EN, BASE_LOCALE)
})

describe('M117 calibration and its honest prior', () => {
  it('collects engine tags and ships finding profiles per engine, kind and class', async () => {
    const journal = new FakeEstimateHistory()
    const result = await collectHistory(
      journal,
      [{ ...lane(), engine: 'codex' }],
      ports(),
      ESTIMATOR_AS_OF,
    )
    expect(result.records[0]?.engine).toBe('codex')
    const collected = await journal.list()
    const tagged = collected[0]!
    const history: HistoryRecord[] = [
      tagged,
      { ...tagged, laneId: 'M117:unknown', review: { status: 'unknown' } },
      {
        ...tagged,
        laneId: 'M117:other-kind',
        kind: 'ui',
        review: { status: 'known', rounds: 0, modules: [], redesigns: [] },
      },
      {
        ...tagged,
        laneId: 'M117:other-class',
        machineClassId: 'macos',
        review: { status: 'known', rounds: 0, modules: [], redesigns: [] },
      },
      {
        ...tagged,
        laneId: 'M117:other-engine',
        engine: 'grok',
        review: { status: 'known', rounds: 0, modules: [], redesigns: [] },
      },
    ]
    const query = () =>
      fitCalibration(history, 'core', 'linux-x64-builder', ESTIMATOR_AS_OF, 'agentTime', 'codex')
    expect(query().calibration.firstPassFindingRate).toMatchObject({
      status: 'known',
      value: 1,
      basis: 'history',
      samples: 1,
    })
    history.push({
      ...tagged,
      laneId: 'M117:clean',
      review: { status: 'known', rounds: 0, modules: [], redesigns: [] },
    })
    expect(query().calibration.firstPassFindingRate).toMatchObject({ value: 0.5, samples: 2 })
    expect(
      fitCalibration([], 'core', 'linux-x64-builder', ESTIMATOR_AS_OF, 'agentTime', 'grok')
        .calibration.firstPassFindingRate,
    ).toMatchObject({ status: 'unknown', value: null, samples: 0 })
  })

  it('uses the documented prior below twenty samples and reports the available count', () => {
    for (const count of [0, 1, 19]) {
      const result = fit(samples(count))
      expect(result.calibration).toMatchObject({
        basis: 'uncalibratedPrior',
        samples: count,
        mu: 0,
        sigma: 0.5,
      })
      expect(result.evidence.durationParameters).toEqual({
        basis: 'assumption',
        samples: 0,
        uncertainty: { kind: 'unknown' },
      })
      expect(calibrationLabel(result)).toBe('Uncalibrated prior')
    }
  })

  it('replaces the prior at exactly twenty lanes with the lognormal ratio fit', () => {
    const result = fit(samples(20))
    expect(result.calibration).toMatchObject({ basis: 'fitted', samples: 20 })
    expect(result.calibration.mu).toBeCloseTo(Math.log(2), 12)
    expect(result.calibration.sigma).toBeCloseTo(Math.log(2), 12)
    expect(result.evidence.durationParameters).toEqual({
      basis: 'calibration',
      samples: 20,
      uncertainty: { kind: 'unknown' },
    })
    expect(calibrationLabel(result)).toBe('Calibrated from history')
    const section = fakeEstimate()
    section.calibration = [result.calibration]
    // Disclosures are the surface owner's concern; this exercises the frozen row shape itself.
    expect(estimateSectionSchema.shape.calibration.safeParse(section.calibration).success).toBe(
      true,
    )
  })

  it('does not pool kinds, machine classes, git elapsed time, zero hours or future observations', () => {
    const records = samples(19)
    records.push(
      { ...fakeHistoryRecord('M117:other-kind'), kind: 'ui' },
      { ...fakeHistoryRecord('M117:other-class'), machineClassId: 'macos-arm64-builder' },
      { ...fakeHistoryRecord('M117:git'), durationBasis: 'gitElapsed', source: 'git' },
      { ...fakeHistoryRecord('M117:zero'), actualHours: 0 },
      { ...fakeHistoryRecord('M117:future'), finishedAt: '2026-10-07T13:00:00.000Z' },
    )
    expect(fit(records).calibration).toMatchObject({ basis: 'uncalibratedPrior', samples: 19 })
    expect(
      fitCalibration(records, 'core', 'linux-x64-builder', ESTIMATOR_AS_OF, 'gitElapsed')
        .calibration.samples,
    ).toBe(1)
  })

  it('fits git elapsed time only when explicitly requested and names that basis', () => {
    const records = samples(20).map((record): HistoryRecord => ({
      ...record,
      durationBasis: 'gitElapsed',
      source: 'git',
    }))
    const result = fitCalibration(
      records,
      'core',
      'linux-x64-builder',
      ESTIMATOR_AS_OF,
      'gitElapsed',
    )
    expect(result).toMatchObject({
      durationBasis: 'gitElapsed',
      calibration: { basis: 'fitted', samples: 20 },
    })
    expect(fit(records).calibration.samples).toBe(0)
  })

  it('keeps constant samples positive and extreme ratios finite', () => {
    const constant = samples(20).map((record): HistoryRecord => ({ ...record, actualHours: 2 }))
    expect(fit(constant).calibration.sigma).toBe(Number.EPSILON)
    const extreme = samples(20).map((record, index): HistoryRecord => ({
      ...record,
      estimatedHours: index % 2 ? Number.MIN_VALUE : Number.MAX_VALUE,
      actualHours: index % 2 ? Number.MAX_VALUE : Number.MIN_VALUE,
    }))
    const result = fit(extreme).calibration
    expect(Number.isFinite(result.mu)).toBe(true)
    expect(Number.isFinite(result.sigma)).toBe(true)
    expect(result.sigma).toBeGreaterThan(1000)
  })

  it('counts replayed records once and rejects conflicting observations or lane identities', () => {
    const records = samples(19)
    expect(fit([...records, records[0]!]).calibration.samples).toBe(19)
    expect(() => fit([...records, { ...records[0]!, actualHours: 10 }])).toThrow(
      expect.objectContaining({ code: 'conflictingHistory' }),
    )
    expect(() =>
      fit([...records, { ...records[0]!, durationBasis: 'gitElapsed', kind: 'ui' }]),
    ).toThrow(expect.objectContaining({ code: 'conflictingLaneIdentity' }))
  })

  it('rejects malformed records and queries without echoing source content', () => {
    expect(() =>
      canonicalHistory([{ ...fakeHistoryRecord(), content: 'PRIVATE-CONTENT' }]),
    ).toThrow(expect.objectContaining({ code: 'invalidHistory' }))
    expect(() =>
      fitCalibration([], 'person@example.invalid', 'linux-x64-builder', ESTIMATOR_AS_OF),
    ).toThrow(expect.objectContaining({ code: 'invalidCalibrationQuery' }))
    expect(() => fitCalibration([], 'core', 'linux-x64-builder', 'yesterday')).toThrow(
      expect.objectContaining({ code: 'invalidCalibrationQuery' }),
    )
  })

  it('derives its cautious review prior from three distinct repository narratives', async () => {
    const prior = calibrationPrior()
    expect(prior).toMatchObject({ reviewRoundRate: 0.75, reviewSamples: 3, redesignRisk: 0.5 })
    expect(prior.reviewRecords.map((record) => record.rounds)).toEqual([4, 5, 3])
    const texts = await Promise.all(
      prior.reviewRecords.map(
        async (record) => await readFile(path.resolve(record.record), 'utf8'),
      ),
    )
    expect(texts[0]).toContain('fourth review round')
    expect(texts[1]).toContain('Five review rounds')
    expect(texts[2]).toContain('third round redesigns')
    expect(fit([]).evidence.reviewRoundRate).toMatchObject({
      basis: 'assumption',
      samples: 0,
      uncertainty: { kind: 'unknown' },
    })
  })

  it('fits complete review rounds once per lane rather than summing module strikes', () => {
    const records = samples(20).map((record): HistoryRecord => ({
      ...record,
      review: {
        status: 'known',
        rounds: 2,
        modules: [
          { familyId: 'a', strikes: 2, classes: [] },
          { familyId: 'b', strikes: 2, classes: [] },
        ],
        redesigns: [],
      },
    }))
    const result = fit(records)
    expect(result.calibration.reviewRoundRate).toBe(0.5)
    expect(result.reviewSamples).toBe(20)
    expect(result.evidence.reviewRoundRate).toMatchObject({ basis: 'calibration', samples: 20 })
  })

  it('keeps unknown and zero-round review histories out of rate fitting independently of durations', () => {
    const records = samples(19)
    records.push(
      { ...fakeHistoryRecord('M117:unknown'), review: { status: 'unknown' } },
      {
        ...fakeHistoryRecord('M117:zero-review'),
        review: { status: 'known', rounds: 0, modules: [], redesigns: [] },
      },
    )
    const result = fit(records)
    expect(result.calibration.basis).toBe('fitted')
    expect(result.reviewSamples).toBe(19)
    expect(result.evidence.reviewRoundRate).toMatchObject({
      value: 0.75,
      basis: 'assumption',
      samples: 0,
    })
  })

  it('fits conditional redesign risk using eligible families and counts each family event once', () => {
    const records = samples(20).map((record, index): HistoryRecord => ({
      ...record,
      review: {
        status: 'known',
        rounds: 3,
        modules: [
          { familyId: 'a', strikes: 2, classes: [{ class: 'testsGates', strikes: 2 }] },
          { familyId: 'b', strikes: 0, classes: [] },
        ],
        redesigns: [
          { moduleFamilyId: 'b', afterRound: 2, outcome: 'impossible' },
          ...(index % 2 === 0
            ? [
                { moduleFamilyId: 'a', afterRound: 2, outcome: 'caught' as const },
                { moduleFamilyId: 'a', afterRound: 3, outcome: 'remains' as const },
              ]
            : []),
        ],
      },
    }))
    const result = fit(records)
    expect(result.calibration.redesignRisk).toBe(0.75)
    expect(result.redesignSamples).toBe(20)
    expect(result.evidence.redesignRisk).toMatchObject({ basis: 'calibration', samples: 20 })
    expect(fit(records.slice(0, 19)).evidence.redesignRisk).toMatchObject({
      value: 0.5,
      basis: 'assumption',
      samples: 0,
    })
  })

  it('applies redesign risk only at two current module strikes and preserves unknown state', () => {
    const result = fit([])
    const review: HistoryRecord['review'] = {
      status: 'known',
      rounds: 2,
      modules: [
        { familyId: 'a', strikes: 1, classes: [] },
        { familyId: 'b', strikes: 1, classes: [] },
      ],
      redesigns: [],
    }
    expect(laneRedesignRisk(result, review)).toMatchObject({
      value: 0,
      uncertainty: { kind: 'interval', lower: 0, upper: 0 },
    })
    review.modules[0]!.strikes = 2
    expect(laneRedesignRisk(result, review)).toMatchObject({ value: 0.5, basis: 'assumption' })
    review.modules[1]!.strikes = 2
    expect(laneRedesignRisk(result, review).value).toBe(0.75)
    expect(laneRedesignRisk(result, { status: 'unknown' })).toMatchObject({
      status: 'unknown',
      value: null,
      basis: 'unknown',
    })
    review.modules[0]!.strikes = 3
    expect(() => laneRedesignRisk(result, review)).toThrow(
      expect.objectContaining({ code: 'invalidReviewState' }),
    )
  })

  it('does not double-count review or CI metadata when both duration bases exist', () => {
    const records = samples(19)
    const elapsed = records.map((record): HistoryRecord => ({
      ...record,
      durationBasis: 'gitElapsed',
      source: 'git',
    }))
    const result = fit([...records, ...elapsed])
    expect(result.reviewSamples).toBe(19)
    expect(result.evidence.ciHours).toMatchObject({ value: 0.1, basis: 'history', samples: 19 })
    expect(() => fit([...records, { ...elapsed[0]!, ciHours: 2 }])).toThrow(
      expect.objectContaining({ code: 'conflictingCiHistory' }),
    )
    expect(() =>
      fit([
        ...records,
        { ...elapsed[0]!, review: { status: 'known', rounds: 0, modules: [], redesigns: [] } },
      ]),
    ).toThrow(expect.objectContaining({ code: 'conflictingReviewHistory' }))
  })

  it('enriches missing review and CI measurements from the other duration basis', () => {
    const board = fakeHistoryRecord()
    delete board.ciHours
    board.review = { status: 'unknown' }
    const elapsed: HistoryRecord = {
      ...fakeHistoryRecord(),
      durationBasis: 'gitElapsed',
      source: 'git',
    }
    const result = fit([board, elapsed])
    expect(result.reviewSamples).toBe(1)
    expect(result.evidence.ciHours).toMatchObject({ status: 'known', samples: 1, value: 0.1 })
    expect(fit([board]).evidence.ciHours).toMatchObject({
      status: 'unknown',
      value: null,
      basis: 'unknown',
      samples: 0,
    })
    expect(fit([{ ...board, ciHours: 0 }]).evidence.ciHours).toMatchObject({
      status: 'known',
      value: 0,
    })
  })

  it('reads the translated calibration label at call time', () => {
    const prior = fit([])
    const fitted = fit(samples(20))
    setUiText(
      { ...EN, estimatePrior: 'Prior sin calibrar', estimateFitted: 'Calibrado con el historial' },
      'es',
    )
    expect(calibrationLabel(prior)).toBe(UI_TEXT.estimatePrior)
    expect(calibrationLabel(fitted)).toBe(UI_TEXT.estimateFitted)
  })
})

describe('M117 board, git, M116 and CI history builders', () => {
  it('builds active time with complete review state and CI job-hours, preferring board over git', async () => {
    const sources = ports()
    const built = await buildHistory([lane()], sources, ESTIMATOR_AS_OF)
    expect(built).toEqual({ records: [{ ...fakeHistoryRecord('M117:C') }], excluded: [] })
    expect(sources.git?.duration).not.toHaveBeenCalled()
    expect(sources.playbook?.review).toHaveBeenCalledWith('M117:C', ESTIMATOR_AS_OF)
  })

  it('derives git elapsed hours only without a board measurement and keeps missing review/CI unknown', async () => {
    const sources = ports()
    const built = await buildHistory([lane()], { git: sources.git! }, ESTIMATOR_AS_OF)
    expect(built.records[0]).toMatchObject({
      durationBasis: 'gitElapsed',
      source: 'git',
      actualHours: 10,
      review: { status: 'unknown' },
    })
    expect(built.records[0]).not.toHaveProperty('ciHours')
    const board = { duration: vi.fn(() => Promise.resolve(undefined)) }
    const fallback = await buildHistory([lane()], { board, git: sources.git! }, ESTIMATOR_AS_OF)
    expect(fallback.records).toEqual(built.records)
  })

  it('excludes unmerged lanes and missing estimates without calling any source', async () => {
    const sources = ports()
    const built = await buildHistory(
      [
        { ...lane('M117:planned'), state: 'planned' },
        { ...lane('M117:running'), state: 'running' },
        { ...lane('M117:missing'), estimatedHours: null },
      ],
      sources,
      ESTIMATOR_AS_OF,
    )
    expect(built.records).toEqual([])
    expect(built.excluded).toEqual([
      { laneId: 'M117:missing', reason: 'missingEstimate' },
      { laneId: 'M117:planned', reason: 'notMerged' },
      { laneId: 'M117:running', reason: 'notMerged' },
    ])
    expect(sources.board?.duration).not.toHaveBeenCalled()
  })

  it('does not fabricate calibration observations for M103/M104 fixture rows without estimates', async () => {
    const sources = ports()
    const targets = repositoryHistory.lanes.map((record): HistoryLane => ({
      laneId: record.laneId,
      kind: 'core',
      estimatedHours: record.estimatedHours,
      state: 'merged',
    }))
    const built = await buildHistory(targets, sources, repositoryHistory.asOf)
    expect(built.records).toEqual([])
    expect(built.excluded).toHaveLength(25)
    expect(built.excluded.every((record) => record.reason === 'missingEstimate')).toBe(true)
    expect(sources.board?.duration).not.toHaveBeenCalled()
  })

  it('reports missing durations and after-snapshot results explicitly', async () => {
    expect(await buildHistory([lane()], {}, ESTIMATOR_AS_OF)).toEqual({
      records: [],
      excluded: [{ laneId: 'M117:C', reason: 'missingDuration' }],
    })
    const git = {
      duration: vi.fn(() =>
        Promise.resolve({
          machineClassId: 'linux-x64-builder',
          startedAt: '2026-10-06T00:00:00.000Z',
          finishedAt: '2026-10-07T00:00:00.000Z',
        }),
      ),
    }
    const future = await buildHistory([lane()], { git }, ESTIMATOR_AS_OF)
    expect(future.excluded).toEqual([{ laneId: 'M117:C', reason: 'afterSnapshot' }])
  })

  it('rejects invalid targets, duplicate lanes and invalid snapshot dates', async () => {
    await expect(
      buildHistory([{ ...lane(), estimatedHours: 0 }], {}, ESTIMATOR_AS_OF),
    ).rejects.toMatchObject({ code: 'invalidHistoryLane' })
    await expect(buildHistory([lane(), lane()], {}, ESTIMATOR_AS_OF)).rejects.toMatchObject({
      code: 'duplicateHistoryLane',
    })
    await expect(buildHistory([], {}, 'today')).rejects.toMatchObject({ code: 'invalidSnapshot' })
  })

  it('fails loudly on malformed projections and does not fall back from a damaged board to git', async () => {
    const sources = ports()
    const board = { duration: vi.fn(() => Promise.resolve({ content: 'PRIVATE-SOURCE-CONTENT' })) }
    await expect(
      buildHistory([lane()], { ...sources, board }, ESTIMATOR_AS_OF),
    ).rejects.toMatchObject({ code: 'invalidHistorySource' })
    expect(sources.git?.duration).not.toHaveBeenCalled()
    const playbook = {
      review: vi.fn(() =>
        Promise.resolve({
          status: 'known',
          rounds: 2,
          modules: [{ familyId: 'a', strikes: 3, classes: [] }],
          redesigns: [],
        }),
      ),
    }
    await expect(
      buildHistory([lane()], { ...sources, playbook }, ESTIMATOR_AS_OF),
    ).rejects.toMatchObject({ code: 'invalidHistorySource' })
    const ci = { duration: vi.fn(() => Promise.resolve({ ciHours: -1 })) }
    await expect(buildHistory([lane()], { ...sources, ci }, ESTIMATOR_AS_OF)).rejects.toMatchObject(
      { code: 'invalidHistorySource' },
    )
    const nullReview = { review: vi.fn(() => Promise.resolve(null)) }
    await expect(
      buildHistory([lane()], { ...sources, playbook: nullReview }, ESTIMATOR_AS_OF),
    ).rejects.toMatchObject({ code: 'invalidHistorySource' })
    const git = {
      duration: vi.fn(() =>
        Promise.resolve({
          machineClassId: 'linux-x64-builder',
          startedAt: '2026-10-06T00:00:00.000Z',
          finishedAt: '2026-10-05T00:00:00.000Z',
        }),
      ),
    }
    await expect(buildHistory([lane()], { git }, ESTIMATOR_AS_OF)).rejects.toMatchObject({
      code: 'invalidHistory',
    })
  })

  it('sanitizes failing sources and propagates journal refusal', async () => {
    const board = {
      duration: vi.fn(() => Promise.reject(new Error('/private/path PRIVATE-SOURCE-CONTENT'))),
    }
    await expect(buildHistory([lane()], { board }, ESTIMATOR_AS_OF)).rejects.toMatchObject({
      code: 'historySourceUnavailable',
      message: 'Estimate failed: historySourceUnavailable',
    })
    const journal = new FakeEstimateHistory()
    vi.spyOn(journal, 'append').mockRejectedValue(new Error('journal refused'))
    await expect(collectHistory(journal, [lane()], ports(), ESTIMATOR_AS_OF)).rejects.toThrow(
      'journal refused',
    )
  })

  it('collects canonical records in stable lane order without mutating its inputs', async () => {
    const targets = [lane('M117:B'), lane('M117:A')]
    const before = JSON.stringify(targets)
    const journal = new FakeEstimateHistory()
    const built = await collectHistory(journal, targets, ports(), ESTIMATOR_AS_OF)
    expect(await journal.list()).toEqual(built.records)
    expect(built.records.map((record) => record.laneId)).toEqual(['M117:A', 'M117:B'])
    expect(JSON.stringify(targets)).toBe(before)
  })
})

describe('M117 calibration determinism', () => {
  let directory: string
  let runner: string
  beforeAll(async () => {
    await mkdir(path.resolve('temp/m117-c'), { recursive: true })
    directory = await mkdtemp(path.resolve('temp/m117-c/determinism-'))
    runner = path.join(directory, 'runner.mjs')
    const root = path.resolve('.').replaceAll('\\', '/')
    await build({
      stdin: {
        contents: `import { fitCalibration } from ${JSON.stringify(root + '/src/core/estimator/calibration/fit.ts')}; process.stdout.write(JSON.stringify(fitCalibration(JSON.parse(process.argv[2]), 'core', 'linux-x64-builder', '${ESTIMATOR_AS_OF}')));`,
        resolveDir: root,
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: runner,
    })
  })
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('is byte-identical with reordered records and review families, without reading the clock', () => {
    const records = samples(20).map((record): HistoryRecord => ({
      ...record,
      review: {
        status: 'known',
        rounds: 2,
        modules: [
          {
            familyId: 'z',
            strikes: 2,
            classes: [
              { class: 'docs', strikes: 1 },
              { class: 'testsGates', strikes: 2 },
            ],
          },
          { familyId: 'a', strikes: 1, classes: [] },
        ],
        redesigns: [],
      },
    }))
    const before = JSON.stringify(records)
    const result = JSON.stringify(fit(records))
    const reversed = structuredClone(records).toReversed()
    for (const record of reversed) {
      if (record.review.status !== 'known') throw new Error('expected known review')
      record.review.modules.reverse()
      for (const module of record.review.modules) module.classes.reverse()
    }
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock read')
    })
    expect(JSON.stringify(fit(reversed))).toBe(result)
    expect(JSON.stringify(fit(records))).toBe(result)
    expect(JSON.stringify(records)).toBe(before)
  })

  it('is byte-identical in child processes with different time zones and languages', async () => {
    const input = JSON.stringify(samples(20))
    const run = promisify(execFile)
    const outputs = await Promise.all([
      run(process.execPath, [runner, input], { env: { TZ: 'UTC', LANG: 'C' } }),
      run(process.execPath, [runner, input], {
        env: { TZ: 'Pacific/Auckland', LANG: 'de_DE.UTF-8' },
      }),
    ])
    expect(outputs[0].stderr).toBe('')
    expect(outputs[1].stderr).toBe('')
    expect(outputs[0].stdout).toBe(outputs[1].stdout)
    expect(outputs[0].stdout).toBe(JSON.stringify(fit(samples(20))))
  })
})

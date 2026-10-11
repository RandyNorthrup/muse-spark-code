// M113 C-M113-4: the estimate report kind runs M117's engine through the
// injected reader and projects the six D93.4 facets. Engine failures stay
// failures with their code; rows are never invented.
import { describe, expect, it, vi } from 'vitest'
import { estimateReportSections } from '../../src/core/reporting/collect/estimate'
import {
  estimateSource,
  type ReportEstimateReader,
} from '../../src/core/reporting/sources/estimate'
import { createEstimateReportReader } from '../../src/runtime/reporting/reportInputs'
import { UI_TEXT } from '../../src/shared/constants'
import type { EstimateRequest, EstimateSection } from '../../src/shared/estimate'
import type { ReportRow } from '../../src/shared/reportSchema'
import type { SourceReadContext } from '../../src/core/reporting/sources/types'

function textCell(entry: ReportRow, key: string): string | undefined {
  const cell = entry.cells[key]
  return cell?.type === 'text' ? cell.value : undefined
}
import { fakeEstimate } from './helpers/estimator/fixtures'
import { ESTIMATOR_AS_OF } from './helpers/estimator/fakes'
import { availableSource, reportOptions, REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'
import { fullSnapshot, getSection } from './helpers/reporting/collect'
import { renderAllFormats, renderTestCollector } from './helpers/reporting/render'

const scrub = (text: string) => text.replaceAll('private-canary', '[redacted]')

function estimateContext(options?: {
  scope?: string
  asOf?: string
  fleet?: 'current' | 'minimum' | 'optimum'
  deadline?: string
  kind?: SourceReadContext['options']['kind']
}): SourceReadContext {
  return {
    asOf: options?.asOf ?? ESTIMATOR_AS_OF,
    workspaceKey: 'fixture',
    options: reportOptions(options?.kind ?? 'estimate', {
      scope: options?.scope ?? 'M117',
      ...(options?.fleet !== undefined && { fleet: options.fleet }),
      ...(options?.deadline !== undefined && { deadline: options.deadline }),
    }),
    signal: new AbortController().signal,
  }
}

function readerFor(section: unknown, observedAt = ESTIMATOR_AS_OF): ReportEstimateReader {
  return { read: () => Promise.resolve({ section, observedAt }) }
}

function sectionIds(data: readonly { id: string }[]): string[] {
  return data.map((entry) => entry.id)
}

describe('estimate report source', () => {
  it('E1 reports unbound when no estimator binding is supplied', async () => {
    const result = await estimateSource(undefined, scrub).read(estimateContext())
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(UI_TEXT.reportSourceReasons.unbound)
    expect(result.data).toBeNull()
  })

  it('E2 stays out of other kinds as not applicable', async () => {
    const result = await estimateSource(readerFor(fakeEstimate()), scrub).read(
      estimateContext({ kind: 'project' }),
    )
    expect(result.record.status).toBe('notApplicable')
    expect(result.record.reason).toBe(UI_TEXT.reportSourceReasons.disabled)
    expect(result.data).toBeNull()
  })

  it('E3 refuses a scope that is no D97.2 goal as invalid', async () => {
    const read = vi.fn()
    const result = await estimateSource({ read }, scrub).read(
      estimateContext({ scope: '!!! not a goal !!!' }),
    )
    expect(read).not.toHaveBeenCalled()
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(UI_TEXT.reportSourceReasons.invalid)
    expect(result.data).toBeNull()
  })

  it('E4 projects the six D93.4 facets from the engine run', async () => {
    const section = fakeEstimate()
    const read = vi.fn().mockResolvedValue({ section, observedAt: ESTIMATOR_AS_OF })
    const result = await estimateSource({ read }, scrub).read(estimateContext())
    expect(result.record.status).toBe('ok')
    // The validated request crosses into the engine: milestone goal, the
    // generation stamp, the current fleet, cost optimization.
    const request: EstimateRequest = read.mock.calls[0]?.[0]
    expect(request).toEqual({
      goal: { kind: 'milestone', milestoneId: 'M117' },
      asOf: ESTIMATOR_AS_OF,
      fleet: 'current',
      optimize: 'cost',
    })
    const data = result.data ?? []
    expect(sectionIds(data)).toEqual([
      'estimate/totals',
      'estimate/criticalPath',
      'estimate/limitingResource',
      'estimate/setups',
      'estimate/inputs',
      'estimate/calibration',
    ])
    const totals = data[0]
    expect(totals?.label).toBe('totals')
    // Row keys are digests, so rows are found by cell, in any key order.
    const byName = new Map(
      (totals?.rows ?? []).map((entry) => [textCell(entry, 'name'), entry.cells['date']] as const),
    )
    expect(byName.get('p50')).toEqual({ type: 'timestamp', value: section.p50 })
    expect(byName.get('p90')).toEqual({ type: 'timestamp', value: section.p90 })
    expect(data[1]?.rows.map((entry) => entry.cells['name'])).toEqual(
      section.criticalPath.map((laneId) => ({ type: 'text', value: laneId })),
    )
    const [firstSetup] = section.setups
    const [firstMachine] = firstSetup?.machines ?? []
    const [firstCalibration] = section.calibration
    expect(
      data[3]?.rows.find(
        (entry) => entry.cells['machine']?.type === 'text' && entry.cells['setup']?.type === 'text',
      )?.cells['machine'],
    ).toEqual({ type: 'text', value: firstMachine?.classId })
    expect(
      data[5]?.rows.find((entry) => textCell(entry, 'kind') === firstCalibration?.kind)?.cells[
        'samples'
      ],
    ).toEqual({ type: 'count', value: firstCalibration?.samples })
  })

  it('E5 carries --by and --fleet into the request and checks the echo', async () => {
    const deadline = '2026-12-01T23:59:59+00:00'
    const base = fakeEstimate()
    const section: EstimateSection = {
      ...base,
      inputs: {
        ...base.inputs,
        request: {
          goal: { kind: 'milestone', milestoneId: 'M117' },
          asOf: ESTIMATOR_AS_OF,
          fleet: 'minimum',
          optimize: 'cost',
          deadline: '2026-12-01T23:59:59.000Z',
        },
      },
    }
    const read = vi.fn().mockResolvedValue({ section, observedAt: ESTIMATOR_AS_OF })
    const result = await estimateSource({ read }, scrub).read(
      estimateContext({ fleet: 'minimum', deadline }),
    )
    expect(result.record.status).toBe('ok')
    // The estimator's instants end in Z: the `+00:00` deadline `--by`
    // builds crosses normalized to the same UTC instant.
    expect(read.mock.calls[0]?.[0]).toMatchObject({
      fleet: 'minimum',
      deadline: '2026-12-01T23:59:59.000Z',
    })
  })

  it('E5b normalizes an offset report stamp to the same UTC instant', async () => {
    const section = fakeEstimate()
    const read = vi.fn().mockResolvedValue({ section, observedAt: ESTIMATOR_AS_OF })
    const result = await estimateSource({ read }, scrub).read(
      estimateContext({ asOf: REPORT_FIXTURE_AS_OF }),
    )
    expect(result.record.status).toBe('ok')
    expect(read.mock.calls[0]?.[0]).toMatchObject({ asOf: ESTIMATOR_AS_OF })
  })

  it('E6 refuses a run that answers another request instead of inventing rows', async () => {
    const result = await estimateSource(readerFor(fakeEstimate()), scrub).read(
      estimateContext({ fleet: 'minimum' }),
    )
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(UI_TEXT.reportSourceReasons.invalid)
    expect(result.data).toBeNull()
  })

  it('E7 reports a missing run as failed with the estimator fallback, never empty success', async () => {
    const result = await estimateSource({ read: () => Promise.resolve(null) }, scrub).read(
      estimateContext(),
    )
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe('Estimate failed: estimate-unavailable')
    expect(result.data).toBeNull()
  })

  it('E8 reports a refused engine run as failed with its typed reason', async () => {
    const refusal = Object.assign(new Error('Estimate failed: missing-estimate: M117:C-M117-9'), {
      estimateDiagnostic: 'missing-estimate: M117:C-M117-9',
    })
    const result = await estimateSource(
      {
        read: () => {
          throw refusal
        },
      },
      scrub,
    ).read(estimateContext())
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe('Estimate failed: missing-estimate: M117:C-M117-9')
    expect(result.data).toBeNull()
  })

  it('E9 scrubs the partial while the engine detail stays with /estimate', async () => {
    const result = await estimateSource(
      {
        read: () =>
          Promise.resolve({
            section: fakeEstimate(),
            observedAt: ESTIMATOR_AS_OF,
            partial: 'private-canary note',
          }),
      },
      scrub,
    ).read(estimateContext())
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toBe('[redacted] note')
    expect(result.data).not.toBeNull()
  })

  it('E15 names every refusal the estimator can return instead of the generic sentence', async () => {
    const typed = (diagnostic: string): Error =>
      Object.assign(new Error(`Estimate failed: ${diagnostic}`), {
        estimateDiagnostic: diagnostic,
      })
    const refusals: readonly (readonly [name: string, error: Error, reason: string])[] = [
      [
        'snapshot missing hours',
        typed('missing-estimate: M117:C-M117-9'),
        'Estimate failed: missing-estimate: M117:C-M117-9',
      ],
      ['unknown goal', typed('unknown-goal: M999'), 'Estimate failed: unknown-goal: M999'],
      [
        'unknown prerequisite',
        typed('unknown-prerequisite: M117:zzz'),
        'Estimate failed: unknown-prerequisite: M117:zzz',
      ],
      [
        'unknown release member',
        typed('unknown-release-member: M117'),
        'Estimate failed: unknown-release-member: M117',
      ],
      [
        'unknown rig',
        typed('unknown-rig: M117:x:kubuntu2'),
        'Estimate failed: unknown-rig: M117:x:kubuntu2',
      ],
      [
        'duplicate lane',
        typed('duplicate-lane: M117:x'),
        'Estimate failed: duplicate-lane: M117:x',
      ],
      [
        'malformed starts',
        typed('malformed-starts: M117:x line 12'),
        'Estimate failed: malformed-starts: M117:x line 12',
      ],
      ['missing plan', typed('missing-plan: PLAN.md'), 'Estimate failed: missing-plan: PLAN.md'],
      [
        'missing associations',
        typed('missing-associations: milestone'),
        'Estimate failed: missing-associations: milestone',
      ],
      [
        'source unavailable',
        typed('source-unavailable: pull-requests'),
        'Estimate failed: source-unavailable: pull-requests',
      ],
      [
        'source incomplete',
        typed('source-incomplete: branches'),
        'Estimate failed: source-incomplete: branches',
      ],
      ['invalid lane', typed('invalid-lane: M117:x'), 'Estimate failed: invalid-lane: M117:x'],
      ['plan drift', typed('plan-drift: M117'), 'Estimate failed: plan-drift: M117'],
      ['lane limit', typed('lane-limit'), 'Estimate failed: lane-limit'],
      [
        'refusal secret scrubbed',
        typed('unknown-prerequisite: M117:private-canary'),
        'Estimate failed: unknown-prerequisite: M117:[redacted]',
      ],
      [
        'engine no feasible setup',
        new Error('Estimate failed: no-feasible-setup'),
        'Estimate failed: no-feasible-setup',
      ],
      [
        'engine missing fit',
        new Error('Estimate failed: missing-fit'),
        'Estimate failed: missing-fit',
      ],
      [
        'schedule unschedulable',
        new Error('Estimate failed: unschedulable:M117:x'),
        'Estimate failed: unschedulable:M117:x',
      ],
      ['no fleet capacity', new Error(UI_TEXT.estimateNoCapacity), UI_TEXT.estimateNoCapacity],
      [
        'goal not found',
        new Error('Goal not found: {"kind":"milestone"}'),
        'Goal not found: {"kind":"milestone"}',
      ],
      ['unshaped failure stays generic', new Error('boom'), UI_TEXT.reportSourceReasons.failed],
      [
        'forged diagnostic stays generic',
        Object.assign(new Error('nope'), { estimateDiagnostic: '../../etc/passwd' }),
        UI_TEXT.reportSourceReasons.failed,
      ],
      [
        'bare diagnostic text stays generic',
        new Error('missing-estimate: M117:C-M117-9'),
        UI_TEXT.reportSourceReasons.failed,
      ],
    ]
    for (const [name, error, reason] of refusals) {
      const result = await estimateSource(
        {
          read: () => {
            throw error
          },
        },
        scrub,
      ).read(estimateContext())
      expect(result.record.status, name).toBe('unavailable')
      expect(result.record.reason, name).toBe(reason)
      expect(result.data, name).toBeNull()
    }
  })

  it('E16 stamps the run at the request instant, so the report reads fresh', async () => {
    const section = fakeEstimate()
    const result = await estimateSource(
      { read: () => Promise.resolve({ section, observedAt: ESTIMATOR_AS_OF }) },
      scrub,
    ).read(estimateContext())
    expect(result.record.status).toBe('ok')
    expect(result.record.observedAt).toBe(ESTIMATOR_AS_OF)
    expect(result.record.freshness).toEqual({ state: 'fresh', ageMs: 0 })
  })

  it('E10 orders content-addressed rows by key whatever order the engine lists them in', () => {
    const base = fakeEstimate()
    const reversed: EstimateSection = {
      ...base,
      calibration: base.calibration.toReversed(),
    }
    const options = reportOptions('estimate', { scope: 'M117' })
    expect(estimateReportSections(reversed, options)).toEqual(estimateReportSections(base, options))
  })
})

describe('estimate report inputs', () => {
  it('E11 runs the validated request through the host engine', async () => {
    const section = fakeEstimate()
    const run = vi.fn().mockResolvedValue(section)
    const context = estimateContext()
    const request: EstimateRequest = {
      goal: { kind: 'milestone', milestoneId: 'M117' },
      asOf: ESTIMATOR_AS_OF,
      fleet: 'current',
      optimize: 'cost',
    }
    const result = await createEstimateReportReader({ run }).read(request, context)
    expect(run).toHaveBeenCalledWith(request, context.signal)
    expect(result).toEqual({ section, observedAt: ESTIMATOR_AS_OF })
  })

  it('E12 propagates the engine failure instead of masking it', async () => {
    const failure = new Error('missing-estimate: M117:C-M117-9')
    const run = vi.fn().mockRejectedValue(failure)
    await expect(
      createEstimateReportReader({ run }).read(
        {
          goal: { kind: 'milestone', milestoneId: 'M117' },
          asOf: ESTIMATOR_AS_OF,
          fleet: 'current',
          optimize: 'cost',
        },
        estimateContext(),
      ),
    ).rejects.toBe(failure)
  })
})

describe('estimate report collection', () => {
  it('E13 collects the estimate kind end to end and renders every format', () => {
    const options = reportOptions('estimate', { scope: 'M117' })
    const snapshot = fullSnapshot()
    const sections = estimateReportSections(fakeEstimate(), options)
    // The production finalizer, like the engine: timestamp cells are
    // rewritten at the report offset before the hash is sealed.
    const document = renderTestCollector(
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          estimate: availableSource('estimate', sections),
        },
      },
      options,
    )
    expect(document.header.kind).toBe('estimate')
    for (const id of [
      'estimate/totals',
      'estimate/criticalPath',
      'estimate/limitingResource',
      'estimate/setups',
      'estimate/inputs',
      'estimate/calibration',
    ])
      expect(getSection(document, id).rows.length).toBeGreaterThan(0)
    const rendered = renderAllFormats(document)
    expect(rendered.md).toContain('## Critical path')
    expect(rendered.md).toContain('## Totals')
    expect(rendered.text).toContain('Critical path')
    expect(rendered.json).toContain('"kind": "estimate"')
    expect(rendered.html).toContain('Critical path')
  })

  it('E14 caps long lane lists with an omitted-row count instead of dropping them silently', () => {
    const base = fakeEstimate()
    const [firstLane] = base.inputs.lanes
    if (firstLane === undefined) throw new Error('Missing estimate fixture lane')
    const lanes = Array.from({ length: 12 }, (_, index) => ({
      ...firstLane,
      id: `M117:lane-${String(index).padStart(2, '0')}`,
    }))
    const section: EstimateSection = {
      ...base,
      inputs: { ...base.inputs, lanes },
    }
    const options = reportOptions('estimate', { scope: 'M117' })
    const inputs = estimateReportSections(section, options).find(
      (entry) => entry.id === 'estimate/inputs',
    )
    expect(inputs?.rows.length).toBeLessThanOrEqual(10)
    expect(inputs?.omittedRows).toBe(12 - (inputs?.rows.length ?? 0))
    expect(inputs?.omittedRows).toBeGreaterThan(0)
  })
})

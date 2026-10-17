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
import { readFileSync } from 'node:fs'
import { fakeEstimate } from './helpers/estimator/kindFixtures'
import { ESTIMATOR_AS_OF } from './helpers/estimator/kindFakes'
import { FakeLogOutputChannel } from './helpers/fakes'
import { installGerman, restoreEnglish } from './helpers/kindGermanTable'
import germanTable from '../../l10n/ui.de.json'
import { loadUiTable } from '../../src/host/l10n'
import { EN, type UiText } from '../../src/shared/l10n/en'
import { fill, setUiText } from '../../src/shared/l10n/text'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { parseEstimateGoal } from '../../src/shared/estimate'
import {
  availableSource,
  reportOptions,
  REPORT_FIXTURE_AS_OF,
} from './helpers/reporting/kindFixtures'
import { fullSnapshot, getSection } from './helpers/reporting/kindFixtures'
import { renderAllFormats, renderTestCollector } from './helpers/reporting/kindRender'

const scrub = (text: string) => text.replaceAll('private-canary', '[redacted]')

function estimateContext(options?: {
  scope?: string
  asOf?: string
  fleet?: 'current' | 'minimum' | 'optimum'
  deadline?: string
  kind?: SourceReadContext['options']['kind']
  reportText?: UiText
  locale?: string
}): SourceReadContext {
  return {
    reportText: options?.reportText ?? EN,
    locale: options?.locale ?? 'en',
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

function throwing(diagnostic: string, message: string): Error {
  return Object.assign(new Error(message), { estimateDiagnostic: diagnostic })
}

async function estimateReason(error: Error, context?: SourceReadContext): Promise<unknown> {
  const result = await estimateSource(
    {
      read: () => {
        throw error
      },
    },
    scrub,
  ).read(context ?? estimateContext())
  expect(result.record.status).toBe('unavailable')
  expect(result.data).toBeNull()
  return result.record.reason
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
    const generic = UI_TEXT.reportSourceReasons.failed
    const goalJson = '{"kind":"milestone","milestoneId":"M117"}'
    const refusals: readonly (readonly [name: string, error: Error, reason: string])[] = [
      [
        'snapshot missing hours',
        typed('missing-estimate: M117:C-M117-9'),
        'Estimate failed: missing-estimate: M117:C-M117-9',
      ],
      ['unknown goal', typed('unknown-goal: M999'), 'Goal not found: M999'],
      [
        'bare unknown goal names the request goal',
        typed('unknown-goal'),
        `Goal not found: ${goalJson}`,
      ],
      ['typed capacity', typed('no-capacity'), UI_TEXT.estimateNoCapacity],
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
      // A bare sentence carries no typed diagnostic: generic, never named.
      ['engine no feasible setup', new Error('Estimate failed: no-feasible-setup'), generic],
      ['engine missing fit', new Error('Estimate failed: missing-fit'), generic],
      ['schedule unschedulable', new Error('Estimate failed: unschedulable:M117:x'), generic],
      ['capacity sentence without a diagnostic', new Error(UI_TEXT.estimateNoCapacity), generic],
      [
        'goal sentence without a diagnostic',
        new Error('Goal not found: {"kind":"milestone"}'),
        generic,
      ],
      ['unshaped failure stays generic', new Error('boom'), generic],
      [
        'forged diagnostic stays generic',
        Object.assign(new Error('nope'), { estimateDiagnostic: '../../etc/passwd' }),
        generic,
      ],
      ['bare diagnostic text stays generic', new Error('missing-estimate: M117:C-M117-9'), generic],
      [
        'retired goal seam stays generic',
        Object.assign(new Error('nope'), { estimateDiagnostic: `goal-not-found: ${goalJson}` }),
        generic,
      ],
      [
        'attached refusal stays generic',
        Object.assign(new Error('nope'), { estimateRefusal: { kind: 'noCapacity' } }),
        generic,
      ],
      [
        'attached goal sentence stays generic',
        Object.assign(new Error('nope'), {
          estimateRefusal: { kind: 'notFound', goal: 'This is a pre-rendered English sentence' },
        }),
        generic,
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

  it('E17 names every refusal in the report language; estimator sentences never cross', async () => {
    const goalJson = '{"kind":"milestone","milestoneId":"M117"}'
    // Messages the estimator may render in any language (or none at all):
    // the report consumes only the typed diagnostic, so every one of these
    // is ignored. (RVCM1134G P1: no sentence decoding survives.)
    const messages = [
      EN.estimateNoCapacity,
      germanTable.estimateNoCapacity,
      fill(EN.estimateFailed, { detail: 'kaput' }),
      'kaput',
    ]
    interface RefusalCase {
      readonly name: string
      readonly diagnostic: string
      readonly german: () => string
      readonly english: () => string
    }
    const refusals: readonly RefusalCase[] = [
      {
        name: 'grammar diagnostic',
        diagnostic: 'missing-estimate: M117:C-M117-9',
        german: () =>
          fill(germanTable.estimateFailed, { detail: 'missing-estimate: M117:C-M117-9' }),
        english: () => fill(EN.estimateFailed, { detail: 'missing-estimate: M117:C-M117-9' }),
      },
      {
        name: 'engine no feasible setup',
        diagnostic: 'no-feasible-setup',
        german: () => fill(germanTable.estimateFailed, { detail: 'no-feasible-setup' }),
        english: () => fill(EN.estimateFailed, { detail: 'no-feasible-setup' }),
      },
      {
        name: 'schedule unschedulable',
        diagnostic: 'unschedulable:M117:x',
        german: () => fill(germanTable.estimateFailed, { detail: 'unschedulable:M117:x' }),
        english: () => fill(EN.estimateFailed, { detail: 'unschedulable:M117:x' }),
      },
      {
        name: 'no fleet capacity',
        diagnostic: 'no-capacity',
        german: () => germanTable.estimateNoCapacity,
        english: () => EN.estimateNoCapacity,
      },
      {
        name: 'unknown goal',
        diagnostic: 'unknown-goal: M999',
        german: () => fill(germanTable.estimateNotFound, { goal: 'M999' }),
        english: () => fill(EN.estimateNotFound, { goal: 'M999' }),
      },
      {
        name: 'bare unknown goal',
        diagnostic: 'unknown-goal',
        german: () => fill(germanTable.estimateNotFound, { goal: goalJson }),
        english: () => fill(EN.estimateNotFound, { goal: goalJson }),
      },
    ]
    expect(await installGerman(new FakeLogOutputChannel())).toBe('de')
    const germanContext = () => estimateContext({ reportText: germanTable, locale: 'de' })
    try {
      for (const refusal of refusals) {
        for (const message of messages) {
          // A German report over any estimator sentence: the report
          // language's sentence, never the estimator's words.
          expect(
            await estimateReason(throwing(refusal.diagnostic, message), germanContext()),
            `${refusal.name} (German report, message ${JSON.stringify(message)})`,
          ).toBe(refusal.german())
        }
      }
    } finally {
      restoreEnglish()
    }
    // And the reverse: an English report over German estimator sentences.
    for (const refusal of refusals) {
      for (const message of messages) {
        expect(
          await estimateReason(throwing(refusal.diagnostic, message)),
          `${refusal.name} (English report, message ${JSON.stringify(message)})`,
        ).toBe(refusal.english())
      }
    }
  })

  it('E18 keeps forged failure sentences generic in every language', async () => {
    // A message that merely starts with the failure prefix but carries a
    // path traversal is decoded by no channel: generic, not the raw message.
    expect(await estimateReason(new Error('Estimate failed: ../../etc/passwd'))).toBe(
      UI_TEXT.reportSourceReasons.failed,
    )
    expect(await installGerman(new FakeLogOutputChannel())).toBe('de')
    const { table } = await loadUiTable({
      language: 'de',
      readExtensionFile: () =>
        Promise.resolve(readFileSync(new URL('../../l10n/ui.de.json', import.meta.url), 'utf8')),
      log: new FakeLogOutputChannel(),
    })
    const germanContext = () => estimateContext({ reportText: table, locale: 'de' })
    try {
      expect(
        await estimateReason(
          new Error(fill(germanTable.estimateFailed, { detail: '../../etc/passwd' })),
          germanContext(),
        ),
      ).toBe(table.reportSourceReasons.failed)
      // A forged diagnostic travels generic too, whatever it claims.
      expect(
        await estimateReason(
          Object.assign(new Error('nope'), { estimateDiagnostic: '../../etc/passwd' }),
          germanContext(),
        ),
      ).toBe(table.reportSourceReasons.failed)
      // An invalid diagnostic with a MATCHING capacity sentence still stays
      // generic: the sentence is never decoded into a named refusal
      // (RVCM1134G P1 scenario).
      expect(
        await estimateReason(
          Object.assign(new Error(germanTable.estimateNoCapacity), {
            estimateDiagnostic: '../../etc/passwd',
          }),
          germanContext(),
        ),
      ).toBe(table.reportSourceReasons.failed)
    } finally {
      restoreEnglish()
    }
    // And in English with the English capacity sentence.
    expect(
      await estimateReason(
        Object.assign(new Error(EN.estimateNoCapacity), {
          estimateDiagnostic: '../../etc/passwd',
        }),
      ),
    ).toBe(UI_TEXT.reportSourceReasons.failed)
  })

  it('E20 never guesses a named refusal from a malformed diagnostic', async () => {
    // RVCM1134G P1's scenarios: each of these guessed a named refusal
    // before; each stays the honest generic refusal now.
    const refusals: readonly (readonly [name: string, error: Error])[] = [
      [
        'garbage goal JSON',
        Object.assign(new Error('Ziel nicht gefunden: {"kind":"garbage"}'), {
          estimateDiagnostic: 'goal-not-found: {"kind":"garbage","description":"English sentence"}',
        }),
      ],
      [
        'attached goal sentence',
        Object.assign(new Error('Estimate failed: estimate-unavailable'), {
          estimateRefusal: { kind: 'notFound', goal: 'This is a pre-rendered English sentence' },
        }),
      ],
      [
        'attached capacity',
        Object.assign(new Error('Estimate failed: estimate-unavailable'), {
          estimateRefusal: { kind: 'noCapacity' },
        }),
      ],
      [
        'path traversal with a capacity-shaped message',
        Object.assign(new Error('No compatible fleet capacity is available.'), {
          estimateDiagnostic: '../../etc/passwd',
        }),
      ],
      [
        'invented code with an engine-shaped message',
        Object.assign(new Error('Estimate failed: garbage'), { estimateDiagnostic: 'garbage' }),
      ],
    ]
    expect(await installGerman(new FakeLogOutputChannel())).toBe('de')
    const { table } = await loadUiTable({
      language: 'de',
      readExtensionFile: () =>
        Promise.resolve(readFileSync(new URL('../../l10n/ui.de.json', import.meta.url), 'utf8')),
      log: new FakeLogOutputChannel(),
    })
    try {
      for (const [name, error] of refusals) {
        // The generic German sentence, never a named German refusal.
        expect(
          await estimateReason(error, estimateContext({ reportText: table, locale: 'de' })),
          `${name} (German report)`,
        ).toBe(table.reportSourceReasons.failed)
      }
    } finally {
      restoreEnglish()
    }
    for (const [name, error] of refusals) {
      expect(await estimateReason(error), `${name} (English report)`).toBe(
        UI_TEXT.reportSourceReasons.failed,
      )
    }
  })

  it('E21 overlapping generations keep their own refusal language when estimator calls resolve out of order', async () => {
    // RVCM1134G P2's scenario through the production reader factory: a
    // German generation starts an estimate and waits; another session's
    // English services install their language while it waits; the English
    // estimator call resolves first. Each reason still renders in its own
    // report's language, from the text captured when its request started.
    const loaded = await loadUiTable({
      language: 'de',
      readExtensionFile: () =>
        Promise.resolve(readFileSync(new URL('../../l10n/ui.de.json', import.meta.url), 'utf8')),
      log: new FakeLogOutputChannel(),
    })
    if (loaded.locale !== 'de') throw new Error('German table failed to load')
    const germanTableText: UiText = loaded.table
    const refusal = (): Error =>
      Object.assign(new Error('No compatible fleet capacity is available.'), {
        estimateDiagnostic: 'no-capacity',
      })
    const germanCall = Promise.withResolvers<unknown>()
    const englishCall = Promise.withResolvers<unknown>()
    const germanReader = createEstimateReportReader(
      {
        run: () => germanCall.promise,
      },
      germanTableText,
      'de',
    )
    try {
      // The German generation starts first and waits on its estimator call.
      const german = estimateSource(germanReader, scrub).read(estimateContext())
      // Another session constructs English services while it waits.
      setUiText(EN, 'en')
      const englishReader = createEstimateReportReader(
        {
          run: () => englishCall.promise,
        },
        EN,
        'en',
      )
      const english = estimateSource(englishReader, scrub).read(estimateContext())
      // The estimator calls resolve in the opposite order: English first.
      englishCall.reject(refusal())
      const englishResult = await english
      expect(englishResult.record.status).toBe('unavailable')
      expect(englishResult.record.reason).toBe(EN.estimateNoCapacity)
      germanCall.reject(refusal())
      const germanResult = await german
      expect(germanResult.record.status).toBe('unavailable')
      expect(germanResult.record.reason).toBe(germanTableText.estimateNoCapacity)
    } finally {
      restoreEnglish()
    }
  })

  it('E22 renders a real twelve-lane missing-estimate refusal from data, in the report language', async () => {
    // RVCM1134G P3's scenario with the actual producer, not a fabricated
    // error: twelve unfinished lanes without hours make the real
    // `buildPlanSnapshot` refuse with ten named lanes `and 2 more`.
    const lanes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
    const rows = lanes
      .map(
        (lane, index) =>
          `| ${lane} | 1 | \`src/${lane.toLowerCase()}.ts\` | ${index === 0 ? 'First' : `after ${lanes[index - 1] ?? ''}`} | Kubuntu | — |`,
      )
      .join('\n')
    const plan = `## 6. Milestones

### M912 — Hour-less work (2026-10-10)

**Status 2026-10-10: building.**

- **Goal.** Twelve lanes.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Rig | Hours |
| ---- | ----- | ------------- | ------ | --- | ----- |
${rows}

### Delivery order (2026-10-10)

1. **M912** — First. Needs: main only.

## 10. Releases

### 0.16.0 — 2026-10-01

Release notes.
`
    const goal = parseEstimateGoal('M912')
    if (goal === undefined) throw new Error('unparseable goal')
    let diagnostic: string
    try {
      buildPlanSnapshot(plan, goal, ESTIMATOR_AS_OF, {})
      throw new Error('hour-less plan estimated without refusing')
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'estimateDiagnostic' in error &&
        typeof error.estimateDiagnostic === 'string'
      ) {
        diagnostic = error.estimateDiagnostic
      } else throw error
    }
    const shown = lanes.slice(0, 10).map((lane) => `M912:${lane}`)
    expect(diagnostic).toBe(`missing-estimate: ${shown.join(', ')} and 2 more`)
    const hostile = Object.assign(new Error(`Schätzung fehlgeschlagen: ${diagnostic}`), {
      estimateDiagnostic: diagnostic,
    })
    expect(await installGerman(new FakeLogOutputChannel())).toBe('de')
    try {
      // The lanes and the count cross as data; the report renders its own
      // words around them — no English `and 2 more` in a German reason.
      const german = await estimateReason(
        hostile,
        estimateContext({ scope: 'M912', reportText: germanTable, locale: 'de' }),
      )
      expect(german).toBe(
        fill(germanTable.estimateFailed, {
          detail: `missing-estimate: ${shown.join(', ')} und 2 weitere`,
        }),
      )
      expect(german).not.toContain(' and 2 more')
    } finally {
      restoreEnglish()
    }
    // The English report seals the producer's bytes.
    expect(await estimateReason(hostile, estimateContext({ scope: 'M912' }))).toBe(
      `Estimate failed: ${diagnostic}`,
    )
  })

  it('E23 keeps disclosure pointers through the production scrub', async () => {
    // The export scrubber reads multi-segment JSON Pointers as POSIX paths
    // and redacts them; the source restores the estimator's disclosures
    // whole (they carry no user text) so the schema still validates and a
    // real forecast renders instead of refusing.
    const { reportScrubber } = await import('../../src/core/reporting/render/redaction')
    const section = fakeEstimate()
    const pointers = section.disclosures.map((disclosure) => disclosure.path)
    expect(pointers.some((path) => path.split('/').length > 2)).toBe(true)
    const result = await estimateSource(
      readerFor(section),
      reportScrubber({ workspaceRoot: '/tmp/kind-fixture', localRoots: [] }),
    ).read(estimateContext({ scope: 'M117' }))
    expect(result.record.status).toBe('ok')
    if (result.record.status !== 'ok' && result.record.status !== 'partial')
      throw new Error('unreachable')
    const totals = (result.data ?? []).find((entry) => entry.id === 'estimate/totals')
    expect(totals?.rows.length).toBeGreaterThan(0)
  })

  it('E19 projects sections from codes only: the installed language changes no byte', async () => {
    const section = fakeEstimate()
    const options = reportOptions('estimate', { scope: 'M117' })
    const collected = estimateReportSections(section, options)
    expect(await installGerman(new FakeLogOutputChannel())).toBe('de')
    try {
      // Labels, units, bottleneck names and assumptions cross from the
      // estimator as codes; the report renderer owns the words.
      expect(estimateReportSections(section, options)).toEqual(collected)
    } finally {
      restoreEnglish()
    }
    const limiting = collected.find((entry) => entry.id === 'estimate/limitingResource')
    expect(limiting?.rows[0]?.cells['kind']).toEqual({
      type: 'text',
      value: section.limitingResource.kind,
    })
    const [firstSetup] = section.setups
    const setups = collected.find((entry) => entry.id === 'estimate/setups')
    expect(setups?.rows[0]?.cells['setup']).toEqual({ type: 'text', value: firstSetup?.kind })
    const [firstLane] = section.inputs.lanes
    const inputs = collected.find((entry) => entry.id === 'estimate/inputs')
    expect(
      inputs?.rows.find((entry) => textCell(entry, 'lane') === firstLane?.id)?.cells['state'],
    ).toEqual({ type: 'label', value: firstLane?.state })
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
    expect(rendered.md).toContain('## Critical Path')
    expect(rendered.md).toContain('## Totals')
    expect(rendered.text).toContain('Critical Path')
    expect(rendered.json).toContain('"kind": "estimate"')
    expect(rendered.html).toContain('Critical Path')
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

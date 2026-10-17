import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import { fromJSONSchema } from 'zod'
import shipped from '../../docs/schemas/report-v1.schema.json'
import { schedulesSource } from '../../src/core/reporting/sources/schedules'
import { playbookSource } from '../../src/core/reporting/sources/playbook'
import { collectFixture, fullSnapshot } from './helpers/reporting/collect'
import {
  fireFixture,
  scheduleFixture,
  playbookJournalFixture,
  FIXTURE_WORKSPACE_KEY,
} from './helpers/reporting/reportKindFixtures'
import { scheduleFireRecordSchema } from '../../src/shared/scheduleV2'
import { describe, expect, it } from 'vitest'
import entry from '../../docs/schemas/report-v1.entry.json'
import { reportDocumentSchema, reportSectionSchema } from '../../src/shared/reportSchema'
import type { ReportDocument } from '../../src/shared/reportSchema'
import { buildSessionExport } from '../../src/core/export/sessionTransfer'
import { reportDocument, reportOptions, availableSource } from './helpers/reporting/snapshot'

// Executable contract handoff only: R owns canonical ordering and the renderer.
// The actual M84 scrub is used; no fake redactor can make this assertion green.
async function scrubCanonicalReport(document: ReportDocument): Promise<ReportDocument> {
  const header = Object.fromEntries(
    Object.entries(document.header).filter(
      ([key]) => !entry.outputScrubExemptPaths.includes(`/header/${key}`),
    ),
  )
  const bytes = JSON.stringify({ ...document, header }, undefined, 2)
  const scrubbed = await buildSessionExport(
    {
      backend: 'modelApi',
      modelId: 'fixture-model',
      exportedAt: '2026-10-06T12:00:00Z',
      items: [{ itemId: 'report', kind: 'agentMessage', status: 'completed', text: bytes }],
    },
    { redact: true, localRoots: [] },
  )
  const parsed: unknown = JSON.parse(scrubbed.doc.transcript[0]!.text!)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid scrubbed report')
  const parsedHeader: unknown = Reflect.get(parsed, 'header')
  if (typeof parsedHeader !== 'object' || parsedHeader === null)
    throw new Error('Invalid scrubbed header')
  const exempt = Object.fromEntries(
    Object.entries(document.header).filter(([key]) =>
      entry.outputScrubExemptPaths.includes(`/header/${key}`),
    ),
  )
  return reportDocumentSchema.parse({ ...parsed, header: { ...parsedHeader, ...exempt } })
}

function canonicalContentHash(document: ReportDocument): string {
  const header = Object.fromEntries(
    Object.entries(document.header).filter(
      ([key]) => !entry.hashExcludedPaths.includes(`/header/${key}`),
    ),
  )
  return createHash('sha256')
    .update(JSON.stringify({ ...document, header }, undefined, 2))
    .digest('hex')
}

describe('report-v1 schema handoff to lane R', () => {
  it('matches the generated JSON Schema and its declared runtime invariants', async () => {
    const generated = {
      ...z.toJSONSchema(reportDocumentSchema),
      'x-runtime-invariants': entry.runtimeInvariants,
    }
    const committed: unknown = JSON.parse(await readFile(path.resolve(entry.output), 'utf8'))
    expect(committed).toEqual(generated)
    expect(entry.source).toBe('src/shared/reportSchema.ts')
    expect(entry.export).toBe('reportDocumentSchema')
    expect(entry.format).toBe('report-v1')
  })
  it('validates every emitted playbook/schedules label against the shipped schema', async () => {
    // JSON imports widen fixed schema discriminants. The freshness test above
    // checks the complete generated shape; this validates emitted documents.
    const validate = fromJSONSchema(shipped as Parameters<typeof fromJSONSchema>[0])
    const outcomes = scheduleFireRecordSchema.shape.outcome.options
    const certainties = scheduleFireRecordSchema.shape.cost.shape.certainty.options
    const schedules = [
      scheduleFixture(FIXTURE_WORKSPACE_KEY),
      scheduleFixture(FIXTURE_WORKSPACE_KEY, { id: 'paused', paused: true }),
      scheduleFixture(FIXTURE_WORKSPACE_KEY, { id: 'ended', end: { afterRuns: 1 }, fireCount: 1 }),
      scheduleFixture(FIXTURE_WORKSPACE_KEY, {
        id: 'complete',
        trigger: { kind: 'once', atMs: 1500 },
        nextFireAtMs: undefined,
        fireCount: 1,
      }),
      scheduleFixture(FIXTURE_WORKSPACE_KEY, { id: 'once', trigger: { kind: 'once', atMs: 2000 } }),
    ]
    const fires = outcomes.flatMap((outcome) =>
      certainties.map((certainty) =>
        fireFixture({
          runId: `${outcome}-${certainty}`,
          outcome,
          cost: { usd: '0', retainedLiabilityUsd: '0', certainty },
        }),
      ),
    )
    const labels = new Set<string>()
    for (const kind of ['playbook', 'schedules'] as const) {
      const options = { ...reportOptions(kind), full: true }
      const context = {
        options,
        asOf: options.asOf,
        workspaceKey: FIXTURE_WORKSPACE_KEY,
        signal: new AbortController().signal,
      }
      const source =
        kind === 'playbook'
          ? playbookSource(
              {
                read: () =>
                  Promise.resolve({ records: playbookJournalFixture(), observedAt: options.asOf }),
              },
              (text) => text,
            )
          : schedulesSource(
              { read: () => Promise.resolve({ schedules, fires, observedAt: options.asOf }) },
              (text) => text,
            )
      const result = await source.read(context)
      expect(result.record.status).toBe('ok')
      const snapshot = fullSnapshot()
      const document = collectFixture(
        kind,
        { full: true },
        {
          ...snapshot,
          sources: { ...snapshot.sources, [kind]: availableSource(kind, result.data) },
        },
      )
      expect(validate.safeParse(document).success).toBe(true)
      for (const section of [document.needsYou, ...document.sections]) {
        labels.add(section.label)
        for (const column of section.columns) labels.add(column.label)
        for (const row of section.rows)
          for (const cell of Object.values(row.cells))
            if (cell.type === 'label') labels.add(cell.value)
      }
    }
    // Schema-driven fixtures cover every lifecycle/cost branch, including
    // headings/columns and common forwarded/plan-format labels.
    for (const value of labels) {
      const document = reportDocument()
      // Whole documents above validate labels used outside cells too. This
      // dedicated cell check ensures all emitted keys are in the value enum.
      document.sections[0]!.rows[0]!.cells['state'] = {
        type: 'label',
        value: reportSectionSchema.shape.label.parse(value),
      }
      expect(validate.safeParse(document).success, value).toBe(true)
    }
    expect([...labels]).toEqual(
      expect.arrayContaining([
        'ended',
        'paused',
        'complete',
        'active',
        'once',
        'user',
        'total',
        'all',
        'hookVerification',
        'reported',
        'estimated',
        'unknown',
      ]),
    )
  })

  it('scrubs canonical output before hashing and exempts only the structural hash', async () => {
    const document = reportDocument()
    const canary = `LLM_${'x'.repeat(32)}`
    document.sections[0]!.rows[0]!.cells['state'] = {
      type: 'text',
      value: `Registered credential shape ${canary}; digest ${'b'.repeat(64)}`,
    }
    const beforeScrub = canonicalContentHash(document)
    const clean = await scrubCanonicalReport(document)
    expect(clean.header.contentHash).toBe(document.header.contentHash)
    expect(JSON.stringify(clean)).not.toContain(canary)
    expect(JSON.stringify(clean)).not.toContain('b'.repeat(64))
    clean.header.contentHash = canonicalContentHash(clean)
    expect(clean.header.contentHash).not.toBe(beforeScrub)
    expect(clean.header.contentHash).toMatch(/^[a-f0-9]{64}$/)
    const saved = reportDocumentSchema.parse(await scrubCanonicalReport(clean))
    expect(saved.header.contentHash).toBe(clean.header.contentHash)
    expect(canonicalContentHash(saved)).toBe(clean.header.contentHash)
    saved.header.asOf = '2026-10-07T12:00:00+00:00'
    expect(canonicalContentHash(saved)).toBe(clean.header.contentHash)
    expect(entry.outputScrubExemptPaths).toEqual(['/header/contentHash'])
    expect(entry.runtimeInvariants).toContain(
      'Schema validation alone certifies neither output scrubbing nor content-hash verification.',
    )
  })
})

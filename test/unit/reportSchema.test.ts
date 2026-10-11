import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import entry from '../../docs/schemas/report-v1.entry.json'
import { reportDocumentSchema } from '../../src/shared/reportSchema'
import type { ReportDocument } from '../../src/shared/reportSchema'
import { buildSessionExport } from '../../src/core/export/sessionTransfer'
import { reportDocument } from './helpers/reporting/snapshot'

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

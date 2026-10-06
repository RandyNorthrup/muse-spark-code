import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fromJSONSchema } from 'zod'
import { toJSONSchema } from 'zod/mini'
import schema from '../../docs/schemas/report-v1.schema.json'
import { REPORT_KINDS } from '../../src/shared/constants'
import { reportDocumentSchema } from '../../src/shared/reportSchema'
import { finalizeReport, verifyReport } from '../../src/core/reporting/render/canonical'
import { GOLDEN_ROOT, RENDERERS, REPORT_THEME, renderFixture } from './reportRenderFixtures'
import { valueFixture } from './reportRenderFixtures'

describe('canonical report JSON and saved input', () => {
  it('refuses a scrubbed JSON parse failure without quoting source text', () => {
    const document = renderFixture()
    const parser = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new Error(`LLM_${'x'.repeat(32)}`)
    })
    try {
      expect(() => finalizeReport(document)).toThrow(/^Invalid scrubbed report$/)
    } finally {
      parser.mockRestore()
    }
  })
  it('refuses malformed saved input without quoting source text', () => {
    const canary = `LLM_${'x'.repeat(32)}`
    expect(() => verifyReport({ ...renderFixture(), [canary]: true })).toThrow(
      /^Invalid report document$/,
    )
  })
  it.each([
    ['+05:30', '2026-10-07T00:30:00.000+05:30'],
    ['-07:00', '2026-10-06T12:00:00.000-07:00'],
    ['Z', '2026-10-06T19:00:00.000Z'],
  ])('writes timestamps with the report offset %s in every format', (offset, expected) => {
    const document = valueFixture()
    document.header.asOf = `2026-10-06T12:00:00${offset}`
    const finalized = finalizeReport(document)
    for (const renderer of Object.values(RENDERERS))
      expect(renderer(finalized, 'en', REPORT_THEME)).toContain(expected)
  })
  it.each(REPORT_KINDS)(
    'matches the %s JSON golden and re-renders saved JSON byte for byte',
    async (kind) => {
      const output = RENDERERS.json(renderFixture(kind), 'en', REPORT_THEME)
      expect(output).toBe(await readFile(path.join(GOLDEN_ROOT, `${kind}.json.golden`), 'utf8'))
      const input: unknown = JSON.parse(output)
      const saved = verifyReport(input)
      expect(reportDocumentSchema.safeParse(input).success).toBe(true)
      const { 'x-runtime-invariants': _invariants, ...committed } = schema
      const generated = toJSONSchema(reportDocumentSchema)
      expect(committed).toEqual(generated)
      expect(fromJSONSchema(generated).safeParse(input).success).toBe(true)
      expect(RENDERERS.json(saved, 'en', REPORT_THEME)).toBe(output)
      for (const renderer of Object.values(RENDERERS))
        expect(renderer(saved, 'en', REPORT_THEME)).toBe(
          renderer(renderFixture(kind), 'en', REPORT_THEME),
        )
    },
  )
  it('hashes scrubbed canonical bytes excluding exactly header asOf and contentHash', () => {
    const document = renderFixture()
    const { asOf: _asOf, contentHash, ...header } = document.header
    const bytes = `${JSON.stringify({ ...document, header }, undefined, 2)}\n`
    expect(contentHash).toBe(createHash('sha256').update(bytes).digest('hex'))
    document.header.asOf = '2026-10-07T12:00:00+00:00'
    expect(verifyReport(document).header.contentHash).toBe(contentHash)
    expect(finalizeReport(document).header.contentHash).toBe(contentHash)
    document.header.scope = 'Changed'
    expect(() => verifyReport(document)).toThrow('Report content hash or redaction mismatch')
    document.header.contentHash = 'b'.repeat(64)
    expect(() => verifyReport(document)).toThrow()
    expect(() => verifyReport({ ...renderFixture(), unexpected: true })).toThrow()
  })
  it('runs the schema generator check against the committed production boundary', () => {
    expect(
      execFileSync(process.execPath, ['scripts/schema-report.mjs', '--check'], {
        cwd: path.resolve(import.meta.dirname, '../..'),
        encoding: 'utf8',
        windowsHide: true,
      }),
    ).toContain('Report schema matches.')
  })
})

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import entry from '../../docs/schemas/report-v1.entry.json'
import { reportDocumentSchema } from '../../src/shared/reportSchema'

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
})

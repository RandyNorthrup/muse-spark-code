// RVCMICCOMP2 finding 1: the finding-4 drill receipt recorded a 69-character
// digest, so it could not be the SHA-256 of the restored file. Every digest
// in the drills file must be 64 lowercase hex characters.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'

const root = path.resolve(import.meta.dirname, '../..')

const drillsSchema = z.array(
  z.object({
    drill: z.string(),
    file: z.string(),
    sha256: z.string(),
  }),
)

describe('M35 companion drill receipts', () => {
  it('records every drill digest as 64 lowercase hex characters', () => {
    const drills = drillsSchema.parse(
      JSON.parse(
        readFileSync(path.join(root, 'docs/certification/m35-companion-drills.json'), 'utf8'),
      ),
    )
    expect(drills.length).toBeGreaterThan(0)
    for (const { drill, sha256 } of drills) expect(sha256, drill).toMatch(/^[0-9a-f]{64}$/)
  })
})

// RVCMICCOMP2 finding 1: the finding-4 drill receipt recorded a 69-character
// digest, so it could not be the SHA-256 of the restored file. Every digest
// in the drills file must be 64 lowercase hex characters.
import { createHash } from 'node:crypto'
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

  // RVCMICCOMP3 P3: shape alone lets a well-formed but wrong digest pass (the
  // finding-4 receipt with 64 `a` characters stayed green). The three rows
  // this lane recorded certify the current tree, so each must equal the live
  // SHA-256 of the file it names. Older rows are point-in-time history (their
  // files legitimately changed after the drill), so only the shape guard
  // above applies to them.
  it('records the current restoration receipts as the live SHA-256 of the named file', () => {
    const drills = drillsSchema.parse(
      JSON.parse(
        readFileSync(path.join(root, 'docs/certification/m35-companion-drills.json'), 'utf8'),
      ),
    )
    const current = [
      'rvcmiccomp-3-capture-generation-fence',
      'rvcmiccomp-5-send-reenable-on-input',
      'rvcmiccomp-4-permission-cancellation-signal',
    ]
    expect(drills.length).toBeGreaterThan(0)
    for (const name of current) {
      const row = drills.find((entry) => entry.drill === name)
      if (row === undefined) throw new Error(`missing drill receipt: ${name}`)
      const live = createHash('sha256')
        .update(readFileSync(path.join(root, row.file)))
        .digest('hex')
      expect(row.sha256, name).toBe(live)
    }
  })
})

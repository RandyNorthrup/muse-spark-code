import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * RVCOMPSUB2 finding 2 guard: the restored-source SHA-256 recorded in
 * docs/certification/companion-early-events.md must be a 64-hex digest that
 * identifies the committed server.ts. A red drill that cannot name its
 * restored bytes verifies nothing, so this test re-hashes the file at HEAD
 * and compares it with the labelled digest in the certification.
 */
describe('companion certification digest', () => {
  it('records the 64-hex SHA-256 of server.ts at HEAD', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const certification = readFileSync(
      `${root}/docs/certification/companion-early-events.md`,
      'utf8',
    )
    // `git show` yields the committed bytes on every OS, so CRLF checkouts
    // cannot skew the digest; hash the raw bytes, never decoded text.
    const committed = execFileSync('git', ['show', 'HEAD:src/runtime/companion/server.ts'], {
      cwd: root,
    })
    const digest = createHash('sha256').update(committed).digest('hex')
    const label = 'Restored-source SHA-256 of `src/runtime/companion/server.ts`: `'
    expect(certification.split(label)).toHaveLength(2)
    expect(certification).toContain(`${label}${digest}\``)
  })
})

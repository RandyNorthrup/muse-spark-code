// Certification checks the bytes the shared tool actually advertises. This
// pin changes deliberately alongside the record when the schema changes.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toolDefinitions } from '../../src/core/backends/modelapi/tools'

describe('M101 T certification measurements', () => {
  it('pins the real shared edit schema and verifies the certification records its exact bytes', () => {
    const tool = toolDefinitions('linux').find((definition) => definition.name === 'edit_file')
    const bytes = JSON.stringify(tool)
    const hash = createHash('sha256').update(bytes).digest('hex')
    // RLLIMITS' byte-range fields moved the measurement (m101-t.md's revision table).
    expect(hash).toBe('a2be6849b966a189970141345d63ad72f660f725e61e65f58fe32e0c0437119b')
    const record = readFileSync(
      new URL('../../docs/certification/m101-t.md', import.meta.url),
      'utf8',
    )
    const rows = record
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
    expect(rows).toContainEqual(['RLLIMITS', String(Buffer.byteLength(bytes)), hash])
  })
})

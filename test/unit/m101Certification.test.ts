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
    expect(hash).toBe('fcde96bd829a336b5ca78aab6daf154fe1edaf3421bacfc0843b93660eb0e4a2')
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
    expect(rows).toContainEqual(['FIXM101T', String(Buffer.byteLength(bytes)), hash])
  })
})

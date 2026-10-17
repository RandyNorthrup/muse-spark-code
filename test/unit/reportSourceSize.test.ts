// Report source reads (NOLIMITS1FIX §N3): the removed 16 MiB bound was
// invented — a source file reads whole at any size through the real reader
// and real files. The finite cap a caller passes explicitly still refuses.
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LocalSourceError } from '../../src/core/reporting/sources/local'
import { reportFileIo } from '../../src/runtime/reporting/sources'

const PAST_REMOVED_CAP = 17 * 1024 * 1024

describe('report source size', () => {
  it('reads a source past the removed 16 MiB bound whole', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nolimits1fix-sources-'))
    try {
      const body = 'a'.repeat(PAST_REMOVED_CAP)
      await writeFile(path.join(root, 'big.txt'), body)
      const io = reportFileIo(root, process.platform)
      const text = await io.read('big.txt', AbortSignal.timeout(30_000))
      expect(text.length).toBe(PAST_REMOVED_CAP)
      expect(text).toBe(body)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('still refuses past an explicitly passed finite bound', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nolimits1fix-sources-'))
    try {
      await writeFile(path.join(root, 'big.txt'), 'a'.repeat(2048))
      const io = reportFileIo(root, process.platform, 1024)
      let failure: unknown
      try {
        await io.read('big.txt', AbortSignal.timeout(30_000))
        expect.unreachable()
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(LocalSourceError)
      expect(failure).toMatchObject({ code: 'limit' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

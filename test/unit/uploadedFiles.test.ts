import { describe, expect, it } from 'vitest'
import {
  createUploadedFilesPort,
  emptyUploadedFilesReport,
} from '../../src/core/media/uploadedFiles'
import { uploadedFilesReportSchema, type UploadedFilesReport } from '../../src/shared/media'

// The port with no ledger behind it, and its posted-report validation.
// Delegation to a live ledger needs the real Files-backed ledger and a
// key; it is unproven here (docs/real-life/unproven.md).
const report: UploadedFilesReport = {
  ...emptyUploadedFilesReport(),
  poolBytes: 100,
  usedBytes: 3,
  files: [
    {
      fileId: 'file-one',
      name: 'clip.mp4',
      bytes: 3,
      expiresAt: 1_800_000_000,
      ours: true,
      sessions: [],
    },
  ],
}

describe('uploaded-files port without a ledger', () => {
  it('says empty and deletes nothing while no ledger exists', async () => {
    const posted: unknown[] = []
    const port = createUploadedFilesPort({
      ledger: () => Promise.resolve(undefined),
      post: (value) => {
        posted.push(value)
      },
      confirmForeign: () => Promise.resolve(true),
    })
    const empty = await port.read()
    expect(uploadedFilesReportSchema.safeParse(empty).success).toBe(true)
    expect(empty).toEqual({ ...emptyUploadedFilesReport(), files: [] })
    await port.deleteFile('file-one', () => Promise.resolve(true))
    await port.deleteAllOurs()
    expect(posted).toHaveLength(0)
  })

  it('posts a valid report and refuses a malformed one', () => {
    const posted: unknown[] = []
    const port = createUploadedFilesPort({
      ledger: () => Promise.resolve(undefined),
      post: (value) => {
        posted.push(value)
      },
    })
    port.post(report)
    expect(posted).toEqual([report])
    expect(() => {
      port.post({ ...report, files: [{ ...report.files[0], file_data: 'x' }] })
    }).toThrow()
    expect(posted).toHaveLength(1)
  })

  it('refuses a read on an aborted signal', async () => {
    const port = createUploadedFilesPort({
      ledger: () => Promise.resolve(undefined),
      post: () => undefined,
    })
    const aborted = new AbortController()
    aborted.abort()
    await expect(port.read(aborted.signal)).rejects.toThrow()
  })
})

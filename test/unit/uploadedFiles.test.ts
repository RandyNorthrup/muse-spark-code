import { describe, expect, it, vi } from 'vitest'
import {
  createUploadedFilesPort,
  emptyUploadedFilesReport,
} from '../../src/core/media/uploadedFiles'
import { uploadedFilesReportSchema } from '../../src/shared/media'

const report = {
  provider: 'meta',
  isReadOnly: false,
  poolBytes: 100,
  usedBytes: 3,
  files: [
    {
      fileId: 'file-one',
      name: 'clip.mp4',
      bytes: 3,
      expiresAt: 1_800_000_000,
      ours: true,
      sessions: ['s1'],
    },
  ],
}

function setup(ledger: unknown) {
  const post = vi.fn()
  const confirmForeign = vi.fn(() => Promise.resolve(true))
  const port = createUploadedFilesPort({
    ledger: () => Promise.resolve(ledger as never),
    post,
    confirmForeign,
  })
  return { port, post, confirmForeign }
}

describe('uploaded-files port', () => {
  it('reads the ledger report and posts it back validated', async () => {
    const ledger = {
      accountReport: vi.fn(() => Promise.resolve(report)),
      deleteFile: vi.fn(() => Promise.resolve()),
      deleteAllOurs: vi.fn(() => Promise.resolve()),
    }
    const t = setup(ledger)
    expect(await t.port.read()).toEqual(report)
    t.port.post(report)
    expect(t.post).toHaveBeenCalledWith(report)
    expect(() => {
      t.port.post({ ...report, files: [{ ...report.files[0], file_data: 'x' }] })
    }).toThrow()
  })

  it('deletes the chosen files through the ledger and confirms foreign ones outside it', async () => {
    const ledger = {
      accountReport: vi.fn(() => Promise.resolve(report)),
      deleteFile: vi.fn(() => Promise.resolve()),
      deleteAllOurs: vi.fn(() => Promise.resolve()),
    }
    const t = setup(ledger)
    const confirmed = vi.fn(() => Promise.resolve(true))
    await t.port.deleteFile('file-one', confirmed)
    expect(ledger.deleteFile).toHaveBeenCalledWith('file-one', confirmed)
    await t.port.deleteAllOurs()
    expect(ledger.deleteAllOurs).toHaveBeenCalledOnce()
    expect(
      await t.port.confirmForeign('Another app may still use other.pdf. Delete it anyway?'),
    ).toBe(true)
    expect(t.confirmForeign).toHaveBeenCalledOnce()
  })

  it('says empty and deletes nothing while no ledger exists', async () => {
    const t = setup(undefined)
    const empty = await t.port.read()
    expect(uploadedFilesReportSchema.safeParse(empty).success).toBe(true)
    expect(empty).toEqual({ ...emptyUploadedFilesReport(), files: [] })
    await t.port.deleteFile('file-one', () => Promise.resolve(true))
    await t.port.deleteAllOurs()
    expect(t.post).not.toHaveBeenCalled()
  })

  it('lets a failed provider delete reach the caller with its reason', async () => {
    const ledger = {
      accountReport: vi.fn(() => Promise.resolve(report)),
      deleteFile: vi.fn(() => Promise.reject(new Error('Offline'))),
      deleteAllOurs: vi.fn(() => Promise.resolve()),
    }
    const t = setup(ledger)
    await expect(t.port.deleteFile('file-one', () => Promise.resolve(true))).rejects.toThrow(
      'Offline',
    )
  })
})

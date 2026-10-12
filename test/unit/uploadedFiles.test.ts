import { describe, expect, it, vi } from 'vitest'
import {
  createUploadedFilesPort,
  emptyUploadedFilesReport,
} from '../../src/core/media/uploadedFiles'
import { uploadedFilesReportSchema } from '../../src/shared/media'
import {
  fakeUploadedFilesLedger,
  type FakeUploadedFilesLedger,
  uploadedFilesReportFixture,
} from './helpers/uploadedFiles'

const report = uploadedFilesReportFixture()

function setup(ledger: FakeUploadedFilesLedger | undefined) {
  const post = vi.fn()
  const confirmForeign = vi.fn(() => Promise.resolve(true))
  const port = createUploadedFilesPort({
    ledger: () => Promise.resolve(ledger),
    post,
    confirmForeign,
  })
  return { port, post, confirmForeign }
}

describe('uploaded-files port', () => {
  it('reads the ledger report and posts it back validated', async () => {
    const t = setup(fakeUploadedFilesLedger(report))
    expect(await t.port.read()).toEqual(report)
    t.port.post(report)
    expect(t.post).toHaveBeenCalledWith(report)
    expect(() => {
      t.port.post({ ...report, files: [{ ...report.files[0], file_data: 'x' }] })
    }).toThrow()
  })

  it('deletes the chosen files through the ledger and confirms foreign ones outside it', async () => {
    const ledger = fakeUploadedFilesLedger(report)
    const t = setup(ledger)
    const confirmed = vi.fn(() => Promise.resolve(true))
    await t.port.deleteFile('file-one', confirmed)
    expect(ledger.deleteFile).toHaveBeenCalledWith('file-one', confirmed, undefined)
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

  it('checks the signal before dispatch and passes it to the ledger', async () => {
    const ledger = fakeUploadedFilesLedger(report)
    const t = setup(ledger)
    const controller = new AbortController()
    const signal = controller.signal
    const confirmed = vi.fn(() => Promise.resolve(true))
    await t.port.deleteFile('file-one', confirmed, signal)
    expect(ledger.deleteFile).toHaveBeenCalledWith('file-one', confirmed, signal)
    await t.port.deleteAllOurs(signal)
    expect(ledger.deleteAllOurs).toHaveBeenCalledWith(signal)
    controller.abort()
    await expect(t.port.deleteFile('file-one', confirmed, signal)).rejects.toThrow()
    await expect(t.port.deleteAllOurs(signal)).rejects.toThrow()
    expect(ledger.deleteFile).toHaveBeenCalledTimes(1)
    expect(ledger.deleteAllOurs).toHaveBeenCalledTimes(1)
  })

  it('lets a failed provider delete reach the caller with its reason', async () => {
    const ledger = fakeUploadedFilesLedger(report)
    ledger.deleteFile.mockRejectedValueOnce(new Error('Offline'))
    const t = setup(ledger)
    await expect(t.port.deleteFile('file-one', () => Promise.resolve(true))).rejects.toThrow(
      'Offline',
    )
  })
})

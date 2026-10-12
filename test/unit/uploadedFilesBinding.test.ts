import { describe, expect, it, vi } from 'vitest'
import {
  createUploadedFilesBinding,
  runDeleteUploadedFilesCommand,
} from '../../src/host/conversation/uploadedFilesBinding'
import { UI_TEXT } from '../../src/shared/constants'
import { type FakeUploadedFilesLedger, uploadedFilesReportFixture } from './helpers/uploadedFiles'

const report = uploadedFilesReportFixture()

function setup(options?: { missingAccount?: boolean }) {
  const ledger: Pick<FakeUploadedFilesLedger, 'accountReport' | 'deleteFile' | 'deleteAllOurs'> = {
    accountReport: vi.fn(() => Promise.resolve(report)),
    deleteFile: vi.fn((_id: string, _isConfirmed: (name: string) => Promise<boolean>) =>
      Promise.resolve(),
    ),
    deleteAllOurs: vi.fn(() => Promise.resolve()),
  }
  const uploads = vi.fn(() => Promise.resolve(ledger))
  const binding = createUploadedFilesBinding({
    uploads,
    getAccountId: () =>
      Promise.resolve(options?.missingAccount === true ? undefined : 'a'.repeat(64)),
    post: vi.fn(),
    confirmForeign: vi.fn(() => Promise.resolve(true)),
  })
  return { binding, uploads, ledger }
}

function fakeDialogs(picked: readonly string[] | undefined) {
  return {
    pick: vi.fn(() => Promise.resolve(picked)),
    inform: vi.fn(),
    fail: vi.fn(),
  }
}

describe('uploaded-files host binding', () => {
  it('supplies the conversation port from the current account ledger', async () => {
    const t = setup()
    expect(await t.binding.port.read()).toEqual(report)
    expect(t.uploads).toHaveBeenCalledWith('a'.repeat(64))
    await t.binding.port.deleteAllOurs()
    expect(t.ledger.deleteAllOurs).toHaveBeenCalledOnce()
    expect(await t.binding.list()).toEqual(report)
  })

  it('reads empty while no account backs the ledger', async () => {
    const t = setup({ missingAccount: true })
    expect(await t.binding.list()).toEqual(expect.objectContaining({ files: [], isReadOnly: true }))
    expect(t.uploads).not.toHaveBeenCalled()
  })

  it('deletes the chosen files and shows a failed delete with its reason', async () => {
    const t = setup()
    const dialogs = fakeDialogs(['file-one', 'file-other'])
    t.ledger.deleteFile.mockRejectedValueOnce(new Error('Offline'))
    await runDeleteUploadedFilesCommand({
      list: t.binding.list,
      remove: t.binding.remove,
      confirmForeign: () => Promise.resolve(true),
      dialogs,
    })
    expect(dialogs.pick).toHaveBeenCalledOnce()
    expect(t.ledger.deleteFile).toHaveBeenCalledTimes(2)
    expect(dialogs.fail).toHaveBeenCalledWith(`Could not delete clip.mp4: Offline`)
    expect(dialogs.inform).not.toHaveBeenCalled()
  })

  it('says so and deletes nothing with no uploads, and stops on dismissal', async () => {
    const t = setup()
    t.ledger.accountReport.mockResolvedValue({ ...report, files: [] })
    const empty = fakeDialogs(undefined)
    await runDeleteUploadedFilesCommand({
      list: t.binding.list,
      remove: t.binding.remove,
      confirmForeign: () => Promise.resolve(true),
      dialogs: empty,
    })
    expect(empty.inform).toHaveBeenCalledWith(UI_TEXT.media.filesEmpty)
    expect(empty.pick).not.toHaveBeenCalled()
    expect(t.ledger.deleteFile).not.toHaveBeenCalled()
    const dismissed = fakeDialogs(undefined)
    await runDeleteUploadedFilesCommand({
      list: t.binding.list,
      remove: t.binding.remove,
      confirmForeign: () => Promise.resolve(true),
      dialogs: dismissed,
    })
    expect(t.ledger.deleteFile).not.toHaveBeenCalled()
  })

  it('deletes nothing once cancelled at any await of the command', async () => {
    // Before the list.
    const preAborted = new AbortController()
    preAborted.abort()
    const t = setup()
    const idle = fakeDialogs(['file-one'])
    await expect(
      runDeleteUploadedFilesCommand({
        list: t.binding.list,
        remove: t.binding.remove,
        confirmForeign: () => Promise.resolve(true),
        dialogs: idle,
        signal: preAborted.signal,
      }),
    ).rejects.toThrow()
    // t.binding.list() reads the ledger through the port: no read happened.
    expect(t.ledger.accountReport).not.toHaveBeenCalled()
    expect(idle.pick).not.toHaveBeenCalled()
    // During the list: the held read finishes on the abort it must obey.
    const duringList = new AbortController()
    t.ledger.accountReport.mockImplementationOnce(() => {
      return new Promise<typeof report>((resolve) => {
        duringList.signal.addEventListener(
          'abort',
          () => {
            resolve(report)
          },
          { once: true },
        )
      })
    })
    const listed = runDeleteUploadedFilesCommand({
      list: t.binding.list,
      remove: t.binding.remove,
      confirmForeign: () => Promise.resolve(true),
      dialogs: fakeDialogs(['file-one']),
      signal: duringList.signal,
    })
    while (t.ledger.accountReport.mock.calls.length === 0)
      await new Promise((settle) => setImmediate(settle))
    duringList.abort()
    await expect(listed).rejects.toThrow()
    // During the pick: the held picker answers on the abort it must obey.
    const duringPick = new AbortController()
    const heldPick = {
      pick: vi.fn(() => {
        return new Promise<readonly string[] | undefined>((resolve) => {
          duringPick.signal.addEventListener(
            'abort',
            () => {
              resolve(['file-one'])
            },
            {
              once: true,
            },
          )
        })
      }),
      inform: vi.fn(),
      fail: vi.fn(),
    }
    const picking = runDeleteUploadedFilesCommand({
      list: t.binding.list,
      remove: t.binding.remove,
      confirmForeign: () => Promise.resolve(true),
      dialogs: heldPick,
      signal: duringPick.signal,
    })
    while (heldPick.pick.mock.calls.length === 0)
      await new Promise((settle) => setImmediate(settle))
    duringPick.abort()
    await expect(picking).rejects.toThrow()
    expect(t.ledger.deleteFile).not.toHaveBeenCalled()
    // Between two deletes: the first goes, the second never dispatches.
    const between = new AbortController()
    t.ledger.deleteFile.mockImplementationOnce(() => {
      between.abort()
      return Promise.resolve()
    })
    await expect(
      runDeleteUploadedFilesCommand({
        list: t.binding.list,
        remove: t.binding.remove,
        confirmForeign: () => Promise.resolve(true),
        dialogs: fakeDialogs(['file-one', 'file-other']),
        signal: between.signal,
      }),
    ).rejects.toThrow()
    expect(t.ledger.deleteFile).toHaveBeenCalledTimes(1)
  })

  it('asks before deleting a file another app may still use', async () => {
    const t = setup()
    const confirmForeign = vi.fn(() => Promise.resolve(true))
    await runDeleteUploadedFilesCommand({
      list: t.binding.list,
      remove: t.binding.remove,
      confirmForeign,
      dialogs: fakeDialogs(['file-other']),
    })
    const confirm = t.ledger.deleteFile.mock.calls[0]?.[1]
    expect(confirm).toBeDefined()
    await confirm?.('other.pdf')
    expect(confirmForeign).toHaveBeenCalledWith(
      'Another app may still use other.pdf. Delete it anyway?',
    )
  })
})

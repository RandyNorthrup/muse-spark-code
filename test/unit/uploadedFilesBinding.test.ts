import { describe, expect, it, vi } from 'vitest'
import {
  createUploadedFilesBinding,
  runDeleteUploadedFilesCommand,
} from '../../src/host/conversation/uploadedFilesBinding'
import { UI_TEXT } from '../../src/shared/constants'

const report = {
  provider: 'meta',
  isReadOnly: false,
  poolBytes: 100,
  usedBytes: 15,
  files: [
    {
      fileId: 'file-one',
      name: 'clip.mp4',
      bytes: 3,
      expiresAt: 1_800_000_000,
      ours: true,
      sessions: [],
    },
    {
      fileId: 'file-other',
      name: 'other.pdf',
      bytes: 12,
      expiresAt: 1_800_000_000,
      ours: false,
      sessions: [],
    },
  ],
}

function setup(options?: { missingAccount?: boolean }) {
  const ledger = {
    accountReport: vi.fn(() => Promise.resolve(report)),
    deleteFile: vi.fn((_id: string, _isConfirmed: (name: string) => Promise<boolean>) =>
      Promise.resolve(),
    ),
    deleteAllOurs: vi.fn(() => Promise.resolve()),
  }
  const uploads = vi.fn(() => Promise.resolve(ledger))
  const binding = createUploadedFilesBinding({
    uploads: uploads as never,
    getAccountId: () =>
      Promise.resolve(options?.missingAccount === true ? undefined : 'a'.repeat(64)),
    post: vi.fn(),
    confirmForeign: vi.fn(() => Promise.resolve(true)),
  })
  return { binding, uploads, ledger }
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
    const dialogs = {
      pick: vi.fn(() => Promise.resolve(['file-one', 'file-other'])),
      inform: vi.fn(),
      fail: vi.fn(),
    }
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
    const empty = {
      pick: vi.fn(),
      inform: vi.fn(),
      fail: vi.fn(),
    }
    await runDeleteUploadedFilesCommand({
      list: t.binding.list,
      remove: t.binding.remove,
      confirmForeign: () => Promise.resolve(true),
      dialogs: empty,
    })
    expect(empty.inform).toHaveBeenCalledWith(UI_TEXT.media.filesEmpty)
    expect(empty.pick).not.toHaveBeenCalled()
    expect(t.ledger.deleteFile).not.toHaveBeenCalled()
    const dismissed = {
      pick: vi.fn(() => Promise.resolve(undefined)),
      inform: vi.fn(),
      fail: vi.fn(),
    }
    await runDeleteUploadedFilesCommand({
      list: t.binding.list,
      remove: t.binding.remove,
      confirmForeign: () => Promise.resolve(true),
      dialogs: dismissed,
    })
    expect(t.ledger.deleteFile).not.toHaveBeenCalled()
  })

  it('asks before deleting a file another app may still use', async () => {
    const t = setup()
    const confirmForeign = vi.fn(() => Promise.resolve(true))
    await runDeleteUploadedFilesCommand({
      list: t.binding.list,
      remove: t.binding.remove,
      confirmForeign,
      dialogs: {
        pick: vi.fn(() => Promise.resolve(['file-other'])),
        inform: vi.fn(),
        fail: vi.fn(),
      },
    })
    const confirm = t.ledger.deleteFile.mock.calls[0]?.[1] as
      ((name: string) => Promise<boolean>) | undefined
    expect(confirm).toBeDefined()
    await confirm?.('other.pdf')
    expect(confirmForeign).toHaveBeenCalledWith(
      'Another app may still use other.pdf. Delete it anyway?',
    )
  })
})

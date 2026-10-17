import { describe, expect, it, vi } from 'vitest'
import {
  createUploadedFilesBinding,
  runDeleteUploadedFilesCommand,
} from '../../src/host/conversation/uploadedFilesBinding'
import { UploadLedger } from '../../src/core/media/uploadLedger'
import { UI_TEXT } from '../../src/shared/constants'
import { type FakeUploadedFilesLedger, uploadedFilesReportFixture } from './helpers/uploadedFiles'

const report = uploadedFilesReportFixture()

function setup(options?: { missingAccount?: boolean }) {
  const ledger: Pick<
    FakeUploadedFilesLedger,
    'accountReport' | 'deleteFile' | 'deleteAllOurs' | 'consumeDeleteNotice'
  > = {
    accountReport: vi.fn(() => Promise.resolve(report)),
    deleteFile: vi.fn((_id: string, _isConfirmed: (name: string) => Promise<boolean>) =>
      Promise.resolve(),
    ),
    deleteAllOurs: vi.fn(() => Promise.resolve()),
    consumeDeleteNotice: vi.fn(() => Promise.resolve(undefined)),
  }
  const uploads = vi.fn(() => Promise.resolve(ledger))
  const post = vi.fn()
  const binding = createUploadedFilesBinding({
    uploads,
    getAccountId: () =>
      Promise.resolve(options?.missingAccount === true ? undefined : 'a'.repeat(64)),
    post,
    confirmForeign: vi.fn(() => Promise.resolve(true)),
  })
  return { binding, uploads, ledger, post }
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

  it('keeps each read on its own stamp when an older read lands later', async () => {
    // Finding 5: read A starts first but lands last. Each post carries
    // its own read's generation, so the surface can keep the newer read.
    const t = setup()
    const gate = new AbortController()
    t.ledger.accountReport.mockImplementationOnce(
      () =>
        new Promise<typeof report>((resolve) => {
          gate.signal.addEventListener(
            'abort',
            () => {
              resolve(report)
            },
            { once: true },
          )
        }),
    )
    const readingA = t.binding.port.readStamped()
    while (t.ledger.accountReport.mock.calls.length === 0)
      await new Promise((settle) => setImmediate(settle))
    const stampedB = await t.binding.port.readStamped()
    t.binding.port.post(stampedB.report, stampedB)
    gate.abort()
    const stampedA = await readingA
    t.binding.port.post(stampedA.report, stampedA)
    expect(stampedA.generation).toBe(1)
    expect(stampedB.generation).toBe(2)
    expect(t.post).toHaveBeenNthCalledWith(1, expect.objectContaining({ generation: 2 }))
    expect(t.post).toHaveBeenNthCalledWith(2, expect.objectContaining({ generation: 1 }))
  })

  it('stamps a read with the account it started under, not one resolved later', async () => {
    // Round 4, P3-5: read A starts under account A; while its report is in
    // flight the account resolves as B. The stamp keeps A.
    const accountA = 'a'.repeat(64)
    const accountB = 'b'.repeat(64)
    let resolutions = 0
    const ledger: Pick<
      FakeUploadedFilesLedger,
      'accountReport' | 'deleteFile' | 'deleteAllOurs' | 'consumeDeleteNotice'
    > = {
      accountReport: vi.fn(
        () =>
          new Promise<typeof report>((resolve) => {
            setTimeout(() => {
              resolve(report)
            }, 20)
          }),
      ),
      deleteFile: vi.fn(() => Promise.resolve()),
      deleteAllOurs: vi.fn(() => Promise.resolve()),
      consumeDeleteNotice: vi.fn(() => Promise.resolve(undefined)),
    }
    const binding = createUploadedFilesBinding({
      uploads: vi.fn(() => Promise.resolve(ledger)),
      getAccountId: () => {
        resolutions += 1
        return Promise.resolve(resolutions === 1 ? accountA : accountB)
      },
      post: vi.fn(),
      confirmForeign: vi.fn(() => Promise.resolve(true)),
    })
    const stamped = await binding.port.readStamped()
    expect(stamped.accountId).toBe(accountA)
  })

  it('recovers the last account ledger once the key is gone', async () => {
    // Finding 6: the opener serves the persisted last account when no key
    // backs the ledger, instead of reading empty.
    const ledger: Pick<
      FakeUploadedFilesLedger,
      'accountReport' | 'deleteFile' | 'deleteAllOurs' | 'consumeDeleteNotice'
    > = {
      accountReport: vi.fn(() => Promise.resolve({ ...report, isReadOnly: true })),
      deleteFile: vi.fn(() => Promise.resolve()),
      deleteAllOurs: vi.fn(() => Promise.resolve()),
      consumeDeleteNotice: vi.fn(() => Promise.resolve(undefined)),
    }
    const uploads = vi.fn(() => Promise.resolve(ledger))
    const openLastUploads = vi.fn(() => Promise.resolve(ledger))
    const binding = createUploadedFilesBinding({
      uploads,
      openLastUploads,
      getAccountId: () => Promise.resolve(undefined),
      post: vi.fn(),
      confirmForeign: vi.fn(() => Promise.resolve(true)),
    })
    expect(await binding.list()).toEqual({ ...report, isReadOnly: true })
    expect(uploads).not.toHaveBeenCalled()
    expect(openLastUploads).toHaveBeenCalledOnce()
  })

  it('stamps each posted report with its read account and generation', async () => {
    const t = setup()
    await t.binding.list()
    t.binding.port.post(report)
    expect(t.post).toHaveBeenCalledWith({
      report,
      accountId: 'a'.repeat(64),
      generation: 1,
    })
    await t.binding.list()
    t.binding.port.post(report)
    expect(t.post).toHaveBeenLastCalledWith({
      report,
      accountId: 'a'.repeat(64),
      generation: 2,
    })
  })

  it('keeps the retained list read-only after the key is removed', async () => {
    // The finding's scenario through the real ledger: two cached files, the
    // key goes, the next read still lists both as read-only and no delete
    // reaches the provider.
    const accountId = 'b'.repeat(64)
    let current: string | undefined = accountId
    let live: string | undefined = accountId
    const cached = [
      { fileId: 'file-one', name: 'clip.mp4', bytes: 3, expiresAt: 1_800_000_000 },
      { fileId: 'file-other', name: 'other.pdf', bytes: 12, expiresAt: 1_800_000_000 },
    ]
    let saved: unknown = {
      version: 1,
      accountId,
      entries: [
        {
          file: {
            fileId: 'file-one',
            provider: 'meta',
            expiresAt: 1_800_000_000,
            sha256: 'c'.repeat(64),
            bytes: 3,
            name: 'clip.mp4',
            mime: 'video/mp4',
          },
          sessions: [],
        },
      ],
      cachedFiles: cached,
    }
    const deleted: string[] = []
    const accountFiles = vi.fn(() => Promise.resolve(cached))
    const forAccountFiles = {
      upload: () => Promise.reject(new Error('no upload here')),
      retrieve: () => Promise.resolve({}),
      accountFiles,
      delete: (fileId: string) => {
        deleted.push(fileId)
        return Promise.resolve()
      },
      forAccount: () => forAccountFiles,
    }
    const ledger = new UploadLedger({
      storage: {
        read: () => Promise.resolve(structuredClone(saved)),
        write: (state) => {
          saved = structuredClone(state)
          return Promise.resolve()
        },
        withLock: async (operation) => await operation(),
      },
      files: forAccountFiles,
      accountId,
      provider: 'meta',
      poolBytes: 100,
      currentAccountId: () => Promise.resolve(current),
      now: () => 4_000_000,
    })
    const seen: string[] = []
    const binding = createUploadedFilesBinding({
      uploads: (id) => {
        seen.push(id)
        return Promise.resolve(ledger)
      },
      getAccountId: () => Promise.resolve(live),
      post: () => undefined,
      confirmForeign: () => Promise.resolve(true),
    })
    const before = await binding.list()
    expect(before.files.map((file) => file.fileId)).toEqual(['file-one', 'file-other'])
    expect(before.isReadOnly).toBe(false)
    current = undefined
    live = undefined
    const after = await binding.list()
    // The factory is not asked again: the core port serves its retained
    // ledger instead of reading empty.
    expect(seen).toEqual([accountId])
    expect(after.files.map((file) => file.fileId)).toEqual(['file-one', 'file-other'])
    expect(after.isReadOnly).toBe(true)
    // ... and the provider was not asked again without the key.
    expect(accountFiles).toHaveBeenCalledTimes(1)
    await expect(binding.remove('file-one', () => Promise.resolve(true))).rejects.toThrow(
      UI_TEXT.media.filesReadOnly,
    )
    await expect(binding.port.deleteAllOurs()).rejects.toThrow(UI_TEXT.media.filesReadOnly)
    expect(deleted).toEqual([])
  })
})

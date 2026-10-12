import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { FilesApi, type UploadSource } from '../../src/core/backends/modelapi/files'
import { ModelApiError } from '../../src/core/backends/modelapi/client'
import {
  UploadDeleteFailedError,
  UploadLedger,
  type UploadLedgerDeps,
  type UploadLedgerStorage,
} from '../../src/core/media/uploadLedger'
import {
  MEDIA_CANCEL_INTENT_WRITE_DELAY_MS,
  MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS,
  MEDIA_UPLOAD_DELETE_RETRY_BASE_DELAY_MS,
  MEDIA_UPLOAD_DELETE_RETRY_MAX_DELAY_MS,
} from '../../src/shared/constants'
import { uploadedFilesReportSchema } from '../../src/shared/media'
import { FifoLimiter } from '../../src/core/fifoLimiter'

const accountId = 'a'.repeat(64)
const content = new Uint8Array([1, 2, 3])
const sha256 = createHash('sha256').update(content).digest('hex')
const receipt = {
  id: 'file-ours',
  object: 'file',
  bytes: 3,
  created_at: 1000,
  expires_at: 4600,
  filename: 'clip.mp4',
  purpose: 'user_data',
  status: 'uploaded',
}
const ref = {
  fileId: receipt.id,
  provider: 'meta',
  expiresAt: receipt.expires_at,
  sha256,
  bytes: 3,
  name: 'clip.mp4',
  mime: 'video/mp4',
}
const foreign = { ...receipt, id: 'file-other', filename: 'other.pdf', bytes: 12 }

function setup(now: () => number = () => 1_001_000, sleep?: UploadLedgerDeps['sleep']) {
  let saved: unknown
  let current: string | undefined = accountId
  let serial = 0
  let isMissing = false
  const limiter = new FifoLimiter(1)
  const storage: UploadLedgerStorage = {
    read: vi.fn(() => Promise.resolve(structuredClone(saved))),
    write: vi.fn((state) => {
      saved = structuredClone(state)
      return Promise.resolve()
    }),
    withLock: async (operation) =>
      await limiter.run(
        operation,
        () => true,
        () => new Error('dropped'),
      ),
  }
  const requestFile = vi.fn(
    async (
      _route: string,
      method: string,
      _signal: AbortSignal,
      multipart?: { body: ReadableStream<Uint8Array> },
      expectedAccount?: string,
    ) => {
      expect(expectedAccount).toBe(accountId)
      if (method === 'POST') {
        await new Response(multipart?.body).arrayBuffer()
        serial += 1
        return Response.json({
          ...receipt,
          id: serial === 1 ? receipt.id : `file-replaced-${String(serial)}`,
        })
      }
      if (method === 'DELETE')
        return Response.json({ id: _route.split('/').at(-1), object: 'file', deleted: true })
      if (_route === '/files')
        return Response.json({ object: 'list', data: [receipt, foreign], has_more: false })
      if (isMissing) throw new ModelApiError('Not found', 404, undefined, undefined)
      return Response.json({ ...receipt, id: _route.split('/').at(-1) })
    },
  )
  const files = new FilesApi({
    provider: 'meta',
    client: { requestFile },
    authorizeUpload: () => Promise.resolve(),
    expirySeconds: 3600,
  })
  const ledger = new UploadLedger({
    files,
    storage,
    accountId,
    provider: 'meta',
    poolBytes: 100 * 1024 ** 3,
    currentAccountId: () => Promise.resolve(current),
    now,
    ...(sleep !== undefined && { sleep }),
  })
  const source: UploadSource = {
    name: ref.name,
    mime: ref.mime,
    bytes: 3,
    async *open() {
      await Promise.resolve()
      yield content
    },
  }
  return {
    ledger,
    storage,
    requestFile,
    source,
    raw: () => saved,
    setRaw: (value: unknown) => {
      saved = value
    },
    setAccount: (value: string | undefined) => {
      current = value
    },
    missing: () => {
      isMissing = true
    },
  }
}

type LedgerRig = ReturnType<typeof setup>

/** One upload owned by `s1`. */
async function uploadedOnce(rig: LedgerRig): Promise<void> {
  await rig.ledger.ensure('s1', sha256, rig.source, new AbortController().signal)
}

/** The provider refuses every DELETE with a fresh `failure`. */
function refuseDeletes(rig: LedgerRig, failure: () => Error = () => new Error('Offline')) {
  const real = rig.requestFile.getMockImplementation()!
  rig.requestFile.mockImplementation(async (...args) => {
    if (args[1] === 'DELETE') throw failure()
    return await real(...args)
  })
  return real
}

/** One upload shared with `fork`, then expired at the provider. */
async function sharedUpload(rig: LedgerRig, signal: AbortSignal): Promise<void> {
  await rig.ledger.ensure('s1', sha256, rig.source, signal)
  await rig.ledger.syncSession('fork', [ref])
  rig.missing()
}

/** The cancelled or failed re-upload left the shared entry exactly as it was. */
async function expectSharedEntryKept(rig: LedgerRig): Promise<void> {
  expect(rig.requestFile.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(2)
  expect(rig.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
  expect(rig.raw()).toMatchObject({
    entries: [{ file: ref, sessions: ['s1', 'fork'] }],
    orphans: [],
  })
  // The fork that still names the old ref saves without re-uploading.
  await rig.ledger.syncSession('fork', [ref])
  expect(rig.requestFile.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(2)
}

describe('upload ownership ledger', () => {
  it('retrieves a locally expired upload under clock skew without reopening a discarded source', async () => {
    const t = setup(() => 8_200_000)
    const signal = new AbortController().signal
    const first = await t.ledger.ensure('s1', sha256, t.source, signal)
    const open = vi.fn(() => {
      throw new Error('Source discarded')
    })
    const duplicate = await t.ledger.ensure('fork', sha256, { ...t.source, open }, signal)
    expect(duplicate).toEqual(first)
    expect(open).not.toHaveBeenCalled()
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(1)
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'GET')).toHaveLength(1)
    expect(t.raw()).toMatchObject({ entries: [{ sessions: ['s1', 'fork'] }] })
  })

  it('uploads identical bytes once, shares fork/rewind refs and deletes only after the last session releases', async () => {
    const t = setup()
    const signal = new AbortController().signal
    const [first, duplicate] = await Promise.all([
      t.ledger.ensure('parent', sha256, t.source, signal),
      t.ledger.ensure('parent', sha256, t.source, signal),
    ])
    expect(first).toEqual(ref)
    expect(duplicate).toEqual(ref)
    await t.ledger.syncSession('fork', [ref, ref])
    await t.ledger.syncSession('parent', [ref])
    await t.ledger.releaseSession('parent')
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
    await t.ledger.releaseSession('fork')
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(1)
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
  })

  it('records a failed provider deletion and never fails a save because of it', async () => {
    let nowMs = 1_001_000
    const t = setup(() => nowMs)
    await uploadedOnce(t)
    const real = refuseDeletes(t)
    // The save-side release succeeds while the provider is down: the entry
    // stays with its recorded attempt, backoff and fixed reason code.
    await t.ledger.releaseSession('s1')
    expect(t.raw()).toMatchObject({
      entries: [{ sessions: [] }],
      deleteFailures: [
        {
          fileId: ref.fileId,
          attempts: 1,
          nextAttemptAt: nowMs + MEDIA_UPLOAD_DELETE_RETRY_BASE_DELAY_MS,
          reason: 'delete_failed',
        },
      ],
    })
    const deletes = () => t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE').length
    const attempted = deletes()
    // A sweep before the backoff is due attempts no DELETE and still succeeds.
    await t.ledger.syncSession('s2', [])
    expect(deletes()).toBe(attempted)
    // Past the backoff the sweep retries; the provider is back, so the entry
    // and its failure record are forgotten.
    nowMs += MEDIA_UPLOAD_DELETE_RETRY_BASE_DELAY_MS
    t.requestFile.mockImplementation(real)
    await t.ledger.accountReport()
    expect(t.raw()).toMatchObject({ entries: [], deleteFailures: [] })
    expect(deletes()).toBe(attempted + 1)
  })

  it('tells the account surface once after the named number of delete failures', async () => {
    let nowMs = 1_001_000
    const t = setup(() => nowMs)
    await uploadedOnce(t)
    const real = refuseDeletes(t)
    for (let attempt = 0; attempt < MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS; attempt += 1) {
      nowMs += MEDIA_UPLOAD_DELETE_RETRY_MAX_DELAY_MS
      await t.ledger.releaseSession('s1')
    }
    expect(t.raw()).toMatchObject({
      deleteFailures: [{ fileId: ref.fileId, attempts: MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS }],
    })
    // Told once, as a count: the provider still holds one file, unnamed.
    expect(await t.ledger.consumeDeleteNotice()).toEqual({ provider: 'meta', count: 1 })
    expect(await t.ledger.consumeDeleteNotice()).toBeUndefined()
    // The provider is back: the sweep deletes, forgets, and nothing is told.
    t.requestFile.mockImplementation(real)
    nowMs += MEDIA_UPLOAD_DELETE_RETRY_MAX_DELAY_MS
    await t.ledger.accountReport()
    expect(t.raw()).toMatchObject({ entries: [], deleteFailures: [] })
    expect(await t.ledger.consumeDeleteNotice()).toBeUndefined()
  })

  it('cleans an uploaded file when its ledger write fails and never records bytes or paths', async () => {
    const t = setup()
    vi.mocked(t.storage.write).mockRejectedValueOnce(new Error('Disk full'))
    await expect(
      t.ledger.ensure('s1', sha256, t.source, new AbortController().signal),
    ).rejects.toThrow('Disk full')
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
    expect(t.raw()).toBeUndefined()
    await t.ledger.ensure('s1', sha256, t.source, new AbortController().signal)
    expect(JSON.stringify(t.raw())).not.toMatch(/base64|file_data|data:|sourcePath/u)
  })

  it('reuploads one missing ID only after the original source hash matches', async () => {
    const t = setup()
    const signal = new AbortController().signal
    await sharedUpload(t, signal)
    const changed: UploadSource = {
      ...t.source,
      async *open() {
        await Promise.resolve()
        yield new Uint8Array([9, 9, 9])
      },
    }
    await expect(t.ledger.ensure('s1', sha256, changed, signal)).rejects.toThrow(
      'changed since upload',
    )
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(1)
    const replacement = await t.ledger.ensure('s1', sha256, t.source, signal)
    expect(replacement.fileId).toBe('file-replaced-2')
    expect(t.raw()).toMatchObject({ entries: [{ sessions: ['s1', 'fork'], file: replacement }] })
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(2)
  })

  it('restores the shared entry when a re-upload is cancelled, so the other session still saves', async () => {
    const t = setup()
    const caller = new AbortController()
    await sharedUpload(t, caller.signal)
    // Cancel the replacement as its publication write lands: the write still
    // commits, so the abort below exercises the post-commit path.
    const writes = vi.mocked(t.storage.write)
    const persist = writes.getMockImplementation()!
    writes.mockImplementation((state) => {
      if (state.entries.some((entry) => entry.file.fileId !== ref.fileId))
        caller.abort(new Error('cancelled re-upload'))
      return persist(state)
    })
    await expect(t.ledger.ensure('s1', sha256, t.source, caller.signal)).rejects.toThrow(
      'cancelled re-upload',
    )
    await expectSharedEntryKept(t)
  })

  it('restores the shared entry when the re-upload publication write fails', async () => {
    const t = setup()
    const signal = new AbortController().signal
    await sharedUpload(t, signal)
    // Fail only the replacement's publication write: the intent write that
    // follows names the restored entry, so it must land.
    const writes = vi.mocked(t.storage.write)
    const persist = writes.getMockImplementation()!
    let publicationFailures = 1
    writes.mockImplementation((state) => {
      if (
        publicationFailures > 0 &&
        state.entries.some((entry) => entry.file.fileId !== ref.fileId)
      ) {
        publicationFailures -= 1
        return Promise.reject(new Error('Disk full'))
      }
      return persist(state)
    })
    await expect(t.ledger.ensure('s1', sha256, t.source, signal)).rejects.toThrow('Disk full')
    await expectSharedEntryKept(t)
  })

  it('retries the cancel intent with backoff after a failed publication', async () => {
    const pauses: number[] = []
    const sleep = vi.fn((ms: number) => {
      pauses.push(ms)
      return Promise.resolve()
    })
    const t = setup(() => 1_001_000, sleep)
    const writes = vi.mocked(t.storage.write)
    const persist = writes.getMockImplementation()!
    let hasFailedPublication = false
    let intentFailures = 2
    writes.mockImplementation((state) => {
      if (!hasFailedPublication && state.entries.length > 0) {
        hasFailedPublication = true
        return Promise.reject(new Error('Disk full'))
      }
      if (
        hasFailedPublication &&
        state.entries.length === 0 &&
        (state.orphans ?? []).length > 0 &&
        intentFailures > 0
      ) {
        intentFailures -= 1
        return Promise.reject(new Error('Disk full'))
      }
      return persist(state)
    })
    await expect(
      t.ledger.ensure('s1', sha256, t.source, new AbortController().signal),
    ).rejects.toThrow('Disk full')
    // Two failed intent attempts pause with a doubling backoff; the third
    // lands, the provider copy is deleted, and the caller keeps the
    // publication failure, never a cleanup write error.
    expect(pauses).toEqual([
      MEDIA_CANCEL_INTENT_WRITE_DELAY_MS,
      MEDIA_CANCEL_INTENT_WRITE_DELAY_MS * 2,
    ])
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
    expect(t.raw()).toMatchObject({ entries: [], orphans: [] })
  })

  it('skips the backoff pause but not the attempts when the wait is cancelled', async () => {
    const caller = new AbortController()
    const sleep = vi.fn((_ms: number, signal?: AbortSignal) => {
      // Cancelled while waiting: no pause, but the bounded attempts still run.
      caller.abort(new Error('stop'))
      signal?.throwIfAborted()
      return Promise.resolve()
    })
    const t = setup(() => 1_001_000, sleep)
    const writes = vi.mocked(t.storage.write)
    const persist = writes.getMockImplementation()!
    let hasFailedPublication = false
    writes.mockImplementation((state) => {
      if (!hasFailedPublication && state.entries.length > 0) {
        hasFailedPublication = true
        return Promise.reject(new Error('Disk full'))
      }
      return hasFailedPublication && state.entries.length === 0
        ? Promise.reject(new Error('Disk full'))
        : persist(state)
    })
    // The intent never lands, so the caller falls back to a best-effort
    // DELETE and still reports the publication failure. All three attempts
    // ran back-to-back instead of waiting out the backoff.
    await expect(t.ledger.ensure('s1', sha256, t.source, caller.signal)).rejects.toThrow(
      'Disk full',
    )
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenNthCalledWith(1, MEDIA_CANCEL_INTENT_WRITE_DELAY_MS, caller.signal)
    expect(sleep).toHaveBeenNthCalledWith(2, MEDIA_CANCEL_INTENT_WRITE_DELAY_MS * 2, caller.signal)
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
    expect(t.raw()).toMatchObject({ entries: [], orphans: [ref.fileId] })
  })

  it('treats a missing provider file as already gone on explicit delete', async () => {
    const t = setup()
    await t.ledger.ensure('s1', sha256, t.source, new AbortController().signal)
    await t.ledger.accountReport()
    const real = t.requestFile.getMockImplementation()!
    t.requestFile.mockImplementation(async (...args) => {
      if (args[1] === 'DELETE') throw new ModelApiError('Not found', 404, undefined, undefined)
      return await real(...args)
    })
    const confirmation = vi.fn(() => Promise.resolve(true))
    await t.ledger.deleteFile(foreign.id, confirmation)
    expect(confirmation).toHaveBeenCalledWith(foreign.filename)
    expect(t.raw()).toMatchObject({
      entries: [{ file: { fileId: ref.fileId } }],
      cachedFiles: [{ fileId: ref.fileId }],
    })
  })

  it('records an explicit delete refusal under the file name, never the provider message', async () => {
    const t = setup()
    await uploadedOnce(t)
    refuseDeletes(t, () => new Error(`No file found with id '${ref.fileId}'.`))
    // The save-side release succeeds while the provider refuses; the entry
    // stays with its first recorded failure.
    await t.ledger.releaseSession('s1')
    try {
      await t.ledger.deleteFile(ref.fileId, () => Promise.resolve(true))
      expect.unreachable()
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(UploadDeleteFailedError)
      // The notice carries the display name, and the fixed message carries
      // no id-echoing provider text.
      if (error instanceof UploadDeleteFailedError) expect(error.fileName).toBe(ref.name)
      expect(String(error)).not.toContain(ref.fileId)
    }
    expect(t.raw()).toMatchObject({
      entries: [{ sessions: [] }],
      deleteFailures: [{ fileId: ref.fileId, attempts: 2, reason: 'delete_failed' }],
    })
  })

  it('shows every account file and its pool total, then retains read-only metadata after key removal', async () => {
    const t = setup()
    await t.ledger.ensure('s1', sha256, t.source, new AbortController().signal)
    const report = await t.ledger.accountReport()
    expect(report.usedBytes).toBe(15)
    expect(report.files).toEqual([
      {
        fileId: ref.fileId,
        name: ref.name,
        bytes: 3,
        expiresAt: ref.expiresAt,
        ours: true,
        sessions: ['s1'],
      },
      {
        fileId: foreign.id,
        name: foreign.filename,
        bytes: 12,
        expiresAt: foreign.expires_at,
        ours: false,
        sessions: [],
      },
    ])
    t.setAccount(undefined)
    t.requestFile.mockClear()
    expect(await t.ledger.accountReport()).toEqual({ ...report, isReadOnly: true })
    await expect(t.ledger.deleteAllOurs()).rejects.toThrow('read-only')
    await expect(
      t.ledger.ensure('s1', sha256, t.source, new AbortController().signal),
    ).rejects.toThrow('read-only')
    expect(t.requestFile).not.toHaveBeenCalled()
  })

  it('requires an explicit foreign-file confirmation and keeps shared ours protected', async () => {
    const t = setup()
    await t.ledger.ensure('s1', sha256, t.source, new AbortController().signal)
    await t.ledger.accountReport()
    const confirmation = vi.fn(() => Promise.resolve(false))
    await expect(t.ledger.deleteFile(ref.fileId, confirmation)).rejects.toThrow('Remove this file')
    await t.ledger.deleteAllOurs()
    await t.ledger.deleteFile(foreign.id, confirmation)
    expect(confirmation).toHaveBeenCalledWith(foreign.filename)
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
    confirmation.mockResolvedValue(true)
    await t.ledger.deleteFile(foreign.id, confirmation)
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
  })

  it('refuses a switched account, corrupt ledger, byte-bearing refs and unowned imports', async () => {
    const t = setup()
    await t.ledger.ensure('s1', sha256, t.source, new AbortController().signal)
    await expect(
      t.ledger.syncSession('import', [{ ...ref, sha256: 'b'.repeat(64), fileId: 'file-foreign' }]),
    ).rejects.toThrow('expired')
    t.setAccount('b'.repeat(64))
    await expect(
      t.ledger.ensure('s1', sha256, t.source, new AbortController().signal),
    ).rejects.toThrow('read-only')
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref, file_data: 'canary' }, sessions: ['s1'] }],
      cachedFiles: [],
    })
    await expect(t.ledger.accountReport()).rejects.toThrow()
    t.setRaw({ version: 1, accountId: 'b'.repeat(64), entries: [], cachedFiles: [] })
    await expect(t.ledger.accountReport()).rejects.toThrow('account mismatch')
    expect(
      uploadedFilesReportSchema.safeParse({
        provider: 'meta',
        isReadOnly: true,
        poolBytes: 1,
        usedBytes: -1,
        files: [],
      }).success,
    ).toBe(false)
  })

  it('refuses provider mismatches and unknown ledger fields rather than adopting ownership', async () => {
    const t = setup()
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref, provider: 'other' }, sessions: ['s1'] }],
      cachedFiles: [],
    })
    await expect(t.ledger.accountReport()).rejects.toThrow('provider mismatch')
    t.setRaw({
      version: 1,
      accountId,
      entries: [],
      cachedFiles: [],
      sourcePath: '/private/clip.mp4',
    })
    await expect(t.ledger.accountReport()).rejects.toThrow()
    t.setRaw(undefined)
    await expect(
      t.ledger.ensure('s1', 'invalid', t.source, new AbortController().signal),
    ).rejects.toThrow('Invalid source digest')
    expect(t.requestFile).not.toHaveBeenCalled()
  })

  it('does not turn a server failure into a second upload and names an unavailable expired source', async () => {
    const t = setup()
    await t.ledger.ensure('s1', sha256, t.source, new AbortController().signal)
    const real = t.requestFile.getMockImplementation()!
    t.requestFile.mockImplementation(async (...args) => {
      if (args[1] === 'GET' && args[0] !== '/files')
        throw new ModelApiError('Unavailable', 503, undefined, undefined)
      return await real(...args)
    })
    await expect(
      t.ledger.ensure('s1', sha256, t.source, new AbortController().signal),
    ).rejects.toThrow('Unavailable')
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(1)
    t.requestFile.mockImplementation(real)
    t.missing()
    const unavailable: UploadSource = {
      ...t.source,
      open: () => {
        throw new Error('Source removed')
      },
    }
    await expect(
      t.ledger.ensure('s1', sha256, unavailable, new AbortController().signal),
    ).rejects.toThrow('upload expired')
  })
})

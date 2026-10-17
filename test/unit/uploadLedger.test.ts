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
  MEDIA_PENDING_DELETE_RETRY_MAX_MS,
  MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS,
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

function setup(baseNow = 1_001_000, sleep?: UploadLedgerDeps['sleep']) {
  let saved: unknown
  let clock = baseNow
  let current: string | undefined = accountId
  let serial = 0
  let isMissing = false
  const deleted = new Set<string>()
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
      if (method === 'DELETE') {
        deleted.add(_route.split('/').at(-1) ?? '')
        return Response.json({ id: _route.split('/').at(-1), object: 'file', deleted: true })
      }
      if (_route === '/files')
        return Response.json({
          object: 'list',
          data: [receipt, foreign].filter((file) => !deleted.has(file.id)),
          has_more: false,
        })
      if (isMissing || deleted.has(_route.split('/').at(-1) ?? ''))
        throw new ModelApiError('Not found', 404, undefined, undefined)
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
    now: () => clock,
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
  const deleteCalls = () => requestFile.mock.calls.filter((call) => call[1] === 'DELETE')
  async function refusesCarriedFile() {
    await expect(ledger.deleteFile(ref.fileId, () => Promise.resolve(true))).rejects.toThrow(
      'in use by a running request',
    )
    expect(deleteCalls()).toEqual([])
  }
  function expectDeletedOnce() {
    expect(deleteCalls()).toHaveLength(1)
    expect(saved).toMatchObject({ entries: [], pinned: [] })
  }
  return {
    ledger,
    storage,
    requestFile,
    files,
    source,
    refusesCarriedFile,
    expectDeletedOnce,
    failProviderDeletes: (
      makeError: (method: string) => Error | undefined = (method) =>
        method === 'DELETE' ? new Error('Offline') : undefined,
    ) => {
      const real = requestFile.getMockImplementation()!
      const gate = { shouldFail: true }
      requestFile.mockImplementation(async (...args) => {
        const error = gate.shouldFail ? makeError(args[1]) : undefined
        if (error !== undefined) throw error
        return await real(...args)
      })
      return gate
    },
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
    advance: (ms: number) => {
      clock += ms
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
    pendingDeletes: [],
  })
  // The fork that still names the old ref saves without re-uploading.
  await rig.ledger.syncSession('fork', [ref])
  expect(rig.requestFile.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(2)
}

describe('upload ownership ledger', () => {
  it('retrieves a locally expired upload under clock skew without reopening a discarded source', async () => {
    const t = setup(8_200_000)
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

  it('records a failed provider deletion durably and retries past the backoff', async () => {
    const t = setup()
    await uploadedOnce(t)
    const real = refuseDeletes(t)
    // The save-side release reports the failure honestly; the row, its
    // intent and its isolated backoff stay durable for the next account read.
    await expect(t.ledger.releaseSession('s1')).rejects.toThrow('Offline')
    expect(t.raw()).toMatchObject({
      entries: [{ sessions: [] }],
      pendingDeletes: [{ fileId: ref.fileId, useGen: 1 }],
      pendingAttempts: { [ref.fileId]: { fails: 1 } },
    })
    const deletes = () => t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE').length
    const attempted = deletes()
    // The backoff holds the immediate retry: the next read attempts no
    // DELETE and the row stays.
    await t.ledger.accountReport()
    expect(deletes()).toBe(attempted)
    expect(t.raw()).toMatchObject({ entries: [{ sessions: [] }] })
    // A sync before the backoff is due attempts no DELETE and still succeeds.
    await t.ledger.syncSession('s2', [])
    expect(deletes()).toBe(attempted)
    // Past the backoff the read retries; the provider is back, so the entry,
    // its intent and its attempt record are forgotten.
    t.advance(60_000)
    t.requestFile.mockImplementation(real)
    await t.ledger.accountReport()
    expect(t.raw()).toMatchObject({ entries: [], pendingDeletes: [], pendingAttempts: {} })
    expect(deletes()).toBe(attempted + 1)
  })

  it('tells the account surface once after the named number of delete failures', async () => {
    const t = setup()
    await uploadedOnce(t)
    const real = refuseDeletes(t)
    // The release reports honestly (one recorded failure); each later
    // account read retries the durable intent once past its backoff. The
    // steps clear every backoff yet stay under the receipt's expiry, so the
    // sweep scope does not double-count the retry.
    await expect(t.ledger.releaseSession('s1')).rejects.toThrow('Offline')
    for (let attempt = 1; attempt < MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS; attempt += 1) {
      t.advance(MEDIA_PENDING_DELETE_RETRY_MAX_MS)
      await t.ledger.accountReport()
    }
    expect(t.raw()).toMatchObject({
      pendingAttempts: { [ref.fileId]: { fails: MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS } },
    })
    // Told once, as a count: the provider still holds one file, unnamed.
    expect(await t.ledger.consumeDeleteNotice()).toEqual({ provider: 'meta', count: 1 })
    expect(await t.ledger.consumeDeleteNotice()).toBeUndefined()
    // The provider is back: the read deletes, forgets, and nothing is told.
    t.requestFile.mockImplementation(real)
    t.advance(MEDIA_PENDING_DELETE_RETRY_MAX_MS)
    await t.ledger.accountReport()
    expect(t.raw()).toMatchObject({ entries: [] })
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
    // commits, so the post-commit check rolls the fresh upload back through
    // the intent-first path instead of leaving it referenced.
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
    const t = setup(1_001_000, sleep)
    const writes = vi.mocked(t.storage.write)
    const persist = writes.getMockImplementation()!
    // Fail the publication write once, then the next two intent writes: the
    // receipt write (no entry yet) and the later attempts persist.
    let hasFailedPublication = false
    let intentFailures = 2
    writes.mockImplementation((state) => {
      if (!hasFailedPublication && state.entries.length > 0) {
        hasFailedPublication = true
        return Promise.reject(new Error('Disk full'))
      }
      if (hasFailedPublication && (state.pendingDeletes ?? []).length > 0 && intentFailures > 0) {
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
    expect(t.raw()).toMatchObject({ entries: [], pendingDeletes: [] })
  })

  it('skips the backoff pause but not the attempts when the wait is cancelled', async () => {
    const caller = new AbortController()
    const sleep = vi.fn((_ms: number, signal?: AbortSignal) => {
      // Cancelled while waiting: no pause, but the bounded attempts still run.
      caller.abort(new Error('stop'))
      signal?.throwIfAborted()
      return Promise.resolve()
    })
    const t = setup(1_001_000, sleep)
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
    expect(t.raw()).toMatchObject({ entries: [], pendingDeletes: [{ fileId: ref.fileId }] })
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
    // The save-side release reports honestly with the first recorded
    // attempt; the explicit delete then wraps the refusal.
    await expect(t.ledger.releaseSession('s1')).rejects.toThrow(
      `No file found with id '${ref.fileId}'.`,
    )
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
      pendingAttempts: { [ref.fileId]: { fails: 2 } },
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

  it('deletes a young upload on its last release, while the read sweep spares unseen young orphans until expiry', async () => {
    // Clocks are honest here: now is milliseconds (4,000 s), the provider
    // expiry seconds (4,600 s) — one unit everywhere.
    const t = setup(4_000_000)
    const signal = new AbortController().signal
    await t.ledger.ensure('s1', sha256, t.source, signal)
    await t.ledger.releaseSession('s1')
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
    expect(t.raw()).toMatchObject({ entries: [] })
    // An orphan no release ever saw (a crash, another install) stays listed
    // on reads until the provider expiry passes.
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref }, sessions: [] }],
      cachedFiles: [],
    })
    t.requestFile.mockClear()
    await t.ledger.accountReport()
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
    expect(t.raw()).toMatchObject({ entries: [{ sessions: [] }] })
  })

  it('sweeps an unseen expired orphan on the account read, in seconds against a millisecond clock', async () => {
    // 8,200 s past a 4,600 s provider expiry: the sweep is the only thing
    // that deletes orphans, and only once expired.
    const t = setup(8_200_000)
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref }, sessions: [] }],
      cachedFiles: [],
    })
    await t.ledger.accountReport()
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
    expect(t.raw()).toMatchObject({ entries: [] })
  })

  it('leaves an unseen orphan alone when an unrelated session syncs', async () => {
    const t = setup(8_200_000)
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref }, sessions: [] }],
      cachedFiles: [],
    })
    await t.ledger.syncSession('unrelated', [])
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
    expect(t.raw()).toMatchObject({ entries: [{ sessions: [] }] })
  })

  it('never deletes a pinned file, however stale the window that released it', async () => {
    const t = setup(4_000_000)
    const signal = new AbortController().signal
    await t.ledger.ensure('s1', sha256, t.source, signal)
    // The active request's bracket pins what it carries.
    await t.ledger.pinFiles([ref.fileId])
    // A stale window's save releases the session reference underneath it.
    await t.ledger.releaseSession('s1')
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
    expect(t.raw()).toMatchObject({
      entries: [{ sessions: [] }],
      pinned: [{ fileId: ref.fileId, owner: expect.any(String) }],
    })
    // An explicit delete refuses the file in use too, naming the running
    // request rather than sessions (round 4, P3-3).
    await t.refusesCarriedFile()
    // Once the request settles, an explicit delete goes at once.
    await t.ledger.unpinFiles([ref.fileId])
    await t.ledger.deleteAllOurs()
    t.expectDeletedOnce()
  })

  it('retries a failed confirmed foreign-file delete on the next account read', async () => {
    const t = setup(4_000_000)
    t.setRaw({
      version: 1,
      accountId,
      entries: [],
      cachedFiles: [
        { fileId: foreign.id, name: foreign.filename, bytes: foreign.bytes, expiresAt: 4600 },
      ],
    })
    const gate = t.failProviderDeletes()
    // The refusal reaches the direct caller as the typed display-name error,
    // never the provider's message.
    await expect(t.ledger.deleteFile(foreign.id, () => Promise.resolve(true))).rejects.toThrow(
      UploadDeleteFailedError,
    )
    // The row and its intent stay durable; reopening the ledger retries.
    expect(t.raw()).toMatchObject({
      cachedFiles: [{ fileId: foreign.id }],
      pendingDeletes: [{ fileId: foreign.id, useGen: 0 }],
    })
    gate.shouldFail = false
    const reopened = new UploadLedger({
      files: t.files,
      storage: t.storage,
      accountId,
      provider: 'meta',
      poolBytes: 100 * 1024 ** 3,
      currentAccountId: () => Promise.resolve(accountId),
      // Past the failed delete's backoff, so the next read retries it.
      now: () => 4_000_000 + 60_000,
    })
    await reopened.accountReport()
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(2)
    // The retried delete cleared its row and intent; the provider's
    // remaining listing (our own live file) is cached again.
    expect(t.raw()).toMatchObject({ pendingDeletes: [], cachedFiles: [{ fileId: ref.fileId }] })
  })

  it('deletes nothing when the listing signal aborts during the storage read', async () => {
    const t = setup(8_200_000)
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref }, sessions: [] }],
      cachedFiles: [],
    })
    const controller = new AbortController()
    const realRead = vi.mocked(t.storage.read).getMockImplementation()!
    vi.mocked(t.storage.read).mockImplementationOnce(async () => {
      const state = await realRead()
      controller.abort()
      return state
    })
    await expect(t.ledger.accountReport(controller.signal)).rejects.toThrow()
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
  })

  it('never deletes an upload another session still references, even past provider expiry', async () => {
    const t = setup(8_200_000)
    const signal = new AbortController().signal
    await t.ledger.ensure('a', sha256, t.source, signal)
    await t.ledger.syncSession('b', [ref])
    await t.ledger.releaseSession('a')
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
    expect(t.raw()).toMatchObject({ entries: [{ sessions: ['b'] }] })
  })

  it('removes an unseen young orphan early through explicit deletion', async () => {
    const t = setup(4_000_000)
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref }, sessions: [] }],
      cachedFiles: [],
    })
    await t.ledger.deleteAllOurs()
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
    expect(t.raw()).toMatchObject({ entries: [] })
  })

  it('deletes nothing when the delete signal is already aborted', async () => {
    const t = setup(4_000_000)
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref }, sessions: [] }],
      cachedFiles: [],
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      t.ledger.deleteFile(ref.fileId, () => Promise.resolve(true), controller.signal),
    ).rejects.toThrow()
    await expect(t.ledger.deleteAllOurs(controller.signal)).rejects.toThrow()
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
    expect(t.raw()).toMatchObject({ entries: [{ sessions: [] }] })
  })

  it('records a provider-removed single file as gone instead of failing the delete', async () => {
    const t = setup(4_000_000)
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref }, sessions: [] }],
      cachedFiles: [
        { fileId: ref.fileId, name: ref.name, bytes: ref.bytes, expiresAt: ref.expiresAt },
      ],
    })
    const real = t.requestFile.getMockImplementation()!
    t.requestFile.mockImplementation(async (...args) => {
      if (args[1] === 'DELETE') throw new ModelApiError('Not found', 404, undefined, undefined)
      return await real(...args)
    })
    await t.ledger.deleteFile(ref.fileId, () => Promise.resolve(false))
    expect(t.raw()).toMatchObject({ entries: [], cachedFiles: [] })
  })

  it('records a provider-removed upload as gone instead of failing the cleanup', async () => {
    const t = setup(8_200_000)
    await t.ledger.ensure('s1', sha256, t.source, new AbortController().signal)
    const real = t.requestFile.getMockImplementation()!
    t.requestFile.mockImplementation(async (...args) => {
      if (args[1] === 'DELETE') throw new ModelApiError('Not found', 404, undefined, undefined)
      return await real(...args)
    })
    await t.ledger.releaseSession('s1')
    expect(t.raw()).toMatchObject({ entries: [] })
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

  it('voids a failed delete intent once a session uses the file again (USE BEATS INTENT)', async () => {
    // Round 4, P1-1: the delete fails while released; the same bytes attach
    // in another session; the next listing must not delete the reused file.
    for (const reuse of ['ensure', 'sync'] as const) {
      const t = setup()
      const signal = new AbortController().signal
      await t.ledger.ensure('s1', sha256, t.source, signal)
      const gate = t.failProviderDeletes()
      await expect(t.ledger.releaseSession('s1')).rejects.toThrow('Offline')
      if (reuse === 'ensure') await t.ledger.ensure('s2', sha256, t.source, signal)
      else await t.ledger.syncSession('s2', [ref])
      gate.shouldFail = false
      t.advance(60_000)
      await t.ledger.accountReport()
      // Only the failed dispatch ran; the reused file was never deleted.
      expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toHaveLength(1)
      expect(t.raw()).toMatchObject({ entries: [{ sessions: ['s2'] }], pendingDeletes: [] })
    }
  })

  it('counts pins per owner, so one request never unpins another (COUNTED REFERENCES)', async () => {
    // Round 4, P2-2: two requests carry the same file; the first end leaves
    // the second request's reference held.
    const t = setup()
    const signal = new AbortController().signal
    await t.ledger.ensure('s1', sha256, t.source, signal)
    await t.ledger.pinFiles([ref.fileId], 'owner-a')
    await t.ledger.pinFiles([ref.fileId], 'owner-b')
    // A stale window's save releases the session reference underneath both.
    await t.ledger.releaseSession('s1')
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
    await t.ledger.unpinFiles([ref.fileId], 'owner-a')
    await t.refusesCarriedFile()
    await t.ledger.unpinFiles([ref.fileId], 'owner-b')
    await t.ledger.deleteFile(ref.fileId, () => Promise.resolve(true))
    t.expectDeletedOnce()
  })

  it('drops a delete intent cancelled before dispatch, so no later listing runs it', async () => {
    // Round 4, P2-5: the cancel lands after the intent write but before the
    // provider dispatch; the next listing must not execute the cancelled delete.
    const t = setup()
    // A released but not yet cleaned entry: deletable, no intent yet.
    t.setRaw({
      version: 1,
      accountId,
      entries: [{ file: { ...ref }, sessions: [], useGen: 1 }],
      cachedFiles: [],
    })
    const controller = new AbortController()
    const inner = vi.mocked(t.storage.write).getMockImplementation()!
    let writes = 0
    vi.mocked(t.storage.write).mockImplementation(async (state) => {
      writes += 1
      if (writes === 1) controller.abort()
      await inner(state)
    })
    await expect(
      t.ledger.deleteFile(ref.fileId, () => Promise.resolve(true), controller.signal),
    ).rejects.toThrow('abort')
    expect(controller.signal.aborted).toBe(true)
    t.advance(60_000)
    await t.ledger.accountReport()
    // The dispatch never ran and the intent is gone: nothing was deleted.
    expect(t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')).toEqual([])
    expect(t.raw()).toMatchObject({ entries: [{ sessions: [] }], pendingDeletes: [] })
  })

  it('isolates one persistently failing delete with backoff and never breaks the listing', async () => {
    // Round 4, P2-6: the provider refuses the foreign file permanently; the
    // listing still succeeds and retries only after the backoff.
    const t = setup()
    t.setRaw({
      version: 1,
      accountId,
      entries: [],
      cachedFiles: [
        { fileId: foreign.id, name: foreign.filename, bytes: foreign.bytes, expiresAt: 4600 },
      ],
    })
    t.failProviderDeletes((method) =>
      method === 'DELETE' ? new ModelApiError('Refused', 403, undefined, undefined) : undefined,
    )
    await expect(t.ledger.deleteFile(foreign.id, () => Promise.resolve(true))).rejects.toThrow(
      UploadDeleteFailedError,
    )
    const deletes = () => t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE').length
    expect(deletes()).toBe(1)
    // The listing succeeds despite the stuck entry, and does not hammer it.
    const report = await t.ledger.accountReport()
    expect(deletes()).toBe(1)
    expect(
      report.files.map((file) => file.fileId).toSorted((a, b) => a.localeCompare(b, 'en')),
    ).toEqual(['file-other', 'file-ours'])
    expect(t.raw()).toMatchObject({
      pendingDeletes: [{ fileId: foreign.id, useGen: 0 }],
    })
    const attempts = (t.raw() as { pendingAttempts: Record<string, { fails: number }> })
      .pendingAttempts
    expect(attempts[foreign.id]?.fails).toBe(1)
    // Past the backoff it retries on its own — and backs off again.
    t.advance(60_000)
    await t.ledger.accountReport()
    expect(deletes()).toBe(2)
    expect(
      (t.raw() as { pendingAttempts: Record<string, { fails: number }> }).pendingAttempts[
        foreign.id
      ]?.fails,
    ).toBe(2)
  })
})

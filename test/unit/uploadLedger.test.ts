import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { FilesApi, type UploadSource } from '../../src/core/backends/modelapi/files'
import { ModelApiError } from '../../src/core/backends/modelapi/client'
import {
  UploadLedger,
  uploadedFilesReportSchema,
  type UploadLedgerStorage,
} from '../../src/core/media/uploadLedger'
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

function setup(now: () => number = () => 1_001_000) {
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

  it('keeps a failed provider deletion durable and retries cleanup on the next account read', async () => {
    const t = setup()
    await t.ledger.ensure('s1', sha256, t.source, new AbortController().signal)
    const real = t.requestFile.getMockImplementation()!
    let shouldFail = true
    t.requestFile.mockImplementation(async (...args) => {
      if (shouldFail && args[1] === 'DELETE') throw new Error('Offline')
      return await real(...args)
    })
    await expect(t.ledger.releaseSession('s1')).rejects.toThrow('Offline')
    expect(t.raw()).toMatchObject({ entries: [{ sessions: [] }] })
    shouldFail = false
    await t.ledger.accountReport()
    expect(t.raw()).toMatchObject({ entries: [] })
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
    await t.ledger.ensure('s1', sha256, t.source, signal)
    await t.ledger.syncSession('fork', [ref])
    t.missing()
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

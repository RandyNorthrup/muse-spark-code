// The uploaded-files composition (M105 lane F, D85.2): the production
// assembly for each host — the real session-uploads factory over real file
// storage and the real Files wire adapter, faked only at the HTTP boundary
// — driven through every consumer's exact call sequence: the controller's
// read/post/delete calls, the VS Code command and ACP /uploads, and the
// cleanupPeriodDays purge. A test here fails without the binding because
// the binding (the port supplier, the expiry threading, the purge release)
// is the production code under test.
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi, type Mock } from 'vitest'
import {
  FilesApi,
  uploadExpirySeconds,
  type UploadSource,
} from '../../src/core/backends/modelapi/files'
import { ModelApiError } from '../../src/core/backends/modelapi/client'
import { MILLISECONDS_PER_DAY, SECONDS_PER_DAY } from '../../src/shared/constants'
import { uploadedFilesReportSchema } from '../../src/shared/media'
import { UploadLedger, type UploadLedgerState } from '../../src/core/media/uploadLedger'
import { createUploadedFilesPort } from '../../src/core/media/uploadedFiles'
import { fileUploadLedgerStorage } from '../../src/core/media/uploadLedgerStorage'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { createSessionUploads } from '../../src/host/backend/sessionUploads'
import {
  createUploadedFilesBinding,
  runDeleteUploadedFilesCommand,
} from '../../src/host/conversation/uploadedFilesBinding'
import { runUploadsCommand } from '../../src/acp/uploads'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'muse-uploaded-files-'))
afterAll(() => removeFolder(root))

const accountId = 'c'.repeat(64)
const content = new Uint8Array([1, 2, 3])
const sha256 = createHash('sha256').update(content).digest('hex')
const youngContent = new Uint8Array([4, 5, 6])
const youngSha256 = createHash('sha256').update(youngContent).digest('hex')
const NOW = 8_200_000
const OLD = { created_at: 1000, expires_at: 4600 }
const YOUNG = { created_at: NOW - 1000, expires_at: NOW + 500_000 }

function uploadSource(bytes: Uint8Array, name: string, mime: string): UploadSource {
  return {
    name,
    mime,
    bytes: bytes.length,
    async *open() {
      await Promise.resolve()
      yield bytes
    },
  }
}

const source = uploadSource(content, 'clip.mp4', 'video/mp4')
const youngSource = uploadSource(youngContent, 'fresh.mp4', 'video/mp4')

interface Rig {
  readonly requestFile: Mock<
    (
      route: string,
      method: string,
      signal: AbortSignal,
      multipart?: { body: ReadableStream<Uint8Array> },
    ) => Promise<Response>
  >
  readonly bodies: string[]
  readonly uploadsDir: string
  readonly sessionsDir: string
  readonly accountId: string
}

/** The production stack with a fake HTTP boundary that counts provider calls. */
function rig(name: string, receipts: { created_at: number; expires_at: number }[]) {
  const uploadsDir = path.join(root, `${name}-uploads`)
  const sessionsDir = path.join(root, `${name}-sessions`)
  const bodies: string[] = []
  const deleted = new Set<string>()
  let serial = 0
  const requestFile = vi.fn(
    async (
      route: string,
      method: string,
      _signal: AbortSignal,
      multipart?: { body: ReadableStream<Uint8Array> },
    ) => {
      if (method === 'POST') {
        if (multipart?.body !== undefined) bodies.push(await new Response(multipart.body).text())
        serial += 1
        const receipt = receipts[Math.min(serial - 1, receipts.length - 1)] ?? OLD
        return Response.json({
          id: serial === 1 ? 'file-old' : `file-young-${String(serial)}`,
          object: 'file',
          bytes: content.length,
          created_at: receipt.created_at,
          expires_at: receipt.expires_at,
          filename: 'clip.mp4',
          purpose: 'user_data',
          status: 'uploaded',
        })
      }
      if (method === 'DELETE') {
        deleted.add(route.split('/').at(-1) ?? '')
        return Response.json({ id: route.split('/').at(-1), object: 'file', deleted: true })
      }
      if (route === '/files')
        return Response.json({
          object: 'list',
          data: [
            {
              id: 'file-old',
              object: 'file',
              bytes: content.length,
              created_at: OLD.created_at,
              expires_at: OLD.expires_at,
              filename: 'clip.mp4',
              purpose: 'user_data',
              status: 'uploaded',
            },
          ].filter((file) => !deleted.has(file.id)),
          has_more: false,
        })
      return Response.json({
        id: route.split('/').at(-1),
        object: 'file',
        bytes: content.length,
        created_at: OLD.created_at,
        expires_at: OLD.expires_at,
        filename: 'clip.mp4',
        purpose: 'user_data',
        status: 'uploaded',
      })
    },
  )
  const filesClient = () => ({ requestFile })
  return { requestFile, bodies, uploadsDir, sessionsDir, accountId, filesClient }
}

function productionUploads(t: Rig, expiryDays?: () => number) {
  return createSessionUploads({
    uploadLedgerDir: t.uploadsDir,
    currentAccountId: () => Promise.resolve(t.accountId),
    filesClient: t.filesClient,
    ...(expiryDays !== undefined && { expiryDays }),
    now: () => NOW,
  })
}

function vsCodeBinding(t: Rig, expiryDays?: () => number) {
  const uploads = productionUploads(t, expiryDays)
  const posted: unknown[] = []
  const binding = createUploadedFilesBinding({
    uploads,
    getAccountId: () => Promise.resolve(t.accountId),
    post: (report) => {
      posted.push(report)
    },
    confirmForeign: () => Promise.resolve(true),
  })
  return { binding, posted }
}

function deletes(t: Rig) {
  return t.requestFile.mock.calls.filter((call) => call[1] === 'DELETE')
}

describe('uploaded-files production composition', () => {
  it('threads the configured expiry days into the provider upload', async () => {
    const t = rig('expiry', [{ created_at: 1000, expires_at: 1000 + 30 * 86_400 }])
    expect(uploadExpirySeconds(30)).toBe(30 * SECONDS_PER_DAY)
    expect(uploadExpirySeconds(undefined)).toBe(7 * SECONDS_PER_DAY)
    expect(uploadExpirySeconds(99)).toBe(30 * SECONDS_PER_DAY)
    const uploads = productionUploads(t, () => 30)
    const ledger = await uploads(t.accountId)
    await ledger.ensure('s1', sha256, source, new AbortController().signal)
    expect(t.bodies).toHaveLength(1)
    expect(t.bodies[0]).toContain('expires_after[seconds]')
    expect(t.bodies[0]?.split('expires_after[seconds]', 2)[1]).toContain('2592000')
  })

  it('serves the VS Code consumers from the production port and deletes the chosen file', async () => {
    const t = rig('vscode', [YOUNG])
    const { binding, posted } = vsCodeBinding(t)
    const ledger = await productionUploads(t)(t.accountId)
    const ref = await ledger.ensure('s1', sha256, source, new AbortController().signal)
    await ledger.syncSession('s1', [ref])
    await ledger.releaseSession('s1')
    // The controller's readUploadedFiles sequence: read, validate, post.
    const read = uploadedFilesReportSchema.parse(await binding.port.read())
    binding.port.post(read)
    expect(posted).toHaveLength(1)
    expect(read.files.map((file) => file.fileId)).toEqual([ref.fileId])
    // The Delete Uploaded Files command: list, pick, delete through the provider.
    const picked: string[][] = []
    await runDeleteUploadedFilesCommand({
      list: binding.list,
      remove: binding.remove,
      confirmForeign: () => Promise.resolve(true),
      dialogs: {
        pick: (files) => {
          picked.push(files.map((file) => file.fileId))
          return Promise.resolve(files.map((file) => file.fileId))
        },
        inform: () => undefined,
        fail: (message) => {
          throw new Error(message)
        },
      },
    })
    expect(picked).toEqual([[ref.fileId]])
    expect(deletes(t)).toHaveLength(1)
    expect(deletes(t)[0]?.[0]).toBe(`/files/${ref.fileId}`)
    expect(await binding.list()).toEqual(expect.objectContaining({ files: [] }))
  })

  it('serves ACP /uploads from the same production ledger', async () => {
    const t = rig('acp', [YOUNG])
    const ledger = await productionUploads(t)(t.accountId)
    const ref = await ledger.ensure('s1', sha256, source, new AbortController().signal)
    await ledger.syncSession('s1', [ref])
    await ledger.releaseSession('s1')
    const port = createUploadedFilesPort({
      ledger: () => productionUploads(t)(t.accountId),
    })
    const sent: string[] = []
    const send = (text: string) => {
      sent.push(text)
    }
    expect(await runUploadsCommand('/uploads', { files: port, send })).toBe('handled')
    expect(sent.join('\n')).toContain('clip.mp4')
    expect(await runUploadsCommand(`/uploads delete ${ref.fileId}`, { files: port, send })).toBe(
      'handled',
    )
    expect(deletes(t)).toHaveLength(1)
  })

  it('purges expired sessions through the ledger: old orphans go, referenced and young ones stay', async () => {
    const t = rig('purge', [OLD, YOUNG])
    const uploads = productionUploads(t)
    const ledger = await uploads(t.accountId)
    const oldRef = await ledger.ensure('a', sha256, source, new AbortController().signal)
    await ledger.syncSession('b', [oldRef])
    const youngRef = await ledger.ensure(
      'c',
      youngSha256,
      youngSource,
      new AbortController().signal,
    )
    expect(youngRef.fileId).not.toBe(oldRef.fileId)
    const log = new FakeLogOutputChannel()
    const store = createFileSessionStore({
      directory: t.sessionsDir,
      log,
      retentionDays: () => 30,
      now: () => NOW,
      sleep: () => Promise.resolve(),
      uploads,
    })
    const session = (
      sessionId: string,
      refs: readonly (typeof oldRef)[],
      lastActivityAt: string,
    ) => ({
      version: 1,
      sessionId,
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
      effort: 'high',
      createdAt: '2026-09-22T09:00:00.000Z',
      lastActivityAt,
      turnIds: [],
      todos: [],
      replay: [],
      transcript: [],
      outputs: {},
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
      accountId: t.accountId,
      fileRefs: [...refs],
    })
    const fresh = new Date(NOW).toISOString()
    const stale = new Date(NOW - 40 * MILLISECONDS_PER_DAY).toISOString()
    await store.save(session('a', [oldRef], stale))
    await store.save(session('b', [oldRef], fresh))
    await store.save(session('c', [youngRef], stale))
    t.requestFile.mockClear()
    // The purge takes a: its old file stays while b references it, and
    // c's young file is spared even unreferenced.
    const remaining = await store.list()
    expect(remaining.map((header) => header.sessionId)).toEqual(['b'])
    expect(deletes(t)).toEqual([])
    // Ageing b past retention releases the old file through the provider.
    const names = await readdir(t.sessionsDir)
    const bFile = names.find((name) => name.startsWith('b.'))
    expect(bFile).toBe('b.json')
    const bPath = path.join(t.sessionsDir, bFile ?? '')
    const raw = JSON.parse(readFileSync(bPath, 'utf8')) as { lastActivityAt: string }
    raw.lastActivityAt = stale
    await writeFile(bPath, JSON.stringify(raw))
    const afterAgeing = await store.list()
    expect(afterAgeing.map((header) => header.sessionId)).toEqual([])
    expect(deletes(t).map((call) => call[0])).toEqual([`/files/${oldRef.fileId}`])
    // No paid traffic: the purge and the deletes never re-upload or fetch.
    expect(
      t.requestFile.mock.calls.filter((call) => call[1] === 'POST' || call[1] === 'GET'),
    ).toEqual([])
    // Privacy: the ledger on disk holds metadata only, never bytes or paths.
    const ledgerRaw = JSON.parse(
      readFileSync(path.join(t.uploadsDir, t.accountId, 'uploads.json'), 'utf8'),
    ) as UploadLedgerState
    for (const entry of ledgerRaw.entries) {
      expect(entry.file).toEqual({
        fileId: entry.file.fileId,
        provider: 'meta',
        expiresAt: entry.file.expiresAt,
        sha256: entry.file.sha256,
        bytes: entry.file.bytes,
        name: entry.file.name,
        mime: entry.file.mime,
      })
      expect(entry.file.name).not.toContain('/')
    }
  })

  it('cleans the same ledger from two windows exactly once without corrupting it', async () => {
    const t = rig('windows', [OLD])
    const directory = path.join(t.uploadsDir, t.accountId)
    const files = new FilesApi({
      client: t.filesClient(),
      provider: 'meta',
      authorizeUpload: () => Promise.resolve(),
    })
    const ledgers = [0, 1].map(
      () =>
        new UploadLedger({
          storage: fileUploadLedgerStorage(directory),
          files,
          accountId: t.accountId,
          provider: 'meta',
          poolBytes: 100,
          currentAccountId: () => Promise.resolve(t.accountId),
          now: () => NOW,
        }),
    )
    const first = ledgers[0]
    const second = ledgers[1]
    if (first === undefined || second === undefined) throw new Error('two ledgers')
    const ref = await first.ensure('a', sha256, source, new AbortController().signal)
    await first.syncSession('b', [ref])
    t.requestFile.mockClear()
    await Promise.all([first.releaseSession('a'), second.releaseSession('b')])
    expect(deletes(t)).toHaveLength(1)
    const state = JSON.parse(readFileSync(path.join(directory, 'uploads.json'), 'utf8'))
    expect(state).toMatchObject({ version: 1, entries: [] })
  })

  it('records a provider-removed file as gone during the production purge', async () => {
    const t = rig('gone', [OLD])
    const ledger = await productionUploads(t)(t.accountId)
    const ref = await ledger.ensure('s1', sha256, source, new AbortController().signal)
    await ledger.syncSession('s1', [ref])
    const real = t.requestFile.getMockImplementation()
    if (real === undefined) throw new Error('a fake wire')
    const through = async (route: string, method: string, signal: AbortSignal): Promise<Response> =>
      await real(route, method, signal)
    t.requestFile.mockImplementation(async (route: string, method: string, signal: AbortSignal) => {
      if (method === 'DELETE' && route.endsWith('/file-old')) {
        await through(route, method, signal)
        throw new ModelApiError('Not found', 404, undefined, undefined)
      }
      return await through(route, method, signal)
    })
    await ledger.releaseSession('s1')
    const report = uploadedFilesReportSchema.parse(await ledger.accountReport())
    expect(report.files).toEqual([])
  })
})

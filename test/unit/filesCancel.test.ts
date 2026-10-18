import { describe, expect, it } from 'vitest'
import { FilesApi, type FilesApiDeps } from '../../src/core/backends/modelapi/files'
import { UploadLedger, type UploadLedgerDeps } from '../../src/core/media/uploadLedger'

const ACCOUNT = 'a'.repeat(64)
const SEEN: { route: string; method: string; signal: AbortSignal | undefined }[] = []

function jsonResponse(payload: unknown): Response {
  return Response.json(payload)
}

function filesDeps(
  onRequest: (route: string, method: string, signal: AbortSignal | undefined) => unknown,
): FilesApiDeps {
  return {
    client: {
      requestFile: (
        route: string,
        method: 'GET' | 'POST' | 'DELETE',
        signal: AbortSignal | undefined,
      ) => {
        SEEN.push({ route, method, signal })
        return Promise.resolve(jsonResponse(onRequest(route, method, signal)))
      },
    },
    provider: 'meta',
    authorizeUpload: () => Promise.resolve(),
  }
}

const INVALID_RECEIPT = {
  id: 'file-cleanup1',
  object: 'file',
  bytes: 999,
  created_at: 1000,
  expires_at: 2000,
  filename: 'a.txt',
  purpose: 'user_data',
  status: 'processed',
}
const DELETION = { id: 'file-cleanup1', object: 'file', deleted: true }

describe('Files internal calls answer the operation signal', () => {
  it("upload's receipt cleanup deletes with the operation signal", async () => {
    SEEN.length = 0
    const api = new FilesApi(
      filesDeps((route, method) =>
        route === '/files' && method === 'POST' ? INVALID_RECEIPT : DELETION,
      ),
    )
    const signal = new AbortController().signal
    await expect(
      api.upload(
        {
          name: 'a.txt',
          mime: 'text/plain',
          bytes: 3,
          open: () => ({
            async *[Symbol.asyncIterator]() {
              await Promise.resolve()
              yield new TextEncoder().encode('abc')
            },
          }),
        },
        signal,
      ),
    ).rejects.toThrow('Invalid upload receipt')
    const cleanup = SEEN.find((seen) => seen.method === 'DELETE')
    expect(cleanup?.signal).toBe(signal)
  })

  it('accountFiles lists with the caller signal', async () => {
    SEEN.length = 0
    const api = new FilesApi(filesDeps(() => ({ object: 'list', data: [], has_more: false })))
    const signal = new AbortController().signal
    await api.accountFiles(signal)
    expect(SEEN).toHaveLength(1)
    expect(SEEN[0]).toMatchObject({ route: '/files', method: 'GET' })
    expect(SEEN[0]?.signal).toBe(signal)
  })

  it('ledger cleanup deletes with the caller signal', async () => {
    const deleted: { id: string; signal: AbortSignal | undefined }[] = []
    let state: unknown = {
      version: 1,
      accountId: ACCOUNT,
      entries: [
        {
          file: {
            fileId: 'file-orphan1',
            provider: 'meta',
            expiresAt: 2000,
            sha256: 'b'.repeat(64),
            bytes: 3,
            name: 'a.txt',
            mime: 'text/plain',
          },
          sessions: [],
        },
      ],
      cachedFiles: [],
    }
    const deps: UploadLedgerDeps = {
      storage: {
        read: () => Promise.resolve(state),
        write: (next) => {
          state = next
          return Promise.resolve()
        },
        withLock: (operation) => operation(),
      },
      files: {
        forAccount: () => deps.files,
        upload: () => Promise.reject(new Error('not under test')),
        retrieve: () => Promise.resolve({}),
        accountFiles: () => Promise.resolve([]),
        delete: (id: string, signal?: AbortSignal) => {
          deleted.push({ id, signal })
          return Promise.resolve()
        },
      },
      accountId: ACCOUNT,
      provider: 'meta',
      poolBytes: 0,
      currentAccountId: () => Promise.resolve(ACCOUNT),
      now: () => 1000,
    }
    const signal = new AbortController().signal
    await new UploadLedger(deps).releaseSession('session-1', signal)
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).toEqual({ id: 'file-orphan1', signal })
  })
})

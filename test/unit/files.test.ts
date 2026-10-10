import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  FilesApi,
  type FilesApiDeps,
  type UploadSource,
} from '../../src/core/backends/modelapi/files'
import { fakeFilesServer } from './helpers/media/fakeFilesServer'
import { removeFolder } from './helpers/temporaryFolders'

// Exact U6 response body: results.jsonl, run 2026-10-06T00-30-19-038Z, seq 4/5.
const capture = {
  id: 'file-1041857842215754',
  bytes: 526_054,
  created_at: 1_791_246_624,
  expires_at: 1_791_250_224,
  filename: 'clip10.mp4',
  object: 'file',
  purpose: 'user_data',
  status: 'uploaded',
}
const deletion = { id: capture.id, object: 'file', deleted: true }
const bytes = new Uint8Array(capture.bytes).fill(7)
const digest = createHash('sha256').update(bytes).digest('hex')
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0)) await close()
})

it.each(['retrieve', 'list', 'delete'] as const)(
  'combines caller cancellation with the Files deadline for %s',
  async (method) => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const requestFile = vi.fn((_route: string, _method: string, signal: AbortSignal) => {
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new Error(String(signal.reason)))
          },
          { once: true },
        )
      })
    })
    const api = new FilesApi({
      provider: 'meta',
      client: { requestFile },
      authorizeUpload: () => Promise.resolve(),
    })
    for (const isCallerCancelled of [false, true]) {
      const deadline = new AbortController()
      timeout.mockReturnValue(deadline.signal)
      const caller = new AbortController()
      const pending =
        method === 'list' ? api.list(caller.signal) : api[method](capture.id, caller.signal)
      const active = requestFile.mock.calls.at(-1)?.[2]
      if (isCallerCancelled) caller.abort(new Error('Caller stopped'))
      else deadline.abort(new Error('Deadline'))
      const wasAborted = active?.aborted
      if (!wasAborted) caller.abort(new Error('Fallback cleanup'))
      await expect(pending).rejects.toThrow(isCallerCancelled ? 'Caller stopped' : 'Deadline')
      expect(timeout).toHaveBeenLastCalledWith(30_000)
      expect(active).not.toBe(caller.signal)
      expect(wasAborted).toBe(true)
    }
  },
)

function client(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  apiKey: () => Promise<string | undefined> = () => Promise.resolve(undefined),
) {
  return new ModelApiClient({
    baseUrl,
    fetch: fetcher,
    apiKey,
    sleep: () => Promise.resolve(),
    now: Date.now,
    random: () => 0,
    log: { info: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
  })
}

const noCredentialTransport: typeof fetch = async (url, init) =>
  await fetch(url, {
    ...init,
    headers: { 'Content-Type': new Headers(init?.headers).get('Content-Type') ?? '' },
  })

function uploadReply(
  apiClient: ModelApiClient,
  replace: (response: Response) => Promise<Response>,
): Pick<ModelApiClient, 'requestFile'> {
  return {
    requestFile: async (...args) => {
      const response = await apiClient.requestFile(...args)
      return args[1] === 'POST' ? await replace(response) : response
    },
  }
}

async function setup(overrides: Partial<FilesApiDeps> = {}) {
  let hasFile = true
  const server = await fakeFilesServer({
    upload: () => capture,
    retrieve: () => capture,
    list: () => ({
      object: 'list',
      data: hasFile ? [capture] : [],
      first_id: capture.id,
      last_id: capture.id,
      has_more: false,
    }),
    delete: () => {
      hasFile = false
      return deletion
    },
    content: () => bytes,
  })
  cleanup.push(server.close)
  // Authorization is deliberately absent in fixtures; the real transport adds it at dispatch.
  const apiClient = client(server.baseUrl, noCredentialTransport, () =>
    Promise.resolve('fixture-authorization'),
  )
  const api = new FilesApi({
    client: apiClient,
    provider: 'meta',
    expirySeconds: 3600,
    authorizeUpload: () => Promise.resolve(),
    ...overrides,
  })
  const directory = await mkdtemp(path.join(tmpdir(), 'muse-files-'))
  cleanup.push(() => removeFolder(directory))
  const file = path.join(directory, capture.filename)
  await writeFile(file, bytes)
  const source: UploadSource = {
    name: capture.filename,
    mime: 'video/mp4',
    bytes: bytes.length,
    open: (signal) => createReadStream(file, { highWaterMark: 16 * 1024, signal }),
  }
  return { api, apiClient, server, source }
}

describe('Files API captured U6 wire', () => {
  it('streams disk bytes with bracket-form expiry, progress and SHA-256; retrieves, lists and deletes', async () => {
    const { api, server, source } = await setup()
    const progress = vi.fn()
    const ref = await api.upload(source, new AbortController().signal, progress)
    expect(ref).toEqual({
      fileId: capture.id,
      provider: 'meta',
      expiresAt: capture.expires_at,
      sha256: digest,
      bytes: bytes.length,
      name: capture.filename,
      mime: 'video/mp4',
    })
    expect(server.uploads[0]).toEqual({
      name: capture.filename,
      mime: 'video/mp4',
      bytes,
      expirySeconds: 3600,
    })
    expect(server.receivedChunkSizes.length).toBeGreaterThan(1)
    expect(Math.max(...server.receivedChunkSizes)).toBeLessThan(bytes.length)
    expect(progress.mock.calls.length).toBeGreaterThan(1)
    expect(progress).toHaveBeenLastCalledWith(bytes.length, bytes.length)
    expect(await api.retrieve(capture.id)).toEqual(capture)
    expect(await api.list()).toEqual([capture])
    await api.delete(capture.id)
    expect(await api.list()).toEqual([])
  })

  it('Stop closes a source in flight and makes no successful upload', async () => {
    const { api, source, server } = await setup()
    const stopped = new AbortController()
    const closed = vi.fn()
    const slow: UploadSource = {
      ...source,
      async *open() {
        try {
          await Promise.resolve()
          yield bytes.subarray(0, 1024)
          stopped.abort()
          yield bytes.subarray(1024)
        } finally {
          closed()
        }
      },
    }
    await expect(api.upload(slow, stopped.signal)).rejects.toThrow()
    expect(closed).toHaveBeenCalledOnce()
    expect(server.uploads).toEqual([])
  })

  it('deletes a known server-created file if Stop arrives with its receipt', async () => {
    const { source, server, apiClient } = await setup()
    const stopped = new AbortController()
    const api = new FilesApi({
      provider: 'meta',
      authorizeUpload: () => Promise.resolve(),
      client: uploadReply(apiClient, async (response) => {
        const received = Response.json(await response.json())
        stopped.abort()
        return received
      }),
    })
    await expect(api.upload(source, stopped.signal)).rejects.toThrow()
    expect(server.deletedIds).toEqual([capture.id])
  })

  it('requires expiry in the receipt and deletes an invalid known upload', async () => {
    const { source, apiClient, server } = await setup()
    const { expires_at: _expiry, ...withoutExpiry } = capture
    const api = new FilesApi({
      provider: 'meta',
      authorizeUpload: () => Promise.resolve(),
      client: uploadReply(apiClient, () => Promise.resolve(Response.json(withoutExpiry))),
    })
    await expect(api.upload(source, new AbortController().signal)).rejects.toThrow(
      'Invalid upload receipt',
    )
    expect(server.deletedIds).toEqual([capture.id])
  })

  it('deletes an identifiable malformed receipt and passes storage units to admission', async () => {
    const { source, apiClient, server } = await setup()
    const authorizeUpload = vi.fn(() => Promise.resolve())
    const api = new FilesApi({
      provider: 'meta',
      authorizeUpload,
      client: uploadReply(apiClient, () =>
        Promise.resolve(Response.json({ ...capture, expires_at: -1 })),
      ),
    })
    const signal = new AbortController().signal
    await expect(api.upload(source, signal)).rejects.toThrow()
    expect(server.deletedIds).toEqual([capture.id])
    expect(authorizeUpload).toHaveBeenCalledWith(signal, {
      bytes: source.bytes,
      expirySeconds: 604_800,
      provider: 'meta',
    })
  })

  it('refuses expiry, size, metadata and storage admission before reading or dispatching', async () => {
    const requestFile = vi.fn()
    const open = vi.fn()
    const source = { name: 'clip.mp4', mime: 'video/mp4', bytes: 10, open }
    for (const expirySeconds of [0, 3599, 2_592_001, 3600.5]) {
      const api = new FilesApi({
        client: { requestFile },
        provider: 'meta',
        expirySeconds,
        authorizeUpload: () => Promise.resolve(),
      })
      await expect(api.upload(source, new AbortController().signal)).rejects.toThrow(
        'Invalid upload expiry',
      )
    }
    const deps = {
      client: { requestFile },
      provider: 'meta',
      authorizeUpload: () => Promise.resolve(),
      maxBytes: 9,
    }
    await expect(new FilesApi(deps).upload(source, new AbortController().signal)).rejects.toThrow(
      'Invalid upload size',
    )
    await expect(
      new FilesApi({ ...deps, maxBytes: 10 }).upload(
        { ...source, name: 'a\r\nb.mp4' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Invalid upload metadata')
    await expect(
      new FilesApi({
        ...deps,
        maxBytes: 10,
        authorizeUpload: () => Promise.reject(new Error('Storage unknown')),
      }).upload(source, new AbortController().signal),
    ).rejects.toThrow('Storage unknown')
    expect(open).not.toHaveBeenCalled()
    expect(requestFile).not.toHaveBeenCalled()
  })

  it('verifies the source hash while streaming and refuses changed bytes', async () => {
    const { api, source, server } = await setup()
    await expect(
      api.upload(source, new AbortController().signal, undefined, 'a'.repeat(64)),
    ).rejects.toThrow()
    expect(server.uploads).toEqual([])
  })

  it('stops reading immediately when a source grows beyond its approved size', async () => {
    const { api, source } = await setup()
    const readRest = vi.fn()
    const growing: UploadSource = {
      ...source,
      bytes: 1,
      async *open() {
        await Promise.resolve()
        yield bytes.subarray(0, 2)
        readRest()
        yield bytes.subarray(2)
      },
    }
    await expect(api.upload(growing, new AbortController().signal)).rejects.toThrow()
    expect(readRest).not.toHaveBeenCalled()
  })

  it('refuses a truncated stream even when a receipt claims the approved size', async () => {
    const { source, apiClient, server } = await setup()
    const api = new FilesApi({
      provider: 'meta',
      authorizeUpload: () => Promise.resolve(),
      client: uploadReply(apiClient, () =>
        Promise.resolve(Response.json({ ...capture, bytes: source.bytes + 1 })),
      ),
    })
    await expect(
      api.upload({ ...source, bytes: source.bytes + 1 }, new AbortController().signal),
    ).rejects.toThrow()
    expect(server.uploads).toEqual([])
  })

  it('validates list, retrieve and delete boundaries and receipt identity', async () => {
    const requestFile = vi.fn(() =>
      Promise.resolve(Response.json({ ...capture, id: 'file-other' })),
    )
    const api = new FilesApi({
      client: { requestFile },
      provider: 'meta',
      authorizeUpload: () => Promise.resolve(),
    })
    await expect(api.retrieve(capture.id)).rejects.toThrow('Mismatched file receipt')
    await expect(api.list()).rejects.toThrow()
    requestFile.mockImplementation(() =>
      Promise.resolve(Response.json({ ...deletion, deleted: false })),
    )
    await expect(api.delete(capture.id)).rejects.toThrow()
    requestFile.mockImplementation(() =>
      Promise.resolve(Response.json({ ...deletion, id: 'file-other' })),
    )
    await expect(api.delete(capture.id)).rejects.toThrow('Mismatched delete receipt')
    await expect(api.delete('../responses')).rejects.toThrow()
    expect(requestFile).toHaveBeenCalledTimes(4)
  })

  it('passes a streaming body to the configured transport with no ambiguous retry or redirect', async () => {
    const sent = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 503 })))
    const apiClient = client('https://api.meta.ai/v1', sent, () =>
      Promise.resolve('fixture-authorization'),
    )
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
    await expect(
      apiClient.requestFile('/files', 'POST', new AbortController().signal, {
        body,
        contentType: 'multipart/form-data; boundary=test',
      }),
    ).rejects.toThrow('HTTP 503')
    expect(sent).toHaveBeenCalledOnce()
    expect(sent.mock.calls[0]?.[0]).toBe('https://api.meta.ai/v1/files')
    expect(sent.mock.calls[0]?.[1]).toMatchObject({ body, redirect: 'error', duplex: 'half' })
    await expect(
      client('https://api.meta.ai/v1', sent).requestFile(
        '/files',
        'GET',
        new AbortController().signal,
      ),
    ).rejects.toThrow('No Model API key')
    await expect(
      apiClient.requestFile('/files/../responses', 'GET', new AbortController().signal),
    ).rejects.toThrow('Invalid Files route')
    expect(sent).toHaveBeenCalledOnce()
  })

  it('checks the account digest after reading the key and before dispatch', async () => {
    const sent = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(capture)))
    const transport = client('https://api.meta.ai/v1', sent, () =>
      Promise.resolve('fixture-authorization'),
    )
    const api = new FilesApi({
      provider: 'meta',
      client: transport,
      authorizeUpload: () => Promise.resolve(),
    }).forAccount('0'.repeat(64))
    await expect(api.retrieve(capture.id)).rejects.toThrow('read-only')
    expect(sent).not.toHaveBeenCalled()
  })

  it('refuses a repeated or missing Files cursor instead of losing account entries', async () => {
    const page = { object: 'list', data: [capture], has_more: true, last_id: capture.id }
    let reads = 0
    const requestFile = vi.fn(() => {
      reads += 1
      return reads <= 2
        ? Promise.resolve(Response.json(page))
        : Promise.reject(new Error('Read past repeated cursor'))
    })
    const api = new FilesApi({
      provider: 'meta',
      client: { requestFile },
      authorizeUpload: () => Promise.resolve(),
    })
    await expect(api.list()).rejects.toThrow('Invalid Files pagination')
    expect(requestFile).toHaveBeenCalledTimes(2)
    requestFile.mockImplementation(() =>
      Promise.resolve(Response.json({ object: 'list', data: [capture], has_more: true })),
    )
    await expect(api.list()).rejects.toThrow('Invalid Files pagination')
  })
})

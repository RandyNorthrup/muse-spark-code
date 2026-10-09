import { createHash } from 'node:crypto'
import type * as NodeFsPromises from 'node:fs/promises'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { createServer, request, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { companionUpload, type CompanionUploadOptions } from '../../src/runtime/companion/upload'
import { companionMediaUploadSchema } from '../../src/shared/media'
import { TINY_PNG_BASE64 } from './helpers/fakeModelApi'
import { pdfFixture } from './helpers/pdfFixture'
import { videoFixture, wavFixture, ebmlFixture } from './helpers/media/fixtures'

const handles = vi.hoisted(() => ({ beforeClose: vi.fn<() => void>() }))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof NodeFsPromises>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args)
      const close = file.close.bind(file)
      file.close = async () => {
        try {
          handles.beforeClose()
        } finally {
          await close()
        }
      }
      return file
    },
  }
})

const responses: ServerResponse[] = []
const fixture = videoFixture()
const state = {
  root: '',
  stop: new AbortController(),
  origin: '',
  close: () => Promise.resolve(),
  isCurrent: true,
}
const sources: Parameters<CompanionUploadOptions['consume']>[0][] = []
const consumeSource = async (source: Parameters<CompanionUploadOptions['consume']>[0]) => {
  sources.push(source)
  expect(await readFile(source.path)).toEqual(Buffer.from(fixture))
  if (process.platform !== 'win32') {
    const file = await stat(source.path)
    const directory = await stat(path.dirname(source.path))
    expect(file.mode & 0o777).toBe(0o600)
    expect(directory.mode & 0o777).toBe(0o700)
  }
  return 'opaque-token'
}
const consume = vi.fn(consumeSource)
const admit = vi.fn<CompanionUploadOptions['admit']>(() => Promise.resolve({ ok: true }))

function headers(): IncomingHttpHeaders {
  return {
    authorization: 'Bearer test-window-token',
    origin: state.origin,
    'x-muse-guard': '1',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'content-type': 'application/octet-stream',
    'x-muse-media': JSON.stringify({
      requestId: 'request-1',
      name: 'renamed.webm',
      isScreenRecording: false,
    }),
  }
}

function send(
  supplied: IncomingHttpHeaders = headers(),
  body: Uint8Array = fixture,
  method = 'POST',
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(`${state.origin}/media`, { method, headers: supplied }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString())
        resolve({ status: response.statusCode ?? 0, body: parsed })
      })
    })
    req.on('error', reject)
    // Separate chunks exercise streamed intake, not a whole-file JSON upload.
    req.write(body.subarray(0, 16))
    req.end(body.subarray(16))
  })
}

async function sendStatus(...args: Parameters<typeof send>): Promise<number> {
  const response = await send(...args)
  return response.status
}

function config(overrides: Partial<CompanionUploadOptions> = {}): CompanionUploadOptions {
  return {
    origin: state.origin,
    bearer: 'test-window-token',
    customHeader: { name: 'x-muse-guard', value: '1' },
    metadataHeader: 'x-muse-media',
    maxBytes: fixture.length * 2,
    temporaryRoot: state.root,
    signal: state.stop.signal,
    isCurrent: () => state.isCurrent,
    admit,
    consume,
    ...overrides,
  }
}

async function serve(overrides: Partial<CompanionUploadOptions> = {}): Promise<void> {
  const server = createServer((req, response) => {
    responses.push(response)
    void companionUpload(config(overrides))(req, response)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test address')
  state.origin = `http://127.0.0.1:${String(address.port)}`
  state.close = () =>
    new Promise((resolve, reject) => {
      server.closeAllConnections()
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
}

beforeEach(async () => {
  state.root = await mkdtemp(path.join(tmpdir(), 'm105-e3-test-'))
  state.stop = new AbortController()
  state.isCurrent = true
  sources.length = 0
  responses.length = 0
  handles.beforeClose.mockReset()
  consume.mockReset().mockImplementation(consumeSource)
  admit.mockReset().mockImplementation(() => Promise.resolve({ ok: true }))
  await serve()
})
afterEach(async () => {
  state.stop.abort()
  await state.close()
  await rm(state.root, { recursive: true, force: true })
})

describe('guarded companion upload', () => {
  it('closes the inspection handle and removes private bytes before acknowledging the upload', async () => {
    let wasAcknowledgedWhileOpen: boolean | undefined
    handles.beforeClose.mockImplementationOnce(() => {
      wasAcknowledgedWhileOpen = responses.at(-1)?.writableEnded
    })
    const response = await send()
    expect(response.status).toBe(200)
    expect(handles.beforeClose).toHaveBeenCalledOnce()
    expect(wasAcknowledgedWhileOpen).toBe(false)
    expect(await readdir(state.root)).toEqual([])
  })

  it('decodes ASCII-safe metadata before validating and consuming the Unicode name', async () => {
    const name = '録画 100% 🎥.mp4'
    const response = await send({
      ...headers(),
      'x-muse-media': encodeURIComponent(
        JSON.stringify({ requestId: 'request-1', name, isScreenRecording: false }),
      ),
    })
    expect(response.status).toBe(200)
    expect(companionMediaUploadSchema.parse(response.body).name).toBe(name)
    expect(sources[0]?.name).toBe(name)
    expect(await readdir(state.root)).toEqual([])
  })
  it.each(['%invalid', '%7B%22bytes%22%3A%22canary%22%7D'])(
    'refuses malformed encoded metadata %s before intake',
    async (metadata) => {
      expect(await sendStatus({ ...headers(), 'x-muse-media': metadata })).toBe(400)
      expect(admit).not.toHaveBeenCalled()
      expect(consume).not.toHaveBeenCalled()
      expect(await readdir(state.root)).toEqual([])
    },
  )
  it('streams sniffed bytes into private files and returns only metadata/token after cleanup', async () => {
    const response = await send()
    expect(response.status).toBe(200)
    const parsed = companionMediaUploadSchema.parse(response.body)
    expect(parsed.info).toMatchObject({
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: fixture.length,
    })
    expect(parsed.uploadToken).toBe('opaque-token')
    expect(sources[0]?.sha256).toBe(createHash('sha256').update(fixture).digest('hex'))
    await vi.waitFor(async () => {
      expect(await readdir(state.root)).toEqual([])
    })
    expect(JSON.stringify(response.body)).not.toContain(state.root)
    expect(JSON.stringify(response.body)).not.toContain(Buffer.from(fixture).toString('base64'))
    expect(admit).toHaveBeenCalledWith(parsed.info, false, expect.any(AbortSignal))
  })

  it.each([
    ['bearer', { authorization: undefined }],
    ['wrong bearer', { authorization: 'Bearer foreign' }],
    ['custom header', { 'x-muse-guard': undefined }],
    ['wrong custom header', { 'x-muse-guard': '0' }],
    ['foreign Origin', { origin: 'https://foreign.example' }],
    ['missing Origin', { origin: undefined }],
    ['foreign Host', { host: 'foreign.example' }],
    ['Fetch Metadata site', { 'sec-fetch-site': 'cross-site' }],
    ['Fetch Metadata mode', { 'sec-fetch-mode': 'navigate' }],
    ['Fetch Metadata destination', { 'sec-fetch-dest': 'document' }],
    ['missing Fetch Metadata', { 'sec-fetch-site': undefined }],
    ['cookies', { cookie: 'session=foreign' }],
    ['content type', { 'content-type': 'video/mp4' }],
  ])('refuses %s before intake', async (_name, changes) => {
    const supplied: IncomingHttpHeaders = { ...headers(), ...changes }
    // Node rejects undefined header values; absence means delete it.
    for (const [key, value] of Object.entries(supplied))
      if (value === undefined) Reflect.deleteProperty(supplied, key)
    expect(await sendStatus(supplied)).toBe(403)
    expect(consume).not.toHaveBeenCalled()
    expect(admit).not.toHaveBeenCalled()
    expect(await readdir(state.root)).toEqual([])
  })

  it('refuses a stopped window and non-POST methods', async () => {
    state.isCurrent = false
    expect(await sendStatus()).toBe(403)
    state.isCurrent = true
    expect(await sendStatus(headers(), fixture, 'PUT')).toBe(405)
    expect(consume).not.toHaveBeenCalled()
  })

  it.each([
    ['image', Buffer.from(TINY_PNG_BASE64, 'base64')],
    ['document', pdfFixture(1)],
    ['audio', wavFixture()],
    ['video', videoFixture({ brand: 'qt  ' })],
  ])('dispatches sniffed %s without trusting its filename', async (kind, body) => {
    if (typeof body === 'string') throw new Error('Invalid fixture')
    await state.close()
    await serve({ maxBytes: Math.max(fixture.length, body.length) * 2 })
    consume.mockImplementationOnce(async (source) => {
      expect(await readFile(source.path)).toEqual(Buffer.from(body))
      return 'opaque-token'
    })
    const response = await send(headers(), body)
    expect(response.status).toBe(200)
    expect(companionMediaUploadSchema.parse(response.body).info.kind).toBe(kind)
    await vi.waitFor(async () => {
      expect(await readdir(state.root)).toEqual([])
    })
  })

  it('validates sniffed image dimensions before admission or consumption', async () => {
    const body = Buffer.from(TINY_PNG_BASE64, 'base64')
    body.writeUInt32BE(0, 16)
    expect(await sendStatus(headers(), body)).toBe(400)
    expect(admit).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })

  it('refuses invalid/byte-bearing metadata and never uses browser paths', async () => {
    const supplied = {
      ...headers(),
      'x-muse-media': JSON.stringify({
        requestId: 'request-1',
        name: 'clip.mp4',
        isScreenRecording: false,
        path: '/foreign',
        bytes: 'canary',
      }),
    }
    expect(await sendStatus(supplied)).toBe(400)
    expect(consume).not.toHaveBeenCalled()
    expect(await readdir(state.root)).toEqual([])
  })

  it('refuses an oversized declared length before creating a file', async () => {
    await state.close()
    await serve({ temporaryRoot: path.join(state.root, 'absent') })
    const supplied = { ...headers(), 'content-length': String(fixture.length * 4) }
    const response = await send(supplied)
    expect(response.status).toBe(400)
    expect(JSON.stringify(response.body)).toContain('exceeds')
    expect(consume).not.toHaveBeenCalled()
    expect(await readdir(state.root)).toEqual([])
  })

  it('enforces the streamed cap without Content-Length and removes partial bytes', async () => {
    const response = await send(headers(), new Uint8Array(fixture.length * 4))
    expect(response.status).toBe(400)
    expect(JSON.stringify(response.body)).toContain('exceeds')
    await vi.waitFor(async () => {
      expect(await readdir(state.root)).toEqual([])
    })
    expect(consume).not.toHaveBeenCalled()
  })

  it.each([new Uint8Array([1, 2, 3]), ebmlFixture('webm')])(
    'rejects unknown or nonaccepted sniffed formats',
    async (body) => {
      consume.mockResolvedValueOnce('opaque-token')
      admit.mockImplementation((info) =>
        info.mediaType === 'video/webm'
          ? Promise.reject(new Error('Unsupported format'))
          : Promise.resolve({ ok: true }),
      )
      expect(await sendStatus(headers(), body)).toBe(400)
      expect(consume).not.toHaveBeenCalled()
      await vi.waitFor(async () => {
        expect(await readdir(state.root)).toEqual([])
      })
    },
  )

  it('recordings must sniff as mp4 video; audio renamed mp4 is refused', async () => {
    await state.close()
    await serve({ maxBytes: wavFixture().length * 2 })
    const supplied = {
      ...headers(),
      'x-muse-media': JSON.stringify({
        requestId: 'request-1',
        name: 'clip.mp4',
        isScreenRecording: true,
      }),
    }
    expect(await sendStatus(supplied, wavFixture())).toBe(400)
    expect(consume).not.toHaveBeenCalled()
  })

  it('policy refusal cleans the file and does not echo sensitive exception text', async () => {
    admit.mockRejectedValue(new Error('private-path/provider-secret-canary'))
    const response = await send()
    expect(response.status).toBe(400)
    expect(JSON.stringify(response.body)).not.toContain('canary')
    expect(consume).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      expect(await readdir(state.root)).toEqual([])
    })
  })

  it('returns a named admission refusal without consuming bytes', async () => {
    admit.mockResolvedValueOnce({ ok: false, reason: 'Storage billing has not been verified.' })
    const response = await send()
    expect(response).toEqual({
      status: 400,
      body: { reason: 'Storage billing has not been verified.' },
    })
    expect(consume).not.toHaveBeenCalled()
  })

  it.each([
    { origin: 'https://foreign.example' },
    { origin: 'http://192.0.2.1' },
    { maxBytes: 0 },
    { maxBytes: Number.MAX_SAFE_INTEGER },
    { bearer: '' },
    { temporaryRoot: 'relative' },
    { metadataHeader: 'authorization' },
    { customHeader: { name: 'cookie', value: '1' } },
  ])('refuses unsafe route configuration', (override) => {
    expect(() => companionUpload(config(override))).toThrow(
      'Invalid companion upload configuration',
    )
  })

  it('checks the window again after admission', async () => {
    admit.mockImplementation(() => {
      state.isCurrent = false
      return Promise.resolve({ ok: true })
    })
    expect(await sendStatus()).toBe(400)
    expect(consume).not.toHaveBeenCalled()
  })

  it.each(['session change', 'cancellation'])(
    'refuses admission after a streamed %s',
    async (change) => {
      const isCurrent = vi
        .fn(() => {
          if (change === 'session change') return false
          state.stop.abort()
          return true
        })
        .mockReturnValueOnce(true)
      await state.close()
      await serve({ isCurrent })
      expect(await sendStatus()).toBe(400)
      expect(admit).not.toHaveBeenCalled()
      expect(consume).not.toHaveBeenCalled()
      await vi.waitFor(async () => {
        expect(await readdir(state.root)).toEqual([])
      })
    },
  )

  it('cancellation during policy work prevents consumption and cleans up', async () => {
    admit.mockImplementation(() => {
      state.stop.abort()
      return Promise.resolve({ ok: true })
    })
    expect(await sendStatus()).toBe(400)
    expect(consume).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      expect(await readdir(state.root)).toEqual([])
    })
  })

  it('cleans up when the consumer fails', async () => {
    consume.mockRejectedValueOnce(new Error('provider-secret-canary'))
    const response = await send()
    expect(response.status).toBe(400)
    expect(JSON.stringify(response.body)).not.toContain('canary')
    await vi.waitFor(async () => {
      expect(await readdir(state.root)).toEqual([])
    })
  })

  it.each(['session change', 'cancellation'])(
    'refuses a consumed token after %s',
    async (change) => {
      consume.mockImplementationOnce(() => {
        if (change === 'session change') state.isCurrent = false
        else state.stop.abort()
        return Promise.resolve('late-token')
      })
      const response = await send()
      expect(response.status).toBe(400)
      expect(JSON.stringify(response.body)).not.toContain('late-token')
      await vi.waitFor(async () => {
        expect(await readdir(state.root)).toEqual([])
      })
    },
  )

  it('cleans up a disconnected partial stream without dispatch', async () => {
    const req = request(`${state.origin}/media`, { method: 'POST', headers: headers() })
    req.on('error', () => {
      /* The test intentionally disconnects this stream. */
    })
    req.write(fixture.subarray(0, 16))
    await vi.waitFor(async () => {
      expect(await readdir(state.root)).toHaveLength(1)
    })
    req.destroy()
    await vi.waitFor(async () => {
      expect(await readdir(state.root)).toEqual([])
    })
    expect(consume).not.toHaveBeenCalled()
  })

  it('validates consumer tokens and cleans up on failure', async () => {
    consume.mockResolvedValueOnce('')
    expect(await sendStatus()).toBe(400)
    await vi.waitFor(async () => {
      expect(await readdir(state.root)).toEqual([])
    })
  })
})

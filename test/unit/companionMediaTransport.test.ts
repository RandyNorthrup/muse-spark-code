/** @vitest-environment jsdom */
import * as z from 'zod/mini'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { companionMediaTransport } from '../../src/webview/media/transport'
import { UI_TEXT } from '../../src/shared/constants'

const endpoint = 'http://127.0.0.1:12345/media'
const credentials = () => ({
  endpoint,
  origin: 'http://127.0.0.1:12345',
  bearer: 'test-window-token',
  customHeader: { name: 'x-muse-guard', value: '1' },
  metadataHeader: 'x-muse-media',
})
const metadataSchema = z.object({ requestId: z.string(), name: z.string() })

function setup(name = 'clip.mp4') {
  const response = Promise.withResolvers<Response>()
  const send = vi.fn<typeof fetch>(() => response.promise)
  const progress = vi.fn()
  const stop = new AbortController()
  const file = new File(['file-canary'], name, { type: 'video/mp4' })
  const transport = companionMediaTransport(credentials, send)
  const pending = transport.upload(file, file.name, false, stop.signal, progress)
  const init = send.mock.calls[0]?.[1]
  const headers = new Headers(init?.headers)
  const metadata: unknown = JSON.parse(decodeURIComponent(headers.get('x-muse-media') ?? '{}'))
  const parsed = metadataSchema.parse(metadata)
  const body = {
    ...parsed,
    uploadToken: 'opaque-token',
    info: {
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: file.size,
      durationSeconds: 10,
      hasSoundtrack: false,
    },
  }
  function reply(value: unknown = body, status = 200, url = endpoint) {
    const result = Response.json(value, { status })
    Object.defineProperty(result, 'url', { value: url })
    response.resolve(result)
  }
  return { response, headers, init, send, progress, stop, file, pending, reply, body }
}

beforeEach(() => {
  vi.restoreAllMocks()
})
describe('companion browser transport', () => {
  it('sends the File as the HTTP body with guards and no content in bridge metadata', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => {
      throw new Error('The page must not read file bytes')
    })
    const rig = setup()
    expect(read).not.toHaveBeenCalled()
    expect(rig.send).toHaveBeenCalledWith(endpoint, expect.objectContaining({ body: rig.file }))
    expect(rig.headers.get('Authorization')).toBe('Bearer test-window-token')
    expect(rig.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(rig.headers.get('x-muse-guard')).toBe('1')
    expect(rig.headers.get('x-muse-media')).not.toContain('file-canary')
    expect(rig.init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error',
      signal: rig.stop.signal,
    })
    expect(rig.progress).toHaveBeenCalledExactlyOnceWith(0, rig.file.size)
    rig.reply()
    await expect(rig.pending).resolves.toEqual(rig.body)
    expect(rig.progress).toHaveBeenLastCalledWith(rig.file.size, rig.file.size)
  })
  it('encodes Unicode and percent signs without encoding file bytes', async () => {
    const rig = setup('録画 100% 🎥.mp4')
    expect(rig.headers.get('x-muse-media')).toMatch(/^[\u{20}-\u{7E}]+$/u)
    expect(rig.body.name).toBe(rig.file.name)
    rig.reply()
    await expect(rig.pending).resolves.toMatchObject({ name: rig.file.name })
  })
  it.each([
    ['bytes', { bytes: 'canary' }],
    ['path', { path: '/private' }],
    ['request', { requestId: 'foreign' }],
    ['name', { name: 'foreign.mp4' }],
    ['token', { uploadToken: '' }],
    [
      'size',
      {
        info: {
          kind: 'video',
          mediaType: 'video/mp4',
          sizeBytes: 1,
          durationSeconds: 10,
          hasSoundtrack: false,
        },
      },
    ],
  ])('rejects an invalid %s in the response', async (_name, override) => {
    const rig = setup()
    rig.reply({ ...rig.body, ...override })
    await expect(rig.pending).rejects.toThrow(UI_TEXT.attachmentUnreadable)
  })
  it('refuses redirects and HTTP failures', async () => {
    const rig = setup()
    rig.reply(rig.body, 200, 'https://foreign.example/media')
    await expect(rig.pending).rejects.toThrow(UI_TEXT.attachmentUnreadable)
    const failure = setup()
    failure.reply({ reason: UI_TEXT.media.uploadStorageUnknown }, 400)
    await expect(failure.pending).rejects.toThrow(UI_TEXT.media.uploadStorageUnknown)
  })
  it.each(['network', 'invalid JSON'])(
    'reports %s failure without completion progress',
    async (kind) => {
      const rig = setup()
      if (kind === 'network') rig.response.reject(new TypeError('Fake network failure'))
      else rig.response.resolve(new Response('malformed'))
      await expect(rig.pending).rejects.toThrow(UI_TEXT.attachmentUnreadable)
      expect(rig.progress).toHaveBeenCalledExactlyOnceWith(0, rig.file.size)
    },
  )
  it('rejects an HTTP error even if its body contains valid upload metadata', async () => {
    const rig = setup()
    rig.reply(rig.body, 403)
    await expect(rig.pending).rejects.toThrow(UI_TEXT.attachmentUnreadable)
  })
  it.each([
    'http://127.0.0.1:12346/media',
    'https://foreign.example/media',
    'http://192.0.2.1/media',
  ])('refuses endpoint %s before dispatch', async (url) => {
    const send = vi.fn<typeof fetch>()
    const port = companionMediaTransport(() => ({ ...credentials(), endpoint: url }), send)
    await expect(
      port.upload(new Blob(['x']), 'x', false, new AbortController().signal, vi.fn()),
    ).rejects.toThrow(UI_TEXT.attachmentUnreadable)
    expect(send).not.toHaveBeenCalled()
  })
  it('ignores a late response after Stop', async () => {
    const rig = setup()
    rig.stop.abort()
    rig.reply()
    await expect(rig.pending).rejects.toThrow(UI_TEXT.media.uploadStop)
    expect(rig.progress).toHaveBeenCalledExactlyOnceWith(0, rig.file.size)
  })
  it('Stop aborts the request; no stale token survives it', async () => {
    const rig = setup()
    rig.init?.signal?.addEventListener('abort', () => {
      rig.response.reject(new DOMException('Fake abort', 'AbortError'))
    })
    rig.stop.abort()
    expect(rig.init?.signal?.aborted).toBe(true)
    await expect(rig.pending).rejects.toThrow(UI_TEXT.media.uploadStop)
  })
  it('refuses an already aborted request before dispatch', async () => {
    const stop = new AbortController()
    stop.abort()
    const send = vi.fn<typeof fetch>()
    await expect(
      companionMediaTransport(credentials, send).upload(
        new Blob(['x']),
        'x',
        false,
        stop.signal,
        vi.fn(),
      ),
    ).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})

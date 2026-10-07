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

function setup() {
  const xhr = new XMLHttpRequest()
  const headers = new Map<string, string>()
  vi.spyOn(xhr, 'open').mockImplementation(() => {
    /* The fake absorbs browser HTTP work. */
  })
  vi.spyOn(xhr, 'setRequestHeader').mockImplementation((name, value) => {
    headers.set(name, value)
  })
  const send = vi.spyOn(xhr, 'send').mockImplementation(() => {
    /* The fake absorbs browser HTTP work. */
  })
  const abort = vi.spyOn(xhr, 'abort').mockImplementation(() => {
    xhr.dispatchEvent(new Event('abort'))
  })
  const progress = vi.fn()
  const stop = new AbortController()
  const file = new File(['file-canary'], 'clip.mp4', { type: 'video/mp4' })
  const transport = companionMediaTransport(credentials, () => xhr)
  const pending = transport.upload(file, file.name, false, stop.signal, progress)
  const metadata: unknown = JSON.parse(headers.get('x-muse-media') ?? '{}')
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
    Object.defineProperties(xhr, {
      response: { value, configurable: true },
      status: { value: status, configurable: true },
      responseURL: { value: url, configurable: true },
    })
    xhr.dispatchEvent(new Event('load'))
  }
  return { xhr, headers, send, abort, progress, stop, file, pending, reply, body }
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
    expect(rig.send).toHaveBeenCalledWith(rig.file)
    expect(rig.headers.get('Authorization')).toBe('Bearer test-window-token')
    expect(rig.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(rig.headers.get('x-muse-guard')).toBe('1')
    expect(rig.headers.get('x-muse-media')).not.toContain('file-canary')
    expect(rig.xhr.withCredentials).toBe(false)
    rig.xhr.upload.dispatchEvent(new ProgressEvent('progress', { loaded: 1, total: rig.file.size }))
    expect(rig.progress).toHaveBeenLastCalledWith(1, rig.file.size)
    rig.reply()
    await expect(rig.pending).resolves.toEqual(rig.body)
    expect(rig.progress).toHaveBeenLastCalledWith(rig.file.size, rig.file.size)
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
  it('rejects an HTTP error even if its body contains valid upload metadata', async () => {
    const rig = setup()
    rig.reply(rig.body, 403)
    await expect(rig.pending).rejects.toThrow(UI_TEXT.attachmentUnreadable)
  })
  it('refuses another loopback window origin before creating HTTP objects', async () => {
    const create = vi.fn((): XMLHttpRequest => {
      throw new Error('Unexpected HTTP object')
    })
    const port = companionMediaTransport(
      () => ({ ...credentials(), endpoint: 'http://127.0.0.1:12346/media' }),
      create,
    )
    await expect(
      port.upload(new Blob(['x']), 'x', false, new AbortController().signal, () => {
        /* No progress without dispatch. */
      }),
    ).rejects.toThrow(UI_TEXT.attachmentUnreadable)
    expect(create).not.toHaveBeenCalled()
  })
  it('ignores a late load event after Stop', async () => {
    const rig = setup()
    rig.stop.abort()
    await expect(rig.pending).rejects.toThrow(UI_TEXT.media.uploadStop)
    rig.reply()
    expect(rig.progress).not.toHaveBeenCalled()
  })
  it('Stop aborts the request; no stale token survives it', async () => {
    const rig = setup()
    rig.stop.abort()
    expect(rig.abort).toHaveBeenCalledOnce()
    await expect(rig.pending).rejects.toThrow(UI_TEXT.media.uploadStop)
  })
  it('refuses an already aborted request before creating HTTP objects', async () => {
    const stop = new AbortController()
    stop.abort()
    const create = vi.fn(() => new XMLHttpRequest())
    await expect(
      companionMediaTransport(credentials, create).upload(
        new Blob(['x']),
        'x',
        false,
        stop.signal,
        () => {
          /* The fake absorbs browser HTTP work. */
        },
      ),
    ).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
  it.each(['https://foreign.example/media', 'http://192.0.2.1/media'])(
    'refuses endpoint %s before dispatch',
    async (url) => {
      const create = vi.fn(() => new XMLHttpRequest())
      const port = companionMediaTransport(() => ({ ...credentials(), endpoint: url }), create)
      await expect(
        port.upload(new Blob(['x']), 'x', false, new AbortController().signal, () => {
          /* The fake absorbs browser HTTP work. */
        }),
      ).rejects.toThrow()
      expect(create).not.toHaveBeenCalled()
    },
  )
})

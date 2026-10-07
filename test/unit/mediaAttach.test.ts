import { describe, expect, it, vi } from 'vitest'
import { createMediaAttachments, type MediaAttachDeps } from '../../src/host/media/mediaAttach'
import { MEDIA_SNIFF_MAX_BYTES, UI_TEXT } from '../../src/shared/constants'
import { videoFixture, wavFixture } from './helpers/media/fixtures'
import { mediaModel } from './helpers/media/replay'

function testPart() {
  return { type: 'text' as const, text: 'test-only media binding' }
}
function bindPart() {
  return testPart
}

function rig(bytes = videoFixture(), overrides: Partial<MediaAttachDeps> = {}) {
  let next = 0
  const read = vi.fn((offset: number, length: number) =>
    Promise.resolve(bytes.subarray(offset, offset + length)),
  )
  const close = vi.fn(() => Promise.resolve())
  const open = vi.fn(() => Promise.resolve({ source: { sizeBytes: bytes.length, read }, close }))
  const bind = vi.fn(bindPart)
  const deps: MediaAttachDeps = {
    newToken: () => `token-${String(++next)}`,
    open,
    capabilities: mediaModel,
    limits: () => ({}),
    bind,
    ...overrides,
  }
  const port = createMediaAttachments(deps)
  const file = { name: 'clip.mov', fsPath: '/approved/clip.mov', relativePath: undefined }
  const token = port.issue(file)
  return { port, token, file, open, read, close, bind }
}

describe('M105 E1 host-token attachments', () => {
  it('sniffs bounded host reads, binds metadata only and consumes each token once', async () => {
    const bytes = new Uint8Array(MEDIA_SNIFF_MAX_BYTES * 2 + 1)
    bytes.set(videoFixture())
    const t = rig(bytes)
    const result = await t.port.prepare(t.token, 'modelApi', 'muse-spark-1.3')
    expect(result.ok).toBe(true)
    expect(t.read.mock.calls.reduce((sum, [, length]) => sum + length, 0)).toBe(
      MEDIA_SNIFF_MAX_BYTES,
    )
    expect(t.close).toHaveBeenCalledOnce()
    expect(t.bind).toHaveBeenCalledWith(
      t.file,
      expect.objectContaining({ kind: 'video', mediaType: 'video/mp4', sizeBytes: bytes.length }),
    )
    expect(JSON.stringify(result)).not.toContain('base64')
    expect(JSON.stringify(result)).not.toContain('/approved')
    expect(await t.port.prepare(t.token, 'modelApi', 'muse-spark-1.3')).toEqual({
      ok: false,
      reason: UI_TEXT.attachmentUnreadable,
    })
    expect(t.open).toHaveBeenCalledOnce()
    if (!result.ok) throw new Error('expected prepared media')
    expect(result.attachment.store.check({ ...result.attachment.info })).toEqual({
      ok: false,
      reason: UI_TEXT.attachmentUnreadable,
    })
    const summary = {
      id: 'chip',
      name: 'clip.mov',
      mediaType: 'video/mp4',
      sizeBytes: bytes.length,
    }
    expect(result.attachment.store.part(summary, result.attachment.info)).toEqual(testPart())
    expect(() => result.attachment.store.part(summary, { ...result.attachment.info })).toThrow(
      'Media source mismatch',
    )
  })

  it('refuses guessed, reused and cleared tokens and Muse Code before opening sources', async () => {
    const t = rig()
    expect(await t.port.prepare('/approved/clip.mov', 'modelApi', 'muse-spark-1.3')).toMatchObject({
      ok: false,
    })
    expect(await t.port.prepare(t.token, 'museCode', 'muse-spark-1.3')).toEqual({
      ok: false,
      reason: UI_TEXT.media.museCodeRefusal,
    })
    const other = t.port.issue(t.file)
    t.port.clear()
    expect(await t.port.prepare(other, 'modelApi', 'muse-spark-1.3')).toMatchObject({ ok: false })
    expect(t.open).not.toHaveBeenCalled()
    expect(t.bind).not.toHaveBeenCalled()
  })

  it('checks actual bytes, size, selected capability and ignored audio before binding', async () => {
    for (const override of [
      { limits: () => ({ maxUploadBytes: 1 }) },
      {
        capabilities: (id: string) => {
          const model = mediaModel(id)
          return {
            ...model,
            modalities: {
              ...model.modalities,
              video: { support: 'unknown' as const, formats: [] },
            },
          }
        },
      },
    ]) {
      const t = rig(videoFixture(), override)
      expect(await t.port.prepare(t.token, 'modelApi', 'selected')).toMatchObject({ ok: false })
      expect(t.close).toHaveBeenCalledOnce()
      expect(t.bind).not.toHaveBeenCalled()
    }
    for (const bytes of [new Uint8Array([1]), wavFixture()]) {
      const t = rig(bytes)
      expect(await t.port.prepare(t.token, 'modelApi', 'muse-spark-1.3')).toMatchObject({
        ok: false,
      })
      expect(t.close).toHaveBeenCalledOnce()
      expect(t.bind).not.toHaveBeenCalled()
    }
  })

  it('closes failed reads and refuses invalidated work after a held open', async () => {
    const t = rig()
    const { promise: gate, resolve: release } = Promise.withResolvers<undefined>()
    t.open.mockImplementation(async () => {
      await gate
      return { source: { sizeBytes: videoFixture().length, read: t.read }, close: t.close }
    })
    const preparing = t.port.prepare(t.token, 'modelApi', 'muse-spark-1.3')
    t.port.clear()
    release(undefined)
    expect(await preparing).toMatchObject({ ok: false })
    expect(t.close).toHaveBeenCalledOnce()
    expect(t.bind).not.toHaveBeenCalled()
    const broken = rig()
    broken.read.mockRejectedValue(new Error('private source path'))
    expect(await broken.port.prepare(broken.token, 'modelApi', 'muse-spark-1.3')).toMatchObject({
      ok: false,
    })
    expect(broken.close).toHaveBeenCalledOnce()
  })

  it('rejects malformed/colliding tokens, unavailable sources and mismatched capability records', async () => {
    const invalid = createMediaAttachments({
      newToken: () => '',
      open: () => Promise.resolve(undefined),
      capabilities: mediaModel,
      limits: () => ({}),
      bind: bindPart,
    })
    expect(() =>
      invalid.issue({ name: 'clip.mp4', fsPath: '/approved', relativePath: undefined }),
    ).toThrow()
    const duplicate = rig(videoFixture(), { newToken: () => 'same' })
    expect(() => duplicate.port.issue(duplicate.file)).toThrow('Duplicate media path token')
    const absent = rig(videoFixture(), { open: () => Promise.resolve(undefined) })
    expect(await absent.port.prepare(absent.token, 'modelApi', 'selected')).toEqual({
      ok: false,
      reason: UI_TEXT.attachmentUnreadable,
    })
    const mismatch = rig(videoFixture(), { capabilities: () => mediaModel('other-model') })
    await expect(mismatch.port.prepare(mismatch.token, 'modelApi', 'selected')).rejects.toThrow(
      'Media capability model mismatch',
    )
    expect(mismatch.bind).not.toHaveBeenCalled()
    expect(mismatch.close).toHaveBeenCalledOnce()
  })
})

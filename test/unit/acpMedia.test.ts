import { describe, expect, it, vi } from 'vitest'
import { AcpMedia, type AcpMediaDeps, type AcpMediaInput } from '../../src/acp/media'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { ebmlFixture, mp3Fixture, videoFixture, wavFixture } from './helpers/media/fixtures'
import { mediaModel } from './helpers/media/replay'
import { sniffMediaBytes } from '../../src/core/media/limits'

const signal = new AbortController().signal
function harness(changes: Partial<AcpMediaDeps> = {}) {
  const prepare = vi.fn((_input: AcpMediaInput) =>
    Promise.resolve({ type: 'text' as const, text: 'registered-media' }),
  )
  const readMedia = vi.fn(() => {
    const bytes = videoFixture({ soundtrack: false })
    const info = sniffMediaBytes(bytes)
    if (info === undefined) throw new Error('bad fixture')
    const chunk = Promise.resolve(bytes)
    return Promise.resolve({
      info,
      sha256: 'a'.repeat(64),
      source: {
        name: 'clip.mp4',
        mime: info.mediaType,
        bytes: bytes.length,
        open: async function* () {
          yield await chunk
        },
      },
    })
  })
  const assertReadable = vi.fn(() => Promise.resolve())
  const deps: AcpMediaDeps = {
    cwd: '/ws',
    sessionId: 'session',
    backend: 'modelApi',
    platform: 'linux',
    interactive: true,
    modelId: () => 'muse-spark-1.3',
    model: mediaModel,
    io: {
      realPath: (given) => Promise.resolve(given),
      readMedia,
      readBytes: () => Promise.resolve(undefined),
    },
    assertReadable,
    prepare,
    ...changes,
  }
  return { media: new AcpMedia(deps), deps, prepare, readMedia, assertReadable }
}

describe('ACP media admission', () => {
  it('honors a selected model record that accepts WebM without a Meta format default', async () => {
    const model = { ...mediaModel('test-video'), provider: 'test-provider' }
    const h = harness({
      modelId: () => model.modelId,
      model: () => ({
        ...model,
        modalities: {
          ...model.modalities,
          video: { ...model.modalities.video, formats: ['video/webm'] },
        },
      }),
    })
    expect(
      await h.media.block(
        {
          type: 'resource',
          resource: {
            uri: 'file:///clip.webm',
            mimeType: 'video/webm',
            blob: Buffer.from(ebmlFixture()).toString('base64'),
          },
        },
        signal,
      ),
    ).toEqual({ type: 'text', text: 'registered-media' })
    expect(
      await harness().media.block(
        {
          type: 'resource',
          resource: {
            uri: 'file:///clip.webm',
            mimeType: 'video/webm',
            blob: Buffer.from(ebmlFixture()).toString('base64'),
          },
        },
        signal,
      ),
    ).toBe(fill(UI_TEXT.media.formatUnsupported, { model: 'muse-spark-1.3', format: 'video/webm' }))
  })
  it('refuses invalid or oversized media names before preparation', async () => {
    const h = harness()
    const blob = Buffer.from(videoFixture()).toString('base64')
    for (const uri of ['file:///', `file:///${'x'.repeat(300)}.mp4`])
      expect(
        await h.media.block(
          { type: 'resource', resource: { uri, blob, mimeType: 'video/mp4' } },
          signal,
        ),
      ).toBe(fill(UI_TEXT.media.attachmentUnknownType, { type: 'video/mp4' }))
    expect(h.prepare).not.toHaveBeenCalled()
  })
  it('sniffs a media path with no media suffix instead of trusting its name', async () => {
    const h = harness()
    expect(await h.media.attach('recording.bin', signal)).toMatchObject({
      info: { kind: 'video', mediaType: 'video/mp4' },
    })
    expect(h.readMedia).toHaveBeenCalledOnce()
  })
  it('dispatches sniffed video and audio blobs through the selected model gate', async () => {
    const h = harness({
      model: () => {
        const model = mediaModel()
        return {
          ...model,
          modalities: {
            ...model.modalities,
            audio: { ...model.modalities.audio, hearsStandaloneAudio: 'yes' },
          },
        }
      },
    })
    for (const [mimeType, bytes] of [
      ['video/mp4', videoFixture({ soundtrack: false })],
      ['audio/wav', wavFixture()],
      ['audio/mpeg', mp3Fixture()],
    ] as const) {
      const part = await h.media.block(
        {
          type: 'resource',
          resource: { uri: 'file:///clip', mimeType, blob: Buffer.from(bytes).toString('base64') },
        },
        signal,
      )
      expect(part).toEqual({ type: 'text', text: 'registered-media' })
      expect(h.prepare.mock.calls.at(-1)?.[0]).toMatchObject({ info: { mediaType: mimeType } })
    }
  })

  it('refuses standalone audio on Meta rather than forwarding ignored input_audio', async () => {
    const h = harness()
    expect(
      await h.media.block(
        {
          type: 'audio',
          mimeType: 'audio/wav',
          data: Buffer.from(wavFixture()).toString('base64'),
        },
        signal,
      ),
    ).toBe(fill(UI_TEXT.media.audioUnsupported, { model: 'muse-spark-1.3' }))
    expect(h.prepare).not.toHaveBeenCalled()
    expect(
      await h.media.block(
        {
          type: 'audio',
          mimeType: 'video/mp4',
          data: Buffer.from(videoFixture()).toString('base64'),
        },
        signal,
      ),
    ).toBe(fill(UI_TEXT.media.attachmentUnknownType, { type: 'video/mp4' }))
  })

  it('refuses unknown video support, MIME mismatch, malformed base64 and Muse Code media', async () => {
    const bytes = Buffer.from(videoFixture()).toString('base64')
    const block = {
      type: 'resource' as const,
      resource: { uri: 'file:///clip.mp4', mimeType: 'video/mp4', blob: bytes },
    }
    const h = harness({
      model: () => {
        const model = mediaModel()
        return {
          ...model,
          modalities: { ...model.modalities, video: { support: 'unknown', formats: [] } },
        }
      },
    })
    expect(await h.media.block(block, signal)).toBe(
      fill(UI_TEXT.media.videoUnknown, { model: 'muse-spark-1.3' }),
    )
    expect(
      await harness().media.block(
        { ...block, resource: { ...block.resource, mimeType: 'audio/wav' } },
        signal,
      ),
    ).toBe(fill(UI_TEXT.media.attachmentUnknownType, { type: 'audio/wav' }))
    expect(
      await harness().media.block(
        { ...block, resource: { ...block.resource, blob: bytes + '!' } },
        signal,
      ),
    ).toBe(fill(UI_TEXT.media.attachmentUnknownType, { type: 'video/mp4' }))
    expect(await harness({ backend: 'museCode' }).media.block(block, signal)).toBe(
      UI_TEXT.media.museCodeRefusal,
    )
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('confines resource links and checks policy before any media read or preparation', async () => {
    const h = harness()
    await expect(h.media.attach('../private.mp4', signal)).rejects.toThrow(UI_TEXT.textFilePrivate)
    expect(h.readMedia).not.toHaveBeenCalled()
    for (const name of ['.env', '.git/config', '.muse/settings.json'])
      await expect(h.media.attach(name, signal)).rejects.toThrow(UI_TEXT.textFilePrivate)
    expect(
      await h.media.block(
        { type: 'resource_link', uri: 'https://example.com/clip.mp4', name: 'clip' },
        signal,
      ),
    ).toBe(UI_TEXT.textFilePrivate)
    const denied = harness({ assertReadable: () => Promise.reject(new Error('policy denied')) })
    await expect(denied.media.attach('clip.mp4', signal)).rejects.toThrow('policy denied')
    expect(denied.readMedia).not.toHaveBeenCalled()
    await h.media.attach('dir/clip.mp4', signal)
    expect(h.assertReadable).toHaveBeenCalledWith(
      expect.objectContaining({ relative: 'dir/clip.mp4', canonical: 'dir/clip.mp4' }),
      signal,
    )
    expect(h.readMedia).toHaveBeenCalledWith(
      '/ws/dir/clip.mp4',
      expect.any(Number),
      '/ws/dir/clip.mp4',
      signal,
    )
  })

  it('refuses a symlink escape and declared MIME mismatch before preparing a linked file', async () => {
    const h = harness()
    h.deps.io.realPath = (given) =>
      Promise.resolve(given.endsWith('link.mp4') ? '/private.mp4' : given)
    expect(
      await h.media.block(
        { type: 'resource_link', uri: 'file:///ws/link.mp4', name: 'clip' },
        signal,
      ),
    ).toBe(UI_TEXT.textFilePrivate)
    expect(
      await h.media.block(
        { type: 'resource_link', uri: 'file:///ws/clip.mp4', name: 'clip', mimeType: 'audio/wav' },
        signal,
      ),
    ).toBe(fill(UI_TEXT.media.attachmentUnknownType, { type: 'audio/wav' }))
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('never starts a recording in headless mode and disposes a refused preview', async () => {
    const recordAndPreview = vi.fn(() => Promise.resolve(undefined))
    await expect(
      harness({ interactive: false, recordAndPreview }).media.record(signal),
    ).rejects.toThrow(UI_TEXT.media.recordingUserOnly)
    expect(recordAndPreview).not.toHaveBeenCalled()
    const h = harness()
    const file = await h.readMedia()
    const dispose = vi.fn(() => Promise.resolve())
    const preview = { name: 'recording.mp4', ...file, dispose }
    const refused = harness({
      recordAndPreview: () => Promise.resolve(preview),
      prepare: () => Promise.reject(new Error('budget denied')),
    })
    await expect(refused.media.record(signal)).rejects.toThrow('budget denied')
    expect(dispose).toHaveBeenCalledOnce()
    const accepted = harness({ recordAndPreview: () => Promise.resolve(preview) })
    expect(await accepted.media.record(signal)).toMatchObject({ name: 'recording.mp4', dispose })
    expect(accepted.prepare.mock.calls[0]?.[0]).toMatchObject({ isScreenRecording: true })
  })
})

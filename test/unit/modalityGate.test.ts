import { describe, expect, it } from 'vitest'
import { modalityGate } from '../../src/core/media/modalityGate'
import type { MediaInfo } from '../../src/shared/media'
import { mediaModel, videoMedia } from './helpers/media/replay'

describe('selected-model media gate', () => {
  it('accepts captured mp4/mov and distinguishes 1.3 soundtrack from 1.2', () => {
    expect(modalityGate(videoMedia().info, mediaModel())).toMatchObject({
      ok: true,
      soundtrackWarning: expect.stringContaining('does not hear'),
    })
    expect(modalityGate(videoMedia().info, mediaModel('muse-spark-1.2'))).toEqual({ ok: true })
    expect(
      modalityGate(
        {
          ...videoMedia().info,
          kind: 'video',
          mediaType: 'video/quicktime',
          durationSeconds: 10,
          hasSoundtrack: false,
        },
        mediaModel(),
      ),
    ).toEqual({ ok: true })
  })

  it.each(['meta', 'openai', 'anthropic', 'gemini', 'xai', 'openrouter', 'ollama', 'custom'])(
    'gates %s by the record, independently of vendor',
    (provider) => {
      const model = { ...mediaModel(), provider }
      expect(modalityGate(videoMedia().info, model).ok).toBe(true)
      expect(
        modalityGate(videoMedia().info, {
          ...model,
          modalities: { ...model.modalities, video: { ...model.modalities.video, support: 'no' } },
        }),
      ).toMatchObject({ ok: false, reason: expect.stringContaining('does not take video') })
    },
  )

  it('refuses unknown video before dispatch with a distinct reason', () => {
    const model = mediaModel()
    expect(
      modalityGate(videoMedia().info, {
        ...model,
        modalities: { ...model.modalities, video: { support: 'unknown', formats: [] } },
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('not known to take video') })
  })

  it('never enables silently ignored standalone audio; captured hearing is required', () => {
    const info: MediaInfo = {
      kind: 'audio',
      mediaType: 'audio/wav',
      sizeBytes: 40,
      durationSeconds: 1,
    }
    const model = mediaModel('muse-spark-1.2')
    expect(modalityGate(info, model)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('does not take audio'),
    })
    const audio = { ...model.modalities.audio, hearsStandaloneAudio: 'yes' } as const
    expect(
      modalityGate(info, {
        ...model,
        provider: 'gemini',
        modalities: { ...model.modalities, audio },
      }),
    ).toEqual({ ok: true })
    expect(
      modalityGate(info, {
        ...model,
        modalities: { ...model.modalities, audio: { ...audio, hearsStandaloneAudio: 'unknown' } },
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('not known to take audio') })
  })

  it('refuses an uncaptured format and enforces the selected upload or inline bound', () => {
    const model = mediaModel()
    expect(
      modalityGate(
        {
          ...videoMedia().info,
          kind: 'video',
          mediaType: 'video/webm',
          durationSeconds: 10,
          hasSoundtrack: false,
        },
        model,
      ).ok,
    ).toBe(false)
    const limits = {
      ...model,
      modalities: {
        ...model.modalities,
        video: { ...model.modalities.video, inlineMaxBytes: 1, uploadMaxBytes: 512_000 },
      },
    }
    expect(modalityGate(videoMedia().info, limits).ok).toBe(true)
    expect(modalityGate(videoMedia().info, { ...limits, files: 'no' }).ok).toBe(false)
    expect(modalityGate({ ...videoMedia().info, sizeBytes: 512_001 }, limits).ok).toBe(false)
  })

  it('enforces duration and fps bounds, refusing unknown duration under a duration limit', () => {
    const model = mediaModel()
    const limited = {
      ...model,
      modalities: {
        ...model.modalities,
        video: { ...model.modalities.video, maxDurationSeconds: 10 },
      },
    }
    expect(modalityGate(videoMedia().info, limited, 1).ok).toBe(true)
    expect(
      modalityGate(
        { ...videoMedia().info, kind: 'video', durationSeconds: 11, hasSoundtrack: true },
        limited,
      ).ok,
    ).toBe(false)
    expect(
      modalityGate(
        { ...videoMedia().info, kind: 'video', durationSeconds: null, hasSoundtrack: true },
        limited,
      ).ok,
    ).toBe(false)
    for (const fps of [0, 3, NaN])
      expect(modalityGate(videoMedia().info, model, fps).ok).toBe(false)
    const { fps: _fps, ...withoutFps } = model.modalities.video
    expect(
      modalityGate(
        videoMedia().info,
        {
          ...model,
          modalities: { ...model.modalities, video: withoutFps },
        },
        1,
      ).ok,
    ).toBe(false)
  })
})

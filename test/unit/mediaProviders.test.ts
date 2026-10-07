import { describe, expect, it, vi } from 'vitest'
import { createMediaAttachments } from '../../src/host/media/mediaAttach'
import {
  createMediaAttachDeps,
  dialogFiltersOption,
  mediaLimitsFromSettings,
  projectMediaCapabilities,
} from '../../src/host/media/mediaProviders'
import { UI_TEXT } from '../../src/shared/constants'
import { videoFixture, wavFixture } from './helpers/media/fixtures'

describe('M105 W host media providers', () => {
  it('reads upload and recording limits from settings', () => {
    expect(
      mediaLimitsFromSettings({ mediaMaxUploadMiB: 25, screenRecordingMaxSeconds: 120 }),
    ).toEqual({ maxUploadBytes: 25 * 1024 * 1024, maxDurationSeconds: 120 })
  })

  it('forwards picker filters to the native dialog shape, copying extensions', () => {
    expect(dialogFiltersOption(undefined)).toBeUndefined()
    const filters = { Attach: ['mp4', 'mov'] as const }
    const option = dialogFiltersOption(filters)
    expect(option).toEqual({ Attach: ['mp4', 'mov'] })
    expect(option?.['Attach']).not.toBe(filters.Attach)
  })

  it('projects established image/document support and unknown video/audio', () => {
    const capabilities = projectMediaCapabilities('muse-spark-1.3')
    expect(capabilities.modelId).toBe('muse-spark-1.3')
    expect(capabilities.modalities.image.support).toBe('yes')
    expect(capabilities.modalities.document.support).toBe('yes')
    expect(capabilities.modalities.image.formats).toContain('image/png')
    expect(capabilities.modalities.document.formats).toContain('application/pdf')
    expect(capabilities.modalities.video.support).toBe('unknown')
    expect(capabilities.modalities.audio.support).toBe('unknown')
    expect(capabilities.files).toBe('unknown')
  })

  it('issues unique tokens and refuses binding until the upload work lands', () => {
    const open = vi.fn(() =>
      Promise.resolve({
        source: {
          sizeBytes: 1,
          read: () => Promise.resolve(new Uint8Array()),
        },
        close: () => Promise.resolve(),
      }),
    )
    const deps = createMediaAttachDeps(
      () => ({ mediaMaxUploadMiB: 25, screenRecordingMaxSeconds: 120 }),
      open,
    )
    expect(deps.newToken()).not.toBe(deps.newToken())
    expect(deps.limits()).toEqual({
      maxUploadBytes: 25 * 1024 * 1024,
      maxDurationSeconds: 120,
    })
    expect(deps.capabilities('muse-spark-1.3').modelId).toBe('muse-spark-1.3')
    expect(() =>
      deps.bind(
        { name: 'clip.mov', fsPath: '/approved/clip.mov', relativePath: undefined },
        {
          kind: 'video',
          mediaType: 'video/mp4',
          sizeBytes: 10,
          width: 1,
          height: 1,
          durationSeconds: 1,
          hasSoundtrack: null,
        },
      ),
    ).toThrow(UI_TEXT.media.uploadStorageUnknown)
  })

  it.each([
    ['video', videoFixture(), 'muse-spark-1.3'],
    ['audio', wavFixture(), 'muse-spark-1.3'],
  ])('refuses %s at the gate before binding', async (_kind, bytes, modelId) => {
    const read = vi.fn((offset: number, length: number) =>
      Promise.resolve(bytes.subarray(offset, offset + length)),
    )
    const open = vi.fn(() =>
      Promise.resolve({
        source: { sizeBytes: bytes.length, read },
        close: () => Promise.resolve(),
      }),
    )
    const bind = vi.fn(() => {
      throw new Error('bind must not run before the gate')
    })
    const port = createMediaAttachments({
      ...createMediaAttachDeps(
        () => ({ mediaMaxUploadMiB: 25, screenRecordingMaxSeconds: 120 }),
        open,
      ),
      bind,
    })
    const token = port.issue({
      name: 'clip',
      fsPath: '/approved/clip',
      relativePath: undefined,
    })
    const result = await port.prepare(token, 'modelApi', modelId)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a gate refusal')
    expect(result.reason).toContain('muse-spark-1.3')
    expect(bind).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledOnce()
  })
})

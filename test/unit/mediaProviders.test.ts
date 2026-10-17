import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createMediaAttachments } from '../../src/host/media/mediaAttach'
import { AttachedMedia } from '../../src/core/media/attachedMedia'
import { sniffMediaBytes } from '../../src/core/media/limits'
import { metaMediaCapabilities } from '../../src/core/media/metaMediaCapabilities'
import { withCapturedMedia } from '../../src/core/media/capturedMedia'
import {
  createMediaAttachDeps,
  dialogFiltersOption,
  mediaLimitsFromSettings,
  projectMediaCapabilities,
  type MediaHostSettings,
} from '../../src/host/media/mediaProviders'
import { videoFixture, wavFixture } from './helpers/media/fixtures'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

/** The attach limits a host's settings supply. */
function settings(): MediaHostSettings {
  return { mediaMaxUploadMiB: 25, screenRecordingMaxSeconds: 120, mediaAudioAction: 'transcribe' }
}

describe('M105 W host media providers', () => {
  it('reads upload and recording limits from settings', () => {
    expect(
      mediaLimitsFromSettings({
        mediaMaxUploadMiB: 25,
        screenRecordingMaxSeconds: 120,
        mediaAudioAction: 'transcribe',
      }),
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

  it('takes video, Files and audio from the captured record on a contributor model (lane V)', () => {
    const capabilities = withCapturedMedia(projectMediaCapabilities('muse-spark-1.3-contributor'))
    expect(capabilities.modalities.video).toEqual(
      metaMediaCapabilities('muse-spark-1.3-contributor').modalities.video,
    )
    expect(capabilities.modalities.video.support).toBe('yes')
    expect(capabilities.files).toBe('yes')
    // U7: input_audio is ignored on Meta, so standalone audio stays refused.
    expect(capabilities.modalities.audio.support).toBe('no')
    expect(capabilities.modalities.image.formats).toContain('image/png')
  })

  it('issues unique tokens and binds a media part the registry resolves (lane V seam 1)', async () => {
    const bytes = videoFixture()
    const open = vi.fn(() =>
      Promise.resolve({
        source: {
          sizeBytes: bytes.length,
          read: (offset: number, length: number) =>
            Promise.resolve(bytes.subarray(offset, offset + length)),
        },
        path: '/approved/clip.mov',
        close: () => Promise.resolve(),
      }),
    )
    const attached = new AttachedMedia()
    const deps = createMediaAttachDeps(
      () => ({
        mediaMaxUploadMiB: 25,
        screenRecordingMaxSeconds: 120,
        mediaAudioAction: 'transcribe',
      }),
      open,
      { attached },
    )
    expect(deps.newToken()).not.toBe(deps.newToken())
    expect(deps.limits()).toEqual({
      maxUploadBytes: 25 * 1024 * 1024,
      maxDurationSeconds: 120,
    })
    expect(deps.capabilities('muse-spark-1.3').modelId).toBe('muse-spark-1.3')
    const info = sniffMediaBytes(bytes)
    if (info === undefined) throw new Error('fixture must sniff')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const part = deps
      .bind(
        { name: 'clip.mov', fsPath: '/approved/clip.mov', relativePath: undefined },
        info,
        sha256,
      )
      .part({ id: 'chip', name: 'clip.mov', mediaType: info.mediaType, sizeBytes: info.sizeBytes })
    expect(part).toMatchObject({ type: 'media', name: 'clip.mov', sha256 })
    // Metadata and a token only: no bytes or path in the part.
    expect(JSON.stringify(part)).not.toContain('/approved')
    expect(attached.resolve(part)).toMatchObject({ name: 'clip.mov', sha256 })
    // The upload source reopens through the host hook and verifies the digest.
    const record = attached.resolve(part)
    if (record === undefined) throw new Error('expected a record')
    const source = part.type === 'media' ? attached.source(part.token, record) : undefined
    const stream = source?.open(new AbortController().signal) ?? []
    const chunks = await Array.fromAsync(stream)
    expect(Buffer.concat(chunks).equals(Buffer.from(bytes))).toBe(true)
    // One open per read; nothing ever asks the registry for the path.
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('releases a discarded chip’s registration and, with the conversation, the port’s own (RVMEDIAV 7)', () => {
    const attached = new AttachedMedia()
    const bytes = videoFixture()
    const info = sniffMediaBytes(bytes)
    if (info === undefined) throw new Error('fixture must sniff')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const open = vi.fn(() => Promise.resolve(undefined))
    const deps = createMediaAttachDeps(settings, open, { attached })
    const other = createMediaAttachDeps(settings, open, { attached })
    const file = { name: 'clip.mov', fsPath: '/approved/clip.mov', relativePath: undefined }
    const summary = { id: 'chip', name: 'clip.mov', mediaType: info.mediaType, sizeBytes: 1 }
    const discarded = deps.bind(file, info, sha256)
    const kept = deps.bind(file, info, sha256)
    const elsewhere = other.bind(file, info, sha256)
    discarded.release()
    expect(attached.resolve(discarded.part(summary))).toBeUndefined()
    expect(attached.resolve(kept.part(summary))).toBeDefined()
    deps.release?.()
    expect(attached.resolve(kept.part(summary))).toBeUndefined()
    // Another composer's registration is not this port's to release.
    expect(attached.resolve(elsewhere.part(summary))).toBeDefined()
  })

  it('stops an attached source whose bytes changed before its last chunk goes', async () => {
    const attached = new AttachedMedia()
    const bytes = videoFixture()
    const info = sniffMediaBytes(bytes)
    if (info === undefined) throw new Error('fixture must sniff')
    const changed = Uint8Array.from(bytes)
    changed[0] = (changed[0] ?? 0) ^ 0xff
    const chunks = [changed.subarray(0, 16), changed.subarray(16)].map((chunk) =>
      Promise.resolve(chunk),
    )
    const part = attached.register(
      'changed',
      { name: 'clip.mov', info, sha256: createHash('sha256').update(bytes).digest('hex') },
      {
        read: async function* () {
          yield* await Promise.all(chunks)
        },
      },
    )
    const record = attached.resolve(part)
    if (record === undefined) throw new Error('expected a record')
    const stream = attached.source('changed', record)?.open(new AbortController().signal)
    const iterator = stream?.[Symbol.asyncIterator]()
    // The first chunk goes only once the second arrived; the last never does.
    const first = await iterator?.next()
    expect(first?.done).toBe(false)
    await expect(iterator?.next()).rejects.toThrow(
      fill(UI_TEXT.media.sourceChanged, { name: 'clip.mov' }),
    )
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
        () => ({
          mediaMaxUploadMiB: 25,
          screenRecordingMaxSeconds: 120,
          mediaAudioAction: 'transcribe',
        }),
        open,
        { attached: new AttachedMedia() },
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

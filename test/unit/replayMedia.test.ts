import { describe, expect, it, vi } from 'vitest'
import { MEDIA_FILE_ID_MIN_BYTES } from '../../src/shared/constants'
import { ReplayMedia, storedMediaPartSchema } from '../../src/core/media/replayMedia'
import { MediaBudget } from '../../src/core/backends/modelapi/mediaBudget'
import type { StoredReplayItem } from '../../src/core/backends/modelapi/sessionStore'
import type { UploadSource } from '../../src/core/backends/modelapi/files'
import {
  mediaModel,
  replayRig,
  switchingMediaModel,
  uploaded,
  videoMedia,
} from './helpers/media/replay'
import { replayLedgerRig } from './helpers/media/replayLedger'

const signal = (): AbortSignal => new AbortController().signal

describe('media replay and metadata persistence', () => {
  it('checks the upload limit after promoting a delivered small inline image', async () => {
    const media = {
      ...videoMedia(),
      name: 'small.png',
      info: { kind: 'image', mediaType: 'image/png', sizeBytes: 2 },
    } as const
    const rig = replayRig(media, {
      capabilities: (id) => {
        const model = mediaModel(id)
        return {
          ...model,
          modalities: {
            ...model.modalities,
            image: { ...model.modalities.image, inlineMaxBytes: 2, uploadMaxBytes: 1 },
          },
        }
      },
    })
    expect(JSON.stringify(rig.replay.project(rig.input, 'muse-spark-1.3', rig.budget))).toContain(
      'MEDIA_BYTE_CANARY',
    )
    rig.replay.delivered(rig.input)
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    expect(rig.ensure).not.toHaveBeenCalled()
    expect(rig.authorize).not.toHaveBeenCalled()
    expect(rig.encodeInline).toHaveBeenCalledTimes(1)
    expect(
      JSON.stringify(rig.replay.project(rig.input, 'muse-spark-1.3', rig.budget)),
    ).not.toContain('MEDIA_BYTE_CANARY')
  })

  it('never falls back to base64 for an uploaded file when the selected model cannot use Files', async () => {
    const media = {
      ...videoMedia(),
      name: 'large.png',
      info: { kind: 'image', mediaType: 'image/png', sizeBytes: MEDIA_FILE_ID_MIN_BYTES + 1 },
    } as const
    const rig = replayRig(media, {
      capabilities: (id) => ({ ...mediaModel(id), files: id === 'inline-only' ? 'no' : 'yes' }),
    })
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    await rig.replay.prepare(rig.input, 'inline-only', signal())
    expect(rig.ensure).toHaveBeenCalledTimes(1)
    expect(rig.authorize).toHaveBeenCalledTimes(1)
    const projected = rig.replay.project(rig.input, 'inline-only', rig.budget)
    expect(JSON.stringify(projected)).not.toContain('MEDIA_BYTE_CANARY')
    expect(rig.encodeInline).not.toHaveBeenCalled()
    expect(rig.encodeUploaded).not.toHaveBeenCalled()
  })

  it.each([{ name: 'wrong' }, { mime: 'audio/wav' }, { bytes: 1 }])(
    'refuses mismatched approved source metadata %j before ensure',
    async (mismatch) => {
      const available = replayRig()
      const original = await available.source()
      const rig = replayRig(videoMedia(), {
        source: () => Promise.resolve({ ...original, ...mismatch }),
      })
      await expect(rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())).rejects.toThrow(
        'changed since upload',
      )
      expect(rig.ensure).not.toHaveBeenCalled()
    },
  )
  it('uses provider-scoped ledgers and keeps both IDs when switching vendors and back', async () => {
    const media = videoMedia()
    const metaFile = uploaded(media, 'file-meta')
    const geminiFile = { ...uploaded(media, 'file-gemini'), provider: 'gemini' }
    const metaEnsure = vi.fn(() => Promise.resolve(metaFile))
    const geminiEnsure = vi.fn(() => Promise.resolve(geminiFile))
    const rig = replayRig(media, {
      capabilities: (id) => ({
        ...mediaModel(id),
        provider: id === 'gemini-video' ? 'gemini' : 'meta',
      }),
      ledger: (provider) => ({ ensure: provider === 'gemini' ? geminiEnsure : metaEnsure }),
    })
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    await rig.replay.prepare(rig.input, 'gemini-video', signal())
    expect(rig.replay.project(rig.input, 'gemini-video', rig.budget)).toMatchObject([
      { content: [{ text: expect.stringContaining('file-gemini') }] },
    ])
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    expect(rig.replay.project(rig.input, 'muse-spark-1.3', rig.budget)).toMatchObject([
      { content: [{ text: expect.stringContaining('file-meta') }] },
    ])
    expect(rig.replay.references(rig.entries)).toEqual(
      expect.arrayContaining([metaFile, geminiFile]),
    )
    expect(rig.replay.references(rig.entries)).toHaveLength(2)
    expect(metaEnsure).toHaveBeenCalledTimes(2)
    expect(geminiEnsure).toHaveBeenCalledTimes(1)
  })

  it('refuses invalid encoder byte counts and fresh inline media beyond the combined cap', () => {
    const rig = replayRig(videoMedia(), {
      capabilities: (id) => ({ ...mediaModel(id), files: 'no' }),
    })
    for (const encodedChars of [-1, 0.5, Infinity]) {
      rig.encodeInline.mockReturnValue({
        part: { type: 'input_text', text: 'inline-marker' },
        encodedChars,
      })
      expect(() => rig.replay.project(rig.input, 'muse-spark-1.3', rig.budget)).toThrow(
        'Invalid encoded media size',
      )
    }
    rig.encodeInline.mockReturnValue({
      part: { type: 'input_text', text: 'inline-marker' },
      encodedChars: 11,
    })
    expect(() => rig.replay.project(rig.input, 'muse-spark-1.3', new MediaBudget(10))).toThrow(
      'combined media size limit',
    )
  })

  it('uses F retrieval despite local expiry, shares forks, replaces one missing ID and refuses changed source hashes', async () => {
    const rig = replayLedgerRig()
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    expect(rig.upload).toHaveBeenCalledTimes(1)
    const fork = new ReplayMedia('fork', rig.deps)
    const saved = rig.replay.snapshot(rig.entries)
    fork.restore(saved)
    await fork.prepare(
      saved.map((entry) => entry.item),
      'muse-spark-1.3',
      signal(),
    )
    expect(rig.upload).toHaveBeenCalledTimes(1)
    rig.missing.add('file-1')
    expect(await rig.replay.recover('missing-file', rig.input, 'muse-spark-1.3', signal())).toBe(
      true,
    )
    expect(rig.upload).toHaveBeenCalledTimes(2)
    expect(rig.replay.references(rig.entries)[0]?.fileId).toBe('file-2')
    rig.replay.beginRequest()
    rig.missing.add('file-2')
    rig.changeSource()
    await expect(rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())).rejects.toThrow(
      'changed since upload',
    )
    expect(rig.upload).toHaveBeenCalledTimes(2)
  })

  it('persists no inline image/PDF bytes before or after delivery and does not give them to uploaded encoding', async () => {
    const media = {
      ...videoMedia(),
      name: 'photo.png',
      info: { kind: 'image', mediaType: 'image/png', sizeBytes: MEDIA_FILE_ID_MIN_BYTES + 1 },
    } as const
    const rig = replayRig(media)
    expect(JSON.stringify(rig.replay.snapshot(rig.entries))).not.toContain('MEDIA_BYTE_CANARY')
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    const projected = rig.replay.project(rig.input, 'muse-spark-1.3', rig.budget)
    expect(JSON.stringify(projected)).not.toContain('MEDIA_BYTE_CANARY')
    expect(JSON.stringify(rig.replay.snapshot(rig.entries))).not.toContain('MEDIA_BYTE_CANARY')
    expect(rig.encodeInline).not.toHaveBeenCalled()
    const restored = new ReplayMedia('restored', rig.deps)
    const saved = rig.replay.snapshot(rig.entries)
    restored.restore(saved)
    await restored.prepare(
      saved.map((entry) => entry.item),
      'muse-spark-1.3',
      signal(),
    )
    expect(
      JSON.stringify(
        restored.project(
          saved.map((entry) => entry.item),
          'muse-spark-1.3',
          new MediaBudget(),
        ),
      ),
    ).not.toContain('MEDIA_BYTE_CANARY')
  })

  it('snapshots pending and delivered small inline images as metadata without bytes', () => {
    const media = {
      ...videoMedia(),
      name: 'small.png',
      info: { kind: 'image', mediaType: 'image/png', sizeBytes: 1 },
    } as const
    const rig = replayRig(media)
    expect(JSON.stringify(rig.input)).toContain('MEDIA_BYTE_CANARY')
    expect(JSON.stringify(rig.replay.snapshot(rig.entries))).not.toContain('MEDIA_BYTE_CANARY')
    rig.replay.delivered(rig.input)
    expect(JSON.stringify(rig.replay.snapshot(rig.entries))).not.toContain('MEDIA_BYTE_CANARY')
    expect(rig.replay.snapshot(rig.entries)[0]?.media?.[0]?.media.delivered).toBe(true)
  })

  it.each(['image', 'document'] as const)(
    'counts an upload-bound %s as slots with zero inline bytes before dispatch',
    async (kind) => {
      const media =
        kind === 'image'
          ? ({
              ...videoMedia(),
              name: 'large.png',
              info: { kind, mediaType: 'image/png', sizeBytes: MEDIA_FILE_ID_MIN_BYTES + 1 },
            } as const)
          : ({
              ...videoMedia(),
              name: 'large.pdf',
              info: { kind, mediaType: 'application/pdf', sizeBytes: MEDIA_FILE_ID_MIN_BYTES + 1 },
            } as const)
      const rig = replayRig(media)
      const budget = new MediaBudget(1)
      const inline =
        kind === 'image'
          ? ({
              type: 'input_image',
              image_url: 'data:image/png;base64,MEDIA_BYTE_CANARY',
              detail: 'auto',
            } as const)
          : ({
              type: 'input_file',
              filename: media.name,
              file_data: 'data:application/pdf;base64,MEDIA_BYTE_CANARY',
            } as const)
      const content = rig.replay.content(
        { type: 'text', text: 'token' },
        inline,
        'muse-spark-1.3',
        budget,
      )
      expect(() => {
        budget.assertMessageFits([content])
      }).not.toThrow()
      expect(JSON.stringify(content)).not.toContain('MEDIA_BYTE_CANARY')
      const input = [{ type: 'message', role: 'user', content: [content] }] as const
      await rig.replay.prepare(input, 'muse-spark-1.3', signal())
      expect(JSON.stringify(rig.replay.project(input, 'muse-spark-1.3', budget))).toContain(
        'test-upload:',
      )
      expect(rig.encodeInline).not.toHaveBeenCalled()
    },
  )

  it('does not consult media capabilities or encoders when there is no media', async () => {
    const rig = replayRig(videoMedia(), { attachment: () => undefined })
    const capabilities = vi.spyOn(rig.deps, 'capabilities')
    const encoded = rig.replay.project(rig.input, 'unregistered-model', rig.budget)
    await rig.replay.prepare(rig.input, 'unregistered-model', signal())
    expect(encoded).toBe(rig.input)
    expect(rig.replay.tail(rig.entries)).toEqual([])
    expect(capabilities).not.toHaveBeenCalled()
    expect(rig.encodeInline).not.toHaveBeenCalled()
    expect(rig.replay.snapshot(rig.entries)).toEqual(rig.entries)
  })

  it('uses English codec metadata for compaction, preserves its selected recent turns and rejects a forged tail', async () => {
    const media = {
      ...videoMedia(),
      name: 'big.pdf',
      info: {
        kind: 'document',
        mediaType: 'application/pdf',
        sizeBytes: MEDIA_FILE_ID_MIN_BYTES + 1,
      },
    } as const
    const rig = replayRig(media)
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    expect(rig.replay.summaryInput(rig.input)).toMatchObject([
      { content: [{ text: 'Media: big.pdf' }] },
    ])
    expect(JSON.stringify(rig.replay.summaryInput(rig.input))).not.toContain('MEDIA_BYTE_CANARY')
    expect(rig.replay.tail(rig.entries)).toEqual(rig.entries)
    const forged = replayRig(videoMedia(), { compactionTail: () => ['foreign-turn'] })
    expect(() => forged.replay.tail(forged.entries)).toThrow('Invalid media compaction tail')
  })

  it.each(['admission', 'source'])(
    'does not start ensure after cancellation during %s',
    async (stage) => {
      const controller = new AbortController()
      const available = replayRig()
      const source = vi.fn(() => {
        if (stage === 'source') controller.abort()
        return available.source()
      })
      const rig = replayRig(videoMedia(), {
        source,
        authorize: () => {
          if (stage === 'admission') controller.abort()
          return Promise.resolve()
        },
      })
      await expect(
        rig.replay.prepare(rig.input, 'muse-spark-1.3', controller.signal),
      ).rejects.toThrow()
      expect(rig.ensure).not.toHaveBeenCalled()
      expect(source).toHaveBeenCalledTimes(stage === 'admission' ? 0 : 1)
    },
  )

  it('uploads video before encoding, forwards fps and never supplies inline bytes to the uploaded encoder', async () => {
    const media = { ...videoMedia(), fps: 1 }
    const rig = replayRig(media)
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    expect(rig.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      rig.ensure.mock.invocationCallOrder[0]!,
    )
    const projected = rig.replay.project(rig.input, 'muse-spark-1.3', rig.budget)
    expect(projected).toMatchObject([{ content: [{ text: 'test-upload:file-clip:video/mp4:1' }] }])
    expect(rig.encodeInline).not.toHaveBeenCalled()
    expect(rig.encodeUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ file: uploaded(media), fps: 1 }),
      expect.objectContaining({ modelId: 'muse-spark-1.3' }),
    )
    expect(rig.replay.snapshot(rig.entries)).toMatchObject([
      { media: [{ index: 0, media: { file: uploaded(media), fps: 1 } }] },
    ])
  })

  it('replaces switched media with a temporary note and restores its unexpired ID on switching back', async () => {
    const rig = replayRig(videoMedia(), {
      capabilities: switchingMediaModel,
    })
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    const switched = rig.replay.project(rig.input, 'text-only', rig.budget)
    expect(switched).toMatchObject([
      { content: [{ text: expect.stringContaining('text-only does not take video') }] },
    ])
    const original = rig.input[0]!
    const retained = rig.replay.retain(original, switched[0]!)
    expect(retained).toEqual(original)
    await rig.replay.prepare([retained], 'text-only', signal())
    expect(rig.ensure).toHaveBeenCalledTimes(1)
    expect(rig.replay.project([retained], 'muse-spark-1.3', rig.budget)).toMatchObject([
      { content: [{ text: expect.stringContaining('file-clip') }] },
    ])
  })

  it('keeps inline small images initially, uploads larger PDFs and moves delivered images to IDs', async () => {
    const image = {
      ...videoMedia(),
      name: 'small.png',
      info: { kind: 'image', mediaType: 'image/png', sizeBytes: MEDIA_FILE_ID_MIN_BYTES },
    } as const
    const rig = replayRig(image)
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    expect(rig.ensure).not.toHaveBeenCalled()
    rig.replay.delivered(rig.replay.project(rig.input, 'muse-spark-1.3', rig.budget))
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    expect(rig.ensure).toHaveBeenCalledTimes(1)
    const pdf = {
      ...image,
      name: 'big.pdf',
      info: {
        kind: 'document',
        mediaType: 'application/pdf',
        sizeBytes: MEDIA_FILE_ID_MIN_BYTES + 1,
        pageCount: 2,
      },
    } as const
    const document = replayRig(pdf)
    await document.replay.prepare(document.input, 'muse-spark-1.3', signal())
    expect(
      document.replay.project(document.input, 'muse-spark-1.3', document.budget),
    ).toMatchObject([{ content: [{ text: expect.stringContaining('application/pdf') }] }])
    expect(document.encodeInline).not.toHaveBeenCalled()
  })

  it('promotes restored legacy large inline media before replay', async () => {
    const media = {
      ...videoMedia(),
      name: 'legacy.png',
      info: { kind: 'image', mediaType: 'image/png', sizeBytes: MEDIA_FILE_ID_MIN_BYTES + 1 },
    } as const
    const rig = replayRig(media)
    const entries: readonly StoredReplayItem[] = [
      {
        turnId: 'legacy',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_image', image_url: 'MEDIA_BYTE_CANARY', detail: 'auto' }],
        },
        media: [{ index: 0, media }],
      },
    ]
    rig.replay.restore(entries)
    const input = entries.map((entry) => entry.item)
    await rig.replay.prepare(input, 'muse-spark-1.3', signal())
    expect(rig.ensure).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(rig.replay.project(input, 'muse-spark-1.3', rig.budget))).not.toContain(
      'MEDIA_BYTE_CANARY',
    )
    expect(rig.encodeInline).not.toHaveBeenCalled()
  })

  it('retains the inline path for a provider without Files and never opens an upload source', async () => {
    const rig = replayRig(videoMedia(), {
      capabilities: (id) => ({ ...mediaModel(id), files: 'no' }),
    })
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    rig.replay.project(rig.input, 'muse-spark-1.3', rig.budget)
    expect(rig.source).not.toHaveBeenCalled()
    expect(rig.ensure).not.toHaveBeenCalled()
    expect(rig.encodeInline).toHaveBeenCalledTimes(1)
  })

  it('rejects metadata bytes, invalid expiry and mismatched digest, MIME or size', () => {
    const media = videoMedia()
    const file = uploaded(media)
    for (const invalid of [
      { ...media, base64Data: 'BYTE_CANARY' },
      { ...media, file: { ...file, expiresAt: undefined } },
      { ...media, file: { ...file, sha256: 'b'.repeat(64) } },
      { ...media, file: { ...file, bytes: file.bytes + 1 } },
      { ...media, file: { ...file, mime: 'audio/wav' } },
      { ...media, files: [file, file] },
      { ...media, name: '' },
      { ...media, name: 'x'.repeat(257) },
      { ...media, sha256: 'invalid' },
      { ...media, fps: 0 },
      { ...media, isScreenRecording: 'true' },
      { ...media, sourcePath: String.raw`C:\private\clip.mp4` },
    ])
      expect(storedMediaPartSchema.safeParse(invalid).success).toBe(false)
  })

  it('requires paid/Contributor/sound admission and refuses missing or changed approved sources before ensure', async () => {
    const denied = replayRig(videoMedia(), { authorize: () => Promise.reject(new Error('denied')) })
    await expect(denied.replay.prepare(denied.input, 'muse-spark-1.3', signal())).rejects.toThrow(
      'denied',
    )
    expect(denied.ensure).not.toHaveBeenCalled()
    const absent = replayRig(videoMedia(), { source: () => Promise.resolve(undefined) })
    await expect(absent.replay.prepare(absent.input, 'muse-spark-1.3', signal())).rejects.toThrow(
      'Attach clip.mp4 again',
    )
    expect(absent.ensure).not.toHaveBeenCalled()
    const chunk = Promise.resolve(new Uint8Array())
    const changed = replayRig(videoMedia(), {
      source: () =>
        Promise.resolve({
          name: 'wrong',
          mime: 'video/mp4',
          bytes: 512_000,
          open: async function* () {
            yield await chunk
          },
        }),
    })
    await expect(changed.replay.prepare(changed.input, 'muse-spark-1.3', signal())).rejects.toThrow(
      'changed since upload',
    )
    expect(changed.ensure).not.toHaveBeenCalled()
  })

  it('refuses cancellation, a mismatched model record and a foreign provider upload', async () => {
    const cancelled = replayRig()
    const abort = new AbortController()
    abort.abort()
    await expect(
      cancelled.replay.prepare(cancelled.input, 'muse-spark-1.3', abort.signal),
    ).rejects.toThrow()
    expect(cancelled.ensure).not.toHaveBeenCalled()
    expect(cancelled.authorize).not.toHaveBeenCalled()
    expect(() => replayRig(videoMedia(), { capabilities: () => mediaModel('wrong') })).toThrow(
      'model mismatch',
    )
    const rig = replayRig()
    rig.ensure.mockResolvedValue({ ...uploaded(videoMedia()), provider: 'foreign' })
    await expect(rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())).rejects.toThrow(
      'provider mismatch',
    )
  })

  it('restores fork/rewind metadata without bytes, retains recent-tail IDs and releases compacted references', async () => {
    const rig = replayRig()
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    const saved = rig.replay.snapshot(rig.entries)
    expect(JSON.stringify(saved)).not.toContain('host-issued-token')
    const restored = new ReplayMedia('fork', rig.deps)
    restored.restore(saved)
    expect(restored.references(saved)).toEqual([uploaded(videoMedia())])
    expect(
      restored.project(
        saved.map((entry) => entry.item),
        'muse-spark-1.3',
        new MediaBudget(),
      ),
    ).toMatchObject([{ content: [{ text: expect.stringContaining('file-clip') }] }])
    expect(restored.references(saved.slice(1))).toEqual([])
    expect(() => {
      restored.restore([{ ...saved[0]!, media: [{ index: 99, media: videoMedia() }] }])
    }).toThrow('index')
  })

  it('preserves screen-recording classification through persistence and forks for Contributor admission', async () => {
    const media = { ...videoMedia(), isScreenRecording: true }
    const rig = replayRig(media)
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    const saved = rig.replay.snapshot(rig.entries)
    expect(saved).toMatchObject([{ media: [{ media: { isScreenRecording: true } }] }])
    const fork = new ReplayMedia('fork', rig.deps)
    fork.restore(saved)
    await fork.prepare(
      saved.map((entry) => entry.item),
      'muse-spark-1.3',
      signal(),
    )
    expect(rig.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ isScreenRecording: true }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
    expect(fork.snapshot(saved)).toMatchObject([
      { media: [{ media: { isScreenRecording: true } }] },
    ])
  })

  it('does not mutate a saved snapshot when a delivery completes', () => {
    const rig = replayRig()
    const saved = rig.replay.snapshot(rig.entries)
    rig.replay.delivered(rig.input)
    expect(saved[0]?.media?.[0]?.media.delivered).toBeUndefined()
    expect(rig.replay.snapshot(rig.entries)[0]?.media?.[0]?.media.delivered).toBe(true)
  })

  it('recovers only a captured file-specific error and only when ensure replaces an ID', async () => {
    const rig = replayRig()
    await rig.replay.prepare(rig.input, 'muse-spark-1.3', signal())
    expect(
      await rig.replay.recover(new Error('generic 404'), rig.input, 'muse-spark-1.3', signal()),
    ).toBe(false)
    expect(rig.ensure).toHaveBeenCalledTimes(1)
    rig.ensure.mockResolvedValue(uploaded(videoMedia(), 'file-replaced'))
    expect(await rig.replay.recover('missing-file', rig.input, 'muse-spark-1.3', signal())).toBe(
      true,
    )
    expect(rig.replay.references(rig.entries)[0]?.fileId).toBe('file-replaced')
  })

  it('bounds repeated missing-ID replacement before a second upload can open the source', async () => {
    const media = { ...videoMedia(), file: uploaded(videoMedia()) }
    const rig = replayRig(media)
    let uploads = 0
    const ensure = vi.fn(
      async (_id: string, _sha: string, source: UploadSource, readSignal: AbortSignal) => {
        for await (const _chunk of source.open(readSignal)) {
          /* F verifies before POST. */
        }
        uploads += 1
        return uploaded(media, `file-${String(uploads)}`)
      },
    )
    const replay = new ReplayMedia('session', { ...rig.deps, ledger: () => ({ ensure }) })
    replay.restore(rig.replay.snapshot(rig.entries))
    const entries: readonly StoredReplayItem[] = rig.replay.snapshot(rig.entries)
    replay.restore(entries)
    const input = entries.map((entry) => entry.item)
    replay.beginRequest()
    await replay.prepare(input, 'muse-spark-1.3', signal())
    await expect(replay.prepare(input, 'muse-spark-1.3', signal())).rejects.toThrow(
      'Attach clip.mp4 again',
    )
    expect(uploads).toBe(1)
  })
})

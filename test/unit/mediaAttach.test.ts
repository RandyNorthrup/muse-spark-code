import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createMediaAttachments, type MediaAttachDeps } from '../../src/host/media/mediaAttach'
import { MEDIA_SNIFF_MAX_BYTES, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { MediaContributorConsent } from '../../src/core/media/contributorConsent'
import { ebmlFixture, videoFixture, wavFixture } from './helpers/media/fixtures'
import { mediaModel } from './helpers/media/replay'

function testPart() {
  return { type: 'text' as const, text: 'test-only media binding' }
}
function bindPart() {
  return testPart
}

function rig(
  bytes = videoFixture(),
  options: Partial<MediaAttachDeps> & {
    readonly askContributor?: ConstructorParameters<typeof MediaContributorConsent>[0]
  } = {},
) {
  // The host builds one consent per port over its modal (mediaProviders).
  const { askContributor, ...overrides } = options
  const consent =
    askContributor === undefined ? undefined : new MediaContributorConsent(askContributor)
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
    ...(consent !== undefined && {
      chooseContributor: (request: Parameters<MediaContributorConsent['choose']>[0]) =>
        consent.choose(request),
    }),
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
    // The sniff reads a bounded head and tail; the digest the upload ledger
    // and every reopen verify (lane V seam 1) then reads the file once.
    expect(t.read.mock.calls.reduce((sum, [, length]) => sum + length, 0)).toBe(
      MEDIA_SNIFF_MAX_BYTES + bytes.length,
    )
    expect(t.close).toHaveBeenCalledOnce()
    expect(t.bind).toHaveBeenCalledWith(
      t.file,
      expect.objectContaining({ kind: 'video', mediaType: 'video/mp4', sizeBytes: bytes.length }),
      createHash('sha256').update(bytes).digest('hex'),
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

  it('carries the soundtrack warning past admission and the convert offer past refusal', async () => {
    // muse-spark-1.3 hears no soundtrack (helpers/media/replay): the warning
    // survives prepare so the caller can say it; the chip only labels sound.
    const t = rig(videoFixture())
    const admitted = await t.port.prepare(t.token, 'modelApi', 'muse-spark-1.3')
    expect(admitted).toMatchObject({
      ok: true,
      soundtrackWarning: expect.stringContaining('sound'),
    })
    expect(t.bind).toHaveBeenCalledOnce()
    // A convertible refusal keeps its convert flag for lane V's action.
    const convertible = rig(ebmlFixture(), { limits: () => ({ converterAvailable: true }) })
    const refused = await convertible.port.prepare(convertible.token, 'modelApi', 'muse-spark-1.3')
    expect(refused).toMatchObject({ ok: false, convertToMp4: true })
    expect(convertible.bind).not.toHaveBeenCalled()
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
    // A refused open was never read: private, not unreadable (M105 E1 review).
    expect(await absent.port.prepare(absent.token, 'modelApi', 'selected')).toEqual({
      ok: false,
      reason: UI_TEXT.textFilePrivate,
    })
    const mismatch = rig(videoFixture(), { capabilities: () => mediaModel('other-model') })
    await expect(mismatch.port.prepare(mismatch.token, 'modelApi', 'selected')).rejects.toThrow(
      'Media capability model mismatch',
    )
    expect(mismatch.bind).not.toHaveBeenCalled()
    expect(mismatch.close).toHaveBeenCalledOnce()
  })
})

describe('attached sound Muse Voice transcribes (M105 lane V seam 3B)', () => {
  it('admits audio the model does not hear when the host transcribes it, and says so', async () => {
    const transcribesSound = vi.fn(() => true)
    const t = rig(wavFixture(), { transcribesSound })
    const admitted = await t.port.prepare(t.token, 'modelApi', 'muse-spark-1.3')
    expect(admitted).toMatchObject({
      ok: true,
      soundtrackWarning: fill(UI_TEXT.media.audioWillTranscribe, { model: 'muse-spark-1.3' }),
    })
    expect(transcribesSound).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'audio', mediaType: 'audio/wav' }),
      'muse-spark-1.3',
    )
    if (!admitted.ok) throw new Error('expected admission')
    // The chip's own recheck reaches the same answer.
    expect(admitted.attachment.store.check(admitted.attachment.info)).toMatchObject({ ok: true })
    expect(t.bind).toHaveBeenCalledOnce()
  })

  it('keeps the gate refusal when the host does not transcribe', async () => {
    for (const overrides of [{}, { transcribesSound: () => false }]) {
      const t = rig(wavFixture(), overrides)
      expect(await t.port.prepare(t.token, 'modelApi', 'muse-spark-1.3')).toMatchObject({
        ok: false,
      })
      expect(t.bind).not.toHaveBeenCalled()
    }
  })
})

describe('D85.7 contributor question at the attach port (M105 lane V seam 1)', () => {
  const CONTRIBUTOR = 'muse-spark-1.3-contributor'

  it('asks once per conversation on a contributor model, again after a new conversation', async () => {
    const askContributor = vi.fn(() => Promise.resolve('send' as const))
    const t = rig(videoFixture(), { askContributor })
    expect(await t.port.prepare(t.token, 'modelApi', CONTRIBUTOR)).toMatchObject({ ok: true })
    const second = t.port.issue(t.file)
    expect(await t.port.prepare(second, 'modelApi', CONTRIBUTOR)).toMatchObject({ ok: true })
    expect(askContributor).toHaveBeenCalledOnce()
    expect(askContributor).toHaveBeenCalledWith(
      expect.objectContaining({
        title: fill(UI_TEXT.media.contributorQuestion, { name: 'clip.mov' }),
        detail: UI_TEXT.media.contributorWarning,
      }),
    )
    t.port.clear()
    const third = t.port.issue(t.file)
    expect(await t.port.prepare(third, 'modelApi', CONTRIBUTOR)).toMatchObject({ ok: true })
    expect(askContributor).toHaveBeenCalledTimes(2)
    expect(t.bind).toHaveBeenCalledTimes(3)
  })

  it('binds nothing on Remove, or on Use the Standard model, which names its own refusal', async () => {
    const removed = rig(videoFixture(), {
      askContributor: () => Promise.resolve('remove' as const),
    })
    expect(await removed.port.prepare(removed.token, 'modelApi', CONTRIBUTOR)).toEqual({
      ok: false,
      reason: fill(UI_TEXT.media.contributorDeclined, { name: 'clip.mov' }),
    })
    expect(removed.bind).not.toHaveBeenCalled()
    const standard = rig(videoFixture(), {
      askContributor: () => Promise.resolve('useStandard' as const),
      capabilities: (id: string) => {
        const model = mediaModel(id)
        return id === CONTRIBUTOR
          ? model
          : {
              ...model,
              modalities: { ...model.modalities, video: { support: 'unknown', formats: [] } },
            }
      },
    })
    expect(await standard.port.prepare(standard.token, 'modelApi', CONTRIBUTOR)).toEqual({
      ok: false,
      reason: fill(UI_TEXT.media.videoUnknown, { model: 'muse-spark-1.3' }),
    })
    const switchable = rig(videoFixture(), {
      askContributor: () => Promise.resolve('useStandard' as const),
    })
    expect(await switchable.port.prepare(switchable.token, 'modelApi', CONTRIBUTOR)).toEqual({
      ok: false,
      reason: fill(UI_TEXT.media.useStandardThenAttach, {
        model: 'muse-spark-1.3',
        name: 'clip.mov',
      }),
    })
    expect(standard.bind).not.toHaveBeenCalled()
    expect(switchable.bind).not.toHaveBeenCalled()
  })

  it('refuses on a contributor model when the editor has no way to ask', async () => {
    const t = rig(videoFixture())
    expect(await t.port.prepare(t.token, 'modelApi', CONTRIBUTOR)).toEqual({
      ok: false,
      reason: fill(UI_TEXT.media.contributorDeclined, { name: 'clip.mov' }),
    })
    expect(t.bind).not.toHaveBeenCalled()
  })

  it('always asks for a screen recording, even on a Standard model', async () => {
    const askContributor = vi.fn(() => Promise.resolve('send' as const))
    const t = rig(videoFixture(), { askContributor })
    for (const token of [t.token, t.port.issue(t.file)])
      expect(
        await t.port.prepare(token, 'modelApi', 'muse-spark-1.3', { isScreenRecording: true }),
      ).toMatchObject({ ok: true })
    expect(askContributor).toHaveBeenCalledTimes(2)
    expect(askContributor).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: UI_TEXT.media.recordingWarning }),
    )
  })
})

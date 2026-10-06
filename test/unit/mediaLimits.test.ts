import { describe, expect, it, vi } from 'vitest'
import { AttachmentStore, type AttachmentMediaPort } from '../../src/core/attachments'
import { checkMediaLimits, sniffMediaBytes, type MediaFileInfo } from '../../src/core/media/limits'
import {
  BYTES_PER_MIB,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  MEDIA_MAX_UPLOAD_MIB,
  UI_TEXT,
} from '../../src/shared/constants'
import { ebmlFixture, videoFixture, wavFixture } from './helpers/media/fixtures'
import { pdfFixture } from './helpers/pdfFixture'
import type { AttachmentSummary } from '../../src/shared/protocol'
import type { TurnPart } from '../../src/core/agent/agentBackend'

function video(): MediaFileInfo {
  return {
    kind: 'video',
    mediaType: 'video/mp4',
    sizeBytes: 200,
    durationSeconds: 10,
    hasSoundtrack: true,
  }
}

function port(): AttachmentMediaPort {
  return {
    sniff: sniffMediaBytes,
    check: checkMediaLimits,
    part: vi.fn((summary: AttachmentSummary): TurnPart => ({ type: 'text', text: summary.id })),
  }
}

describe('M105 media admission', () => {
  it('enforces default/configured/hard byte limits and exact boundary acceptance', () => {
    expect(
      checkMediaLimits({ ...video(), sizeBytes: MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB }),
    ).toEqual({ ok: true })
    expect(
      checkMediaLimits({ ...video(), sizeBytes: MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB + 1 }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('exceeds') })
    expect(checkMediaLimits(video(), { maxUploadBytes: 199 })).toMatchObject({ ok: false })
    expect(checkMediaLimits(video(), { maxUploadBytes: 200 })).toEqual({ ok: true })
    expect(() =>
      checkMediaLimits(video(), { maxUploadBytes: MEDIA_MAX_UPLOAD_MIB * BYTES_PER_MIB + 1 }),
    ).toThrow(RangeError)
    for (const maximum of [0, -1, 1.5, NaN, Infinity])
      expect(() => checkMediaLimits(video(), { maxUploadBytes: maximum })).toThrow(RangeError)
  })

  it('enforces duration and refuses unknown duration under a cap/model maximum', () => {
    expect(checkMediaLimits(video(), { maxDurationSeconds: 10 })).toEqual({ ok: true })
    expect(checkMediaLimits(video(), { maxDurationSeconds: 9 })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('exceeds'),
    })
    const unknown = { ...video(), durationSeconds: null }
    expect(checkMediaLimits(unknown)).toEqual({ ok: true })
    expect(checkMediaLimits(unknown, { capped: true })).toEqual({
      ok: false,
      reason: UI_TEXT.media.cappedDurationUnknown,
    })
    expect(checkMediaLimits(unknown, { maxDurationSeconds: 600 })).toEqual({
      ok: false,
      reason: UI_TEXT.media.durationUnknown,
    })
    for (const maximum of [0, -1, NaN, Infinity])
      expect(() => checkMediaLimits(video(), { maxDurationSeconds: maximum })).toThrow(RangeError)
  })

  it('refuses WebM/Matroska/m4a with conversion offered only after the machine probe', () => {
    for (const bytes of [ebmlFixture(), ebmlFixture('matroska'), videoFixture({ brand: 'M4A ' })]) {
      const info = sniffMediaBytes(bytes)!
      expect(checkMediaLimits(info)).toMatchObject({ ok: false })
      expect(checkMediaLimits(info)).not.toHaveProperty('convertToMp4')
      expect(checkMediaLimits(info, { converterAvailable: true })).toMatchObject({
        ok: false,
        convertToMp4: true,
      })
      expect(
        checkMediaLimits(info, {
          acceptedMediaTypes: [info.mediaType],
          modelName: 'Captured model',
        }),
      ).toEqual({ ok: true })
    }
    expect(
      checkMediaLimits(video(), {
        acceptedMediaTypes: [],
        modelName: 'No video model',
        converterAvailable: true,
      }),
    ).toMatchObject({ ok: false, reason: 'No video model does not take video/mp4.' })
    expect(
      checkMediaLimits(video(), { acceptedMediaTypes: [], converterAvailable: true }),
    ).not.toHaveProperty('convertToMp4')
  })

  it('refuses empty/invalid metadata before admission', () => {
    for (const info of [
      { ...video(), sizeBytes: 0 },
      { ...video(), sizeBytes: -1 },
      { ...video(), durationSeconds: 0 },
      { ...video(), width: 0 },
    ])
      expect(checkMediaLimits(info)).toMatchObject({ ok: false })
  })

  it('offers conversion only when the selected model accepts the resulting mp4', () => {
    const webm = sniffMediaBytes(ebmlFixture())!
    expect(
      checkMediaLimits(webm, { converterAvailable: true, acceptedMediaTypes: ['video/quicktime'] }),
    ).not.toHaveProperty('convertToMp4')
    const quicktime = sniffMediaBytes(videoFixture({ brand: 'qt  ' }))!
    expect(
      checkMediaLimits(quicktime, { converterAvailable: true, acceptedMediaTypes: ['video/mp4'] }),
    ).toMatchObject({ ok: false, convertToMp4: true })
  })
})

describe('M105 lazy AttachmentStore media port', () => {
  it('installs the lazy media port after construction without losing existing attachments', () => {
    let id = 0
    const attachments = new AttachmentStore(() => String(++id))
    expect(attachments.add('pages.pdf', pdfFixture(1), true).ok).toBe(true)
    attachments.installMediaPort(port())
    expect(attachments.addMedia('clip.mp4', video()).ok).toBe(true)
    expect(attachments.list()).toHaveLength(2)
    expect(attachments.partsFor(['1', '2'])).toMatchObject([
      { type: 'file', mediaType: 'application/pdf' },
      { type: 'text', text: '2' },
    ])
  })
  it('dispatches renamed video by bytes before PDF/text/image names and gates before storing', () => {
    const media = port()
    const attachments = new AttachmentStore(() => 'media-1', undefined, media)
    expect(attachments.add('renamed.mp4', ebmlFixture(), true, true)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('video/webm'),
    })
    expect(attachments.size).toBe(0)
    expect(media.part).not.toHaveBeenCalled()
    expect(attachments.add('renamed.pdf', videoFixture(), true, true)).toMatchObject({
      ok: true,
      attachment: { mediaType: 'video/mp4', media: { info: { durationSeconds: 10 } } },
    })
    expect(media.part).not.toHaveBeenCalled()
    expect(attachments.partsFor(['media-1'])).toEqual([{ type: 'text', text: 'media-1' }])
    expect(media.part).toHaveBeenCalledOnce()
    attachments.release(['media-1'])
    expect(attachments.partsFor(['media-1'])).toEqual([])
  })

  it('keeps host-file metadata only, applies the injected model gate, and preserves mixed budgets', () => {
    const media = port()
    let id = 0
    const attachments = new AttachmentStore(() => String(++id), undefined, media)
    expect(attachments.add('pages.pdf', pdfFixture(50), true).ok).toBe(true)
    expect(attachments.addMedia('clip.mp4', video())).toEqual({
      ok: false,
      reason: UI_TEXT.documentsOverBudget,
    })
    attachments.clear()
    expect(
      attachments.addMedia('clip.mp4', { ...video(), sizeBytes: 100 * BYTES_PER_MIB }),
    ).toMatchObject({
      ok: true,
      attachment: {
        sizeBytes: 100 * BYTES_PER_MIB,
        media: { info: { kind: 'video', durationSeconds: 10 } },
      },
    })
  })

  it('refuses media when the port is absent or denies the chosen model', () => {
    expect(new AttachmentStore(() => '1').addMedia('clip.mp4', video())).toEqual({
      ok: false,
      reason: UI_TEXT.media.museCodeRefusal,
    })
    const media = {
      ...port(),
      check: vi.fn(() => ({ ok: false, reason: 'captured model gate' }) as const),
    }
    const attachments = new AttachmentStore(() => '1', undefined, media)
    expect(attachments.addMedia('clip.mp4', video())).toEqual({
      ok: false,
      reason: 'captured model gate',
    })
    expect(attachments.size).toBe(0)
    expect(media.part).not.toHaveBeenCalled()
  })

  it('enforces the composer count for streamed and embedded media and names malformed input', () => {
    let id = 0
    const media = port()
    const attachments = new AttachmentStore(() => String(++id), undefined, media)
    for (let index = 0; index < MAX_ATTACHMENTS_PER_MESSAGE; index += 1)
      expect(attachments.addMedia('clip.mp4', video()).ok).toBe(true)
    expect(attachments.addMedia('clip.mp4', video())).toEqual({
      ok: false,
      reason: UI_TEXT.attachmentLimit,
    })
    expect(attachments.add('sound.wav', wavFixture())).toEqual({
      ok: false,
      reason: UI_TEXT.attachmentLimit,
    })
    attachments.clear()
    expect(attachments.add('broken.mp4', videoFixture().subarray(0, 7))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Unsupported attachment type'),
    })
    expect(attachments.add('sound.wav', wavFixture())).toMatchObject({
      ok: true,
      attachment: { mediaType: 'audio/wav' },
    })
  })
})

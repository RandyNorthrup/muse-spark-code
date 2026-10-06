import { describe, expect, it } from 'vitest'
import {
  companionMediaUploadSchema,
  mediaEstimateSchema,
  mediaAttachmentUpdateSchema,
  mediaInfoSchema,
  mediaUploadStateSchema,
  screenRecordingOptionsSchema,
  uploadedMediaRefSchema,
  type MediaInfo,
  type MediaChip,
  type MediaUploadState,
  type UploadedMediaRef,
} from '../../src/shared/media'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'
import {
  MEDIA_AUDIO_ACTIONS,
  MEDIA_AUDIO_ACTION_SETTING,
  MEDIA_CONTRIBUTOR_CHOICES,
  MEDIA_FILE_EXPIRY_DEFAULT_S,
  MEDIA_FILE_EXPIRY_MAX_S,
  MEDIA_FILE_EXPIRY_MIN_S,
  MEDIA_FILE_ID_MIN_BYTES,
  MEDIA_KINDS,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  MEDIA_MAX_UPLOAD_MIB,
  MEDIA_MAX_UPLOAD_SETTING,
  MEDIA_UPLOAD_EXPIRY_SETTING,
  SCREEN_RECORDING_DEFAULT_MAX_SECONDS,
  SCREEN_RECORDING_MAX_SECONDS_SETTING,
  SCREEN_RECORDING_RECENT_MAX_AGE_MS,
} from '../../src/shared/constants'
import type { ScreenRecordingDriver } from '../../src/core/media/record/driver'

const video: Extract<MediaInfo, { kind: 'video' }> = {
  kind: 'video',
  mediaType: 'video/mp4',
  sizeBytes: 500_000,
  durationSeconds: 10,
  hasSoundtrack: true,
  width: 640,
  height: 480,
}
const file: UploadedMediaRef = {
  fileId: 'file-test',
  provider: 'meta',
  sha256: 'a'.repeat(64),
  expiresAt: 1_800_000_000,
  bytes: 500_000,
  name: 'clip.mp4',
  mime: 'video/mp4',
}

describe('M105 media metadata', () => {
  it('keeps each sniffed kind and unknown duration/sound explicit without granting support', () => {
    const infos = [
      { kind: 'image', mediaType: 'image/png', sizeBytes: 24, width: 1, height: 2 },
      { kind: 'document', mediaType: 'application/pdf', sizeBytes: 100, pageCount: 2 },
      { kind: 'text', mediaType: 'text/plain', sizeBytes: 0 },
      video,
      { kind: 'audio', mediaType: 'audio/wav', sizeBytes: 44, durationSeconds: null },
    ]
    expect(infos.map((info) => mediaInfoSchema.parse(info).kind)).toEqual(MEDIA_KINDS)
    for (const mediaType of ['video/quicktime', 'video/webm', 'video/x-matroska']) {
      expect(mediaInfoSchema.parse({ ...video, mediaType }).mediaType).toBe(mediaType)
    }
    expect(
      mediaInfoSchema.parse({ ...video, durationSeconds: null, hasSoundtrack: null }),
    ).toMatchObject({
      durationSeconds: null,
      hasSoundtrack: null,
    })
  })

  it.each([
    ['negative size', { ...video, sizeBytes: -1 }],
    ['fractional size', { ...video, sizeBytes: 0.5 }],
    ['empty duration', { ...video, durationSeconds: 0 }],
    ['infinite duration', { ...video, durationSeconds: Infinity }],
    ['missing duration', { ...video, durationSeconds: undefined }],
    ['wrong kind', { ...video, kind: 'audio' }],
    ['invalid dimensions', { ...video, width: -1 }],
    ['bytes in metadata', { ...video, base64Data: 'MEDIA_BYTE_CANARY' }],
  ])('refuses %s', (_label, info) => {
    expect(mediaInfoSchema.safeParse(info).success).toBe(false)
  })

  it('requires an expiry and a SHA-256 and refuses content in an upload reference', () => {
    expect(uploadedMediaRefSchema.parse(file)).toEqual(file)
    for (const bad of [
      { ...file, expiresAt: undefined },
      { ...file, expiresAt: 0 },
      { ...file, sha256: 'invalid' },
      { ...file, sha256: 'a'.repeat(65) },
      { ...file, fileId: '' },
      { ...file, bytes: -1 },
      { ...file, name: 'x'.repeat(257) },
      { ...file, file_data: 'MEDIA_BYTE_CANARY' },
    ]) {
      expect(uploadedMediaRefSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('bounds progress and keeps upload failures, Stop and estimates explicit', () => {
    const states: MediaUploadState[] = [
      { status: 'pending' },
      { status: 'uploading', uploadedBytes: 1, totalBytes: 2 },
      { status: 'uploaded', file },
      { status: 'failed', reason: 'Upload refused' },
      { status: 'stopped' },
    ]
    for (const state of states) expect(mediaUploadStateSchema.parse(state)).toEqual(state)
    expect(
      mediaUploadStateSchema.safeParse({ status: 'uploading', uploadedBytes: 3, totalBytes: 2 })
        .success,
    ).toBe(false)
    expect(mediaUploadStateSchema.safeParse({ status: 'uploaded' }).success).toBe(false)
    const estimate = {
      estimatedInputTokens: 2580,
      upperBoundInputTokens: 3000,
      standardCostUsd: 0.01,
    }
    expect(mediaEstimateSchema.parse(estimate)).toEqual(estimate)
    expect(mediaEstimateSchema.safeParse({ ...estimate, upperBoundInputTokens: 169 }).success).toBe(
      false,
    )
    expect(mediaEstimateSchema.safeParse({ ...estimate, standardCostUsd: -1 }).success).toBe(false)
  })

  it('accepts companion tokens and refuses paths and file contents in the reply', () => {
    const upload = { requestId: 'r', uploadToken: 'opaque-token', name: 'clip.mp4', info: video }
    expect(companionMediaUploadSchema.parse(upload)).toEqual(upload)
    for (const extra of [{ path: '/private/clip.mp4' }, { base64: 'MEDIA_BYTE_CANARY' }]) {
      expect(companionMediaUploadSchema.safeParse({ ...upload, ...extra }).success).toBe(false)
    }
  })
})

describe('M105 attachment bridge', () => {
  it('carries host-issued tokens and rejects a byte-bearing webview request', () => {
    const request = {
      type: 'attachMedia',
      requestId: 'r',
      pathToken: 'host-issued',
      attachmentEpoch: 2,
    }
    expect(parseWebviewToHostMessage(request)).toEqual({ ok: true, message: request })
    for (const extra of [{ base64: 'MEDIA_BYTE_CANARY' }, { file_data: 'MEDIA_BYTE_CANARY' }]) {
      expect(parseWebviewToHostMessage({ ...request, ...extra }).ok).toBe(false)
    }
    expect(parseWebviewToHostMessage({ ...request, pathToken: '' }).ok).toBe(false)
    expect(parseWebviewToHostMessage({ ...request, pathToken: 'x'.repeat(4097) }).ok).toBe(false)
    expect(parseWebviewToHostMessage({ ...request, attachmentEpoch: -1 }).ok).toBe(false)
  })

  it('checks sound and contributor choices, and carries metadata and progress back', () => {
    for (const action of MEDIA_AUDIO_ACTIONS) {
      expect(
        parseWebviewToHostMessage({ type: 'mediaAttachmentAction', id: 'att', action }).ok,
      ).toBe(true)
    }
    for (const choice of MEDIA_CONTRIBUTOR_CHOICES) {
      expect(
        parseWebviewToHostMessage({ type: 'mediaContributorChoice', id: 'att', choice }).ok,
      ).toBe(true)
    }
    expect(
      parseWebviewToHostMessage({
        type: 'mediaAttachmentAction',
        id: 'att',
        action: 'startRecording',
      }).ok,
    ).toBe(false)
    const media: MediaChip = { info: video, upload: { status: 'uploaded', file } }
    const update = {
      type: 'mediaAttachmentUpdate',
      id: 'att',
      media,
    }
    expect(mediaAttachmentUpdateSchema.parse(update)).toEqual(update)
    const attachment = {
      id: 'a',
      name: 'clip.mp4',
      mediaType: 'video/mp4',
      sizeBytes: 500_000,
      media: update.media,
    }
    expect(parseHostToWebviewMessage({ type: 'attachmentAdded', attachment })).toMatchObject({
      ok: true,
      message: { attachment },
    })
  })
})

describe('M105 recorder contract', () => {
  it('requires explicit sound choices and bounds recording duration', () => {
    const options = {
      maxSeconds: SCREEN_RECORDING_DEFAULT_MAX_SECONDS,
      microphone: false,
      systemAudio: false,
    }
    expect(screenRecordingOptionsSchema.parse(options)).toEqual(options)
    for (const maxSeconds of [10, 600])
      expect(screenRecordingOptionsSchema.safeParse({ ...options, maxSeconds }).success).toBe(true)
    for (const maxSeconds of [9, 601, 10.5, Infinity])
      expect(screenRecordingOptionsSchema.safeParse({ ...options, maxSeconds }).success).toBe(false)
    expect(screenRecordingOptionsSchema.safeParse({ maxSeconds: 120 }).success).toBe(false)
    expect(
      screenRecordingOptionsSchema.safeParse({ ...options, microphone: undefined }).success,
    ).toBe(false)
    expect(
      screenRecordingOptionsSchema.safeParse({ ...options, systemAudio: undefined }).success,
    ).toBe(false)
  })

  it('allows an editor-neutral injected driver to refuse rather than return an empty recording', async () => {
    const refusal = { ok: false, reason: 'No local screen' } as const
    const driver: ScreenRecordingDriver = {
      available: () => Promise.resolve(refusal),
      start: () =>
        Promise.resolve({
          stop: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          result: Promise.resolve(refusal),
        }),
    }
    expect(await driver.available()).toEqual(refusal)
    const run = await driver.start(
      { maxSeconds: 120, microphone: false, systemAudio: false },
      () => undefined,
    )
    expect(await run.result).toEqual(refusal)
    await run.stop()
    await run.cancel()
  })

  it('publishes the plan defaults without changing existing backend or paid defaults', () => {
    expect(MEDIA_FILE_ID_MIN_BYTES).toBe(1024 * 1024)
    expect(MEDIA_FILE_EXPIRY_DEFAULT_S).toBe(7 * 24 * 60 * 60)
    expect(MEDIA_FILE_EXPIRY_MIN_S).toBe(3600)
    expect(MEDIA_FILE_EXPIRY_MAX_S).toBe(30 * 24 * 60 * 60)
    expect([MEDIA_MAX_UPLOAD_DEFAULT_MIB, MEDIA_MAX_UPLOAD_MIB]).toEqual([200, 1024])
    expect(SCREEN_RECORDING_RECENT_MAX_AGE_MS).toBe(600_000)
    expect([
      MEDIA_UPLOAD_EXPIRY_SETTING,
      MEDIA_MAX_UPLOAD_SETTING,
      MEDIA_AUDIO_ACTION_SETTING,
      SCREEN_RECORDING_MAX_SECONDS_SETTING,
    ]).toEqual([
      'museSpark.mediaUploadExpiryDays',
      'museSpark.mediaMaxUploadMiB',
      'museSpark.mediaAudioAction',
      'museSpark.screenRecordingMaxSeconds',
    ])
  })
})

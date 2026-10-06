import { describe, expect, it, vi } from 'vitest'
import {
  audioRouteOptions,
  batchTranscriptionQuestion,
  prepareAudioAttachment,
  type AudioModelCapabilities,
  type AudioPreparationDeps,
  type AudioRoutingContext,
  type AudioSource,
  type BatchTranscriptionPort,
} from '../../src/core/voice/transcribeBatch'
import { PaidFeatureGate, PaidUsage } from '../../src/core/paid/paidFeatures'
import { PaidUseConsent, type PaidUseAnswer } from '../../src/core/paid/paidConsent'
import { MAX_TEXT_ATTACHMENT_BYTES, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { audioLabels } from './helpers/audioLabels'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { compareUsd, parseUsd, sumUsd, type Usd } from '../../src/shared/usd'

// Test-only projections of U4/U7's summary, never claimed complete live records.
const spark13: AudioModelCapabilities = {
  modelId: 'muse-spark-1.3',
  video: 'yes',
  videoFormats: ['video/mp4', 'video/quicktime'],
  hearsSoundtrack: 'no',
  audio: 'no',
  audioFormats: [],
}
const spark12: AudioModelCapabilities = {
  ...spark13,
  modelId: 'muse-spark-1.2',
  hearsSoundtrack: 'yes',
}
const video: AudioSource = {
  name: 'clip.mp4',
  pathToken: 'confined-video',
  info: {
    kind: 'video',
    mediaType: 'video/mp4',
    sizeBytes: 500_000,
    durationSeconds: 60.25,
    hasSoundtrack: true,
  },
}
const wav: AudioSource = {
  name: 'speech.wav',
  pathToken: 'confined-audio',
  info: { kind: 'audio', mediaType: 'audio/wav', sizeBytes: 1000, durationSeconds: 60.25 },
}

function rig() {
  const log = new FakeLogOutputChannel()
  const state: { isOn: boolean; isCurrent: boolean; answer: PaidUseAnswer } = {
    isOn: true,
    isCurrent: true,
    answer: 'once',
  }
  const context: AudioRoutingContext = {
    backend: 'modelApi',
    model: spark13,
    soundtrackModel: spark12,
    batchFormats: ['video/mp4', 'audio/wav', 'audio/mpeg'],
    canExtractWav: true,
    canWrapMp4: true,
    isVoiceOn: true,
  }
  const gate = new PaidFeatureGate({
    isSettingOn: () => state.isOn,
    isDefaultOn: () => true,
    setSetting: () => Promise.resolve(),
    readAccepted: () => new Set(),
    writeAccepted: () => Promise.resolve(),
    confirm: () => Promise.resolve(false),
    isWindowFocused: () => true,
    log,
  })
  const ask = vi.fn(() => Promise.resolve(state.answer))
  const consent = new PaidUseConsent({
    isOn: (feature) => gate.isOn(feature),
    windowOnceFeatures: new Set(['voice']),
    windowOnceGeneration: () => (state.isOn ? 1 : 0),
    canRemember: () => false,
    readGrants: () => new Set(),
    writeGrants: () => Promise.resolve(),
    ask,
    log,
  })
  const usage = new PaidUsage(log)
  const claim = {
    admitSend: vi.fn(),
    settle: vi.fn<(cost: Usd | undefined) => Promise<void>>(() => Promise.resolve()),
  }
  const reserve = vi.fn<AudioPreparationDeps['reserve']>(() => Promise.resolve(claim))
  const transcribe = vi.fn<BatchTranscriptionPort['transcribe']>((source, _signal, admit) => {
    admit()
    return Promise.resolve({
      text: 'Soundtrack transcript canary',
      billedSeconds: source.info.durationSeconds ?? 0,
    })
  })
  const batch: BatchTranscriptionPort = {
    billableSecondsUpperBound: (source) => source.info.durationSeconds ?? undefined,
    transcribe,
  }
  const dispose = vi.fn(() => Promise.resolve())
  const convert = vi.fn<NonNullable<AudioPreparationDeps['converter']>['convert']>((source, mode) =>
    Promise.resolve({
      source: {
        ...source,
        pathToken: 'private-converted',
        info:
          mode === 'extractWav'
            ? { ...wav.info, durationSeconds: source.info.durationSeconds }
            : { ...video.info, durationSeconds: source.info.durationSeconds },
      },
      dispose,
    }),
  )
  const deps: AudioPreparationDeps = {
    context,
    gate,
    consent,
    usage,
    reserve,
    batch,
    converter: { convert },
    assertCurrent: () => {
      if (!state.isCurrent) throw new Error('stale choice')
    },
  }
  const prepare = (
    source = video,
    action: Parameters<typeof prepareAudioAttachment>[1] = 'transcribe',
    override: Partial<AudioPreparationDeps> = {},
    signal = new AbortController().signal,
  ) => prepareAudioAttachment(source, action, { ...deps, ...override }, signal)
  return {
    context,
    state,
    deps,
    batch,
    claim,
    reserve,
    transcribe,
    ask,
    usage,
    convert,
    dispose,
    consent,
    prepare,
  }
}

describe('D85.5 capability sound choices', () => {
  it('projects labels in the installed language at use time', () => {
    const r = rig()
    try {
      setUiText({ ...EN, media: { ...EN.media, sendWithoutSound: 'Sans son pour ce test' } }, 'fr')
      expect(audioRouteOptions(video.info, r.context).labels.sendWithoutSound).toBe(
        'Sans son pour ce test',
      )
    } finally {
      setUiText(EN, 'en')
    }
  })
  it('offers 1.3 soundtrack choices and defaults only to transcription', () => {
    const r = rig()
    expect(audioRouteOptions(video.info, r.context)).toEqual({
      actions: ['transcribe', 'useSoundtrackModel', 'sendWithoutSound'],
      labels: audioLabels,
      defaultAction: 'transcribe',
      soundtrackModelId: spark12.modelId,
      warning: fill(UI_TEXT.media.soundtrackUnsupported, { model: spark13.modelId }),
    })
    expect(audioRouteOptions(video.info, { ...r.context, model: spark12 })).toEqual({
      actions: [],
      labels: audioLabels,
    })
    if (video.info.kind !== 'video') throw new Error('Expected video fixture')
    expect(audioRouteOptions({ ...video.info, hasSoundtrack: false }, r.context)).toEqual({
      actions: [],
      labels: audioLabels,
    })
    expect(audioRouteOptions({ ...video.info, hasSoundtrack: null }, r.context).actions).toContain(
      'transcribe',
    )
    expect(
      audioRouteOptions(video.info, {
        ...r.context,
        model: { ...spark13, hearsSoundtrack: 'unknown' },
      }).warning,
    ).toBe(UI_TEXT.media.soundUnknown)
  })

  it.each(['audio/wav', 'audio/mpeg'] as const)(
    'offers transcription and converter-gated wrap for %s, never native Meta audio',
    (mediaType) => {
      if (wav.info.kind !== 'audio') throw new Error('Expected audio fixture')
      const info = { ...wav.info, mediaType }
      const r = rig()
      expect(audioRouteOptions(info, r.context).actions).toEqual(['transcribe', 'wrapAsVideo'])
      expect(audioRouteOptions(info, { ...r.context, canWrapMp4: false }).actions).toEqual([
        'transcribe',
      ])
      expect(
        audioRouteOptions(info, {
          ...r.context,
          soundtrackModel: { ...spark12, hearsSoundtrack: 'unknown' },
        }).actions,
      ).toEqual(['transcribe'])
    },
  )

  it('enables other vendors only when their selected record hears the format', async () => {
    const r = rig()
    const supported = {
      ...r.context,
      model: {
        ...spark13,
        modelId: 'captured-audio-model',
        audio: 'yes' as const,
        audioFormats: ['audio/wav'],
      },
    }
    expect(audioRouteOptions(wav.info, supported).defaultAction).toBe('sendAudio')
    expect(await r.prepare(wav, 'sendAudio', { context: supported })).toEqual({
      modelId: 'captured-audio-model',
      media: wav,
    })
    for (const audio of ['no', 'unknown'] as const)
      expect(
        audioRouteOptions(wav.info, { ...supported, model: { ...supported.model, audio } }).actions,
      ).not.toContain('sendAudio')
    expect(
      audioRouteOptions(wav.info, {
        ...supported,
        model: { ...supported.model, audioFormats: [] },
      }).actions,
    ).not.toContain('sendAudio')
    await expect(r.prepare(wav, 'sendAudio')).rejects.toThrow('does not take audio')
    expect(r.transcribe).not.toHaveBeenCalled()
  })

  it('refuses unknown video and Muse Code before work, without guessed vendor support', async () => {
    const r = rig()
    expect(
      audioRouteOptions(video.info, { ...r.context, model: { ...spark13, video: 'unknown' } }),
    ).toEqual({
      actions: [],
      labels: audioLabels,
      warning: fill(UI_TEXT.media.videoUnknown, { model: spark13.modelId }),
    })
    expect(
      audioRouteOptions(video.info, { ...r.context, model: { ...spark13, videoFormats: [] } })
        .actions,
    ).toEqual([])
    await expect(
      r.prepare(wav, 'transcribe', { context: { ...r.context, backend: 'museCode' } }),
    ).rejects.toThrow(UI_TEXT.media.museCodeRefusal)
    expect(r.ask).not.toHaveBeenCalled()
  })

  it('keeps U18 unavailable explicit and never silently defaults to a different model', () => {
    const r = rig()
    const options = audioRouteOptions(video.info, {
      ...r.context,
      batchFormats: [],
      canExtractWav: false,
    })
    expect(options.actions).toEqual(['useSoundtrackModel', 'sendWithoutSound'])
    expect(options.defaultAction).toBeUndefined()
    expect(audioRouteOptions(video.info, { ...r.context, isVoiceOn: false }).actions).not.toContain(
      'transcribe',
    )
  })
})

describe('batch preparation and accounting', () => {
  it('puts a transcript beside the video and sends standalone audio as text only', async () => {
    const r = rig()
    const prepared = await r.prepare()
    expect(prepared).toMatchObject({
      modelId: spark13.modelId,
      media: video,
      transcript: {
        type: 'textFile',
        name: 'Transcript of clip.mp4',
        text: 'Soundtrack transcript canary',
        sizeBytes: 28,
      },
    })
    const audioPrepared = await r.prepare(wav)
    expect(audioPrepared.media).toBeUndefined()
    expect(r.context.model).toBe(spark13)
    expect(r.reserve.mock.calls[0]?.[0]).toBe(parseUsd('0.0030125'))
    expect(r.claim.settle.mock.calls.at(-1)?.[0]).toBe(parseUsd('0.0030125'))
    expect(r.usage.current.voiceSeconds).toBe(120.5)
    expect(r.ask).toHaveBeenCalledOnce()
    await r.consent.forget()
    await r.prepare(wav)
    expect(r.ask).toHaveBeenCalledTimes(2)
  })

  it('passes the exact ten-second tariff to admission and settlement', async () => {
    const r = rig()
    await r.prepare({ ...wav, info: { ...wav.info, durationSeconds: 10 } })
    expect(r.reserve.mock.calls[0]?.[0]).toBe(parseUsd('0.0005'))
    expect(r.claim.settle).toHaveBeenCalledExactlyOnceWith(parseUsd('0.0005'))
  })

  it('admits exactly 1000 ten-second bills at the half-dollar cap and refuses the next', async () => {
    const r = rig()
    const cap = parseUsd('0.5')
    let spent = parseUsd(0)
    const reserve = vi.fn<AudioPreparationDeps['reserve']>((cost) => {
      if (compareUsd(sumUsd([spent, cost]), cap) > 0)
        return Promise.reject(new Error('budget reached'))
      return Promise.resolve({
        admitSend: () => undefined,
        settle: (actual) => {
          spent = sumUsd([spent, actual ?? cost])
          return Promise.resolve()
        },
      })
    })
    const source = { ...wav, info: { ...wav.info, durationSeconds: 10 } }
    for (let index = 0; index < 1000; index++) await r.prepare(source, 'transcribe', { reserve })
    expect(spent).toBe(cap)
    await expect(r.prepare(source, 'transcribe', { reserve })).rejects.toThrow('budget reached')
    expect(r.transcribe).toHaveBeenCalledTimes(1000)
  })

  it('keeps fractional-second tariffs and rounds a sub-nano-USD liability upward', async () => {
    const r = rig()
    for (const [seconds, cost] of [
      [0.125, '0.00000625'],
      [0.000001, '0.000000001'],
    ] as const) {
      await r.prepare({ ...wav, info: { ...wav.info, durationSeconds: seconds } })
      expect(r.reserve).toHaveBeenLastCalledWith(parseUsd(cost), expect.any(AbortSignal))
      expect(r.claim.settle).toHaveBeenLastCalledWith(parseUsd(cost))
    }
  })

  it('names the exact hourly price, key billing and shared daily budget in the existing modal', () => {
    const q = batchTranscriptionQuestion('speech.wav', 5)
    expect(q.title).toBe('Transcript of speech.wav')
    expect(q.detail).toContain('$0.18 per hour of audio')
    expect(q.detail).toContain('billed to your Model API key')
    expect(q.detail).toContain('Shared daily budget for interactive paid extras: $5.00')
    expect(() => batchTranscriptionQuestion('speech.wav', NaN)).toThrow()
  })

  it('refuses an absent captured batch adapter with a named reason before consent', async () => {
    const r = rig()
    const deps = { ...r.deps }
    delete deps.batch
    await expect(
      prepareAudioAttachment(video, 'transcribe', deps, new AbortController().signal),
    ).rejects.toThrow(UI_TEXT.museVoiceRefused)
    expect(r.ask).not.toHaveBeenCalled()
  })

  it('uses the fallback for this message only, and without-sound spends nothing', async () => {
    const r = rig()
    expect(await r.prepare(video, 'useSoundtrackModel')).toEqual({
      modelId: spark12.modelId,
      media: video,
    })
    expect(await r.prepare(video, 'sendWithoutSound')).toEqual({
      modelId: spark13.modelId,
      media: video,
    })
    expect(r.context.model.modelId).toBe(spark13.modelId)
    expect(r.transcribe).not.toHaveBeenCalled()
    expect(r.reserve).not.toHaveBeenCalled()
  })

  it('extracts only when required and deletes the private intermediate after transcription', async () => {
    const r = rig()
    await r.prepare(video, 'transcribe', { context: { ...r.context, batchFormats: ['audio/wav'] } })
    expect(r.convert).toHaveBeenCalledWith(video, 'extractWav', expect.any(AbortSignal))
    expect(r.transcribe.mock.calls[0]?.[0].info.mediaType).toBe('audio/wav')
    expect(r.dispose).toHaveBeenCalledOnce()
    expect(Object.keys(r.convert.mock.calls[0] ?? [])).toHaveLength(3)
  })

  it('keeps a wrapped soundtrack until upload/discard and cleans it on stale conversion', async () => {
    const r = rig()
    const prepared = await r.prepare(wav, 'wrapAsVideo')
    expect(prepared).toMatchObject({
      modelId: spark12.modelId,
      media: { info: { kind: 'video', mediaType: 'video/mp4', hasSoundtrack: true } },
    })
    expect(r.dispose).not.toHaveBeenCalled()
    await prepared.dispose?.()
    expect(r.dispose).toHaveBeenCalledOnce()
    r.convert.mockImplementationOnce(() => {
      r.state.isCurrent = false
      return Promise.resolve({ source: video, dispose: r.dispose })
    })
    await expect(r.prepare(wav, 'wrapAsVideo')).rejects.toThrow('stale choice')
    expect(r.dispose).toHaveBeenCalledTimes(2)
  })

  it.each(['denied', 'disabled', 'unknown duration', 'unbounded bill', 'aborted'] as const)(
    'does not dispatch when %s',
    async (reason) => {
      const r = rig()
      const consentAllows = vi.spyOn(r.consent, 'allows')
      const abort = new AbortController()
      switch (reason) {
        case 'denied': {
          r.state.answer = 'deny'
          break
        }
        case 'disabled': {
          r.state.isOn = false
          break
        }
        case 'aborted': {
          abort.abort()
          break
        }
        default: {
          break
        }
      }
      const source =
        reason === 'unknown duration'
          ? { ...video, info: { ...video.info, durationSeconds: null } }
          : video
      let batch = r.batch
      if (reason === 'unbounded bill')
        batch = { ...r.batch, billableSecondsUpperBound: () => undefined }
      else if (reason === 'unknown duration')
        batch = { ...r.batch, billableSecondsUpperBound: () => 60.25 }
      await expect(r.prepare(source, 'transcribe', { batch }, abort.signal)).rejects.toThrow()
      expect(r.transcribe).not.toHaveBeenCalled()
      expect(r.convert).not.toHaveBeenCalled()
      expect(r.reserve).not.toHaveBeenCalled()
      if (reason === 'disabled') expect(consentAllows).not.toHaveBeenCalled()
    },
  )

  it('passes Stop into consent and cancels even a popup that ignores its signal', async () => {
    const r = rig()
    const answer = Promise.withResolvers<boolean>()
    const allows = vi.fn(() => answer.promise)
    const stop = new AbortController()
    let outcome: unknown
    const waiting = (async () => {
      try {
        await r.prepare(wav, 'transcribe', { consent: { allows } }, stop.signal)
      } catch (error: unknown) {
        outcome = error
      }
    })()
    try {
      expect(allows).toHaveBeenCalledWith({ feature: 'voice' }, false, stop.signal)
      stop.abort(new Error('stopped during consent'))
      await expect.poll(() => outcome).toEqual(new Error('stopped during consent'))
      await waiting
      expect(r.reserve).not.toHaveBeenCalled()
      expect(r.transcribe).not.toHaveBeenCalled()
    } finally {
      answer.resolve(true)
      await waiting
    }
  })

  it('rebinds after the question and after reservation, refunding an unsent claim', async () => {
    const r = rig()
    r.ask.mockImplementationOnce(() => {
      r.state.isCurrent = false
      return Promise.resolve('once')
    })
    await expect(r.prepare()).rejects.toThrow('stale choice')
    expect(r.reserve).not.toHaveBeenCalled()
    r.state.isCurrent = true
    r.reserve.mockImplementationOnce(() => {
      r.state.isCurrent = false
      return Promise.resolve(r.claim)
    })
    await expect(r.prepare()).rejects.toThrow('stale choice')
    expect(r.transcribe).not.toHaveBeenCalled()
    expect(r.claim.settle).toHaveBeenCalledWith(parseUsd(0))
  })

  it.each([Infinity, NaN, 1])(
    'refuses an invalid billable upper bound %s before consent',
    async (bound) => {
      const r = rig()
      await expect(
        r.prepare(video, 'transcribe', {
          batch: { ...r.batch, billableSecondsUpperBound: () => bound },
        }),
      ).rejects.toThrow(UI_TEXT.sessionBudgetVoiceUnavailable)
      expect(r.ask).not.toHaveBeenCalled()
      expect(r.reserve).not.toHaveBeenCalled()
    },
  )

  it('checks extraction duration and deletes mismatched converted audio', async () => {
    const r = rig()
    r.convert.mockResolvedValueOnce({
      source: { ...wav, info: { ...wav.info, durationSeconds: 1 } },
      dispose: r.dispose,
    })
    await expect(
      r.prepare(video, 'transcribe', { context: { ...r.context, batchFormats: ['audio/wav'] } }),
    ).rejects.toThrow(UI_TEXT.media.converterUnavailable)
    expect(r.dispose).toHaveBeenCalledOnce()
    expect(r.reserve).not.toHaveBeenCalled()
  })

  it('rechecks the gate and budget at dispatch and refuses automatic retries', async () => {
    const r = rig()
    r.transcribe.mockImplementationOnce((_source, _signal, admit) => {
      r.state.isOn = false
      admit()
      return Promise.resolve({ text: 'should not arrive' })
    })
    await expect(r.prepare()).rejects.toThrow()
    expect(r.claim.admitSend).not.toHaveBeenCalled()
    expect(r.claim.settle).toHaveBeenCalledWith(parseUsd(0))
    r.state.isOn = true
    r.claim.admitSend.mockImplementationOnce(() => {
      throw new Error('daily budget reached')
    })
    await expect(r.prepare()).rejects.toThrow('daily budget reached')
    r.transcribe.mockImplementationOnce((_source, _signal, admit) => {
      admit()
      admit()
      return Promise.resolve({ text: 'retry' })
    })
    await expect(r.prepare()).rejects.toThrow()
    expect(r.claim.settle).toHaveBeenLastCalledWith(undefined)
  })

  it('retains uncertain liability and tally on failure, missing receipts and Stop, while cleaning', async () => {
    const r = rig()
    r.transcribe.mockImplementationOnce((_source, _signal, admit) => {
      admit()
      throw new Error('connection lost')
    })
    await expect(
      r.prepare(video, 'transcribe', { context: { ...r.context, batchFormats: ['audio/wav'] } }),
    ).rejects.toThrow('connection lost')
    expect(r.claim.settle).toHaveBeenLastCalledWith(undefined)
    expect(r.dispose).toHaveBeenCalledOnce()
    r.transcribe.mockImplementationOnce((_source, _signal, admit) => {
      admit()
      return Promise.resolve({ text: 'no receipt' })
    })
    await r.prepare(wav)
    expect(r.claim.settle).toHaveBeenLastCalledWith(undefined)
    const abort = new AbortController()
    r.transcribe.mockImplementationOnce((_source, signal, admit) => {
      admit()
      abort.abort()
      signal.throwIfAborted()
      return Promise.reject(new Error('unreachable'))
    })
    await expect(r.prepare(wav, 'transcribe', {}, abort.signal)).rejects.toThrow()
    expect(r.claim.settle).toHaveBeenLastCalledWith(undefined)
    expect(r.usage.current.voiceSeconds).toBe(180.75)
  })

  it.each(['', '  ', 'é'.repeat(MAX_TEXT_ATTACHMENT_BYTES)])(
    'refuses empty or oversized UTF-8 transcripts',
    async (text) => {
      const r = rig()
      r.transcribe.mockImplementationOnce((_source, _signal, admit) => {
        admit()
        return Promise.resolve({ text })
      })
      await expect(r.prepare(wav)).rejects.toThrow()
      expect(r.claim.settle).toHaveBeenLastCalledWith(undefined)
    },
  )

  it.each([
    '',
    ' ',
    'x'.repeat(MAX_TEXT_ATTACHMENT_BYTES + 1),
    'é'.repeat(MAX_TEXT_ATTACHMENT_BYTES),
  ])('settles a known bill exactly once even when transcript text is rejected', async (text) => {
    const r = rig()
    r.transcribe.mockImplementationOnce((_source, _signal, admit) => {
      admit()
      return Promise.resolve({ text, billedSeconds: 1 })
    })
    await expect(r.prepare(wav)).rejects.toThrow()
    expect(r.claim.settle).toHaveBeenCalledExactlyOnceWith(parseUsd('0.00005'))
    expect(r.usage.current.voiceSeconds).toBe(1)
  })

  it('settles exactly once and cleans converted audio even when the usage tally throws', async () => {
    const r = rig()
    vi.spyOn(r.usage, 'addVoiceBatch').mockImplementationOnce(() => {
      throw new Error('usage tally failed')
    })
    await expect(
      r.prepare(video, 'transcribe', { context: { ...r.context, batchFormats: ['audio/wav'] } }),
    ).rejects.toThrow('usage tally failed')
    expect(r.claim.settle).toHaveBeenCalledExactlyOnceWith(parseUsd('0.0030125'))
    expect(r.dispose).toHaveBeenCalledOnce()
  })

  it('does not accept a success from an adapter that bypasses final admission', async () => {
    const r = rig()
    r.transcribe.mockResolvedValueOnce({ text: 'not admitted', billedSeconds: 1 })
    await expect(r.prepare(wav)).rejects.toThrow()
    expect(r.claim.settle).toHaveBeenLastCalledWith(parseUsd(0))
    expect(r.usage.current.voiceSeconds).toBe(0)
  })

  it('rejects invalid conversion results and still cleans if settlement fails', async () => {
    const r = rig()
    r.convert.mockResolvedValueOnce({ source: wav, dispose: r.dispose })
    await expect(r.prepare(wav, 'wrapAsVideo')).rejects.toThrow()
    expect(r.dispose).toHaveBeenCalledOnce()
    r.claim.settle.mockRejectedValueOnce(new Error('ledger unavailable'))
    await expect(
      r.prepare(video, 'transcribe', { context: { ...r.context, batchFormats: ['audio/wav'] } }),
    ).rejects.toThrow('ledger unavailable')
    expect(r.dispose).toHaveBeenCalledTimes(2)
    expect(r.claim.settle).toHaveBeenCalledOnce()
  })

  it('settles an over-bound receipt honestly and refuses its transcript', async () => {
    const r = rig()
    r.transcribe.mockImplementationOnce((_source, _signal, admit) => {
      admit()
      return Promise.resolve({ text: 'overspend', billedSeconds: 100 })
    })
    await expect(r.prepare(wav)).rejects.toThrow()
    expect(r.claim.settle).toHaveBeenCalledWith(parseUsd('0.005'))
    expect(r.usage.current.voiceSeconds).toBe(100)
  })

  it('keeps fractional batch tally and refuses invalid durations', () => {
    const r = rig()
    r.usage.addVoiceBatch(0.125)
    expect(r.usage.current.voiceSeconds).toBe(0.125)
    for (const seconds of [NaN, Infinity, -1])
      expect(() => {
        r.usage.addVoiceBatch(seconds)
      }).toThrow()
  })
})

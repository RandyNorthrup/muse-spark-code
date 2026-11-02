// RLF-M105BIND: a prepared video or audio item reaches the model only
// through the selected model's capability record, D48 consent and the
// run ledger. These tests run the real modules: the record resolver and
// its media projection, the modality gate, the session replay's prepare
// gate, the headless run ledger, the exec argument admission and the
// exec transport's transcription route.
import { describe, expect, it } from 'vitest'
import { Usd } from '../../src/shared/usd'
import { MODEL_API_BASE_URL, UI_TEXT } from '../../src/shared/constants'
import {
  metaCapabilityRecord,
  resolveModelCapabilities,
} from '../../src/core/providers/capabilityRecord'
import { mediaCapabilitiesFromRecord } from '../../src/core/media/recordMediaCapabilities'
import { metaMediaCapabilities } from '../../src/core/media/metaMediaCapabilities'
import { modalityGate } from '../../src/core/media/modalityGate'
import { ReplayMedia } from '../../src/core/media/replayMedia'
import { responsesMediaCodec } from '../../src/core/media/responsesMediaCodec'
import { MediaBudget } from '../../src/core/backends/modelapi/mediaBudget'
import { createModelApiAudioContext } from '../../src/core/voice/transcribeBatchHttp'
import { createRunLedger } from '../../src/runtime/exec/runLedger'
import { isHeadlessPaidUseAllowed, parseExec } from '../../src/runtime/exec/execArgs'
import { execFetch } from '../../src/runtime/exec/execFetch'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import type { ExecEventBody } from '../../src/runtime/exec/execProtocol'
import type { MediaInfo } from '../../src/shared/media'

const VIDEO: MediaInfo = {
  kind: 'video',
  mediaType: 'video/mp4',
  sizeBytes: 1024,
  durationSeconds: 30,
  hasSoundtrack: true,
}
const SHA = 'a'.repeat(64)

/** A listener the test never triggers. */
function ignore(): void {
  // Nothing to observe on this path.
}

function replayFor(recordFor?: (modelId: string) => ReturnType<typeof resolveModelCapabilities>) {
  return new ReplayMedia('session-1', {
    capabilities: metaMediaCapabilities,
    ...(recordFor !== undefined && { recordFor }),
    codec: responsesMediaCodec,
    ledger: () => {
      throw new Error('no upload in this test')
    },
    compactionTail: () => [],
    attachment: () => ({ name: 'clip.mp4', info: VIDEO, sha256: SHA }),
    source: () => Promise.resolve(undefined),
    authorize: () => Promise.resolve(),
    isCapped: () => false,
    isClosed: () => false,
  })
}

const TRANSCRIBE_URL = `${MODEL_API_BASE_URL}/asr/transcribe?sessionId=123e4567-e89b-12d3-a456-426614174000`

function harness(hasVoice: boolean) {
  const events: ExecEventBody[] = []
  const lifecycle = createLifecycle({
    processStartMs: Date.now(),
    timeoutMs: 30_000,
    now: () => Date.now(),
    setTimer: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    onSignal: () => ignore,
    forceFinish: ignore,
    exit: (code): never => {
      throw new Error(`exit ${String(code)}`)
    },
  })
  const ledger = createRunLedger({ capUsd: Usd.from(10).toAmount(), maxRequests: 5 })
  const seen: string[] = []
  const transport = execFetch({
    fetch: (url) => {
      seen.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url)
      return Promise.resolve(
        Response.json(
          { transcript: 'hello', audioDurationMs: 1000 },
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
    },
    ledger,
    selectedModel: 'muse-spark-1.3-contributor',
    imageGeneration: false,
    voiceTranscription: hasVoice,
    lifecycle,
    onLatch: ignore,
    emit: (event) => {
      events.push(event)
    },
    onResponseStart: ignore,
    onResponseSettled: ignore,
  })
  return { transport, events, lifecycle, ledger, seen }
}

function multipartInit() {
  return {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=muse-transcribe-test' },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('wav-bytes'))
        controller.close()
      },
    }),
    duplex: 'half',
  }
}

describe('the selected model record carries video and hearing (D85.1)', () => {
  it('records the captures per contributor model and unknown elsewhere', () => {
    const hears = metaCapabilityRecord('muse-spark-1.2-contributor')
    expect(hears.modalities.video.state).toBe('yes')
    if (hears.modalities.video.state === 'yes') {
      expect(hears.modalities.video.value.mimes).toEqual(['video/mp4', 'video/quicktime'])
      expect(hears.modalities.video.value.hearsSoundtrack.state).toBe('yes')
      expect(hears.modalities.video.value.maxDurationSeconds).toBe(600)
      expect(hears.modalities.video.value.fps).toEqual({ min: 1, max: 2 })
    }
    expect(hears.modalities.audio.state).toBe('no')
    const deaf = metaCapabilityRecord('muse-spark-1.3-contributor')
    if (deaf.modalities.video.state === 'yes')
      expect(deaf.modalities.video.value.hearsSoundtrack.state).toBe('no')
    const standard = metaCapabilityRecord('muse-spark-1.3')
    expect(standard.modalities.video.state).toBe('unknown')
    expect(standard.modalities.audio.state).toBe('unknown')
  })

  it('projects the record for the gate exactly as the captured table did', () => {
    for (const modelId of ['muse-spark-1.2-contributor', 'muse-spark-1.3-contributor']) {
      const projected = mediaCapabilitiesFromRecord(metaCapabilityRecord(modelId), modelId)
      const captured = metaMediaCapabilities(modelId)
      expect(projected.modalities.video).toMatchObject({
        support: 'yes',
        formats: ['video/mp4', 'video/quicktime'],
        maxDurationSeconds: 600,
        fps: { min: 1, max: 2 },
      })
      expect(projected.modalities.video.hearsSoundtrack).toBe(
        captured.modalities.video.hearsSoundtrack,
      )
      expect(projected.modalities.audio.support).toBe('no')
      expect(projected.files).toBe('yes')
      expect(captured.modalities.video.support).toBe('yes')
    }
    expect(metaMediaCapabilities('muse-spark-1.3').modalities.video.support).toBe('unknown')
  })

  it('gates a video through the record: heard, unheard with warning, unknown refused', () => {
    const hears = mediaCapabilitiesFromRecord(
      metaCapabilityRecord('muse-spark-1.2-contributor'),
      'muse-spark-1.2-contributor',
    )
    expect(modalityGate(VIDEO, hears)).toEqual({ ok: true })
    const deaf = mediaCapabilitiesFromRecord(
      metaCapabilityRecord('muse-spark-1.3-contributor'),
      'muse-spark-1.3-contributor',
    )
    const warned = modalityGate(VIDEO, deaf)
    expect(warned.ok).toBe(true)
    if (warned.ok) expect(warned.soundtrackWarning).toContain('muse-spark-1.3-contributor')
    const unknown = modalityGate(VIDEO, metaMediaCapabilities('muse-spark-1.3'))
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.reason).toContain('muse-spark-1.3')
  })

  it('routes sound from the same record projection the gate reads', () => {
    const deaf = createModelApiAudioContext({
      modelId: 'muse-spark-1.3-contributor',
      canExtractWav: true,
      isVoiceOn: true,
    })
    expect(deaf.model).toMatchObject({ video: 'yes', hearsSoundtrack: 'no', audio: 'no' })
    const unknown = createModelApiAudioContext({
      modelId: 'muse-spark-1.3',
      canExtractWav: true,
      isVoiceOn: true,
    })
    expect(unknown.model).toMatchObject({ video: 'unknown', audio: 'unknown' })
  })
})

describe('the replay prepares through the session record, not the table alone', () => {
  it('admits the part while the selected record takes video', () => {
    const media = replayFor((modelId) => metaCapabilityRecord(modelId))
    const part = media.content(
      { type: 'media', token: 't1', name: 'clip.mp4' },
      { type: 'input_text', text: 'clip' },
      'muse-spark-1.3-contributor',
      new MediaBudget(),
    )
    expect(part.type).toBe('input_text')
  })

  it('refuses in words when the selected record says no, though the table would admit', () => {
    const noVideo = resolveModelCapabilities(
      { provider: 'meta', nativeModel: 'muse-spark-1.3-contributor', format: 'responses' },
      [
        {
          source: { kind: 'user' },
          fields: {
            modalities: {
              video: { state: 'no', source: { kind: 'user' } },
            },
          },
        },
      ],
    )
    const media = replayFor(() => noVideo)
    expect(() =>
      media.content(
        { type: 'media', token: 't1', name: 'clip.mp4' },
        { type: 'input_text', text: 'clip' },
        'muse-spark-1.3-contributor',
        new MediaBudget(),
      ),
    ).toThrow(/muse-spark-1\.3-contributor/u)
  })
})

describe('the run ledger admits transcription like every other paid use', () => {
  const cap = { capUsd: Usd.from(1).toAmount(), maxRequests: 30 }
  // $0.18 per hour: 3600 s reserves exactly 0.18; 1800 s settles 0.09.
  it('reserves the exact bounded cost and settles from the receipt', () => {
    const ledger = createRunLedger(cap)
    const ticket = ledger.admitTranscription(Usd.from('0.18').toAmount())
    if ('refused' in ticket) throw new Error(ticket.refused)
    expect(ticket.reserveUsd).toBe('0.18')
    expect(ledger.hasActiveTranscription()).toBe(true)
    expect(ledger.totals().reservedUsd).toBe('0.18')
    const result = ledger.settleTranscription(ticket, {
      kind: 'returned',
      costUsd: Usd.from('0.09').toAmount(),
    })
    expect(result).toMatchObject({ outcome: 'priced', chargedUsd: '0.09' })
    expect(ledger.hasActiveTranscription()).toBe(false)
    expect(ledger.totals().paid).toMatchObject({
      transcriptionAttempts: 1,
      transcriptionsReturned: 1,
      transcribedSeconds: 1800,
      settledUsd: '0.09',
      uncertainUsd: '0',
    })
    expect(ledger.totals().requests).toBe(1)
  })

  it('refunds a non-send, holds an unknown bill at the full reservation, breaches past it', () => {
    const ledger = createRunLedger(cap)
    const refunded = ledger.admitTranscription(Usd.from('0.18').toAmount())
    if ('refused' in refunded) throw new Error(refunded.refused)
    expect(ledger.settleTranscription(refunded, { kind: 'refunded' })).toMatchObject({
      outcome: 'priced',
      chargedUsd: '0',
    })
    const unknown = ledger.admitTranscription(Usd.from('0.18').toAmount())
    if ('refused' in unknown) throw new Error(unknown.refused)
    expect(ledger.settleTranscription(unknown, { kind: 'unknown' })).toMatchObject({
      outcome: 'full-reservation',
      chargedUsd: '0.18',
    })
    const over = ledger.admitTranscription(Usd.from('0.09').toAmount())
    if ('refused' in over) throw new Error(over.refused)
    expect(
      ledger.settleTranscription(over, { kind: 'returned', costUsd: Usd.from('0.18').toAmount() }),
    ).toMatchObject({ outcome: 'priced', chargedUsd: '0.18', latch: 'breach' })
    expect(ledger.totals().paid).toMatchObject({
      transcriptionAttempts: 3,
      transcriptionsRefunded: 1,
      transcriptionsUncertain: 1,
      transcriptionsReturned: 1,
    })
  })

  it('refuses before dispatch when the run budget cannot hold the cost', () => {
    const ledger = createRunLedger({ capUsd: Usd.from('0.10').toAmount(), maxRequests: 30 })
    expect(ledger.admitTranscription(Usd.from('0.18').toAmount())).toEqual({ refused: 'budget' })
    expect(ledger.totals().requests).toBe(0)
  })
})

describe('headless admission: the flag is the D48 answer (exec)', () => {
  const base = {
    backend: 'modelApi',
    'max-budget-usd': '1',
    'permission-mode': 'acceptEdits',
  }
  it('parses --muse-voice as the voice paid feature under acceptEdits', () => {
    const parsed = parseExec({ ...base, 'muse-voice': true }, ['do it'])
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.options.paidFeatures).toContain('voice')
  })
  it('refuses --muse-voice without acceptEdits, in words', () => {
    const parsed = parseExec({ backend: 'modelApi', 'max-budget-usd': '1', 'muse-voice': true }, [
      'do it',
    ])
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toBe(UI_TEXT.execPaidNeedsEdits)
  })
  it('refuses --muse-voice on the Muse Code backend, naming the flag', () => {
    const parsed = parseExec(
      { backend: 'museCode', 'muse-voice': true, 'permission-mode': 'acceptEdits' },
      ['do it'],
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toContain('--muse-voice')
  })
  it('admits a voice use only with its flag, acceptEdits and budget left', () => {
    const request = { feature: 'voice' } as const
    const remaining = Usd.from('0.50').toAmount()
    expect(
      isHeadlessPaidUseAllowed(
        { paidFeatures: ['voice'], mode: 'acceptEdits' },
        remaining,
        false,
        request,
        false,
      ),
    ).toBe(true)
    expect(
      isHeadlessPaidUseAllowed(
        { paidFeatures: [], mode: 'acceptEdits' },
        remaining,
        false,
        request,
        false,
      ),
    ).toBe(false)
    expect(
      isHeadlessPaidUseAllowed(
        { paidFeatures: ['voice'], mode: 'plan' },
        remaining,
        false,
        request,
        false,
      ),
    ).toBe(false)
    expect(
      isHeadlessPaidUseAllowed(
        { paidFeatures: ['voice'], mode: 'acceptEdits' },
        Usd.from(0).toAmount(),
        false,
        request,
        false,
      ),
    ).toBe(false)
    expect(
      isHeadlessPaidUseAllowed(
        { paidFeatures: ['voice'], mode: 'acceptEdits' },
        remaining,
        false,
        request,
        true,
      ),
    ).toBe(false)
  })
})

describe('the exec transport carries a transcription only under its reservation', () => {
  it('forwards the POST while the flag is on and a reservation is held', async () => {
    const { transport, lifecycle, ledger, seen } = harness(true)
    try {
      const ticket = ledger.admitTranscription(Usd.from('0.18').toAmount())
      if ('refused' in ticket) throw new Error(ticket.refused)
      const response = await transport.fetch(TRANSCRIBE_URL, multipartInit())
      expect(response.status).toBe(200)
      expect(seen).toEqual([TRANSCRIBE_URL])
      ledger.settleTranscription(ticket, {
        kind: 'returned',
        costUsd: Usd.from('0.00005').toAmount(),
      })
      expect(ledger.totals().paid.transcribedSeconds).toBe(1)
    } finally {
      transport.close()
      lifecycle.dispose()
    }
  })

  it('refuses without a held reservation, and without the flag', async () => {
    const unreserved = harness(true)
    try {
      await expect(unreserved.transport.fetch(TRANSCRIBE_URL, multipartInit())).rejects.toThrow(
        UI_TEXT.execRequestShape,
      )
      expect(unreserved.seen).toEqual([])
      expect(
        unreserved.events.some(
          (event) =>
            event.type === 'paid_use' && event.feature === 'voice' && event.phase === 'refused',
        ),
      ).toBe(true)
    } finally {
      unreserved.transport.close()
      unreserved.lifecycle.dispose()
    }
    const unflagged = harness(false)
    try {
      const ticket = unflagged.ledger.admitTranscription(Usd.from('0.18').toAmount())
      if ('refused' in ticket) throw new Error(ticket.refused)
      await expect(unflagged.transport.fetch(TRANSCRIBE_URL, multipartInit())).rejects.toThrow(
        UI_TEXT.execRequestShape,
      )
      expect(unflagged.seen).toEqual([])
    } finally {
      unflagged.transport.close()
      unflagged.lifecycle.dispose()
    }
  })
})

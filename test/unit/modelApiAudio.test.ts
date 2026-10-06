import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { MAX_MODEL_API_TEXT_ATTACHMENT_BYTES, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  FAKE_MODEL_API_KEY,
  fakeModelApi,
  fakeModelApiClientSettings,
} from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'
import { PaidUseConsent, type PaidUseAnswer } from '../../src/core/paid/paidConsent'
import {
  prepareAudioAttachment,
  type AudioPreparationDeps,
} from '../../src/core/voice/transcribeBatch'

async function setup(
  prepareAudioMessage?: ModelApiHostDeps['prepareAudioMessage'],
  onKeyRead?: () => void,
) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const rawBodies: string[] = []
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    apiKey: () => {
      onKeyRead?.()
      return Promise.resolve(FAKE_MODEL_API_KEY)
    },
    fetch: (resource, options) => {
      const pathname = new URL(resource instanceof Request ? resource.url : String(resource))
        .pathname
      if (pathname === '/v1/responses' && typeof options?.body === 'string')
        rawBodies.push(options.body)
      return api.fetch(resource, options)
    },
  })
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client,
      workspaceRoot: '/ws',
      io: memoryToolIo({}, '/ws'),
      log,
    }),
    ...(prepareAudioMessage !== undefined && { prepareAudioMessage }),
  })
  return { api, host, rawBodies, ...(await startWatchedSession(host, '/ws', 'onRequest')) }
}

function expectFailedWithoutDispatch(r: Awaited<ReturnType<typeof setup>>): void {
  expect(r.api.responseBodies()).toEqual([])
  expect(r.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
    terminal: 'failed',
  })
}

describe('M105-A per-message Model API audio preparation port', () => {
  it('uses 1.2 for the entire message and returns to 1.3 for the next turn', async () => {
    let isFirst = true
    const prepare = vi.fn<NonNullable<ModelApiHostDeps['prepareAudioMessage']>>(({ parts }) => {
      if (!isFirst) return Promise.resolve(undefined)
      isFirst = false
      return Promise.resolve({ modelId: 'muse-spark-1.2', parts, assertCurrent: () => undefined })
    })
    const r = await setup(prepare)
    try {
      r.api.script(
        { calls: [{ name: 'get_current_time', arguments: '{}' }] },
        { text: 'heard soundtrack' },
        { text: 'next message' },
      )
      await r.session.sendTurn([{ type: 'text', text: 'hear this soundtrack' }])
      await r.turnDone()
      expect(r.api.responseBodies().map((body) => body['model'])).toEqual([
        'muse-spark-1.2',
        'muse-spark-1.2',
      ])
      expect(r.session.modelId).toBe('muse-spark-1.3')
      expect(r.events).toContainEqual({
        type: 'backendNotice',
        level: 'info',
        text: fill(UI_TEXT.media.useSoundtrackModel, { model: 'muse-spark-1.2' }),
      })
      expect(r.events.some((event) => event.type === 'modelChanged')).toBe(false)
      await r.session.sendTurn([{ type: 'text', text: 'ordinary next message' }])
      await r.turnDone()
      expect(r.api.responseBodies().at(-1)?.['model']).toBe('muse-spark-1.3')
    } finally {
      await r.host.close()
    }
  })

  it('appends the batch transcript as named text on the selected model, never input_audio', async () => {
    const r = await setup(({ parts, modelId }) =>
      Promise.resolve({
        modelId,
        parts: [
          ...parts,
          {
            type: 'textFile',
            name: 'Transcript of speech.wav',
            mediaType: 'text/plain',
            text: 'spoken fixture canary',
            sizeBytes: 21,
          },
        ],
        assertCurrent: () => undefined,
      }),
    )
    try {
      r.api.script({ text: 'heard the text' })
      await r.session.sendTurn([{ type: 'text', text: 'summarize the speech' }])
      await r.turnDone()
      const body = r.api.responseBodies()[0]
      expect(body?.['model']).toBe('muse-spark-1.3')
      expect(JSON.stringify(body?.['input'])).toContain('spoken fixture canary')
      expect(JSON.stringify(body)).not.toContain('input_audio')
      expect(r.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
    } finally {
      await r.host.close()
    }
  })

  it('keeps ordinary requests byte-identical when the optional port returns no media choice', async () => {
    const plain = await setup()
    const port = await setup(() => Promise.resolve(undefined))
    try {
      const bodies = []
      for (const r of [plain, port]) {
        r.api.script({ text: 'ordinary answer' })
        await r.session.sendTurn([{ type: 'text', text: 'ordinary prompt' }])
        await r.turnDone()
        bodies.push(r.rawBodies[0])
      }
      expect(bodies[0]).toBe(bodies[1])
    } finally {
      await plain.host.close()
      await port.host.close()
    }
  })

  it('refuses a held choice after a model switch, including switch-back', async () => {
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const r = await setup(async ({ parts }) => {
      entered.resolve(undefined)
      await released.promise
      return { modelId: 'muse-spark-1.2', parts, assertCurrent: () => undefined }
    })
    try {
      await r.session.sendTurn([{ type: 'text', text: 'with audio' }])
      await entered.promise
      await r.session.setModel('muse-spark-1.2')
      await r.session.setModel('muse-spark-1.3')
      released.resolve(undefined)
      await r.turnDone()
      expectFailedWithoutDispatch(r)
    } finally {
      released.resolve(undefined)
      await r.host.close()
    }
  })

  it('rechecks the prepared fence immediately before dispatch', async () => {
    const state = { hasPrepared: false, isCurrent: true }
    const r = await setup(
      ({ parts, modelId }) => {
        state.hasPrepared = true
        return Promise.resolve({
          modelId,
          parts,
          assertCurrent: () => {
            if (!state.isCurrent) throw new Error('owner changed during key lookup')
          },
        })
      },
      () => {
        if (state.hasPrepared) state.isCurrent = false
      },
    )
    try {
      r.api.script({ text: 'should never send' })
      await r.session.sendTurn([{ type: 'text', text: 'with audio' }])
      await r.turnDone()
      expect(state.isCurrent).toBe(false)
      expectFailedWithoutDispatch(r)
    } finally {
      await r.host.close()
    }
  })

  it('does not invoke audio preparation for a reviewer turn', async () => {
    const prepare = vi.fn<NonNullable<ModelApiHostDeps['prepareAudioMessage']>>(() =>
      Promise.resolve(undefined),
    )
    const r = await setup(prepare)
    try {
      r.api.script({ text: 'review' })
      await r.session.review([{ type: 'text', text: 'review these changes' }], 'review')
      await r.turnDone()
      expect(prepare).not.toHaveBeenCalled()
    } finally {
      await r.host.close()
    }
  })

  it('counts text steered during batch preparation against the same aggregate limit', async () => {
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const text = 'x'.repeat(Math.floor(MAX_MODEL_API_TEXT_ATTACHMENT_BYTES / 2))
    const part = {
      type: 'textFile' as const,
      name: 'transcript.txt',
      mediaType: 'text/plain',
      text,
      sizeBytes: text.length,
    }
    const r = await setup(async ({ parts, modelId }) => {
      entered.resolve(undefined)
      await released.promise
      return { modelId, parts: [...parts, part], assertCurrent: () => undefined }
    })
    try {
      const submitted = await r.session.sendTurn([{ type: 'text', text: 'transcribe' }])
      await entered.promise
      await r.session.steer(submitted.turnId, [part])
      released.resolve(undefined)
      await r.turnDone()
      expectFailedWithoutDispatch(r)
    } finally {
      released.resolve(undefined)
      await r.host.close()
    }
  })

  it('finishes a real session on Stop while batch consent is unanswered and releases the next turn', async () => {
    const entered = Promise.withResolvers<undefined>()
    const answer = Promise.withResolvers<PaidUseAnswer>()
    const reserve = vi.fn<AudioPreparationDeps['reserve']>(() =>
      Promise.reject(new Error('must not reserve before consent')),
    )
    const consent = new PaidUseConsent({
      isOn: () => true,
      windowOnceFeatures: new Set(['voice']),
      canRemember: () => false,
      readGrants: () => new Set(),
      writeGrants: () => Promise.resolve(),
      ask: () => {
        entered.resolve(undefined)
        return answer.promise
      },
      log: new FakeLogOutputChannel(),
    })
    const model = {
      modelId: 'muse-spark-1.3',
      video: 'yes' as const,
      videoFormats: ['video/mp4'],
      hearsSoundtrack: 'no' as const,
      audio: 'no' as const,
      audioFormats: [],
    }
    let isFirst = true
    const r = await setup(async ({ signal, parts, modelId }) => {
      if (!isFirst) return undefined
      isFirst = false
      const prepared = await prepareAudioAttachment(
        {
          name: 'speech.wav',
          pathToken: 'confined-speech',
          info: { kind: 'audio', mediaType: 'audio/wav', sizeBytes: 1000, durationSeconds: 10 },
        },
        'transcribe',
        {
          context: {
            backend: 'modelApi',
            model,
            batchFormats: ['audio/wav'],
            canExtractWav: false,
            canWrapMp4: false,
            isVoiceOn: true,
          },
          assertCurrent: () => undefined,
          gate: { isOn: () => true },
          consent,
          reserve,
          usage: { addVoiceBatch: () => undefined },
          batch: {
            billableSecondsUpperBound: () => 10,
            transcribe: () => Promise.reject(new Error('must not send before consent')),
          },
        },
        signal,
      )
      return {
        modelId,
        parts: [...parts, ...(prepared.transcript === undefined ? [] : [prepared.transcript])],
        assertCurrent: () => undefined,
      }
    })
    try {
      await r.session.sendTurn([{ type: 'text', text: 'transcribe this audio' }])
      await entered.promise
      await r.session.cancel()
      await expect
        .poll(() => r.events.findLast((event) => event.type === 'turnCompleted'))
        .toMatchObject({ terminal: 'cancelled' })
      expect(reserve).not.toHaveBeenCalled()
      expect(r.api.responseBodies()).toEqual([])
      r.api.script({ text: 'next turn runs while the old popup is unanswered' })
      await r.session.sendTurn([{ type: 'text', text: 'next message' }])
      await r.turnDone()
      expect(r.api.responseBodies()).toHaveLength(1)
    } finally {
      answer.resolve('deny')
      await r.host.close()
    }
  })

  it('aborts preparation on Stop without dispatching chat', async () => {
    const entered = Promise.withResolvers<undefined>()
    const r = await setup(async ({ signal, parts, modelId }) => {
      entered.resolve(undefined)
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve()
          },
          { once: true },
        )
      })
      return { modelId, parts, assertCurrent: () => undefined }
    })
    try {
      await r.session.sendTurn([{ type: 'text', text: 'transcribe' }])
      await entered.promise
      await r.session.cancel()
      await r.turnDone()
      expect(r.api.responseBodies()).toEqual([])
      expect(r.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'cancelled',
      })
    } finally {
      await r.host.close()
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import {
  ReplayMedia,
  type ReplayMediaDeps,
  type StoredMediaPart,
} from '../../src/core/media/replayMedia'
import { parseStoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { startWatchedSession, watchSessionTurns } from './helpers/sessionTurns'
import {
  mediaModel,
  replayRig,
  switchingMediaModel,
  uploaded,
  videoMedia,
} from './helpers/media/replay'
import type { MediaModelCapabilities } from '../../src/core/media/modalityGate'
import { buildSessionExport } from '../../src/core/export/sessionTransfer'
import { MEDIA_FILE_ID_MIN_BYTES } from '../../src/shared/constants'

function isTestMissingFile(error: unknown): boolean {
  return error instanceof Error && error.message === 'file missing'
}

async function setup(
  options: {
    model?: (id: string) => MediaModelCapabilities
    authorize?: () => Promise<void>
    media?: StoredMediaPart
    source?: ReplayMediaDeps['source']
  } = {},
) {
  const api = fakeModelApi()
  const transport = vi.spyOn(api, 'fetch')
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, '/ws')
  const client = fakeModelApiClient(api, log)
  const store = memorySessionStore()
  const media = options.media ?? videoMedia()
  const rig = replayRig(media)
  const deps: ModelApiHostDeps = {
    ...fakeModelApiHostDeps({ client, log, io, workspaceRoot: '/ws' }),
    store,
    createMediaReplay: (sessionId) =>
      new ReplayMedia(sessionId, {
        ...rig.deps,
        attachment: (part) =>
          (part.type === 'text' && part.text === 'opaque-media') || part.type === 'image'
            ? media
            : undefined,
        capabilities: options.model ?? mediaModel,
        ...(options.authorize !== undefined && { authorize: options.authorize }),
        ...(options.source !== undefined && { source: options.source }),
      }),
  }
  const host = new ModelApiHost(deps)
  return {
    api,
    transport,
    store,
    host,
    deps,
    rig,
    ...(await startWatchedSession(host, '/ws', 'allowAll')),
  }
}

async function sendMediaTurn(h: Awaited<ReturnType<typeof setup>>): Promise<void> {
  const settled = h.turnDone()
  await h.session.sendTurn([{ type: 'text', text: 'opaque-media' }])
  await settled
}

describe('Model API media integration through injected ports', () => {
  it('preserves restored undelivered media ahead of newer delivered history during host fitting', async () => {
    const h = await setup()
    try {
      await sendMediaTurn(h)
      const snapshot = h.session.snapshot()
      const entry = snapshot.replay.find((entry) => entry.media !== undefined)
      const media = entry?.media?.[0]?.media
      if (media === undefined || entry?.item.type !== 'message')
        throw new Error('Expected saved media message')
      const part = entry.item.content[0]
      if (part === undefined) throw new Error('Expected saved media content')
      const { delivered: _delivered, ...pending } = media
      h.session.adopt({
        ...snapshot,
        replay: [
          { ...entry, turnId: 'pending-old', media: [{ index: 0, media: pending }] },
          {
            ...entry,
            turnId: 'delivered-later',
            item: {
              ...entry.item,
              content: Array.from({ length: 50 }, () => structuredClone(part)),
            },
            media: Array.from({ length: 50 }, (_, index) => ({ index, media })),
          },
        ],
      })
      const done = h.turnDone()
      await h.session.sendTurn([{ type: 'text', text: 'continue' }])
      await done
      const input = h.api.responseBodies().at(-1)?.['input']
      expect(input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            content: [{ type: 'input_text', text: expect.stringContaining('test-upload:') }],
          }),
        ]),
      )
      expect(JSON.stringify(input).match(/test-upload:/gu)).toHaveLength(50)
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
    } finally {
      await h.host.close()
    }
  })

  it('refuses steering that would overfill accepted pending media and delivers every accepted attachment', async () => {
    const h = await setup()
    const hold = Promise.withResolvers<undefined>()
    const requested = Promise.withResolvers<undefined>()
    h.api.script({
      hold: hold.promise,
      onRequest: () => {
        requested.resolve(undefined)
      },
    })
    try {
      const done = h.turnDone()
      const turn = await h.session.sendTurn([{ type: 'text', text: 'hello' }])
      await requested.promise
      const parts = Array.from(
        { length: 26 },
        () => ({ type: 'text', text: 'opaque-media' }) as const,
      )
      expect(await h.session.steer(turn.turnId, parts)).toMatchObject({ disposition: 'steered' })
      await expect(h.session.steer(turn.turnId, parts)).rejects.toThrow('Remove clip.mp4')
      expect(await h.session.steer(turn.turnId, parts.slice(0, 24))).toMatchObject({
        disposition: 'steered',
      })
      expect(h.rig.ensure).not.toHaveBeenCalled()
      hold.resolve(undefined)
      await done
      expect(h.api.responseBodies()).toHaveLength(2)
      expect(JSON.stringify(h.api.responseBodies().at(-1)).match(/test-upload:/gu)).toHaveLength(50)
      expect(h.session.snapshot().replay.flatMap((entry) => entry.media ?? [])).toHaveLength(50)
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
    } finally {
      hold.resolve(undefined)
      await h.host.close()
    }
  })

  it('counts initial undelivered media while admitting steering during authorization', async () => {
    const admission = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const h = await setup({
      authorize: async () => {
        entered.resolve(undefined)
        await admission.promise
      },
    })
    try {
      const done = h.turnDone()
      const parts = Array.from(
        { length: 26 },
        () => ({ type: 'text', text: 'opaque-media' }) as const,
      )
      const turn = await h.session.sendTurn(parts)
      await entered.promise
      await expect(h.session.steer(turn.turnId, parts)).rejects.toThrow('Remove clip.mp4')
      expect(h.api.responseBodies()).toHaveLength(0)
      expect(h.rig.ensure).not.toHaveBeenCalled()
      admission.resolve(undefined)
      await done
      expect(JSON.stringify(h.api.responseBodies()[0]).match(/test-upload:/gu)).toHaveLength(26)
    } finally {
      admission.resolve(undefined)
      await h.host.close()
    }
  })

  it.each([true, false])(
    'forks an inline-only image with approved source availability %s honestly',
    async (available) => {
      const data = new Uint8Array([1, 2, 3])
      const chunk = Promise.resolve(data)
      const media = {
        ...videoMedia(),
        name: 'photo.png',
        sha256: createHash('sha256').update(data).digest('hex'),
        info: { kind: 'image', mediaType: 'image/png', sizeBytes: 3 },
      } as const
      const source = vi.fn(() =>
        Promise.resolve(
          available
            ? {
                name: media.name,
                mime: media.info.mediaType,
                bytes: media.info.sizeBytes,
                open: async function* () {
                  yield await chunk
                },
              }
            : undefined,
        ),
      )
      const h = await setup({
        media,
        source,
        model: (id) => ({ ...mediaModel(id), files: 'no' }),
      })
      try {
        const done = h.turnDone()
        await h.session.sendTurn([
          { type: 'image', base64Data: 'AQID', mediaType: 'image/png', width: 1, height: 1 },
        ])
        await done
        expect(JSON.stringify(h.api.responseBodies()[0])).toContain('base64,AQID')
        expect(source).not.toHaveBeenCalled()
        const fork = await h.host.forkSession(h.session.sessionId, 'muse-spark-1.3')
        const watched = watchSessionTurns(fork.session)
        const forkDone = watched.turnDone()
        await fork.session.sendTurn([{ type: 'text', text: 'describe the attached image' }])
        await forkDone
        const request = JSON.stringify(h.api.responseBodies().at(-1))
        expect(request).toContain(available ? 'base64,AQID' : 'not available — reattach')
        if (!available) expect(request).not.toContain('base64')
        expect(source).toHaveBeenCalled()
        expect(h.rig.ensure).not.toHaveBeenCalled()
        expect(watched.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
          terminal: 'completed',
        })
      } finally {
        await h.host.close()
      }
    },
  )

  it.each([2, MEDIA_FILE_ID_MIN_BYTES + 1])(
    'applies the actual encoding-route limit to an image of %i bytes',
    async (sizeBytes) => {
      const media = {
        ...videoMedia(),
        name: 'photo.png',
        info: { kind: 'image', mediaType: 'image/png', sizeBytes },
      } as const
      const h = await setup({
        media,
        model: (id) => {
          const model = mediaModel(id)
          return {
            ...model,
            modalities: {
              ...model.modalities,
              image: {
                ...model.modalities.image,
                inlineMaxBytes: 1,
                uploadMaxBytes: MEDIA_FILE_ID_MIN_BYTES + 1,
              },
            },
          }
        },
      })
      try {
        const done = h.turnDone()
        await h.session.sendTurn([
          { type: 'image', base64Data: 'AQI=', mediaType: 'image/png', width: 1, height: 1 },
        ])
        await done
        if (sizeBytes === 2) {
          expect(h.api.responseBodies()).toHaveLength(0)
          expect(h.rig.ensure).not.toHaveBeenCalled()
          expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
            terminal: 'failed',
            reason: expect.stringContaining('exceeds'),
          })
        } else {
          expect(h.api.responseBodies()).toHaveLength(1)
          expect(h.rig.ensure).toHaveBeenCalled()
          expect(JSON.stringify(h.api.responseBodies()[0])).toContain('test-upload:')
          expect(JSON.stringify(h.api.responseBodies()[0])).not.toContain('AQI=')
        }
      } finally {
        await h.host.close()
      }
    },
  )

  it('sends byte-identical no-media requests with the media port installed or absent', async () => {
    const capabilities = vi.fn(() => {
      throw new Error('No media capability lookup expected')
    })
    const h = await setup({ model: capabilities })
    const { createMediaReplay: _factory, ...deps } = h.deps
    const baseline = new ModelApiHost(deps)
    try {
      const plain = await startWatchedSession(baseline, '/ws', 'allowAll')
      const mediaDone = h.turnDone()
      await h.session.sendTurn([{ type: 'text', text: 'hello' }])
      await mediaDone
      const plainDone = plain.turnDone()
      await plain.session.sendTurn([{ type: 'text', text: 'hello' }])
      await plainDone
      const bodies = h.transport.mock.calls.flatMap(([input, init]) =>
        new URL(input instanceof Request ? input.url : String(input)).pathname ===
          '/v1/responses' && typeof init?.body === 'string'
          ? [init.body]
          : [],
      )
      expect(bodies).toHaveLength(2)
      expect(bodies[0]).toBe(bodies[1])
      expect(capabilities).not.toHaveBeenCalled()
      expect(h.rig.authorize).not.toHaveBeenCalled()
      expect(h.rig.ensure).not.toHaveBeenCalled()
    } finally {
      await baseline.close()
      await h.host.close()
    }
  })

  it('retains pre-existing F references and refuses a media session when its adapter is missing', async () => {
    const h = await setup()
    const legacy = uploaded(videoMedia(), 'file-legacy')
    h.session.adopt({ ...h.session.snapshot(), fileRefs: [legacy] })
    expect(h.session.snapshot().fileRefs).toEqual([legacy])
    const done = h.turnDone()
    await h.session.sendTurn([{ type: 'text', text: 'opaque-media' }])
    await done
    const sessionId = h.session.sessionId
    await h.host.close()
    const { createMediaReplay: _factory, ...deps } = h.deps
    const unbound = new ModelApiHost(deps)
    try {
      await unbound.load()
      await expect(unbound.resumeSession(sessionId, 'muse-spark-1.3')).rejects.toThrow(
        'media replay',
      )
    } finally {
      await unbound.close()
    }
  })
  it.each([1, 2_000_000])(
    'compacts an image of %i bytes as metadata and preserves its uploaded tail on continuation',
    async (sizeBytes) => {
      const media = {
        ...videoMedia(),
        name: 'photo.png',
        info: { kind: 'image', mediaType: 'image/png', sizeBytes },
      } as const
      const h = await setup({ media })
      try {
        const done = h.turnDone()
        const submitted = await h.session.sendTurn([
          {
            type: 'image',
            base64Data: 'MEDIA_BYTE_CANARY',
            mediaType: 'image/png',
            width: 1,
            height: 1,
          },
        ])
        await done
        const images = h.session.sentImages(submitted.turnId, submitted.userMessageId ?? '')
        if (sizeBytes === 1) {
          expect(images).toEqual([{ mediaType: 'image/png', base64Data: 'MEDIA_BYTE_CANARY' }])
          expect(JSON.stringify(h.api.responseBodies()[0])).toContain('MEDIA_BYTE_CANARY')
        } else {
          expect(images).toEqual([])
          expect(JSON.stringify(h.api.responseBodies()[0])).not.toContain('MEDIA_BYTE_CANARY')
        }
        expect(await h.session.compact()).toMatchObject({ status: 'accepted' })
        const summary = JSON.stringify(h.api.responseBodies().at(-1))
        expect(summary).toContain('Media: photo.png')
        expect(summary).not.toContain('MEDIA_BYTE_CANARY')
        const continued = h.turnDone()
        await h.session.sendTurn([{ type: 'text', text: 'continue' }])
        await continued
        const final = JSON.stringify(h.api.responseBodies().at(-1))
        expect(final).toContain('test-upload:file-clip:image/png')
        expect(final).not.toContain('MEDIA_BYTE_CANARY')
        expect(h.session.snapshot().fileRefs).toEqual([uploaded(media)])
        expect(h.session.sentImages(submitted.turnId, submitted.userMessageId ?? '')).toEqual([])
      } finally {
        await h.host.close()
      }
    },
  )
  it('dispatches uploaded references, saves metadata-only history and preserves IDs across model switches and forks', async () => {
    const h = await setup({
      model: switchingMediaModel,
    })
    try {
      await sendMediaTurn(h)
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      const snapshot = h.session.snapshot()
      expect(snapshot.fileRefs).toEqual([uploaded(videoMedia())])
      expect(parseStoredSession(snapshot).ok).toBe(true)
      expect(JSON.stringify(snapshot.replay)).not.toContain('opaque-media')
      const exported = await buildSessionExport(
        {
          backend: 'modelApi',
          modelId: h.session.modelId,
          exportedAt: '2026-10-06T00:00:00.000Z',
          items: snapshot.transcript.map((entry) => entry.item),
        },
        { redact: true, localRoots: ['/ws'] },
      )
      expect(JSON.stringify(exported.doc)).toContain('clip.mp4')
      expect(JSON.stringify(exported.doc)).not.toContain('file-clip')
      expect(JSON.stringify(exported.doc)).not.toContain('MEDIA_BYTE_CANARY')
      const first = JSON.stringify(h.api.responseBodies()[0])
      expect(first).toContain('test-upload:file-clip:video/mp4')
      expect(first).not.toContain('opaque-media')
      await h.session.setModel('text-only')
      const switched = h.turnDone()
      await h.session.sendTurn([{ type: 'text', text: 'next' }])
      await switched
      expect(JSON.stringify(h.api.responseBodies().at(-1))).toContain(
        'text-only does not take video',
      )
      await h.session.setModel('muse-spark-1.3')
      const returned = h.turnDone()
      await h.session.sendTurn([{ type: 'text', text: 'back' }])
      await returned
      expect(JSON.stringify(h.api.responseBodies().at(-1))).toContain(
        'test-upload:file-clip:video/mp4',
      )
      const fork = await h.host.forkSession(h.session.sessionId, 'muse-spark-1.3')
      if (!(fork.session instanceof ModelApiSession)) throw new Error('expected Model API fork')
      expect(fork.session.snapshot().fileRefs).toEqual(snapshot.fileRefs)
      const watched = watchSessionTurns(fork.session)
      const forked = watched.turnDone()
      await fork.session.sendTurn([{ type: 'text', text: 'forked' }])
      await forked
      expect(JSON.stringify(h.api.responseBodies().at(-1))).toContain(
        'test-upload:file-clip:video/mp4',
      )
    } finally {
      await h.host.close()
    }
  })

  it('refuses unknown video and 51 fresh videos before a model request or upload', async () => {
    const unknown = await setup({
      model: (id) => {
        const model = mediaModel(id)
        return {
          ...model,
          modalities: { ...model.modalities, video: { support: 'unknown', formats: [] } },
        }
      },
    })
    try {
      const done = unknown.turnDone()
      await unknown.session.sendTurn([{ type: 'text', text: 'opaque-media' }])
      await done
      expect(unknown.api.responseBodies()).toHaveLength(0)
      expect(unknown.rig.ensure).not.toHaveBeenCalled()
      expect(unknown.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'failed',
        reason: expect.stringContaining('not known to take video'),
      })
    } finally {
      await unknown.host.close()
    }
    const many = await setup()
    try {
      const done = many.turnDone()
      await many.session.sendTurn(
        Array.from({ length: 51 }, () => ({ type: 'text', text: 'opaque-media' })),
      )
      await done
      expect(many.api.responseBodies()).toHaveLength(0)
      expect(many.rig.ensure).not.toHaveBeenCalled()
      expect(many.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'failed',
        reason: expect.stringContaining('Remove clip.mp4'),
      })
    } finally {
      await many.host.close()
    }
  })

  it('recovers a captured missing-file error once, but does not retry a second missing-file error', async () => {
    const h = await setup()
    let failures = 0
    h.rig.deps.codec.isMissingFile = isTestMissingFile
    h.api.script({
      httpError: { status: 400, body: { error: { message: 'file missing' } } },
      onRequest: () => {
        failures += 1
        h.rig.ensure.mockResolvedValue(uploaded(videoMedia(), `file-replaced-${String(failures)}`))
      },
    })
    try {
      await sendMediaTurn(h)
      expect(h.api.responseBodies()).toHaveLength(2)
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'failed',
      })
    } finally {
      await h.host.close()
    }
  })

  it('does not add a missing-file retry after the shared HTTP retry budget is exhausted', async () => {
    const h = await setup()
    h.rig.deps.codec.isMissingFile = isTestMissingFile
    h.api.script(...Array.from({ length: 4 }, () => ({ httpError: { status: 503 } })), {
      httpError: { status: 400, body: { error: { message: 'file missing' } } },
      onRequest: () => {
        h.rig.ensure.mockResolvedValue(uploaded(videoMedia(), 'file-replaced'))
      },
    })
    try {
      await sendMediaTurn(h)
      expect(h.api.responseBodies()).toHaveLength(5)
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'failed',
      })
    } finally {
      await h.host.close()
    }
  })

  it('rechecks a model change during admission and never sends media to the new unsupported model', async () => {
    const admission = Promise.withResolvers<undefined>()
    const blocked = Promise.withResolvers<undefined>()
    const authorize = vi.fn(async () => {
      blocked.resolve(undefined)
      await admission.promise
    })
    const h = await setup({
      authorize,
      model: switchingMediaModel,
    })
    try {
      const done = h.turnDone()
      await h.session.sendTurn([{ type: 'text', text: 'opaque-media' }])
      await blocked.promise
      await h.session.setModel('text-only')
      admission.resolve(undefined)
      await done
      expect(h.api.responseBodies()).toHaveLength(1)
      expect(h.api.responseBodies()[0]?.['model']).toBe('text-only')
      expect(JSON.stringify(h.api.responseBodies()[0])).not.toContain('test-upload:')
    } finally {
      admission.resolve(undefined)
      await h.host.close()
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createModelApiHost } from '../../src/host/backend/modelApiEntry'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import type { ScheduleRunDeps } from '../../src/core/schedules/unattended'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import {
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_ACCOUNT_ID,
  FAKE_MODEL_API_BASE_URL,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { startWatchedSession } from './helpers/sessionTurns'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import { unattendedRun } from './helpers/schedules/unattended'
import { videoMedia } from './helpers/media/replay'

// No replay, codec, calibration or upload port is injected into the production factory.
describe('the production Model API factory while verified upload bindings are unavailable', () => {
  it.each([
    { kind: 'video', hasReader: true },
    { kind: 'audio', hasReader: true },
    { kind: 'video', hasReader: false },
    { kind: 'audio', hasReader: false },
  ] as const)(
    'honestly refuses scheduled $kind (reader=$hasReader) before any upload',
    async ({ kind, hasReader }) => {
      const api = fakeModelApi()
      const transport = vi.spyOn(api, 'fetch')
      const log = new FakeLogOutputChannel()
      const io = memoryToolIo({}, '/ws')
      const video = videoMedia()
      const info =
        kind === 'video'
          ? video.info
          : {
              kind: 'audio' as const,
              mediaType: 'audio/wav' as const,
              sizeBytes: video.info.sizeBytes,
              durationSeconds: video.info.durationSeconds,
            }
      const name = kind === 'video' ? 'clip.mp4' : 'sound.wav'
      const chunk = Promise.resolve(new Uint8Array(1))
      const readMedia = vi.fn<NonNullable<ToolIo['readMedia']>>(
        (_path, _max, _expected, _signal, observe) => {
          observe?.({
            kind: 'file',
            contentHash: video.sha256,
            file: { path: `/ws/${name}`, dev: '1', ino: '2', size: info.sizeBytes, mtime: '3' },
          })
          return Promise.resolve({
            info,
            sha256: video.sha256,
            source: {
              name,
              mime: info.mediaType,
              bytes: info.sizeBytes,
              open: async function* () {
                yield await chunk
              },
            },
          })
        },
      )
      if (hasReader) Object.assign(io, { readMedia })
      const host = await createModelApiHost({
        uiText: EN,
        uiLocale: 'en',
        client: { ...fakeModelApiClientSettings(log), fetch: api.fetch },
        host: {
          ...fakeModelApiHostDeps({
            client: fakeModelApiClient(api, log),
            log,
            io,
            workspaceRoot: '/ws',
          }),
          store: memorySessionStore(),
          isPaidFeatureOn: () => true,
        },
        hookSettingsPath: undefined,
        createMcpServers: undefined,
      })
      const reserve = vi.fn<NonNullable<ScheduleRunDeps['paid']>['reserve']>(
        (_body, _tokens, _signal, admitted) => {
          const amount = admitted ?? Usd.from(1).toAmount()
          return Promise.resolve({
            claimId: 'fake-fire',
            reservedUsd: amount,
            check: () => ({ spentUsd: amount, hasUnknownHistoricalFees: false }),
            settle: (cost: UsdAmount) =>
              Promise.resolve({ spentUsd: cost, hasUnknownHistoricalFees: false }),
          })
        },
      )
      try {
        const h = await startWatchedSession(host, '/ws', 'allowAll')
        const context = fakeRunContext(
          fakeSchedule({ grant: { rules: [], destinationIds: [], paidCapUsd: 1 } }),
        )
        const { run } = unattendedRun({
          context,
          io,
          workspaceRoot: '/ws',
          paid: {
            modelId: 'muse-spark-1.3',
            accountId: FAKE_MODEL_API_ACCOUNT_ID,
            allows: () => true,
            reserve,
          },
        })
        api.script(
          {
            calls: [
              {
                name: 'read_file',
                arguments: JSON.stringify({ path: name }),
                callId: 'scheduled-read',
              },
            ],
          },
          { text: 'The media could not be read.' },
        )
        const done = h.turnDone()
        await h.session.sendScheduledTurn([{ type: 'text', text: `Read ${name}` }], run)
        await done
        const followup = JSON.stringify(api.responseBodies()[1])
        expect(followup).toContain(UI_TEXT.scheduledMediaUnavailable)
        expect(followup).not.toContain('file-clip')
        expect(h.session.snapshot().replay.every((entry) => entry.media === undefined)).toBe(true)
        expect(api.responseBodies()).toHaveLength(2)
        expect(transport.mock.calls.map(([url]) => url)).toEqual([
          `${FAKE_MODEL_API_BASE_URL}/responses`,
          `${FAKE_MODEL_API_BASE_URL}/responses`,
        ])
        expect(readMedia).toHaveBeenCalledTimes(hasReader ? 1 : 0)
        expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
          terminal: 'completed',
        })
      } finally {
        await host.close()
      }
    },
  )
})

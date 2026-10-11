import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { createScheduleDeliveryBinding } from '../../src/host/schedules/deliveryBinding'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost } from './helpers/fakeMsp'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeSchedule, quietScheduleDelivery } from './helpers/schedules/fixtures'
import { FakeScheduleBackground } from './helpers/schedules/background'
import { MemoryScheduleFs, memoryScheduleQueue } from './helpers/schedules/storage'

describe('native scheduled parallel overlap', () => {
  it.each(['manual', 'plan', 'acceptEdits', 'auto'] as const)(
    'settles the second background fire while the first native turn is still running in %s',
    async (mode) => {
      const protocol = fakeMspHost()
      const host = new MuseCodeHost(protocol.host, new FakeLogOutputChannel())
      const root = process.cwd()
      const key = workspaceKey(root)
      const lifetime = new AbortController()
      let sequence = 0
      protocol.server.handle('session/start', () => ({
        session: {
          sessionId: `session-${String(++sequence)}`,
          modelId: 'muse-spark-1.3',
          status: 'idle',
        },
        viewCursor: '',
      }))
      protocol.server.handle('session/setApprovalMode', (params) => ({
        commandId: params['commandId'],
        status: 'accepted',
      }))
      protocol.server.handle('session/rename', (params) => ({
        commandId: params['commandId'],
        status: 'accepted',
        name: params['name'],
      }))
      protocol.server.handle('turn/start', (params) => ({
        commandId: params['commandId'],
        turnId: `turn-${String(params['sessionId'])}`,
        status: 'accepted',
        disposition: 'started',
        startedNewTurn: true,
      }))
      protocol.server.followWith('turn/start', (params) =>
        params['sessionId'] === 'session-2'
          ? [
              {
                jsonrpc: '2.0',
                method: 'turn/completed',
                params: {
                  sessionId: 'session-2',
                  turnId: 'turn-session-2',
                  terminal: 'completed',
                  viewCursor: 'v',
                },
              },
            ]
          : [],
      )
      const unpublish = vi.fn<() => void>()
      const publish = vi.fn(() => unpublish)
      const fs = new MemoryScheduleFs()
      const engine = createScheduleEngine({
        fs,
        queue: memoryScheduleQueue(fs),
        now: () => fakeSchedule().nextFireAtMs ?? 0,
        delivery: (authority) =>
          createScheduleDeliveryBinding(
            {
              workspaceRoot: root,
              platform: process.platform,
              dialect: process.platform === 'win32' ? 'powershell' : 'bash',
              io: memoryToolIo({}, root),
              signal: lifetime.signal,
              isActive: () => true,
              host: () => Promise.resolve(host),
              ...quietScheduleDelivery(root),
              publish,
              findLive: () => undefined,
            },
            authority,
          ),
        backgroundEntry: new FakeScheduleBackground(),
      })
      const release = await engine.runtime.holdWorkspace(root)
      try {
        for (const id of ['first', 'second'])
          await engine.store.create(
            fakeSchedule({
              mode,
              id,
              workspaceKey: key,
              target: { kind: 'newConversation', backend: 'museCode' },
              delivery: 'newConversation',
              parallel: true,
            }),
          )
        const polling = engine.scheduler.poll(key)
        await vi.waitFor(async () => {
          expect(await engine.store.fires(key)).toHaveLength(1)
        })
        expect(publish).toHaveBeenCalledTimes(2)
        const firstFires = await engine.store.fires(key)
        expect(firstFires[0]).toMatchObject({
          scheduleId: 'second',
          outcome: 'ran',
        })
        protocol.server.notify('turn/completed', {
          sessionId: 'session-1',
          turnId: 'turn-session-1',
          terminal: 'completed',
          viewCursor: 'v',
        })
        await polling
        await vi.waitFor(async () => {
          expect(await engine.store.fires(key)).toHaveLength(2)
        })
        const fires = await engine.store.fires(key)
        expect(fires.every((fire) => fire.outcome === 'ran')).toBe(true)
      } finally {
        lifetime.abort()
        await release()
        await engine.runtime.close()
        await host.close()
      }
    },
  )
})

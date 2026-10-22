// C-M115-4 through the real engine: a schedule that runs publishes its
// settlement to the agents hub, and a schedule triggered on turnFinished
// fires from it — while a schedule never refires on its own settlement,
// so the chain ends.
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { noScheduleCost, type ScheduleV2 } from '../../src/shared/scheduleV2'
import type { ScheduleEvent } from '../../src/shared/scheduleEvents'
import type { ScheduleDeliverySession } from '../../src/core/schedules/delivery'
import { hostEventHub } from '../../src/core/schedules/events/hostHub'
import { scheduleStorageHash } from '../../src/core/schedules/store'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { scheduleFixture } from './helpers/scheduleFixtures'

const folders: string[] = []
afterEach(async () => {
  while (folders.length > 0) {
    const folder = folders.pop()
    if (folder !== undefined) await rm(folder, { recursive: true, force: true })
  }
})

async function tempDir(prefix: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), prefix))
  folders.push(folder)
  return folder
}

function session(sessionId: string): ScheduleDeliverySession {
  return {
    backend: 'modelApi',
    sessionId,
    isRunning: () => false,
    isOpen: () => true,
    steer: () => Promise.resolve(undefined),
    cancel: () => Promise.resolve(undefined),
    queue: () => Promise.resolve('msg-0'),
    withdraw: () => Promise.resolve(true),
    send: () => Promise.resolve(undefined),
    waitUntilIdle: () => Promise.resolve(true),
    queueWhenIdle: () => Promise.resolve('msg-1'),
  }
}

describe('event chaining through the engine', () => {
  it('runs a follower when its leader settles, then stops', async () => {
    const root = await tempDir('schedule-event-engine-')
    const workspace = await tempDir('schedule-event-ws-')
    const key = workspaceKey(workspace)
    let nowMs = 1_700_000_100_000
    const reported: unknown[] = []
    const engine = await createScheduleEngine({
      fs: createNodeScheduleFs(root),
      queue: createNodeScheduleQueue(root),
      now: () => nowMs,
      onError: (error: unknown) => {
        reported.push(error)
      },
      delivery: () => ({
        targets: {
          find: () => Promise.resolve(undefined),
          open: () => Promise.reject(new Error('no open target in this test')),
          fresh: (schedule: ScheduleV2) =>
            Promise.resolve({
              session: session(`fresh-${schedule.id}`),
              release: () => Promise.resolve(undefined),
            }),
        },
        runs: {
          run: async (_session, _schedule, _context, dispatch) => {
            await dispatch()
            return { outcome: 'ran' as const, refusedActions: [], cost: noScheduleCost() }
          },
        },
        prompt: (schedule: ScheduleV2) => {
          if (schedule.action.kind !== 'prompt') throw new Error('prompt only in this test')
          return schedule.action.prompt
        },
      }),
    })
    const published: ScheduleEvent[] = []
    const subscription = hostEventHub(key, 'agents', ['turnFinished']).subscribe((event) => {
      published.push(event)
    })
    try {
      const release = await engine.runtime.holdWorkspace(workspace)
      try {
        await engine.store.create(
          scheduleFixture({
            id: 'schedule-leader',
            workspaceKey: key,
            delivery: 'newConversation',
            trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 1_699_996_500_000 },
            target: { kind: 'newConversation', backend: 'modelApi' },
          }),
        )
        await engine.store.create(
          scheduleFixture({
            id: 'schedule-follower',
            workspaceKey: key,
            delivery: 'newConversation',
            trigger: { kind: 'event', source: 'agents', event: 'turnFinished', conditions: [] },
            target: { kind: 'newConversation', backend: 'modelApi' },
          }),
        )
        await engine.pollWorkspace(key)
        const firstFires = await engine.store.fires(key)
        const leader = firstFires.filter((fire) => fire.scheduleId === 'schedule-leader')
        expect(leader).toHaveLength(1)
        expect(leader[0]?.outcome).toBe('ran')
        expect(published).toHaveLength(1)
        expect(published[0]?.fields['scheduleId']).toBe('schedule-leader')
        // The follower's burst is claimed asynchronously; its file proves it.
        const claim = path.join(
          root,
          key,
          'events',
          `${scheduleStorageHash('schedule-follower')}.json`,
        )
        for (let attempt = 0; attempt < 200 && !existsSync(claim); attempt += 1) {
          await delay(25)
        }
        expect(existsSync(claim)).toBe(true)
        nowMs += 35_000
        await engine.pollWorkspace(key)
        const secondFires = await engine.store.fires(key)
        const follower = secondFires.filter((fire) => fire.scheduleId === 'schedule-follower')
        expect(follower).toHaveLength(1)
        expect(follower[0]?.outcome).toBe('ran')
        expect(follower[0]?.event?.kind).toBe('turnFinished')
        expect(published).toHaveLength(2)
        // The follower's own settlement never refires it: one more matured
        // round settles nothing new.
        nowMs += 120_000
        await engine.pollWorkspace(key)
        expect(await engine.store.fires(key)).toHaveLength(2)
        expect(reported).toEqual([])
      } finally {
        await release()
      }
    } finally {
      subscription.dispose()
      await engine.runtime.close()
    }
  })
})

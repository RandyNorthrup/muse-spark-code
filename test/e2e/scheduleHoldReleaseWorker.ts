import process from 'node:process'
import path from 'node:path'
import * as z from 'zod/mini'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { SCHEDULE_POLL_INTERVAL_MS } from '../../src/shared/constants'
import { fakeSchedule } from '../unit/helpers/schedules/fixtures'
import { IdleScheduleSession } from '../unit/helpers/schedules/session'
import { noScheduleCost } from '../../src/shared/scheduleV2'
import { FakeScheduleBackground } from '../unit/helpers/schedules/background'

// R1 regression with real processes on one real journal. B delivers fire 1 on
// a target and goes idle holding the workspace. A then admits fire 2 on the
// same target, releases its workspace hold WITHOUT closing, and drains: the
// fire must stay pending and be delivered exactly once, by B.
async function main() {
  const [root, role] = process.argv.slice(2)
  if (root === undefined || role === undefined) throw new Error('missing hold worker arguments')
  const cwd = path.join(root, 'workspace')
  const key = workspaceKey(cwd)
  // Test-only: the engine's background tick would race this choreography (a
  // tick can admit and drain before the scripted poll). Suppress it; every
  // poll below is explicit. Clearing the suppressed handle is a harmless no-op.
  const realSetInterval = globalThis.setInterval
  Object.defineProperty(globalThis, 'setInterval', {
    configurable: true,
    writable: true,
    value: (fn: () => void, ms: number, ...args: unknown[]) =>
      ms === SCHEDULE_POLL_INTERVAL_MS
        ? { unref: () => undefined, ref: () => undefined }
        : (realSetInterval as (...values: unknown[]) => unknown)(fn, ms, ...args),
  })
  const now = fakeSchedule().nextFireAtMs!
  const session = new IdleScheduleSession('modelApi')
  let isFirstRun = true
  let releaseHold: (() => Promise<void>) | undefined
  // The hold runs one poll immediately, while the deliverer's fire is still
  // mid-flight. That early drain must not enter the message protocol (it
  // would steal 'poll-now' or emit a stray 'draining'), so it is dropped:
  // the rows stay on disk and the armed drain re-reads them. The protocol
  // arms only once the test sends 'poll-now'.
  let isProtocolArmed = false
  const engine = createScheduleEngine({
    fs: createNodeScheduleFs(root),
    queue:
      role === 'releaser'
        ? {
            serialize: async (targetKey: string, work: () => Promise<void>) => {
              if (!isProtocolArmed) return
              process.send?.({ phase: 'draining' })
              await new Promise<void>((resolve) =>
                process.once('message', (input: unknown) => {
                  z.literal('release').parse(input)
                  resolve()
                }),
              )
              // Release the workspace hold WITHOUT closing, then drain.
              await releaseHold?.()
              releaseHold = undefined
              process.send?.({ phase: 'released' })
              const queue = createNodeScheduleQueue(root)
              await queue.serialize(targetKey, work)
            },
          }
        : createNodeScheduleQueue(root),
    now: () => now,
    backgroundEntry: new FakeScheduleBackground(),
    delivery: () => ({
      targets: {
        find: () => Promise.resolve({ session, release: () => Promise.resolve() }),
        open: () => Promise.reject(new Error('unused open')),
        fresh: () => Promise.reject(new Error('unused fresh')),
      },
      runs: {
        run: async (
          _session: unknown,
          schedule: { id: string },
          _context: unknown,
          dispatch: () => Promise<void>,
        ) => {
          await dispatch()
          if (role === 'deliverer' && isFirstRun) {
            isFirstRun = false
            process.send?.({ phase: 'blocked' })
            await new Promise<void>((resolve) =>
              process.once('message', (input: unknown) => {
                z.literal('resume').parse(input)
                resolve()
              }),
            )
          }
          process.send?.({ phase: 'sent', id: schedule.id })
          return { outcome: 'ran', refusedActions: [], cost: noScheduleCost() }
        },
      },
      prompt: () => 'scheduled test prompt',
    }),
  })
  if (role === 'deliverer') {
    const job = fakeSchedule({ id: 'fire-1', workspaceKey: key, catchUp: 'runOnce' })
    await engine.store.create(job)
    const release = await engine.runtime.holdWorkspace(cwd)
    const polling = engine.pollWorkspace(key)
    // Fire 1 delivered; the drain loop re-reads and finds nothing else yet.
    await polling
    process.send?.({ phase: 'idle' })
    // Stay alive holding the workspace while the releaser lets go of its hold.
    await new Promise<void>((resolve) =>
      process.once('message', (input: unknown) => {
        z.literal('recover').parse(input)
        resolve()
      }),
    )
    await engine.pollWorkspace(key)
    const fires = await engine.store.fires(key)
    process.send?.({ phase: 'done', fires })
    await release()
  } else {
    await new Promise<void>((resolve) =>
      process.once('message', (input: unknown) => {
        z.literal('go').parse(input)
        resolve()
      }),
    )
    releaseHold = await engine.runtime.holdWorkspace(cwd)
    const job = fakeSchedule({ id: 'fire-2', workspaceKey: key, catchUp: 'runOnce' })
    await engine.store.create(job)
    process.send?.({ phase: 'created' })
    await new Promise<void>((resolve) =>
      process.once('message', (input: unknown) => {
        z.literal('poll-now').parse(input)
        resolve()
      }),
    )
    isProtocolArmed = true
    const polling = engine.pollWorkspace(key)
    await polling
    process.send?.({ phase: 'done' })
  }
  await engine.runtime.close()
  process.disconnect()
}
void main().catch((error: unknown) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})

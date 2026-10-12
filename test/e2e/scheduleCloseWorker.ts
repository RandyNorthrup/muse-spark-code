import process from 'node:process'
import path from 'node:path'
import * as z from 'zod/mini'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { fakeSchedule } from '../unit/helpers/schedules/fixtures'
import { IdleScheduleSession } from '../unit/helpers/schedules/session'
import { noScheduleCost } from '../../src/shared/scheduleV2'
import { FakeScheduleBackground } from '../unit/helpers/schedules/background'

async function main() {
  const [root, role] = process.argv.slice(2)
  if (root === undefined || role === undefined) throw new Error('missing close worker arguments')
  const cwd = path.join(root, 'workspace')
  const job = fakeSchedule({ workspaceKey: workspaceKey(cwd) })
  const resume = Promise.withResolvers<undefined>()
  const session = new IdleScheduleSession('modelApi')
  const engine = createScheduleEngine({
    fs: createNodeScheduleFs(root),
    queue:
      role === 'owner'
        ? {
            serialize: async (_key, work) => {
              process.send?.({ phase: 'admitted' })
              await resume.promise
              await work()
            },
          }
        : createNodeScheduleQueue(root),
    now: () => job.nextFireAtMs!,
    backgroundEntry: new FakeScheduleBackground(),
    delivery: () => ({
      targets: {
        find: () => Promise.resolve({ session, release: () => Promise.resolve() }),
        open: () => Promise.reject(new Error('unused open')),
        fresh: () => Promise.reject(new Error('unused fresh')),
      },
      runs: {
        run: async (_session, _schedule, _context, dispatch) => {
          await dispatch()
          process.send?.({ phase: 'sent' })
          return { outcome: 'ran', refusedActions: [], cost: noScheduleCost() }
        },
      },
      prompt: () => 'scheduled test prompt',
    }),
  })
  if (role === 'owner') {
    await engine.store.create(job)
    process.on('message', (input: unknown) => {
      z.literal('resume').parse(input)
      resume.resolve(undefined)
    })
    await engine.runtime.holdWorkspace(cwd)
    await engine.pollWorkspace(job.workspaceKey)
    const fires = await engine.store.fires(job.workspaceKey)
    process.send?.({ phase: 'done', fires })
    await engine.runtime.close()
  } else {
    process.send?.({ phase: 'ready' })
    await new Promise<void>((resolve) =>
      process.once('message', (input: unknown) => {
        z.literal('close').parse(input)
        resolve()
      }),
    )
    await engine.runtime.close()
    process.send?.({ phase: 'closed' })
  }
  process.disconnect()
}
void main().catch((error: unknown) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})

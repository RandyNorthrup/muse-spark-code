// A real scheduler process, with delivery faked only beyond the durable claim.
import { appendFile } from 'node:fs/promises'
import process from 'node:process'
import * as z from 'zod/mini'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { noScheduleCost } from '../../src/shared/scheduleV2'
import { IdleScheduleSession } from '../unit/helpers/schedules/session'
import { fakeSchedule } from '../unit/helpers/schedules/fixtures'

const [dataDir, cwd, receipt, holder] = z
  .tuple([z.string(), z.string(), z.string(), z.enum(['window-1', 'window-2', 'acp'])])
  .parse(process.argv.slice(2))
const session = new IdleScheduleSession('museCode')
const lease = { session, release: () => Promise.resolve() }
const engine = createScheduleEngine({
  fs: createNodeScheduleFs(dataDir),
  queue: createNodeScheduleQueue(dataDir),
  now: () => fakeSchedule().nextFireAtMs ?? 0,
  delivery: () => ({
    targets: {
      find: () => Promise.resolve(lease),
      open: () => Promise.resolve(lease),
      fresh: () => Promise.resolve(lease),
    },
    prompt: () => 'fake process-boundary delivery',
    runs: {
      run: async (_session, _schedule, context, dispatch) => {
        await appendFile(receipt, `${JSON.stringify({ holder, runId: context.runId })}\n`)
        await dispatch()
        session.idleNow()
        return { outcome: 'ran', refusedActions: [], cost: noScheduleCost() }
      },
    },
  }),
  backgroundEntry: {
    status: () => Promise.resolve({ registered: false }),
    register: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  },
})

async function start() {
  const release = await engine.runtime.holdWorkspace(cwd)
  process.send?.({ phase: 'ready', holder })
  process.on('message', (input: unknown) => {
    const message = z.enum(['poll', 'close']).parse(input)
    void (async () => {
      if (message === 'close') {
        await release()
        await engine.runtime.close()
        process.disconnect()
        return
      }
      await engine.scheduler.poll(workspaceKey(cwd))
      process.send?.({ phase: 'settled', holder })
    })().catch(fail)
  })
}
async function fail(error: unknown): Promise<void> {
  process.stderr.write(String(error))
  process.exitCode = 1
  try {
    await engine.runtime.close()
  } finally {
    if (process.connected) process.disconnect()
  }
}
void start().catch(fail)

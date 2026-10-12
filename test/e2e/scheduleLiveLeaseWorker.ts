import process from 'node:process'
import * as z from 'zod/mini'
import { createScheduler } from '../../src/core/schedules/scheduler'
import { createScheduleStore } from '../../src/core/schedules/store'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { noScheduleCost } from '../../src/shared/scheduleV2'
import { fakeSchedule } from '../unit/helpers/schedules/fixtures'

async function main() {
  const [root, role] = process.argv.slice(2)
  if (root === undefined || role === undefined) throw new Error('missing lease worker arguments')
  const store = createScheduleStore(createNodeScheduleFs(root))
  const job = fakeSchedule()
  const intent = {
    schedule: job,
    runId: `${job.id}:${String(job.nextFireAtMs)}`,
    occurrenceMs: job.nextFireAtMs!,
    advancesTime: true,
  }
  const resume = Promise.withResolvers<undefined>()
  const queueFs = createNodeScheduleFs(root)
  const replace = queueFs.replace.bind(queueFs)
  queueFs.replace = async (file, content, guard) => {
    // Simulate a stopped event loop's heartbeat only; the real target lease and
    // durable store remain unchanged and the owning process stays alive.
    if (file.endsWith('.heartbeat')) await resume.promise
    await replace(file, content, guard)
  }
  const scheduler = createScheduler({
    store,
    runs: store,
    queue:
      role === 'owner'
        ? { serialize: (key, work) => queueFs.lock(`target:${key}`, () => work()) }
        : createNodeScheduleQueue(root),
    host: {
      holds: () => true,
      now: () => intent.occurrenceMs,
      monotonicNow: () => intent.occurrenceMs,
      lookupRun: (id) => store.lookupRun(job.workspaceKey, id),
      deliver: async () => {
        process.send?.({ phase: 'inFlight' })
        await resume.promise
        return {
          runId: intent.runId,
          scheduleId: job.id,
          workspaceKey: job.workspaceKey,
          target: job.target,
          delivery: job.delivery,
          occurrenceMs: intent.occurrenceMs,
          observedAtMs: intent.occurrenceMs,
          outcome: 'ran',
          refusedActions: [],
          cost: noScheduleCost(),
        }
      },
    },
    time: { plan: () => ({ missed: false }) },
    deferEvent: () => Promise.resolve(),
    failureSettlement: () => Promise.reject(new Error('unknown delivery')),
  })
  process.on('message', (input: unknown) => {
    z.literal('resume').parse(input)
    resume.resolve(undefined)
  })
  if (role === 'owner') {
    await store.create(job)
    await store.admit(intent)
    try {
      await scheduler.recover(job.workspaceKey)
    } catch {
      /* A stolen target lease must not overwrite known terminal facts. */
    }
  } else {
    process.send?.({ phase: 'ready' })
    await resume.promise
    await scheduler.recover(job.workspaceKey)
  }
  const pending = await store.pending(job.workspaceKey)
  process.send?.({
    phase: 'done',
    state: await store.lookupRun(job.workspaceKey, intent.runId),
    pending: pending.length,
  })
  await scheduler.close()
  process.disconnect()
}
void main().catch((error: unknown) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})

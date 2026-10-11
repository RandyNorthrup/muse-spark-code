import process from 'node:process'
import path from 'node:path'
import * as z from 'zod/mini'
import { appendFile } from 'node:fs/promises'
import { createScheduler } from '../../src/core/schedules/scheduler'
import { createScheduleStore } from '../../src/core/schedules/store'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { noScheduleCost } from '../../src/shared/scheduleV2'
import { fakeSchedule } from '../unit/helpers/schedules/fixtures'

async function main() {
  const [root, phase, catchUp] = process.argv.slice(2)
  if (root === undefined || phase === undefined) throw new Error('missing worker arguments')
  const store = createScheduleStore(createNodeScheduleFs(root))
  const job = fakeSchedule({ catchUp: catchUp === 'skip' ? 'skip' : 'runOnce' })
  const occurrenceMs = job.nextFireAtMs!
  const intent = {
    schedule: job,
    runId: `${job.id}:${String(occurrenceMs)}`,
    occurrenceMs,
    advancesTime: true,
    missed: true,
  }
  const fire = {
    runId: intent.runId,
    scheduleId: job.id,
    workspaceKey: job.workspaceKey,
    occurrenceMs,
    observedAtMs: occurrenceMs,
    target: job.target,
    delivery: job.delivery,
    outcome: 'ran' as const,
    refusedActions: [],
    cost: noScheduleCost(),
  }
  if (phase !== 'recover') {
    await store.create(job)
    await store.admit(intent)
    await store.advance(intent)
    if (phase !== 'admitted') await store.startDispatch(intent)
    if (phase === 'sent' || phase === 'known')
      await appendFile(path.join(root, 'sent.txt'), 'sent\n')
    if (phase === 'known') await store.acknowledge(fire)
    process.send?.({ phase: 'parked' })
    // Parent kills this real process at the journal boundary; no cleanup settles it.
    process.on('message', () => undefined)
    return
  }
  // Warm process/module startup without reading the journal; construct the
  // second scheduler only after the first process is killed and reaped.
  const resume = new Promise<void>((resolve, reject) => {
    process.once('message', (input: unknown) => {
      try {
        z.literal('recover').parse(input)
        resolve()
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('invalid recovery signal'))
      }
    })
  })
  process.send?.({ phase: 'ready' })
  await resume
  const scheduler = createScheduler({
    store,
    runs: store,
    queue: createNodeScheduleQueue(root),
    host: {
      now: () => occurrenceMs,
      monotonicNow: () => occurrenceMs,
      holds: () => true,
      lookupRun: (id) => store.lookupRun(job.workspaceKey, id),
      deliver: async () => {
        await appendFile(path.join(root, 'sent.txt'), 'sent\n')
        return fire
      },
    },
    time: { plan: () => ({ missed: false }) },
    deferEvent: () => Promise.resolve(),
    failureSettlement: () => Promise.reject(new Error('host cannot settle')),
  })
  await scheduler.recover(job.workspaceKey)
  await scheduler.recover(job.workspaceKey)
  const record = await store.lookupRun(job.workspaceKey, intent.runId)
  const pending = await store.pending(job.workspaceKey)
  await scheduler.close()
  process.send?.({ phase: 'recovered', record, pending })
  process.disconnect()
}
void main().catch((error: unknown) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})

import type { ChildProcess } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { SCHEDULE_LEASE_EXPIRES_MS, SCHEDULE_LEASE_HEARTBEAT_MS } from '../../src/shared/constants'
import { scheduleDeliveryStateSchema } from '../../src/shared/scheduleV2'
import {
  bundleScheduleWorker,
  forkScheduleWorker,
  queueForkWorkerMessages,
  stopForkWorkers,
} from './scheduleForkWorker'
import { FIXTURE_HOOK_TIMEOUT_MS } from '../unit/helpers/fixtureBudget'

const receipt = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('ready') }),
  z.strictObject({ phase: z.literal('inFlight') }),
  z.strictObject({
    phase: z.literal('done'),
    state: scheduleDeliveryStateSchema,
    pending: z.int(),
  }),
])
const paths = { root: '', worker: '' }
const workers: { owner?: ReturnType<typeof start>; contender?: ReturnType<typeof start> } = {}
const children: ChildProcess[] = []
const exits: Promise<number | null>[] = []
function start(role: string) {
  const worker = forkScheduleWorker(paths.worker, [paths.root, role])
  children.push(worker.child)
  exits.push(worker.exit)
  return queueForkWorkerMessages(
    worker,
    (input) => receipt.parse(input),
    'live lease worker exited',
  )
}
beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'schedule-live-lease-'))
  paths.worker = path.join(paths.root, 'worker.cjs')
  await bundleScheduleWorker('test/e2e/scheduleLiveLeaseWorker.ts', paths.worker)
  workers.owner = start('owner')
  expect(await workers.owner.next()).toEqual({ phase: 'inFlight' })
  workers.contender = start('contender')
  expect(await workers.contender.next()).toEqual({ phase: 'ready' })
  // Expiry preparation is outside the case's default timeout. The assertion
  // still exercises a real target-lease takeover while its sender is alive.
  await delay(SCHEDULE_LEASE_EXPIRES_MS + SCHEDULE_LEASE_HEARTBEAT_MS)
}, FIXTURE_HOOK_TIMEOUT_MS)
afterAll(() => stopForkWorkers(children, exits, paths.root))
it('a lease takeover after a stalled heartbeat leaves the live owner to record its known result', async () => {
  const { owner, contender } = workers
  if (owner === undefined || contender === undefined) throw new Error('missing live lease workers')
  contender.child.send('resume')
  expect(await contender.next()).toMatchObject({
    phase: 'done',
    state: { status: 'dispatchStarted' },
    pending: 1,
  })
  expect(await contender.exit).toBe(0)
  owner.child.send('resume')
  expect(await owner.next()).toMatchObject({
    phase: 'done',
    state: { status: 'settled', fire: { outcome: 'ran' } },
    pending: 0,
  })
  expect(await owner.exit).toBe(0)
})

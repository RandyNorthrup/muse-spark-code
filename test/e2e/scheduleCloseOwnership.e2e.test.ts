import type { ChildProcess } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { scheduleFireRecordSchema } from '../../src/shared/scheduleV2'
import { FIXTURE_HOOK_TIMEOUT_MS } from '../unit/helpers/fixtureBudget'
import {
  bundleScheduleWorker,
  forkScheduleWorker,
  queueForkWorkerMessages,
  stopForkWorkers,
} from './scheduleForkWorker'

const receipt = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('admitted') }),
  z.strictObject({ phase: z.literal('ready') }),
  z.strictObject({ phase: z.literal('closed') }),
  z.strictObject({ phase: z.literal('sent') }),
  z.strictObject({ phase: z.literal('done'), fires: z.array(scheduleFireRecordSchema) }),
])
const children: ChildProcess[] = []
const exits: Promise<number | null>[] = []
const paths = { root: '', worker: '' }
const workers: {
  owner?: ReturnType<typeof start>
  other?: ReturnType<typeof start>
  liveOwner?: ReturnType<typeof start>
  liveOther?: ReturnType<typeof start>
} = {}
function start(role: string, root = paths.root) {
  const worker = forkScheduleWorker(paths.worker, [root, role])
  children.push(worker.child)
  exits.push(worker.exit)
  return queueForkWorkerMessages(worker, (input) => receipt.parse(input), 'close worker exited')
}
beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'schedule-close-owner-'))
  paths.worker = path.join(paths.root, 'worker.cjs')
  await bundleScheduleWorker('test/e2e/scheduleCloseWorker.ts', paths.worker)
  workers.owner = start('owner')
  expect(await workers.owner.next()).toEqual({ phase: 'admitted' })
  workers.other = start('other')
  expect(await workers.other.next()).toEqual({ phase: 'ready' })
  const liveRoot = path.join(paths.root, 'live')
  workers.liveOwner = start('live', liveRoot)
  expect(await workers.liveOwner.next()).toEqual({ phase: 'sent' })
  workers.liveOther = start('other', liveRoot)
  expect(await workers.liveOther.next()).toEqual({ phase: 'ready' })
}, FIXTURE_HOOK_TIMEOUT_MS)
afterAll(() => stopForkWorkers(children, exits, paths.root))
it("another process closing leaves the owning process's due Once admission untouched", async () => {
  const { owner, other } = workers
  if (owner === undefined || other === undefined) throw new Error('missing prepared workers')
  other.child.send('close')
  expect(await other.next()).toEqual({ phase: 'closed' })
  expect(await other.exit).toBe(0)
  owner.child.send('resume')
  const sent = await owner.next()
  const done = sent.phase === 'sent' ? await owner.next() : sent
  expect(done).toMatchObject({
    phase: 'done',
    fires: [expect.objectContaining({ outcome: 'ran' })],
  })
  expect(sent.phase).toBe('sent')
  expect(await owner.exit).toBe(0)
})

it('closing another process finishes while the owner holds the live target lease', async () => {
  const owner = workers.liveOwner
  const other = workers.liveOther
  if (owner === undefined || other === undefined) throw new Error('missing live close workers')
  other.child.send('close')
  expect(await other.next()).toEqual({ phase: 'closed' })
  expect(await other.exit).toBe(0)
  // This is reached while the owner still waits in deliver and heartbeats its lease.
  owner.child.send('resume')
  expect(await owner.next()).toMatchObject({
    phase: 'done',
    fires: [expect.objectContaining({ outcome: 'ran' })],
  })
  expect(await owner.exit).toBe(0)
})

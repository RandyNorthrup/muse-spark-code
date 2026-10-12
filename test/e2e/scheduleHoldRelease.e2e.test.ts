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

const delivererReceipt = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('blocked') }),
  z.strictObject({ phase: z.literal('sent'), id: z.string() }),
  z.strictObject({ phase: z.literal('idle') }),
  z.strictObject({ phase: z.literal('done'), fires: z.array(scheduleFireRecordSchema) }),
])
const releaserReceipt = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('created') }),
  z.strictObject({ phase: z.literal('draining') }),
  z.strictObject({ phase: z.literal('released') }),
  z.strictObject({ phase: z.literal('done') }),
])
const children: ChildProcess[] = []
const exits: Promise<number | null>[] = []
const paths = { root: '', worker: '' }

beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'schedule-hold-release-'))
  paths.worker = path.join(paths.root, 'worker.cjs')
  await bundleScheduleWorker('test/e2e/scheduleHoldReleaseWorker.ts', paths.worker)
}, FIXTURE_HOOK_TIMEOUT_MS)
afterAll(() => stopForkWorkers(children, exits, paths.root))

it('a hold released without closing leaves its fire for the holder to deliver once', async () => {
  const deliverer = forkScheduleWorker(paths.worker, [paths.root, 'deliverer'])
  children.push(deliverer.child)
  exits.push(deliverer.exit)
  const delivering = queueForkWorkerMessages(
    deliverer,
    (input) => delivererReceipt.parse(input),
    'deliverer exited',
  )
  // B delivers fire 1, then goes idle holding the workspace.
  expect(await delivering.next()).toEqual({ phase: 'blocked' })
  const releaser = forkScheduleWorker(paths.worker, [paths.root, 'releaser'])
  children.push(releaser.child)
  exits.push(releaser.exit)
  const releasing = queueForkWorkerMessages(
    releaser,
    (input) => releaserReceipt.parse(input),
    'releaser exited',
  )
  releaser.child.send('go')
  expect(await releasing.next()).toEqual({ phase: 'created' })
  deliverer.child.send('resume')
  expect(await delivering.next()).toEqual({ phase: 'sent', id: 'fire-1' })
  expect(await delivering.next()).toEqual({ phase: 'idle' })
  // A admits fire 2 only once B is idle, so B never sees it mid-drain.
  releaser.child.send('poll-now')
  expect(await releasing.next()).toEqual({ phase: 'draining' })
  // A releases its hold without closing, then drains into the free lease.
  releaser.child.send('release')
  expect(await releasing.next()).toEqual({ phase: 'released' })
  expect(await releasing.next()).toEqual({ phase: 'done' })
  expect(await releaser.exit).toBe(0)
  // B delivers the survivor exactly once.
  deliverer.child.send('recover')
  expect(await delivering.next()).toEqual({ phase: 'sent', id: 'fire-2' })
  const done = await delivering.next()
  expect(done).toMatchObject({
    phase: 'done',
    fires: [
      expect.objectContaining({ scheduleId: 'fire-1', outcome: 'ran' }),
      expect.objectContaining({ scheduleId: 'fire-2', outcome: 'ran' }),
    ],
  })
  expect(await deliverer.exit).toBe(0)
})

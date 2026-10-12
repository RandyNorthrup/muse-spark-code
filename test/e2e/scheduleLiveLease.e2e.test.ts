import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { SCHEDULE_LEASE_EXPIRES_MS, SCHEDULE_LEASE_HEARTBEAT_MS } from '../../src/shared/constants'
import { scheduleDeliveryStateSchema } from '../../src/shared/scheduleV2'
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
  const child = fork(paths.worker, [paths.root, role], {
    silent: true,
    env: { SystemRoot: process.env['SystemRoot'], TMPDIR: tmpdir() },
  })
  children.push(child)
  const exit = new Promise<number | null>((resolve) => child.once('exit', resolve))
  exits.push(exit)
  const messages: z.infer<typeof receipt>[] = []
  const waiters: ReturnType<typeof Promise.withResolvers<z.infer<typeof receipt>>>[] = []
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.on('exit', () => {
    for (const waiter of waiters) waiter.reject(new Error(`live lease worker exited: ${stderr}`))
  })
  child.on('message', (input: unknown) => {
    const parsed = receipt.parse(input)
    const waiter = waiters.shift()
    if (waiter === undefined) messages.push(parsed)
    else waiter.resolve(parsed)
  })
  return {
    child,
    exit,
    next: () => {
      const queued = messages.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      const waiter = Promise.withResolvers<z.infer<typeof receipt>>()
      waiters.push(waiter)
      return waiter.promise
    },
  }
}
beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'schedule-live-lease-'))
  paths.worker = path.join(paths.root, 'worker.cjs')
  await build({
    entryPoints: ['test/e2e/scheduleLiveLeaseWorker.ts'],
    outfile: paths.worker,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  workers.owner = start('owner')
  expect(await workers.owner.next()).toEqual({ phase: 'inFlight' })
  workers.contender = start('contender')
  expect(await workers.contender.next()).toEqual({ phase: 'ready' })
  // Expiry preparation is outside the case's default timeout. The assertion
  // still exercises a real target-lease takeover while its sender is alive.
  await delay(SCHEDULE_LEASE_EXPIRES_MS + SCHEDULE_LEASE_HEARTBEAT_MS)
}, FIXTURE_HOOK_TIMEOUT_MS)
afterAll(async () => {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill()
  await Promise.all(exits)
  await rm(paths.root, { recursive: true, force: true })
})
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

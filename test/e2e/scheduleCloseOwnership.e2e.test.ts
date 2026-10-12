import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { scheduleFireRecordSchema } from '../../src/shared/scheduleV2'
import { FIXTURE_HOOK_TIMEOUT_MS } from '../unit/helpers/fixtureBudget'

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
  const child = fork(paths.worker, [root, role], {
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
    for (const waiter of waiters) waiter.reject(new Error(`close worker exited: ${stderr}`))
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
  paths.root = await mkdtemp(path.join(tmpdir(), 'schedule-close-owner-'))
  paths.worker = path.join(paths.root, 'worker.cjs')
  await build({
    entryPoints: ['test/e2e/scheduleCloseWorker.ts'],
    outfile: paths.worker,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
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
afterAll(async () => {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill()
  await Promise.all(exits)
  await rm(paths.root, { recursive: true, force: true })
})
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

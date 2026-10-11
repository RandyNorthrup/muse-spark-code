import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { scheduleDeliveryStateSchema } from '../../src/shared/scheduleV2'

const message = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('parked') }),
  z.strictObject({
    phase: z.literal('recovered'),
    record: scheduleDeliveryStateSchema,
    pending: z.array(z.unknown()),
  }),
])

const recoveryCases = [
  { phase: 'admitted', catchUp: 'runOnce', sends: 1, outcome: 'ran' },
  { phase: 'admitted', catchUp: 'skip', sends: 0, outcome: 'missed' },
  { phase: 'dispatch', catchUp: 'runOnce', sends: 0, outcome: 'uncertain' },
  { phase: 'sent', catchUp: 'runOnce', sends: 1, outcome: 'uncertain' },
  { phase: 'known', catchUp: 'runOnce', sends: 1, outcome: 'ran' },
]
const owners = new Map<string, ReturnType<typeof start>>()
const paths = { folder: '', worker: '' }
const children: ChildProcess[] = []
const exited = new Map<ChildProcess, Promise<number | null>>()
beforeAll(async () => {
  paths.folder = await mkdtemp(path.join(tmpdir(), 'schedule-settlement-'))
  paths.worker = path.join(paths.folder, 'worker.cjs')
  await build({
    entryPoints: ['test/e2e/scheduleSettlementWorker.ts'],
    outfile: paths.worker,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  await Promise.all(
    recoveryCases.map(async (test) => {
      const key = `${test.phase}-${test.catchUp}`
      const owner = start(path.join(paths.folder, key), test.phase, test.catchUp)
      owners.set(key, owner)
      const parked = await owner.response
      expect(parked.phase).toBe('parked')
    }),
  )
})
afterAll(async () => {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill()
  await Promise.all(exited.values())
  await rm(paths.folder, { recursive: true, force: true })
})
function start(root: string, phase: string, catchUp: string) {
  const child = fork(paths.worker, [root, phase, catchUp], {
    silent: true,
    env: { SystemRoot: process.env['SystemRoot'], TMPDIR: tmpdir() },
  })
  children.push(child)
  const exit = new Promise<number | null>((resolve) => child.once('exit', resolve))
  exited.set(child, exit)
  const response = new Promise<z.infer<typeof message>>((resolve, reject) => {
    child.once('message', (input: unknown) => {
      resolve(message.parse(input))
    })
    child.once('error', reject)
    child.once('exit', () => {
      reject(new Error('paths.worker exited before journal receipt'))
    })
  })
  return { child, exit, response }
}
it.each(recoveryCases)(
  'recovers real killed process at $phase with $catchUp without replay',
  async (test) => {
    const root = path.join(paths.folder, `${test.phase}-${test.catchUp}`)
    const owner = owners.get(`${test.phase}-${test.catchUp}`)
    if (owner === undefined) throw new Error('missing parked crash process')
    const parked = await owner.response
    expect(parked.phase).toBe('parked')
    owner.child.kill()
    await owner.exit
    const next = start(root, 'recover', test.catchUp)
    const receipt = await next.response
    expect(await next.exit).toBe(0)
    expect(receipt).toMatchObject({
      phase: 'recovered',
      pending: [],
      record: {
        status: test.outcome === 'uncertain' ? 'uncertain' : 'settled',
        fire: { outcome: test.outcome },
      },
    })
    let sends: string
    try {
      sends = await readFile(path.join(root, 'sent.txt'), 'utf8')
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      sends = ''
    }
    expect(sends.trim().split('\n').filter(Boolean)).toHaveLength(test.sends)
  },
)

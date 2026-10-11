import { fork, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createScheduleStore } from '../../src/core/schedules/store'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { fakeSchedule } from '../unit/helpers/schedules/fixtures'

const directory = mkdtempSync(path.resolve('temp', 'CM1151-claims-'))
const worker = path.join(directory, 'worker.cjs')
const data = path.join(directory, 'data')
const receipt = path.join(directory, 'receipt.jsonl')
const cwd = path.join(directory, 'workspace')
const holderSchema = z.enum(['window-1', 'window-2', 'acp'])
const statusSchema = z.strictObject({ phase: z.enum(['ready', 'settled']), holder: holderSchema })
const receiptSchema = z.strictObject({ holder: holderSchema, runId: z.string() })
const children: ChildProcess[] = []
const exits: Promise<number | null>[] = []
const store = createScheduleStore(createNodeScheduleFs(data))
const facts: {
  dispatches?: z.infer<typeof receiptSchema>[]
  polling?: PromiseSettledResult<void>[]
  fires?: Awaited<ReturnType<typeof store.fires>>
  exits?: (number | null)[]
} = {}
// Three real processes fsync shared journal/lease state; perform that costly
// fixture once, keeping the assertions at the repository's test deadline.
const CLAIM_FIXTURE_TIMEOUT_MS = 60_000
const schedule = fakeSchedule({
  workspaceKey: workspaceKey(cwd),
  catchUp: 'runOnce',
  target: { kind: 'conversation', backend: 'museCode', sessionId: 'session-1' },
})

beforeAll(async () => {
  await build({
    entryPoints: [path.resolve('test/e2e/scheduleClaimWorker.ts')],
    outfile: worker,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  })
  children.push(
    ...['window-1', 'window-2', 'acp'].map((holder) =>
      fork(worker, [data, cwd, receipt, holder], {
        silent: true,
        env: { SystemRoot: process.env['SystemRoot'] },
      }),
    ),
  )
  exits.push(
    ...children.map(
      (child) => new Promise<number | null>((resolve) => child.once('exit', resolve)),
    ),
  )
  await Promise.all(children.map((child) => status(child, 'ready')))
  await store.create(schedule)
  await raceHolders()
}, CLAIM_FIXTURE_TIMEOUT_MS)
afterAll(async () => {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill()
  await Promise.all(exits)
  expect(path.dirname(directory)).toBe(path.resolve('temp'))
  await rm(directory, { recursive: true, force: true })
})

function status(child: ChildProcess, phase: 'ready' | 'settled'): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off('message', message)
      child.off('error', failed)
      child.off('exit', exited)
    }
    const message = (input: unknown) => {
      const value = statusSchema.safeParse(input)
      if (!value.success) {
        cleanup()
        reject(new Error('invalid schedule worker status'))
      } else if (value.data.phase === phase) {
        cleanup()
        resolve()
      }
    }
    const failed = (error: Error) => {
      cleanup()
      reject(error)
    }
    const exited = () => {
      failed(new Error('schedule worker exited before status'))
    }
    child.on('message', message)
    child.on('error', failed)
    child.on('exit', exited)
  })
}

async function raceHolders(): Promise<void> {
  try {
    const polling: PromiseSettledResult<void>[] = []
    for (let round = 0; round < 2; round += 1) {
      const settled = children.map((child) => status(child, 'settled'))
      for (const child of children) child.send('poll')
      const results = await Promise.allSettled(settled)
      polling.push(...results)
      if (results.some((result) => result.status === 'rejected')) break
    }
    const receiptText = await readFile(receipt, 'utf8')
    const dispatches = receiptText
      .trim()
      .split('\n')
      .map((line) => receiptSchema.parse(JSON.parse(line)))
    facts.dispatches = dispatches
    facts.polling = polling
    const fires = await store.fires(schedule.workspaceKey)
    facts.fires = fires
    for (const child of children) child.send('close')
    facts.exits = await Promise.all(exits)
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
    await Promise.all(exits)
  }
}

it('admits one fire across two window holders and an ACP holder in separate processes', () => {
  expect(facts.dispatches).toHaveLength(1)
  expect(facts.polling?.every((result) => result.status === 'fulfilled')).toBe(true)
  expect(facts.fires).toHaveLength(1)
  expect(facts.fires?.[0]).toMatchObject({ runId: facts.dispatches?.[0]?.runId, outcome: 'ran' })
  expect(facts.exits).toEqual([0, 0, 0])
})

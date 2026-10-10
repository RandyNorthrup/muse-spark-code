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
})
afterAll(async () => {
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

it('admits one fire across two window holders and an ACP holder in separate processes', async () => {
  const children = ['window-1', 'window-2', 'acp'].map((holder) =>
    fork(worker, [data, cwd, receipt, holder], {
      silent: true,
      env: { SystemRoot: process.env['SystemRoot'] },
    }),
  )
  const exits = children.map(
    (child) => new Promise<number | null>((resolve) => child.once('exit', resolve)),
  )
  try {
    await Promise.all(children.map((child) => status(child, 'ready')))
    const store = createScheduleStore(createNodeScheduleFs(data))
    const schedule = fakeSchedule({
      workspaceKey: workspaceKey(cwd),
      catchUp: 'runOnce',
      target: { kind: 'conversation', backend: 'museCode', sessionId: 'session-1' },
    })
    await store.create(schedule)
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
    expect(dispatches).toHaveLength(1)
    expect(polling.every((result) => result.status === 'fulfilled')).toBe(true)
    const fires = await store.fires(schedule.workspaceKey)
    expect(fires).toHaveLength(1)
    expect(fires[0]).toMatchObject({ runId: dispatches[0]?.runId, outcome: 'ran' })
    for (const child of children) child.send('close')
    expect(await Promise.all(exits)).toEqual([0, 0, 0])
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
    await Promise.all(exits)
  }
})

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
const statusSchema = z.strictObject({
  phase: z.enum(['ready', 'contending', 'admitted', 'settled']),
  holder: holderSchema,
})
const receiptSchema = z.strictObject({ holder: holderSchema, runId: z.string() })
const children: ChildProcess[] = []
const exits: Promise<number | null>[] = []
const store = createScheduleStore(createNodeScheduleFs(data))
const schedule = fakeSchedule({
  workspaceKey: workspaceKey(cwd),
  catchUp: 'runOnce',
  target: { kind: 'conversation', backend: 'museCode', sessionId: 'session-1' },
})
const state: { isPassed: boolean; settled: Promise<void>[] } = { isPassed: false, settled: [] }
const admission = Promise.withResolvers<undefined>()

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
  await store.create(schedule)
  for (const holder of ['window-1', 'window-2', 'acp']) {
    const child = fork(worker, [data, cwd, receipt, holder], {
      silent: true,
      env: { SystemRoot: process.env['SystemRoot'] },
    })
    children.push(child)
    child.on('message', (input: unknown) => {
      const value = statusSchema.parse(input)
      if (value.phase === 'admitted') admission.resolve(undefined)
    })
    child.once('exit', () => {
      admission.reject(new Error('claim worker exited before admission'))
    })
    exits.push(new Promise((resolve) => child.once('exit', resolve)))
  }
  await Promise.all(children.map((child) => status(child, 'ready')))
  // Warm durable admission in setup; the test releases the real pending turn
  // through an IPC barrier, independent of wall-clock/process-start timing.
  state.settled = children.map((child) => status(child, 'settled'))
  const contenders = children.map((child) => status(child, 'contending'))
  for (const promise of state.settled) void promise.catch(String)
  for (const promise of contenders) void promise.catch(String)
  for (const child of children) child.send('poll')
  await Promise.all(contenders)
  for (const child of children) child.send('dispatch')
  await admission.promise
})
afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      if (state.isPassed && child.connected) child.send('close')
      else child.kill()
    }
  }
  const codes = await Promise.all(exits)
  if (state.isPassed) expect(codes).toEqual([0, 0, 0])
  expect(path.dirname(directory)).toBe(path.resolve('temp'))
  await rm(directory, { recursive: true, force: true })
})

function status(child: ChildProcess, phase: 'ready' | 'contending' | 'settled'): Promise<void> {
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
  try {
    for (const child of children) child.send('complete')
    const polling = await Promise.allSettled(state.settled)
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
    state.isPassed = true
  } finally {
    if (!state.isPassed) for (const child of children) child.kill()
  }
})

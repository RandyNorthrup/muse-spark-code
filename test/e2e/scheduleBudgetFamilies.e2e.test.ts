import type { ChildProcess } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { FIXTURE_HOOK_TIMEOUT_MS } from '../unit/helpers/fixtureBudget'
import {
  bundleScheduleWorker,
  forkScheduleWorker,
  queueForkWorkerMessages,
  stopForkWorkers,
} from './scheduleForkWorker'

const receipt = z.strictObject({ phase: z.enum(['ready', 'reserved', 'refused']) })
const paths = { root: '', worker: '' }
const children: ChildProcess[] = []
const exits: Promise<number | null>[] = []

function start(data: string, family: string, own: string, file: string, setting: string) {
  const worker = forkScheduleWorker(paths.worker, [data, family, own, file, setting])
  children.push(worker.child)
  exits.push(worker.exit)
  return queueForkWorkerMessages(worker, (input) => receipt.parse(input), 'budget worker exited')
}

async function reserve(data: string, family: string, own: string, file: string, setting: string) {
  const worker = start(data, family, own, file, setting)
  expect(await worker.next()).toEqual({ phase: 'ready' })
  worker.child.send('reserve')
  const outcome = await worker.next()
  expect(await worker.exit).toBe(0)
  return outcome
}

beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'schedule-budget-families-'))
  paths.worker = path.join(paths.root, 'worker.cjs')
  await bundleScheduleWorker('test/e2e/scheduleBudgetFamilyWorker.ts', paths.worker, [
    {
      name: 'fixture-vscode',
      setup(builder) {
        builder.onResolve({ filter: /^vscode$/ }, () => ({
          path: 'vscode',
          namespace: 'fixture',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const window = {}',
          loader: 'js',
        }))
      },
    },
  ])
}, FIXTURE_HOOK_TIMEOUT_MS)
afterAll(() => stopForkWorkers(children, exits, paths.root))

it('the data-folder settings file is the one shared cap for both families', async () => {
  // The VS Code setting names 5 while the settings file names 1: both
  // families must enforce 1 against the one ledger.
  const data = path.join(paths.root, 'file-wins')
  expect(await reserve(data, 'window', '5', '1', '5')).toEqual({ phase: 'reserved' })
  expect(await reserve(data, 'agent', '5', '1', '5')).toEqual({ phase: 'refused' })
  // And the window cannot spend past the file cap on its own either.
  expect(await reserve(data, 'window', '5', '1', '5')).toEqual({ phase: 'refused' })
})

it('one daily cap applies to a window-family and agent-family process', async () => {
  const data = path.join(paths.root, 'shared')
  expect(await reserve(data, 'window', '5', '5', '5')).toEqual({ phase: 'reserved' })
  expect(await reserve(data, 'agent', '5', '5', '5')).toEqual({ phase: 'reserved' })
})

import type { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
const cases = [
  { cap: 'own', own: '1', shared: '5' },
  { cap: 'shared', own: '5', shared: '1' },
]
const prepared = new Map<
  string,
  { window: ReturnType<typeof start>; agent: ReturnType<typeof start> }
>()
function start(data: string, family: string, own: string, shared: string) {
  const worker = forkScheduleWorker(paths.worker, [data, family, own, shared])
  children.push(worker.child)
  exits.push(worker.exit)
  return queueForkWorkerMessages(worker, (input) => receipt.parse(input), 'budget worker exited')
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
  for (const test of cases) {
    const data = path.join(paths.root, test.cap)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(data)
    await writeFile(
      path.join(data, 'settings.json'),
      JSON.stringify({ paidDailyBudgetUsd: Number(test.shared) }),
    )
    const window = start(data, 'window', test.own, test.shared)
    const agent = start(data, 'agent', test.own, test.shared)
    expect(await window.next()).toEqual({ phase: 'ready' })
    expect(await agent.next()).toEqual({ phase: 'ready' })
    prepared.set(test.cap, { window, agent })
  }
}, FIXTURE_HOOK_TIMEOUT_MS)
afterAll(() => stopForkWorkers(children, exits, paths.root))
it.each(cases)(
  'one $cap daily cap applies to a window-family and agent-family process',
  async (test) => {
    const workers = prepared.get(test.cap)
    if (workers === undefined) throw new Error('missing prepared family pair')
    workers.window.child.send('reserve')
    expect(await workers.window.next()).toEqual({ phase: 'reserved' })
    expect(await workers.window.exit).toBe(0)
    workers.agent.child.send('reserve')
    expect(await workers.agent.next()).toEqual({ phase: 'refused' })
    expect(await workers.agent.exit).toBe(0)
  },
)
it('the production window uses the same machine data root as ACP and CLI for daily accounting', async () => {
  const source = await readFile('src/extension.ts', 'utf8')
  const start = source.indexOf('paidDaily = bundle.createUsageBudget(')
  const end = source.indexOf('return paidDaily', start)
  expect(source).toContain('const dailyBudgetDataFolder = agentDataFolder(')
  expect(source.slice(start, end)).toContain('dailyBudgetDataFolder')
  expect(source.slice(start, end)).toContain(
    'legacyDirectory: path.join(context.globalStorageUri.fsPath',
  )
})

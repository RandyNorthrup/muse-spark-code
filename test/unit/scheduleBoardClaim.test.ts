// Two processes race one due role fire (C-M115-8): each child runs the
// real schedule engine and the real team host over the shared store. The
// dispatch lease admits exactly one: the winner's board holds the fire's
// task, the loser records nothing and never touches boards, and the
// ledger settles the run once as ran. No worker ever starts.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import { scheduleBoardKey } from '../../src/core/schedules/boardDelivery'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import { workspaceKey } from '../../src/runtime/dataFolder'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { MILLISECONDS_PER_MINUTE } from '../../src/shared/constants'
import { closeEngine } from './helpers/scheduleBoardRig'
import { silentCoreLog } from './helpers/memoryLogs'
import { scheduleFixture } from './helpers/scheduleFixtures'

const holder: { bundle: string } = { bundle: '' }

beforeAll(async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'sched-board-claim-'))
  holder.bundle = path.join(folder, 'scheduleBoardClaimChild.mjs')
  await build({
    entryPoints: [path.resolve('test/unit/scheduleBoardClaimChild.entry.ts')],
    outfile: holder.bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })
}, 120_000)

interface ClaimResult {
  readonly admitted: boolean
  readonly teamFor: readonly string[]
  readonly boardKeys: readonly string[]
  readonly boardRoles: readonly string[]
  readonly runs: number
  readonly startWorker: number
  readonly listModels: number
  readonly allowKeyTasks: number
  readonly cards: number
}

async function runClaimant(plan: {
  readonly root: string
  readonly cwd: string
  readonly storage: string
  readonly resultFile: string
}): Promise<{ readonly code: number | null; readonly stderr: string }> {
  const planFile = `${plan.resultFile}.plan.json`
  writeFileSync(planFile, JSON.stringify(plan))
  const child = spawn(process.execPath, [holder.bundle, planFile], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const code = await new Promise<number | null>((resolve) => {
    child.on('exit', (exitCode) => {
      resolve(exitCode)
    })
  })
  return { code, stderr }
}

describe('one due role fire across two processes', () => {
  // Two child engine builds and a cross-process dispatch race: genuinely
  // long, outside any single test's budget.
  it('admits exactly one claimant and settles the run once', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'sched-board-race-'))
    try {
      const root = path.join(folder, 'store')
      const cwd = path.join(folder, 'workspace')
      const key = workspaceKey(cwd)
      const seed = await createScheduleEngine({
        log: silentCoreLog(),
        fs: createNodeScheduleFs(root),
        queue: createNodeScheduleQueue(root),
      })
      try {
        // Due now, never held here: this engine seeds the schedule and
        // closes without polling, so only the children race the fire.
        const atMs = Date.now()
        await seed.store.create(
          scheduleFixture({
            id: 'schedule-race',
            workspaceKey: key,
            createdAtMs: atMs - MILLISECONDS_PER_MINUTE,
            mode: 'auto',
            target: { kind: 'role', teamId: key, roleId: 'engineering' },
            trigger: { kind: 'once', atMs },
            nextFireAtMs: atMs,
          }),
        )
      } finally {
        await closeEngine(seed)
      }
      const [first, second] = await Promise.all([
        runClaimant({
          root,
          cwd,
          storage: path.join(folder, 'team-a'),
          resultFile: path.join(folder, 'result-a.json'),
        }),
        runClaimant({
          root,
          cwd,
          storage: path.join(folder, 'team-b'),
          resultFile: path.join(folder, 'result-b.json'),
        }),
      ])
      expect(first.code, `claimant A stderr: ${first.stderr}`).toBe(0)
      expect(second.code, `claimant B stderr: ${second.stderr}`).toBe(0)
      const results = [
        JSON.parse(readFileSync(path.join(folder, 'result-a.json'), 'utf8')) as ClaimResult,
        JSON.parse(readFileSync(path.join(folder, 'result-b.json'), 'utf8')) as ClaimResult,
      ]
      const winners = results.filter((result) => result.admitted)
      const losers = results.filter((result) => !result.admitted)
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
      const winner = winners[0]
      const loser = losers[0]
      expect(winner?.teamFor).toEqual([key])
      expect(winner?.boardKeys).toHaveLength(1)
      expect(winner?.boardRoles).toEqual(['engineering'])
      expect(winner?.runs).toBe(0)
      expect(winner?.startWorker).toBe(0)
      expect(winner?.listModels).toBe(0)
      expect(winner?.allowKeyTasks).toBe(0)
      expect(winner?.cards).toBe(0)
      expect(loser?.teamFor).toEqual([])
      expect(loser?.boardKeys).toEqual([])
      expect(loser?.runs).toBe(0)

      const reader = await createScheduleEngine({
        log: silentCoreLog(),
        fs: createNodeScheduleFs(root),
        queue: createNodeScheduleQueue(root),
      })
      try {
        const fires = await reader.store.fires(key)
        const ran = fires.filter((fire) => fire.outcome === 'ran')
        expect(new Set(ran.map((fire) => fire.runId)).size).toBe(1)
        expect(winner?.boardKeys[0]).toBe(
          ran[0] === undefined ? undefined : scheduleBoardKey(ran[0].runId),
        )
      } finally {
        await closeEngine(reader)
      }
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }, 60_000)
})

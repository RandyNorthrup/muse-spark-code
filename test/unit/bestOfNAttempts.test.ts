// Best-of-N against the fake Model API (M77, PLAN.md D49): N attempts run
// real Model API conversations in their own worktree-rooted hosts, the
// ceiling binds model requests, and the take merges only the taken branch.

import { describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { bestOfNWorktreeFolder } from '../../src/core/bestOfN/bestOfN'
import { BestOfNManager } from '../../src/host/bestOfN/bestOfNManager'
import { PaidUsage } from '../../src/core/paid/paidFeatures'
import type { OwnedSessionBudgetScope } from '../../src/core/backends/modelapi/sessionBudget'
import type { BestOfNRun } from '../../src/shared/bestOfN'
import type { PaidUseRequest } from '../../src/shared/paid'
import { awaitCompletedRun, bestOfNCommandArgs, bestOfNManagerBase } from './helpers/bestOfN'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClient,
  type FakeModelApi,
} from './helpers/fakeModelApi'
import { memoryContextIo } from './helpers/fakeContextIo'
import { memoryToolIo, type MemoryToolIo } from './helpers/fakeToolIo'

interface AttemptWorld {
  api: FakeModelApi
  io: MemoryToolIo
  root: string
}

function writeCall(
  path: string,
  content: string,
): { calls: [{ name: string; arguments: string }] } {
  return { calls: [{ name: 'write_file', arguments: JSON.stringify({ path, content }) }] }
}

function harness(
  attempts: number,
  budgetScope?: OwnedSessionBudgetScope,
): {
  manager: BestOfNManager
  worlds: AttemptWorld[]
  paidRequests: PaidUseRequest[]
  noted: number[]
  updates: BestOfNRun[]
  gitCalls: { readonly args: readonly string[] }[]
  usage: PaidUsage
} {
  const log = new FakeLogOutputChannel()
  const usage = new PaidUsage(log)
  // The test injects a deterministic run id, so the worktree folders are
  // known before the run starts; production uses a UUID.
  const runId = `bon-${(1_000_000).toString(36)}-1`
  const worlds: AttemptWorld[] = []
  for (let index = 0; index < attempts; index += 1) {
    const root = bestOfNWorktreeFolder('/repo/app', runId, index, 'linux')
    worlds.push({ api: fakeModelApi(), io: memoryToolIo({}, root), root })
  }
  const paidRequests: PaidUseRequest[] = []
  const noted: number[] = []
  const updates: BestOfNRun[] = []
  const gitCalls: { readonly args: readonly string[] }[] = []
  const manager = new BestOfNManager({
    isBestOfNOn: () => true,
    allowsPaidUse: (request) => {
      paidRequests.push(request)
      return Promise.resolve(true)
    },
    notePaidUse: (count) => {
      noted.push(count)
      usage.add('bestOfN', count)
    },
    noteAttemptRequest: () => {
      usage.addBestOfNRequest()
    },
    noteAttemptUsage: (modelId, reported) => {
      usage.addBestOfNUsage(modelId, reported)
    },
    getBudgetScope: () => Promise.resolve(budgetScope),
    runGit: (rawArgs) => {
      const args = bestOfNCommandArgs(rawArgs)
      gitCalls.push({ args })
      if (args.includes('--absolute-git-dir')) return Promise.resolve('/repo/app/.git')
      if (args[0] === 'rev-parse') {
        return Promise.resolve('a'.repeat(40))
      }
      if (args.includes('write-tree')) {
        const index = gitCalls.filter((call) => call.args.includes('write-tree')).length - 1
        return Promise.resolve(`${'b'.repeat(39)}${String(index)}`)
      }
      if (args[0] === 'diff' && args[1] === '--numstat') {
        const index = args.at(-2)?.at(-1) ?? '0'
        return Promise.resolve(`2\t0\tnotes-${index}.txt\n`)
      }
      return args[0] === 'diff'
        ? Promise.resolve('diff --git a/notes.txt b/notes.txt\n')
        : Promise.resolve('')
    },
    repositoryRoot: () => '/repo/app',
    platform: 'linux',
    ...bestOfNManagerBase(updates, log),
    buildAttemptHost: (worktreePath, admitRequest, noteUsage, scope) => {
      const world = worlds.find((candidate) => candidate.root === worktreePath)
      if (world === undefined) {
        throw new Error(`No fake worktree at ${worktreePath}`)
      }
      const io = world.io
      let ids = 0
      return Promise.resolve(
        new ModelApiHost({
          client: fakeModelApiClient(world.api, log),
          workspaceRoot: world.root,
          platform: 'linux',
          io,
          contextIo: memoryContextIo(io.files),
          newId: () => {
            ids += 1
            return `attempt-id${String(ids)}`
          },
          now: () => 0,
          log,
          personalSkillsRoot: undefined,
          isWorkspaceTrusted: () => true,
          store: undefined,
          scheduleStore: undefined,
          ...(scope !== undefined && { budgetScope: scope }),
          sessionBudgetUsd: () => scope?.capUsd() ?? 0,
          showReplyUsage: () => false,
          getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
          admitResponseAttempt: admitRequest,
          noteResponseUsage: noteUsage,
          describeEnvironment: () => Promise.resolve({ git: undefined }),
          isPaidFeatureOn: () => false,
          notePaidUse: () => undefined,
          promptCacheRetention: () => 'in_memory',
          mcpServers: undefined,
          ideTools: undefined,
          allowsPaidUse: () => Promise.resolve(false),
          isPaidUseRemembered: () => false,
          noteSubagentUsage: () => undefined,
          loadHooks: () => Promise.resolve([]),
          isHooksEnabled: () => false,
          memory: undefined,
        }),
      )
    },
  })
  return { manager, worlds, paidRequests, noted, updates, gitCalls, usage }
}

describe('best-of-N on the fake Model API', () => {
  it('counts HTTP retries before they run and blocks the next paid request', async () => {
    const t = harness(2)
    const [retrying, quiet] = t.worlds
    if (retrying === undefined || quiet === undefined)
      throw new Error('Expected two fake worktrees')
    retrying.api.script(
      { httpError: { status: 503 } },
      { httpError: { status: 503 } },
      { httpError: { status: 503 } },
      { httpError: { status: 503 } },
      writeCall('last-admitted.txt', 'fifth try'),
      { text: 'must never request this reply' },
    )
    quiet.api.script({ text: 'done' })
    await t.manager.start({ prompt: 'go', attempts: 2, requestCeilingPerAttempt: 5 }, 'modelApi')
    await awaitCompletedRun(t.updates)
    expect(retrying.api.responseBodies()).toHaveLength(5)
    expect(t.updates.at(-1)?.runAttempts[0]).toMatchObject({
      status: 'failed',
      requestsMade: 5,
      ceilingReached: true,
    })
    expect(t.noted).toEqual([1, 1])
    expect(t.usage.current).toMatchObject({
      bestOfNRequests: 6,
      bestOfNUnknownRequests: 4,
      bestOfNTokens: 30,
    })
  })
  it('runs one prompt in N worktrees and takes one', async () => {
    const t = harness(3)
    for (const [index, world] of t.worlds.entries()) {
      world.api.script(writeCall(`notes-${String(index)}.txt`, `attempt ${String(index)}`), {
        text: `done ${String(index)}`,
      })
    }
    const run = await t.manager.start(
      { prompt: 'leave a note', attempts: 3, requestCeilingPerAttempt: 20 },
      'modelApi',
    )
    expect(run.status).toBe('running')
    await awaitCompletedRun(t.updates)
    // One popup for the whole run, and the attempts tallied once.
    expect(t.paidRequests).toHaveLength(1)
    expect(t.paidRequests[0]).toMatchObject({
      feature: 'bestOfN',
      modelId: 'muse-spark-1.3',
      attempts: 3,
      requestCeilingPerAttempt: 20,
    })
    expect(t.noted).toEqual([1, 1, 1])
    expect(t.usage.current).toMatchObject({
      bestOfNRequests: 6,
      bestOfNUnknownRequests: 0,
      bestOfNTokens: 90,
    })
    const finished = t.updates.at(-1)
    expect(finished?.runAttempts).toHaveLength(3)
    const attempts = finished?.runAttempts ?? []
    for (const [index, attempt] of attempts.entries()) {
      expect(attempt.status).toBe('completed')
      expect(attempt.requestsMade).toBe(2)
      expect(attempt.ceilingReached).toBe(false)
      expect(attempt.files).toEqual([
        { path: `notes-${String(index)}.txt`, insertions: 2, deletions: 0 },
      ])
      // Each attempt wrote in its own worktree, nowhere else.
      const own = [...(t.worlds[index]?.io.files ?? [])].filter(([name]) =>
        name.endsWith(`notes-${String(index)}.txt`),
      )
      expect(own.map(([, content]) => content)).toEqual([`attempt ${String(index)}`])
      const elsewhere = [...(t.worlds[(index + 1) % 3]?.io.files ?? [])].filter(([name]) =>
        name.endsWith(`notes-${String(index)}.txt`),
      )
      expect(elsewhere).toEqual([])
    }
    // "Take this one" merges only the taken worktree's branch.
    const winner = finished?.runAttempts[1]
    if (winner === undefined) {
      throw new Error('Expected three attempts')
    }
    const taken = await t.manager.take(winner.attemptId)
    const merges = t.gitCalls.filter((call) => call.args[0] === 'apply')
    expect(merges).toHaveLength(1)
    expect(merges[0]?.args).toEqual(['apply', '--index', '--binary', '-'])
    expect(taken.takenBranch).toBe(winner.branch)
  })

  it('stops an attempt at its request ceiling', async () => {
    const t = harness(2)
    const [verbose, quiet] = t.worlds
    if (verbose === undefined || quiet === undefined) {
      throw new Error('Expected two fake worktrees')
    }
    verbose.api.script(
      writeCall('v0.txt', 'a'),
      writeCall('v1.txt', 'b'),
      writeCall('v2.txt', 'c'),
      writeCall('v3.txt', 'd'),
      writeCall('v4.txt', 'e'),
      writeCall('v5.txt', 'f'),
      { text: 'done verbose' },
    )
    quiet.api.script(writeCall('q.txt', 'quiet'), { text: 'done quiet' })
    await t.manager.start(
      { prompt: 'leave notes', attempts: 2, requestCeilingPerAttempt: 5 },
      'modelApi',
    )
    await awaitCompletedRun(t.updates)
    const finished = t.updates.at(-1)
    const capped = finished?.runAttempts[0]
    expect(capped).toMatchObject({ status: 'failed', ceilingReached: true, requestsMade: 5 })
    // Exactly five model requests fired for the capped attempt: the sixth
    // scripted reply was never consumed.
    expect(verbose.api.responseBodies()).toHaveLength(5)
    expect([...verbose.io.files].filter(([name]) => name.endsWith('v5.txt'))).toEqual([])
    const other = finished?.runAttempts[1]
    expect(other).toMatchObject({ status: 'completed', ceilingReached: false })
  })
})

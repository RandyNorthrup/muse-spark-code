// M96 lanes W and I through the host (C-M96-3): the engine worker and merge
// ports against real git. The worker's conversation is a fake session that
// edits files in its own copy and ends with a report; everything else (the
// copy, the branch, the commit, the `agents/` ref, the merge, cleanup) is the
// production code.

import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveWorkerReport } from '../../src/core/team/workers/engineWorker'
import {
  createEngineTeamPorts,
  type EngineTeamPortsDeps,
} from '../../src/host/team/teamEnginePorts'
import { configureResources } from '../../src/core/resources/admission'
import { immediateResourceSettings } from './helpers/resources/fixtureAdmission'
import { processTeamGit } from '../../src/core/team/workers/workerOps'
import type {
  TeamTaskMeter,
  TeamTaskSpec,
  TeamTaskWorkspace,
  TeamWorkerOutcome,
} from '../../src/core/team/teamHostService'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import type { SubagentUsage } from '../../src/shared/paid'
import type {
  ResponseAttemptGuard,
  ResponseAttemptOutcome,
} from '../../src/core/backends/modelapi/transport'
import type { TeamPoolEntry, TeamRoleConfig, TeamUsage } from '../../src/shared/team'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { createTeamHostService, TEAM_TASKS_STATE_KEY } from '../../src/core/team/teamHost'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  type ScriptedReply,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { Usd } from '../../src/shared/usd'
import { FakeAgentSession } from './helpers/fakeAgent'
import { cleanupTeamRoots, teamFixtureRepo, teamGitRunner, trackTeamRoot } from './helpers/teamGit'

cleanupTeamRoots()

const runGit = teamGitRunner()
const REPORT = '```muse-team-report\n{"status":"done","summary":"changed it"}\n```'
const ENTRY: TeamPoolEntry & { agent: NonNullable<TeamPoolEntry['agent']> } = {
  id: 'e1',
  concurrent: 1,
  caps: [],
  agent: { kind: 'engine', agentId: 'agent-1', model: 'other-model', pays: 'local' },
}

const silent = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

async function setup(
  edit: (folder: string) => Promise<void>,
  message = REPORT,
  start?: EngineTeamPortsDeps['startWorker'],
) {
  const { root, head } = await teamFixtureRepo(runGit)
  const storage = await mkdtemp(path.join(tmpdir(), 'muse-team-store-'))
  trackTeamRoot(storage)
  const started: {
    folder: string
    approvalMode: string
    admit: ResponseAttemptGuard
    noteUsage: (modelId: string, usage: SubagentUsage) => void
    fenceIo: (io: ToolIo) => ToolIo
  }[] = []
  const ports = createEngineTeamPorts({
    repositoryRoot: () => root,
    storageRoot: storage,
    platform: process.platform,
    isTrusted: () => true,
    listModels: () => Promise.resolve(['other-model', 'muse-spark-1.3']),
    startWorker: ({ folder, modelId, approvalMode, admit, noteUsage, fenceIo }) => {
      started.push({ folder, approvalMode, admit, noteUsage, fenceIo })
      if (start !== undefined)
        return start({
          folder,
          modelId,
          approvalMode,
          admit,
          noteUsage,
          fenceIo,
          parentSessionId: 's1',
        })
      const session = new FakeAgentSession(`worker-${String(started.length)}`, modelId)
      session.sendTurn.mockImplementation(async () => {
        await edit(folder)
        setTimeout(() => {
          session.emit(
            { type: 'turnStarted', turnId: 't1' },
            {
              type: 'itemCompleted',
              item: { itemId: 'm1', kind: 'agentMessage', status: 'completed', text: message },
            },
            { type: 'turnCompleted', turnId: 't1', terminal: 'completed' },
          )
        }, 0)
        return { turnId: 't1', disposition: 'started' }
      })
      return Promise.resolve({
        session,
        toolNames: ['read_file', 'edit_file', 'write_file', 'list_files', 'search_files'],
        close: () => Promise.resolve(),
      })
    },
    runGit,
    now: () => Date.now(),
    log: silent,
  })
  return { root, head, storage, ports, started }
}

function spec(
  role: TeamRoleConfig,
  taskId = 'task1',
  extra: Partial<TeamTaskSpec> = {},
): TeamTaskSpec {
  return {
    taskId,
    role,
    entry: ENTRY,
    brief: 'change tracked.txt',
    files: [],
    parentSessionId: 's1',
    meter: {
      admitRequest: () => undefined,
      reserveRequest: () => Promise.resolve(0),
      settleRequest: () => Promise.resolve(),
      noteUsage: () => Promise.resolve(),
      noteWorkspace: () => Promise.resolve(),
    },
    ...extra,
  }
}

const ENGINEERING: TeamRoleConfig = { role: 'engineering', pool: [ENTRY] }
const RESEARCH: TeamRoleConfig = { role: 'research', pool: [ENTRY] }

async function changedTask() {
  const fixture = await setup(async (folder) => {
    await writeFile(path.join(folder, 'tracked.txt'), 'after\n')
  })
  const outcome = await fixture.ports.workers.run(spec(ENGINEERING), new AbortController().signal)
  return { ...fixture, outcome }
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

describe('the engine worker port', () => {
  describe('a completed own-branch fixture', () => {
    const ready = Promise.withResolvers<Awaited<ReturnType<typeof changedTask>>>()
    // Native startup/commit is fixture preparation; assertions and merge keep the 5 s deadline.
    beforeAll(async () => {
      ready.resolve(await changedTask())
    })
    it('runs an own-branch task in its own copy, commits it and publishes the ref', async () => {
      const { root, head, ports, started, outcome } = await ready.promise
      expect(outcome.baseCommit).toBe(head)
      expect(outcome.head).not.toBe(head)
      expect(outcome.changedFiles).toEqual(['tracked.txt'])
      expect(started[0]?.approvalMode).toBe('allowAll')
      expect(path.resolve(started[0]?.folder ?? '').startsWith(path.resolve(root))).toBe(false)
      const ref = new TextDecoder().decode(
        await runGit(['rev-parse', '--verify', outcome.agentsRef ?? ''], root),
      )
      expect(ref.trim()).toBe(outcome.head)
      // The user's tree is untouched until the orchestrator merges.
      expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
      const diff = await ports.merges.diff(outcome)
      expect(diff).toContain('+after')
      const merged = await ports.merges.merge(
        { taskId: 'task1', role: ENGINEERING, outcome },
        new AbortController().signal,
        { allowProtected: false },
      )
      expect(merged).toEqual({ status: 'merged', written: ['tracked.txt'], conflicts: [] })
      expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('after\n')
      expect(await isPresent(outcome.folder ?? '')).toBe(false)
      await expect(
        runGit(['rev-parse', '--verify', outcome.agentsRef ?? ''], root),
      ).rejects.toThrow()
    })
  })

  describe('a continuation fixture', () => {
    const ready = Promise.withResolvers<{
      fixture: Awaited<ReturnType<typeof setup>>
      first: TeamWorkerOutcome
    }>()
    // Build the first completed task once; continuation itself stays inside the test deadline.
    beforeAll(async () => {
      let round = 0
      const fixture = await setup(async (folder) => {
        round += 1
        await writeFile(path.join(folder, 'tracked.txt'), `round ${String(round)}\n`)
      })
      const first = await fixture.ports.workers.run(spec(ENGINEERING), new AbortController().signal)
      ready.resolve({ fixture, first })
    })
    it('continues a finished task on the same copy and branch', async () => {
      const {
        fixture: { root, ports, started },
        first,
      } = await ready.promise
      const second = await ports.workers.run(
        spec(ENGINEERING, 'task2', { continueFrom: first }),
        new AbortController().signal,
      )
      expect(started[1]?.folder).toBe(started[0]?.folder)
      expect(second.branch).toBe(first.branch)
      expect(second.baseCommit).toBe(first.baseCommit)
      expect(second.head).not.toBe(first.head)
      const ref = new TextDecoder().decode(
        await runGit(['rev-parse', '--verify', second.agentsRef ?? ''], root),
      )
      expect(ref.trim()).toBe(second.head)
    })
  })

  it('fails a read-only task that changed its scratch copy, and removes the copy', async () => {
    const { ports, started } = await setup(async (folder) => {
      await writeFile(path.join(folder, 'tracked.txt'), 'sneaky\n')
    })
    const outcome = await ports.workers.run(spec(RESEARCH), new AbortController().signal)
    expect(started[0]?.approvalMode).toBe('denyUnmatched')
    expect(outcome.report.status).toBe('failed')
    expect(outcome.report.summary).toContain('tracked.txt')
    expect(outcome.branch).toBeUndefined()
    expect(await isPresent(started[0]?.folder ?? '')).toBe(false)
  })

  it('keeps an unstructured last message as the report, clipped', async () => {
    const { ports } = await setup(() => Promise.resolve(), 'No block here.')
    const outcome = await ports.workers.run(spec(ENGINEERING), new AbortController().signal)
    expect(outcome.report).toMatchObject({ status: 'unstructured' })
    expect(outcome.changedFiles).toEqual([])
  })

  it('removes the copy and the ref of a task stopped before its worker starts', async () => {
    const { root, ports, started } = await setup(() => Promise.resolve())
    const controller = new AbortController()
    controller.abort()
    await expect(ports.workers.run(spec(ENGINEERING), controller.signal)).rejects.toThrow()
    expect(started).toEqual([])
    await expect(
      runGit(['rev-parse', '--verify', 'refs/heads/agents/engineering/task1'], root),
    ).rejects.toThrow()
  })

  it('discards a finished task: its copy and its ref go', async () => {
    const { root, ports, outcome } = await changedTask()
    await ports.merges.discard({ taskId: 'task1', role: ENGINEERING, outcome })
    expect(await isPresent(outcome.folder ?? '')).toBe(false)
    await expect(runGit(['rev-parse', '--verify', outcome.agentsRef ?? ''], root)).rejects.toThrow()
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
  })

  it('probes the engine model list, and runs only engine agents', async () => {
    const { ports } = await setup(() => Promise.resolve())
    expect(await ports.workers.probe(ENTRY.agent)).toBe(true)
    expect(await ports.workers.probe({ ...ENTRY.agent, model: 'missing' })).toBe(false)
    expect(ports.workers.canRun(ENTRY.agent)).toBe(true)
    expect(ports.workers.canRun({ ...ENTRY.agent, kind: 'museCode' })).toBe(false)
    expect(ports.workers.isLimited?.(ENTRY.agent)).toBe(false)
  })

  it('runs production git with a credential-free environment', async () => {
    // Immediate grant and plain roots: the subject is git's environment,
    // not queueing or root proofs.
    const dispose = configureResources(
      immediateResourceSettings({ inspect: () => undefined, onError: () => undefined }),
    )
    try {
      const { root, head } = await setup(() => Promise.resolve())
      const resolved = new TextDecoder().decode(
        await processTeamGit(process.platform)(['rev-parse', 'HEAD'], root),
      )
      expect(resolved.trim()).toBe(head)
    } finally {
      dispose()
    }
  })
})

describe('the engine worker port after the RVCM963 review', () => {
  it('1+4: hands the worker host a fence, records its copy, and asks the task before every request', async () => {
    let isAdmitted = true
    const workspaces: TeamTaskWorkspace[] = []
    const { ports, started } = await setup(async (folder) => {
      await writeFile(path.join(folder, 'tracked.txt'), 'after\n')
    })
    const meter = {
      admitRequest: () => {
        if (!isAdmitted) throw new Error('revoked')
      },
      noteUsage: () => Promise.resolve(),
      reserveRequest: () => Promise.resolve(0),
      settleRequest: () => Promise.resolve(),
      noteWorkspace: (workspace: TeamTaskWorkspace | undefined) => {
        if (workspace !== undefined) workspaces.push(workspace)
        return Promise.resolve()
      },
    }
    const outcome = await ports.workers.run(
      spec(ENGINEERING, 'task1', { meter }),
      new AbortController().signal,
    )
    expect(workspaces).toEqual([expect.objectContaining({ folder: outcome.folder })])
    const worker = started[0]
    expect(() => worker?.admit(undefined)).not.toThrow()
    isAdmitted = false
    expect(() => worker?.admit(undefined)).toThrow('revoked')
    isAdmitted = true
    const base: ToolIo = {
      readFile: () => Promise.resolve(undefined),
      readBytes: () => Promise.resolve(undefined),
      writeFile: () => Promise.reject(new Error('the handle writes, never the base callback')),
      writeFileIfUnchanged: () => Promise.reject(new Error('unused')),
      pathExists: () => Promise.resolve(false),
      reserveFile: () => Promise.reject(new Error('unused')),
      hasUnsavedChanges: () => false,
      unsavedFiles: () => [],
      listFiles: () => Promise.resolve([]),
      searchFiles: () => Promise.reject(new Error('unused')),
      runShell: () => Promise.reject(new Error('unused')),
      realPath: (absolute) => Promise.resolve(absolute),
    }
    const fenced = worker?.fenceIo(base)
    const folder = outcome.folder ?? ''
    await expect(fenced?.writeFile(path.join(folder, '.git', 'config'), 'x')).rejects.toThrow()
    await fenced?.writeFile(path.join(folder, 'tracked.txt'), 'y')
    expect(await readFile(path.join(folder, 'tracked.txt'), 'utf8')).toBe('y')
  })

  it('R4-2: the engine reserves each request maximum and settles its usage report', async () => {
    const reserved: TeamUsage[] = []
    const settled: { ordinal: number; usage: TeamUsage }[] = []
    let ordinal = 0
    const { ports, started } = await setup(() => Promise.resolve())
    const meter: TeamTaskMeter = {
      admitRequest: () => undefined,
      reserveRequest: (maximum) => {
        reserved.push(maximum)
        ordinal += 1
        return Promise.resolve(ordinal)
      },
      settleRequest: (requestOrdinal, usage) => {
        settled.push({ ordinal: requestOrdinal, usage })
        return Promise.resolve()
      },
      noteUsage: () => Promise.resolve(),
      noteWorkspace: () => Promise.resolve(),
    }
    const outcome = await ports.workers.run(
      spec(ENGINEERING, 'task1', { meter }),
      new AbortController().signal,
    )
    expect(outcome.report.status).toBe('done')
    const settleClaim = await started[0]?.admit.reserveUsage?.({
      inputTokens: 80,
      outputTokens: 20,
      costUsd: Usd.from('0.75').toAmount(),
    })
    expect(reserved).toEqual([
      {
        input: 80,
        cachedInput: 0,
        output: 20,
        reasoning: 0,
        modelCalls: 1,
        estimated: true,
        costUsd: 0.75,
      },
    ])
    if (settleClaim === undefined) throw new Error('settlement callback missing')
    await settleClaim({
      kind: 'billed',
      usage: {
        inputTokens: 80,
        outputTokens: 20,
        cachedTokens: 5,
        costUsd: Usd.from('0.30').toAmount(),
      },
    })
    expect(settled).toEqual([
      {
        ordinal: 1,
        usage: {
          input: 80,
          cachedInput: 5,
          output: 20,
          reasoning: 0,
          modelCalls: 1,
          estimated: false,
          costUsd: 0.3,
        },
      },
    ])
    const settleNext = await started[0]?.admit.reserveUsage?.({
      inputTokens: 10,
      outputTokens: 2,
      costUsd: Usd.from('0.5').toAmount(),
    })
    if (settleNext === undefined) throw new Error('next settlement callback missing')
    await settleNext({
      kind: 'billed',
      usage: {
        inputTokens: 5,
        outputTokens: 1,
        cachedTokens: 0,
        costUsd: Usd.from('0.1').toAmount(),
      },
    })
    await settleClaim({
      kind: 'billed',
      usage: {
        inputTokens: 80,
        outputTokens: 20,
        cachedTokens: 5,
        costUsd: Usd.from('0.2').toAmount(),
      },
    })
    expect(settled.map((claim) => claim.ordinal)).toEqual([1, 2])
  })

  it('14: merges a protected path only with the approval the merge card gave', async () => {
    const { root, ports } = await setup(async (folder) => {
      await mkdir(path.join(folder, '.github', 'workflows'), { recursive: true })
      await writeFile(path.join(folder, '.github', 'workflows', 'ci.yml'), 'on: push\n')
    })
    const outcome = await ports.workers.run(spec(ENGINEERING), new AbortController().signal)
    await expect(
      ports.merges.merge(
        { taskId: 'task1', role: ENGINEERING, outcome },
        new AbortController().signal,
        {
          allowProtected: false,
        },
      ),
    ).rejects.toThrow()
    const merged = await ports.merges.merge(
      { taskId: 'task1', role: ENGINEERING, outcome },
      new AbortController().signal,
      { allowProtected: true },
    )
    expect(merged.status).toBe('merged')
    expect(await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')).toBe(
      'on: push\n',
    )
  })

  it('5: a merge whose call was cancelled writes nothing', async () => {
    const { root, ports, outcome } = await changedTask()
    const controller = new AbortController()
    controller.abort()
    await expect(
      ports.merges.merge({ taskId: 'task1', role: ENGINEERING, outcome }, controller.signal, {
        allowProtected: false,
      }),
    ).rejects.toThrow()
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
  })
})

it('R4-11: the production report parser preserves structured review findings', () => {
  const finding = { file: 'a.ts', line: 2, severity: 'P1', title: 'unsafe', detail: 'race detail' }
  expect(
    resolveWorkerReport({
      reportedText: JSON.stringify({ status: 'done', summary: 'complete', findings: [finding] }),
      lastMessage: undefined,
    }),
  ).toMatchObject({ ok: true, report: { findings: [finding] } })
})

it.each([
  {
    outcome: {
      kind: 'billed',
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        cachedTokens: 2,
        costUsd: Usd.from('0.1').toAmount(),
      },
    },
    expected: {
      input: 12,
      output: 3,
      cachedInput: 2,
      modelCalls: 1,
      estimated: false,
      costUsd: 0.1,
    },
  },
  {
    outcome: { kind: 'ambiguous' },
    expected: {
      input: 80,
      output: 20,
      cachedInput: 0,
      modelCalls: 1,
      estimated: true,
      costUsd: 0.75,
    },
  },
  {
    outcome: { kind: 'released' },
    expected: { input: 0, output: 0, cachedInput: 0, modelCalls: 0, estimated: false, costUsd: 0 },
  },
] satisfies { outcome: ResponseAttemptOutcome; expected: Partial<TeamUsage> }[])(
  'R6 engine outcomes: $outcome.kind closes its exact claim once',
  async ({ outcome, expected }) => {
    const settled: { ordinal: number; usage: TeamUsage; isFinal?: boolean | undefined }[] = []
    const { ports, started } = await setup(() => Promise.resolve())
    await ports.workers.run(
      spec(ENGINEERING, 'task1', {
        meter: {
          admitRequest: () => undefined,
          reserveRequest: () => Promise.resolve(1),
          settleRequest: (ordinal, usage, isFinal) => {
            settled.push({ ordinal, usage, isFinal })
            return Promise.resolve()
          },
          noteUsage: () => Promise.resolve(),
          noteWorkspace: () => Promise.resolve(),
        },
      }),
      new AbortController().signal,
    )
    const close = await started[0]?.admit.reserveUsage?.({
      inputTokens: 80,
      outputTokens: 20,
      costUsd: Usd.from('0.75').toAmount(),
    })
    if (close === undefined) throw new Error('claim callback missing')
    await close(outcome)
    await close(outcome)
    expect(settled).toEqual([{ ordinal: 1, usage: { ...expected, reasoning: 0 }, isFinal: true }])
  },
)

it.each([
  { name: 'success', failures: [], outcomes: ['billed'], posts: 1 },
  {
    name: '5xx then success',
    failures: [{ httpError: { status: 503 } }],
    outcomes: ['ambiguous', 'billed'],
    posts: 2,
  },
  {
    name: 'dispatched timeout then success',
    failures: [{ networkError: 'timeout', networkErrorCode: 'ETIMEDOUT' }],
    outcomes: ['ambiguous', 'billed'],
    posts: 2,
  },
  {
    name: 'retry cannot fit retained liability',
    failures: [{ httpError: { status: 503 } }],
    outcomes: ['ambiguous'],
    posts: 1,
    limit: 0.2,
  },
  { name: 'refusal', failures: [{ httpError: { status: 400 } }], outcomes: ['released'], posts: 1 },
  { name: 'failure before dispatch', failures: [], outcomes: ['released'], posts: 0, revoke: true },
  {
    name: 'abort between attempts',
    failures: [{ httpError: { status: 503 } }],
    outcomes: ['ambiguous'],
    posts: 1,
    cancel: true,
  },
] satisfies {
  name: string
  failures: ScriptedReply[]
  outcomes: string[]
  posts: number
  revoke?: boolean
  cancel?: boolean
  limit?: number
}[])(
  'R6 integrated accounting: $name sums host/engine/service outcomes',
  async ({ failures, outcomes, posts, ...fault }) => {
    const api = fakeModelApi()
    api.models.push('muse-spark-1.3')
    api.script(...failures, { text: REPORT, usage: { input: 12, output: 3 } })
    const maxima: { costUsd?: string | undefined }[] = []
    const h = await setup(
      () => Promise.resolve(),
      REPORT,
      async ({ folder, modelId, approvalMode, admit, noteUsage }) => {
        const reserve = admit.reserveUsage
        if (reserve === undefined) throw new Error('worker reservation missing')
        const guard: ResponseAttemptGuard = Object.assign(
          (key: string | undefined) => {
            if (fault.revoke) throw new Error('revoked before dispatch')
            admit(key)
          },
          {
            reserveUsage: async (maximum: Parameters<typeof reserve>[0]) => {
              const claim = await reserve(maximum)
              if (typeof claim !== 'function') throw new Error('worker claim missing')
              maxima.push(maximum)
              return claim
            },
          },
        )
        const client = new ModelApiClient({
          ...fakeModelApiClientSettings(silent),
          fetch: api.fetch,
        })
        const host = new ModelApiHost({
          ...fakeModelApiHostDeps({
            client,
            workspaceRoot: folder,
            io: memoryToolIo({}, folder),
            log: silent,
          }),
          admitResponseAttempt: guard,
          noteResponseUsage: noteUsage,
        })
        const session = await host.startSession({ workspaceRoot: folder, modelId, approvalMode })
        if (fault.cancel)
          session.onEvent((event) => {
            if (event.type === 'turnRetry') void session.cancel()
          })
        return { session, toolNames: [], close: () => host.close() }
      },
    )
    const workerEntry = {
      ...ENTRY,
      agent: { ...ENTRY.agent, model: 'muse-spark-1.3', pays: 'key' as const },
      caps: [
        { measure: 'spendUsd' as const, window: 'lifetime' as const, amount: fault.limit ?? 2 },
        { measure: 'spendUsd' as const, window: 'day' as const, amount: fault.limit ?? 2 },
      ],
    }
    const values = new Map<string, unknown>([
      [
        TEAM_WORKSPACE_KEYS.team,
        {
          roles: [{ role: 'engineering', workspace: 'own-branch', pool: [workerEntry] }],
          intensity: 'balanced',
        },
      ],
    ])
    const service = createTeamHostService({
      state: {
        get: (key) => values.get(key),
        update: (key, value) => {
          values.set(key, value)
          return Promise.resolve()
        },
      },
      settings: {
        isTeamOn: () => true,
        isTeamWorkersOn: () => true,
        maxWorkers: () => 1,
        isTrusted: () => true,
      },
      orchestrator: {
        modelId: () => 'orchestrator',
        backend: () => 'modelApi',
        approvalMode: () => 'allowAll',
      },
      workers: h.ports.workers,
      merges: h.ports.merges,
      cards: { show: () => undefined },
      paid: { allowKeyTasks: () => Promise.resolve(true) },
      newId: () => 'integrated-task',
      now: () => Date.now(),
      log: silent,
    })
    const finished = Promise.withResolvers<undefined>()
    const stopWatching = service.onTreeChange((tree) => {
      if (h.started.length > 0 && tree?.roles[0]?.entries[0]?.running === 0)
        finished.resolve(undefined)
    })
    try {
      await service.probeEntries()
      await service.teamRunner.delegate(
        {
          tasks: [
            { role: 'engineering', brief: 'work', reason: { code: 'parallel', detail: 'test' } },
          ],
        },
        { sessionId: 's1', approvalMode: 'allowAll', signal: new AbortController().signal },
      )
      await finished.promise
      expect(values.get(TEAM_TASKS_STATE_KEY)).toMatchObject({
        tasks: [{ endMs: expect.any(Number) }],
      })
      expect(api.responseBodies()).toHaveLength(posts)
      expect(maxima).toHaveLength(outcomes.length)
      let total = 0
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome === 'ambiguous') total += Number(maxima[index]?.costUsd)
        else if (outcome === 'billed') total += 0.00002775
      }
      expect(service.tree()?.roles[0]?.entries[0]?.caps[0]?.used).toBeCloseTo(total, 10)
      expect(service.tree()?.roles[0]?.entries[0]?.caps[1]?.used).toBeCloseTo(total, 10)
      expect(values.get(TEAM_TASKS_STATE_KEY)).toMatchObject({
        tasks: [{ claims: outcomes.map(() => ({ isSettled: true })) }],
      })
      await service.resetEntry('e1')
      expect(service.tree()?.roles[0]?.entries[0]?.caps[0]?.used).toBe(0)
      expect(service.tree()?.roles[0]?.entries[0]?.caps[1]?.used).toBe(0)
    } finally {
      stopWatching()
      await service.dispose()
    }
  },
)

// M116 (D212): team dispatches through the real playbook integration: a
// real team host, a real policy over a real file journal, and the dispatch
// base read over real git. A task with files journals its dispatch brief;
// a task whose brief carries a template marker is refused and its sibling
// still starts; a task with no files runs ungoverned; the work releases
// when the task ends.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { createTeamHostService } from '../../src/core/team/teamHost'
import type { TeamHostServiceDeps, TeamWorkerOutcome } from '../../src/core/team/teamHostService'
import type { TeamToolContext } from '../../src/core/team/teamSeams'
import { isTeamGitError, TeamGitError, type TeamGit } from '../../src/core/team/teamGit'
import { isTeamWorkspaceError, readDispatchHead } from '../../src/core/team/teamWorkspaces'
import type { TeamPoolEntry, TeamSnapshot } from '../../src/shared/team'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
import {
  OPTIONAL_RUNTIME_AVAILABILITY,
  SETTING_DEFAULTS,
  TEAM_MODEL_TEXT,
} from '../../src/shared/constants'
import {
  FilePlaybookJournal,
  validatedRecords,
} from '../../src/core/orchestration/playbook/journal'
import {
  createCapacityAdmission,
  createReadingHolder,
} from '../../src/core/orchestration/playbook/readingHolder'
import { createTeamPlaybookIntegration } from '../../src/host/playbook/teamPlaybook'
import type { ResourceStatus } from '../../src/shared/resources'

beforeAll(async () => {
  await import('../../src/core/team/teamMergeFlow')
})

beforeAll(() => {
  OPTIONAL_RUNTIME_AVAILABILITY.team = true
})
afterAll(() => {
  OPTIONAL_RUNTIME_AVAILABILITY.team = false
})

/** The real git binary behind the `TeamGit` contract. */
const realGit: TeamGit = (args, cwd) => {
  try {
    const out = execFileSync('git', [...args], { cwd, encoding: 'buffer' })
    return Promise.resolve(new Uint8Array(out))
  } catch (error) {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : 128
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''
    return Promise.reject(new TeamGitError(status, stderr, args.join(' ')))
  }
}

function scratchRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'm116-team-host-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'base',
    ],
    { cwd: root },
  )
  return root
}

function entry(id: string): TeamPoolEntry {
  return {
    id,
    concurrent: 2,
    caps: [],
    agent: { kind: 'engine', agentId: `agent-${id}`, model: 'worker-model-1', pays: 'local' },
  }
}

function team(): TeamSnapshot {
  return {
    roles: [{ role: 'engineering', workspace: 'own-branch', pool: [entry('e1')] }],
    intensity: 'balanced',
  }
}

function context(): TeamToolContext {
  return {
    sessionId: 's1',
    approvalMode: 'manual',
    signal: new AbortController().signal,
    orchestratorModelId: 'orchestrator-model-1',
  }
}

function harness() {
  const repo = scratchRepo()
  const data = mkdtempSync(path.join(tmpdir(), 'm116-team-host-data-'))
  onTestFinished(() => {
    rmSync(data, { recursive: true, force: true })
  })
  mkdirSync(data, { recursive: true })
  const values = new Map<string, unknown>([[TEAM_WORKSPACE_KEYS.team, team()]])
  const resolvers: ((outcome: TeamWorkerOutcome) => void)[] = []
  let id = 0
  const deps: TeamHostServiceDeps = {
    state: {
      get: (key) => values.get(key),
      update: async (key, value) => {
        values.set(key, value)
        await Promise.resolve()
      },
    },
    settings: {
      isTeamOn: () => true,
      isTeamWorkersOn: () => true,
      maxWorkers: () => 4,
      isTrusted: () => true,
      hooksMaxStopContinuations: () => SETTING_DEFAULTS.hooksMaxStopContinuations,
    },
    orchestrator: {
      modelId: () => 'orchestrator-model-1',
      backend: () => 'modelApi',
      defaultAgent: () => undefined,
      approvalMode: () => 'manual',
    },
    workers: {
      canRun: () => true,
      probe: () => Promise.resolve(true),
      run: () =>
        new Promise<TeamWorkerOutcome>((resolve) => {
          resolvers.push(resolve)
        }),
    },
    merges: {
      merge: () => Promise.resolve({ status: 'merged', written: ['a.ts'], conflicts: [] }),
      discard: () => Promise.resolve(),
      diff: () => Promise.resolve('diff'),
    },
    cards: { show: () => undefined },
    paid: { allowKeyTasks: () => Promise.resolve(true) },
    playbook: {
      create: (facts) =>
        createTeamPlaybookIntegration({
          agentDataFolder: data,
          workspaceFolder: repo,
          teamId: 'team',
          laneId: 'team',
          checkAdmission: createCapacityAdmission(createReadingHolder<ResourceStatus>()),
          lanes: () => [],
          entries: () => facts().entries,
          branches: () => facts().branches,
          ci: () => ({ known: false }),
          events: {
            note: () => undefined,
            offerRedesign: () => undefined,
            hookOutput: () => undefined,
            failure: () => undefined,
          },
        }),
      head: async (mode) => {
        try {
          return await readDispatchHead(realGit, repo, mode)
        } catch (error: unknown) {
          if (isTeamGitError(error) || isTeamWorkspaceError(error))
            return { refused: error.message }
          throw error
        }
      },
    },
    newId: () => {
      id += 1
      return `task-${String(id)}`
    },
    now: () => 1_000_000,
    log: { info: () => undefined, warn: () => undefined },
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  return {
    repo,
    data,
    head,
    service: createTeamHostService(deps),
    finish: (index: number) => {
      resolvers[index]?.({
        report: { status: 'done', summary: 'did it' },
        usage: {
          input: 10,
          cachedInput: 0,
          output: 5,
          reasoning: 0,
          modelCalls: 1,
          estimated: false,
        },
        branch: 'agents/engineering/task-1',
        baseCommit: head,
        head,
        changedFiles: ['src/team/retry.ts'],
        folder: path.join(repo, 'copy'),
        agentsRef: 'refs/heads/agents/engineering/task-1',
      })
    },
  }
}

async function journalLines(data: string, root: string): Promise<string[]> {
  const file = new FilePlaybookJournal(data, root).file
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (existsSync(file)) return readFileSync(file, 'utf8').split('\n').filter(Boolean)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for the journal to settle')
}

describe('team dispatches through the playbook', () => {
  it('journals the dispatch brief of a task with files', async () => {
    const h = harness()
    await h.service.probeEntries()
    const result = await h.service.teamRunner.delegate(
      {
        tasks: [
          {
            role: 'engineering',
            brief: 'Rework the retry helper',
            reason: { code: 'parallel', detail: 'x' },
            files: ['src/team/retry.ts'],
          },
        ],
      },
      context(),
    )
    const tasks = (JSON.parse(result.output) as { tasks: unknown[] }).tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ task_id: 'task-1' })
    const lines = await journalLines(h.data, h.repo)
    const records = validatedRecords(lines.map((line) => JSON.parse(line) as unknown))
    const brief = records.find((record) => record.kind === 'note')
    expect(brief).toMatchObject({
      kind: 'note',
      value: { code: 'briefRecorded', module: 'src/team' },
    })
    expect(brief?.kind === 'note' && brief.value.reason).toContain(h.head)
    expect(
      records.some((record) => record.kind === 'work' && record.value.moduleId === 'team:task-1'),
    ).toBe(true)
  })

  it('refuses a template-marked brief and still starts its sibling', async () => {
    const h = harness()
    await h.service.probeEntries()
    const result = await h.service.teamRunner.delegate(
      {
        tasks: [
          {
            role: 'engineering',
            brief: 'Rework {{the thing}}',
            reason: { code: 'parallel', detail: 'x' },
            files: ['src/team/retry.ts'],
          },
          {
            role: 'engineering',
            brief: 'Rework the retry helper',
            reason: { code: 'parallel', detail: 'x' },
            files: ['src/team/other.ts'],
          },
        ],
      },
      context(),
    )
    const tasks = (JSON.parse(result.output) as { tasks: unknown[] }).tasks
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toEqual({
      role: 'engineering',
      refused: TEAM_MODEL_TEXT.hostPlaybookBriefInvalid,
    })
    expect(tasks[1]).toMatchObject({ task_id: 'task-2' })
  })

  it('runs a task with no files ungoverned: no start, no journal', async () => {
    const h = harness()
    await h.service.probeEntries()
    const result = await h.service.teamRunner.delegate(
      {
        tasks: [
          {
            role: 'engineering',
            brief: 'Survey the codebase',
            reason: { code: 'parallel', detail: 'x' },
          },
        ],
      },
      context(),
    )
    const tasks = (JSON.parse(result.output) as { tasks: unknown[] }).tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ task_id: 'task-1' })
    expect(existsSync(new FilePlaybookJournal(h.data, h.repo).file)).toBe(false)
    h.finish(0)
  })

  it('releases the admitted work when the task ends', async () => {
    const h = harness()
    await h.service.probeEntries()
    await h.service.teamRunner.delegate(
      {
        tasks: [
          {
            role: 'engineering',
            brief: 'Rework the retry helper',
            reason: { code: 'parallel', detail: 'x' },
            files: ['src/team/retry.ts'],
          },
        ],
      },
      context(),
    )
    h.finish(0)
    const file = new FilePlaybookJournal(h.data, h.repo).file
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
      if (text.includes('"released"')) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('Timed out waiting for the work to release')
  })
})

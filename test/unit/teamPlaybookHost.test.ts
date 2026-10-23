// M116 (D216): team dispatches through the real playbook integration: a
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
import type { TeamHostServiceDeps } from '../../src/core/team/teamHostService'
import { harness as serviceHarness } from './helpers/teamHostHarness'
import type { TeamToolContext } from '../../src/core/team/teamSeams'
import type { DelegateArgs } from '../../src/core/team/teamTools'
import { isTeamGitError } from '../../src/core/team/teamGit'
import { realTeamGit as realGit, scratchTeamRepo } from './helpers/teamGit'
import { isTeamWorkspaceError, readDispatchHead } from '../../src/core/team/teamWorkspaces'
import type { TeamPoolEntry, TeamSnapshot } from '../../src/shared/team'
import { OPTIONAL_RUNTIME_AVAILABILITY, TEAM_MODEL_TEXT } from '../../src/shared/constants'
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

async function delegate(
  h: ReturnType<typeof harness>,
  tasks: DelegateArgs['tasks'],
): Promise<unknown[]> {
  await h.service.probeEntries()
  const result = await h.service.teamRunner.delegate({ tasks }, context())
  return (JSON.parse(result.output) as { tasks: unknown[] }).tasks
}

function harness() {
  const repo = scratchTeamRepo('m116-team-host-')
  const data = mkdtempSync(path.join(tmpdir(), 'm116-team-host-data-'))
  onTestFinished(() => {
    rmSync(data, { recursive: true, force: true })
  })
  mkdirSync(data, { recursive: true })
  const base = serviceHarness(team())
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  const deps: TeamHostServiceDeps = {
    ...base.deps,
    orchestrator: {
      modelId: () => 'orchestrator-model-1',
      backend: () => 'modelApi',
      defaultAgent: () => undefined,
      approvalMode: () => 'manual',
    },
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
  }
  return {
    repo,
    data,
    head,
    service: createTeamHostService(deps),
    finish: (index: number) => {
      base.finish(index, {
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
    const tasks = await delegate(h, [
      {
        role: 'engineering',
        brief: 'Rework the retry helper',
        reason: { code: 'parallel', detail: 'x' },
        files: ['src/team/retry.ts'],
      },
    ])
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
    const tasks = await delegate(h, [
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
    ])
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toEqual({
      role: 'engineering',
      refused: TEAM_MODEL_TEXT.hostPlaybookBriefInvalid,
    })
    expect(tasks[1]).toMatchObject({ task_id: 'task-2' })
  })

  it('runs a task with no files ungoverned: no start, no journal', async () => {
    const h = harness()
    const tasks = await delegate(h, [
      {
        role: 'engineering',
        brief: 'Survey the codebase',
        reason: { code: 'parallel', detail: 'x' },
      },
    ])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ task_id: 'task-1' })
    expect(existsSync(new FilePlaybookJournal(h.data, h.repo).file)).toBe(false)
    h.finish(0)
  })

  it('releases the admitted work when the task ends', async () => {
    const h = harness()
    await delegate(h, [
      {
        role: 'engineering',
        brief: 'Rework the retry helper',
        reason: { code: 'parallel', detail: 'x' },
        files: ['src/team/retry.ts'],
      },
    ])
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

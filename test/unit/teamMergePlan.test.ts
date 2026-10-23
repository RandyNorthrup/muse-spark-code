// The merge planner binding over a real repository: the engine ports'
// `plan` answers what a merge would do (the planner's files, protected
// flags and write-paths judgement) without writing, and refuses a moved
// agents ref before any card could be shown. Real git only.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createEngineTeamPorts } from '../../src/host/team/teamEnginePorts'
import type { TeamWorkerOutcome } from '../../src/core/team/teamHostService'
import { realTeamGit, scratchTeamRepo } from './helpers/teamGit'

const GIT_IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid']

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8' }).trim()
}

describe('engine merge planner binding (real git)', () => {
  it('plans files, protected flags and write-paths without writing; refuses a moved ref', async () => {
    const repo = scratchTeamRepo('team-merge-plan-')
    const storage = mkdtempSync(path.join(tmpdir(), 'team-merge-plan-store-'))
    onTestFinished(() => {
      rmSync(storage, { recursive: true, force: true })
    })
    const base = git(repo, ['rev-parse', 'HEAD'])
    git(repo, ['checkout', '-q', '-b', 'agents/engineering/task-1'])
    writeFileSync(path.join(repo, 'feature.ts'), 'export const answer = 42\n')
    mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true })
    writeFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
    git(repo, ['add', '--', 'feature.ts', '.github/workflows/ci.yml'])
    git(repo, ['commit', '-q', '-m', 'task work'])
    const head = git(repo, ['rev-parse', 'HEAD'])
    git(repo, ['checkout', '-q', 'main'])

    const ports = createEngineTeamPorts({
      repositoryRoot: () => repo,
      storageRoot: storage,
      platform: process.platform,
      isTrusted: () => true,
      listModels: () => Promise.resolve([]),
      // Planning starts no worker: a call here is the failure it reports.
      startWorker: () => Promise.reject(new Error('plan must not start a worker')),
      runGit: realTeamGit,
      now: () => 0,
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })
    const outcome: TeamWorkerOutcome = {
      report: { status: 'done', summary: 'did it' },
      usage: { input: 0, cachedInput: 0, output: 0, reasoning: 0, modelCalls: 0, estimated: false },
      branch: 'agents/engineering/task-1',
      baseCommit: base,
      head,
      changedFiles: ['feature.ts', '.github/workflows/ci.yml'],
      folder: storage,
      agentsRef: 'refs/heads/agents/engineering/task-1',
    }
    const role = { role: 'engineering', writePaths: ['feature.ts'], pool: [] }

    const planned = await ports.merges.plan({ taskId: 'task-1', role, outcome })
    expect(planned.map((file) => file.path).toSorted((a, b) => a.localeCompare(b))).toEqual([
      '.github/workflows/ci.yml',
      'feature.ts',
    ])
    const ci = planned.find((file) => file.path === '.github/workflows/ci.yml')
    expect(ci?.isProtected).toBe(true)
    expect(ci?.outsideWritePaths).toBe(true)
    const feature = planned.find((file) => file.path === 'feature.ts')
    expect(feature?.change).toBe('added')
    expect(feature?.isProtected).toBe(false)
    expect(feature?.outsideWritePaths).toBe(false)
    // Planning wrote nothing: the user's tree is still at the base.
    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(base)
    expect(git(repo, ['status', '--porcelain'])).toBe('')

    // A moved agents ref refuses at plan time, before any card.
    git(repo, ['update-ref', 'refs/heads/agents/engineering/task-1', base])
    await expect(ports.merges.plan({ taskId: 'task-1', role, outcome })).rejects.toThrow(
      /moved ref/u,
    )
  })
})

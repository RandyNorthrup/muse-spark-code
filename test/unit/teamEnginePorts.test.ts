// M96 lanes W and I through the host (C-M96-3): the engine worker and merge
// ports against real git. The worker's conversation is a fake session that
// edits files in its own copy and ends with a report; everything else (the
// copy, the branch, the commit, the `agents/` ref, the merge, cleanup) is the
// production code.

import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEngineTeamPorts, processTeamGit } from '../../src/host/team/teamEnginePorts'
import type { TeamTaskSpec, TeamTaskWorkspace } from '../../src/core/team/teamHostService'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import type { TeamPoolEntry, TeamRoleConfig } from '../../src/shared/team'
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

async function setup(edit: (folder: string) => Promise<void>, message = REPORT) {
  const { root, head } = await teamFixtureRepo(runGit)
  const storage = await mkdtemp(path.join(tmpdir(), 'muse-team-store-'))
  trackTeamRoot(storage)
  const started: {
    folder: string
    approvalMode: string
    admit: (keyDigest: string | undefined) => void
    fenceIo: (io: ToolIo) => ToolIo
  }[] = []
  const ports = createEngineTeamPorts({
    repositoryRoot: () => root,
    storageRoot: storage,
    platform: process.platform,
    isTrusted: () => true,
    listModels: () => Promise.resolve(['other-model', 'muse-spark-1.3']),
    startWorker: ({ folder, modelId, approvalMode, admit, fenceIo }) => {
      started.push({ folder, approvalMode, admit, fenceIo })
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
      noteUsage: () => undefined,
      noteWorkspace: () => undefined,
    },
    ...extra,
  }
}

const ENGINEERING: TeamRoleConfig = { role: 'engineering', pool: [ENTRY] }
const RESEARCH: TeamRoleConfig = { role: 'research', pool: [ENTRY] }

async function isPresent(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

describe('the engine worker port', () => {
  it('runs an own-branch task in its own copy, commits it and publishes the ref', async () => {
    const { root, head, ports, started } = await setup(async (folder) => {
      await writeFile(path.join(folder, 'tracked.txt'), 'after\n')
    })
    const outcome = await ports.workers.run(spec(ENGINEERING), new AbortController().signal)
    expect(outcome.report).toEqual({ status: 'done', summary: 'changed it' })
    expect(outcome.branch).toBe('agents/engineering/task1')
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
    await expect(runGit(['rev-parse', '--verify', outcome.agentsRef ?? ''], root)).rejects.toThrow()
  })

  it('continues a finished task on the same copy and branch', async () => {
    let round = 0
    const { root, ports, started } = await setup(async (folder) => {
      round += 1
      await writeFile(path.join(folder, 'tracked.txt'), `round ${String(round)}\n`)
    })
    const first = await ports.workers.run(spec(ENGINEERING), new AbortController().signal)
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
    const { root, ports } = await setup(async (folder) => {
      await writeFile(path.join(folder, 'tracked.txt'), 'after\n')
    })
    const outcome = await ports.workers.run(spec(ENGINEERING), new AbortController().signal)
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
    const { root, head } = await setup(() => Promise.resolve())
    const resolved = new TextDecoder().decode(
      await processTeamGit(process.platform)(['rev-parse', 'HEAD'], root),
    )
    expect(resolved.trim()).toBe(head)
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
      noteUsage: () => undefined,
      noteWorkspace: (workspace: TeamTaskWorkspace) => {
        workspaces.push(workspace)
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
    const writes: string[] = []
    const base: ToolIo = {
      readFile: () => Promise.resolve(undefined),
      readBytes: () => Promise.resolve(undefined),
      writeFile: (absolute) => {
        writes.push(absolute)
        return Promise.resolve()
      },
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
    expect(writes).toEqual([path.join(folder, 'tracked.txt')])
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
    const { root, ports } = await setup(async (folder) => {
      await writeFile(path.join(folder, 'tracked.txt'), 'after\n')
    })
    const outcome = await ports.workers.run(spec(ENGINEERING), new AbortController().signal)
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

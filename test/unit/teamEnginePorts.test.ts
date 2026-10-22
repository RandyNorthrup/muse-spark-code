// The engine worker and merge ports over a real workspace (M96 lanes W and
// I): the real `createEngineTeamPorts` against a real git repository in a
// temporary folder, through the TeamGit contract over the real git binary.
// Worker refusals (trust, repository, charter, workspace mode, settings)
// fire before any copy exists; merges land real branches, refuse moved refs
// and unapproved protected paths, and remove the copy they landed. The
// model conversation itself is never reached: `listModels` and `startWorker`
// are tripwires that fail loudly if the product ever calls them here, and
// the meter is a tripwire for the same reason. The live drill
// (test/e2e/team.live.e2e.test.ts) proves the full dispatch through a real
// worker turn.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { TEAM_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { TeamAgentRef, TeamPoolEntry, TeamRoleConfig } from '../../src/shared/team'
import { createEngineTeamPorts } from '../../src/host/team/teamEnginePorts'
import type { TeamSettingCapabilities } from '../../src/core/team/modelSettings'
import {
  commitTaskBranch,
  publishTaskRef,
  resolveBaseCommit,
  startTeamWorkspace,
} from '../../src/core/team/teamWorkspaces'
import { TeamMergeError } from '../../src/core/team/teamMerge'
import type {
  TeamMergePort,
  TeamTaskMeter,
  TeamTaskSpec,
  TeamWorkerOutcome,
} from '../../src/core/team/teamHostService'
import { silentCoreLog } from './helpers/memoryLogs'
import { realTeamGit as realGit } from './helpers/realTeamGit'

function scratchDir(prefix: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), prefix))
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true })
  })
  return folder
}

/** A real repository with one committed file; the returned base is its HEAD. */
function scratchRepo(): { root: string; baseCommit: string } {
  const root = scratchDir('team-ports-repo-')
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  writeFileSync(path.join(root, 'a.ts'), 'const value = 1\n')
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', '--all', '--'],
    {
      cwd: root,
    },
  )
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'],
    { cwd: root },
  )
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  return { root, baseCommit }
}

function agent(kind: TeamAgentRef['kind']): TeamAgentRef {
  return { kind, agentId: `agent-${kind}`, model: 'worker-model', pays: 'local' }
}

function tripwireError(name: string): Error {
  return new Error(`test: the ports never call ${name} here`)
}

function portsFor(
  root: string,
  storage: string,
  overrides: {
    isTrusted?: () => boolean
    repositoryRoot?: () => string | undefined
    capabilitiesForModel?: (modelId: string) => TeamSettingCapabilities | undefined
  } = {},
) {
  return createEngineTeamPorts({
    repositoryRoot: overrides.repositoryRoot ?? (() => root),
    storageRoot: storage,
    platform: process.platform,
    isTrusted: overrides.isTrusted ?? (() => true),
    listModels: () => Promise.reject(tripwireError('listModels')),
    startWorker: () => Promise.reject(tripwireError('startWorker')),
    ...(overrides.capabilitiesForModel !== undefined && {
      capabilitiesForModel: overrides.capabilitiesForModel,
    }),
    runGit: realGit,
    now: () => Date.now(),
    log: silentCoreLog(),
  })
}

const tripwireMeter: TeamTaskMeter = {
  admitRequest: () => {
    throw tripwireError('meter.admitRequest')
  },
  reserveRequest: () => Promise.reject(tripwireError('meter.reserveRequest')),
  settleRequest: () => Promise.reject(tripwireError('meter.settleRequest')),
  noteUsage: () => Promise.reject(tripwireError('meter.noteUsage')),
  noteWorkspace: () => Promise.reject(tripwireError('meter.noteWorkspace')),
}

function entry(): TeamPoolEntry & { agent: TeamAgentRef } {
  return { id: 'e1', concurrent: 1, caps: [], agent: agent('engine') }
}

function role(overrides: Partial<TeamRoleConfig> = {}): TeamRoleConfig {
  return { role: 'engineering', workspace: 'own-branch', pool: [entry()], ...overrides }
}

function spec(roleConfig: TeamRoleConfig): TeamTaskSpec {
  return {
    taskId: 'task-1',
    role: roleConfig,
    entry: entry(),
    brief: 'Change the file.',
    files: [],
    parentSessionId: 's1',
    meter: tripwireMeter,
  }
}

function mergeOutcome(
  merges: TeamMergePort,
  outcome: TeamWorkerOutcome,
  isProtectedAllowed: boolean,
) {
  return merges.merge({ taskId: 'task-1', role: role(), outcome }, new AbortController().signal, {
    allowProtected: isProtectedAllowed,
  })
}

// The merge's thrown failure, or undefined when it unexpectedly lands (the
// caller's TeamMergeError assertion then fails on the undefined).
async function mergeFailure(merges: TeamMergePort, outcome: TeamWorkerOutcome): Promise<unknown> {
  try {
    await mergeOutcome(merges, outcome, false)
  } catch (error: unknown) {
    return error
  }
  return undefined
}

describe('the engine worker port', () => {
  it('runs engine agents and no other kind', () => {
    const { root } = scratchRepo()
    const { workers } = portsFor(root, scratchDir('team-ports-storage-'))
    expect(workers.canRun(agent('engine'))).toBe(true)
    expect(workers.canRun(agent('museCode'))).toBe(false)
    expect(workers.canRun(agent('external'))).toBe(false)
  })

  it('refuses an untrusted workspace before creating anything', async () => {
    const { root } = scratchRepo()
    const storage = path.join(scratchDir('team-ports-parent-'), 'storage')
    const { workers } = portsFor(root, storage, { isTrusted: () => false })
    await expect(workers.run(spec(role()), new AbortController().signal)).rejects.toThrow(
      TEAM_MODEL_TEXT.hostUntrusted,
    )
    expect(existsSync(storage)).toBe(false)
  })

  it('refuses without a repository', async () => {
    const { root } = scratchRepo()
    const { workers } = portsFor(root, scratchDir('team-ports-storage-'), {
      repositoryRoot: () => undefined,
    })
    await expect(workers.run(spec(role()), new AbortController().signal)).rejects.toThrow(
      TEAM_MODEL_TEXT.hostNoRepository,
    )
  })

  it('refuses an incomplete custom role, naming it', async () => {
    const { root } = scratchRepo()
    const { workers } = portsFor(root, scratchDir('team-ports-storage-'))
    const incomplete = role({ role: 'custom-audit', workspace: 'read-only' })
    await expect(workers.run(spec(incomplete), new AbortController().signal)).rejects.toThrow(
      'custom-audit',
    )
  })

  it('refuses an in-place role', async () => {
    const { root } = scratchRepo()
    const { workers } = portsFor(root, scratchDir('team-ports-storage-'))
    await expect(
      workers.run(spec(role({ workspace: 'in-place' })), new AbortController().signal),
    ).rejects.toThrow(TEAM_MODEL_TEXT.hostInPlaceNotOffered)
  })

  it('refuses a setting the entry model does not serve', async () => {
    const { root } = scratchRepo()
    const { workers } = portsFor(root, scratchDir('team-ports-storage-'), {
      capabilitiesForModel: () => ({ effortTiers: ['low'], maxOutputTokens: undefined }),
    })
    const configured = spec(role())
    const refusing: TeamTaskSpec = {
      ...configured,
      entry: { ...configured.entry, settings: { effort: 'high' } },
    }
    await expect(workers.run(refusing, new AbortController().signal)).rejects.toThrow(
      fill(UI_TEXT.teamSettingUnsupported, {
        setting: 'effort',
        value: 'high',
        model: 'worker-model',
      }),
    )
  })
})

interface FinishedCopy {
  outcome: TeamWorkerOutcome & {
    branch: string
    baseCommit: string
    head: string
    changedFiles: readonly string[]
    folder: string
    agentsRef: string
  }
}

// The real end-of-task sequence, as the worker port runs it: a real copy,
// the edit the worker would have made, the real commit and the real ref
// publication, then the outcome the port hands back.
async function finishedCopy(
  root: string,
  storage: string,
  edit: (folder: string) => void,
): Promise<FinishedCopy> {
  const baseCommit = await resolveBaseCommit(realGit, root)
  const workspace = await startTeamWorkspace(realGit, storage, process.platform, {
    repositoryRoot: root,
    role: 'engineering',
    taskId: 'task-1',
    mode: 'own-branch',
    baseCommit,
  })
  if (workspace.branch === undefined || workspace.agentsRef === undefined)
    throw new Error('test: own-branch copies carry a branch and a ref')
  edit(workspace.folder)
  const committed = await commitTaskBranch(realGit, workspace.folder, {
    branch: workspace.branch,
    role: 'engineering',
    taskId: 'task-1',
    entryId: 'e1',
  })
  await publishTaskRef(
    realGit,
    root,
    workspace.folder,
    workspace.branch,
    workspace.agentsRef,
    baseCommit,
  )
  const changed = new TextDecoder()
    .decode(
      await realGit(
        ['diff', '--name-only', '-z', '--no-renames', baseCommit, committed.head, '--'],
        workspace.folder,
      ),
    )
    .split('\0')
    .filter((name) => name !== '')
  return {
    outcome: {
      report: { status: 'done', summary: 'did it' },
      usage: {
        input: 1,
        cachedInput: 0,
        output: 1,
        reasoning: 0,
        modelCalls: 1,
        estimated: false,
      },
      branch: workspace.branch,
      baseCommit,
      head: committed.head,
      changedFiles: changed,
      folder: workspace.folder,
      agentsRef: workspace.agentsRef,
    },
  }
}

function refTarget(root: string, ref: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--verify', ref], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  } catch {
    return undefined
  }
}

type MissingCopyPart = 'folder' | 'agentsRef' | 'baseCommit' | 'head'

const withoutCopyPart: Record<
  MissingCopyPart,
  (full: FinishedCopy['outcome']) => TeamWorkerOutcome
> = {
  folder: (full) => ({ ...full, folder: undefined }),
  agentsRef: (full) => ({ ...full, agentsRef: undefined }),
  baseCommit: (full) => ({ ...full, baseCommit: undefined }),
  head: (full) => ({ ...full, head: undefined }),
}

// A real repository, the real ports over it, and a finished copy holding
// the edit: every merge case starts here.
async function mergeRig(edit: (folder: string) => void) {
  const { root } = scratchRepo()
  const storage = scratchDir('team-ports-storage-')
  const { merges } = portsFor(root, storage)
  const { outcome } = await finishedCopy(root, storage, edit)
  return { root, merges, outcome }
}

function changeAts(folder: string): void {
  writeFileSync(path.join(folder, 'a.ts'), 'const value = 2\n')
}

describe('the engine merge port', () => {
  it.each([
    { missing: 'folder' },
    { missing: 'agentsRef' },
    { missing: 'baseCommit' },
    { missing: 'head' },
  ] as const)('refuses a task without a finished $missing', async ({ missing }) => {
    const { root, baseCommit } = scratchRepo()
    const { merges } = portsFor(root, scratchDir('team-ports-storage-'))
    const full: FinishedCopy['outcome'] = {
      report: { status: 'done', summary: 'did it' },
      usage: {
        input: 1,
        cachedInput: 0,
        output: 1,
        reasoning: 0,
        modelCalls: 1,
        estimated: false,
      },
      branch: 'agents/engineering/task-1',
      baseCommit,
      head: baseCommit,
      changedFiles: [],
      folder: path.join(root, 'missing-copy'),
      agentsRef: 'refs/agents/engineering/task-1',
    }
    await expect(mergeOutcome(merges, withoutCopyPart[missing](full), false)).rejects.toThrow(
      TEAM_MODEL_TEXT.hostMergeNotReady,
    )
  })

  it('lands a real branch and removes its copy and ref', async () => {
    const { root, merges, outcome } = await mergeRig(changeAts)
    const merged = await mergeOutcome(merges, outcome, false)
    expect(merged.status).toBe('merged')
    expect(merged.written).toContain('a.ts')
    expect(readFileSync(path.join(root, 'a.ts'), 'utf8')).toBe('const value = 2\n')
    expect(existsSync(outcome.folder)).toBe(false)
    expect(refTarget(root, outcome.agentsRef)).toBeUndefined()
  })

  it('refuses a moved ref and leaves the tree alone', async () => {
    const { root, merges, outcome } = await mergeRig(changeAts)
    execFileSync('git', ['update-ref', outcome.agentsRef, outcome.baseCommit], { cwd: root })
    const failure = await mergeFailure(merges, outcome)
    expect(failure).toBeInstanceOf(TeamMergeError)
    expect((failure as TeamMergeError).code).toBe('refBreach')
    expect(readFileSync(path.join(root, 'a.ts'), 'utf8')).toBe('const value = 1\n')
  })

  it('refuses protected paths without approval and lands them with it', async () => {
    const protectedFile = path.join('.github', 'workflows', 'ci.yml')
    const { root, merges, outcome } = await mergeRig((folder) => {
      const target = path.join(folder, protectedFile)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, 'jobs: {}\n')
    })
    const failure = await mergeFailure(merges, outcome)
    expect(failure).toBeInstanceOf(TeamMergeError)
    expect((failure as TeamMergeError).code).toBe('protected')
    expect(existsSync(path.join(root, protectedFile))).toBe(false)
    const merged = await mergeOutcome(merges, outcome, true)
    expect(merged.status).toBe('merged')
    expect(readFileSync(path.join(root, protectedFile), 'utf8')).toBe('jobs: {}\n')
  })

  it('shows the real change between base and head', async () => {
    const { merges, outcome } = await mergeRig(changeAts)
    const diff = await merges.diff(outcome)
    expect(diff).toContain('-const value = 1')
    expect(diff).toContain('+const value = 2')
  })

  it('discards the copy and ref for real, and a missing copy is nothing to do', async () => {
    const { root, merges, outcome } = await mergeRig(changeAts)
    await merges.discard({ taskId: 'task-1', role: role(), outcome })
    expect(existsSync(outcome.folder)).toBe(false)
    expect(refTarget(root, outcome.agentsRef)).toBeUndefined()
    await expect(
      merges.discard({
        taskId: 'task-1',
        role: role(),
        outcome: { ...outcome, folder: undefined },
      }),
    ).resolves.toBeUndefined()
  })
})

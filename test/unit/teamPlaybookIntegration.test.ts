// M116 (D218): the team runner's integration over a real journal and a real
// policy, with the board read from the team's live facts, as the window's
// playbook worker runs it. Nothing here is stubbed: the journal is a real
// file journal in a scratch folder, the policy is the orchestrator policy,
// the board reads the live team facts, and on Windows every git read runs in
// the worker's real contained job over the compiled MuseSparkJob type.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import {
  FilePlaybookJournal,
  validatedRecords,
} from '../../src/core/orchestration/playbook/journal'
import {
  createCapacityAdmission,
  createReadingHolder,
} from '../../src/core/orchestration/playbook/readingHolder'
import type { PlaybookWork } from '../../src/core/orchestration/playbookIntegration'
import {
  createTeamPlaybookIntegration,
  type TeamPlaybookIntegrationDeps,
} from '../../src/host/playbook/teamPlaybook'
import type {
  TeamPlaybookBranchState,
  TeamPlaybookCiState,
  TeamPlaybookEntryState,
  TeamPlaybookFacts,
} from '../../src/core/team/teamPlaybookBoard'
import type { PlaybookHookAdmission } from '../../src/core/orchestration/playbook/outcomes'
import { ContainedJob } from '../../src/host/playbook/containedJob'
import { compiledJobAssembly, SYSTEM_ROOT } from './helpers/playbook/jobAssembly'
import { GOVERNED_ROUND_TIMEOUT_MS } from './helpers/playbook/panelRepository'
import { removeFolder } from './helpers/temporaryFolders'
import type { PlaybookLane, PlaybookWhyNote } from '../../src/shared/playbook'
import { resourceStatusSchema, type ResourceStatus } from '../../src/shared/resources'

function scratch(): { data: string; workspace: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'm116-team-playbook-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const data = path.join(root, 'data')
  const workspace = path.join(root, 'ws')
  mkdirSync(data, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  // The policy's dispatch baseline reads git: the workspace is a real repo.
  execFileSync('git', ['init', '-b', 'main'], { cwd: workspace })
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
    { cwd: workspace },
  )
  return { data, workspace }
}

const lane = (id: string, starts: readonly string[] = []): PlaybookLane => ({
  id,
  milestoneId: 'M96',
  kind: 'patch',
  module: { id: 'module-a', key: 'src/team', files: ['src/team/a.ts'], source: 'lane' },
  starts: [...starts],
  estimateHours: 2,
  merged: false,
  reviewed: false,
  addsTestsOrGates: false,
  drills: [],
  integrationTrunk: 'main',
  mergedTrunks: [],
})

const IS_WINDOWS = process.platform === 'win32'
const shared: { storage?: string; assembly?: string } = {}

beforeAll(async () => {
  if (!IS_WINDOWS) return
  shared.storage = await mkdtemp(path.join(tmpdir(), 'm116-team-playbook-job-'))
  shared.assembly = await compiledJobAssembly(shared.storage)
}, GOVERNED_ROUND_TIMEOUT_MS)
afterAll(async () => {
  if (shared.storage !== undefined) await removeFolder(shared.storage)
})

/** The worker's own git admission: on Windows, inside one real contained job. */
function hookAdmission(): PlaybookHookAdmission {
  if (!IS_WINDOWS || shared.assembly === undefined) return { admit: () => true }
  const job = new ContainedJob({
    assemblyPath: shared.assembly,
    systemRoot: SYSTEM_ROOT,
    onJob: () => undefined,
  })
  onTestFinished(() => {
    job.close()
  })
  return { admit: () => true, runContained: (effect, options) => job.run(effect, options) }
}

/** The team's board facts, changed in place by a test as the team changes. */
const noFacts = (): TeamPlaybookFacts => ({
  lanes: [],
  entries: [],
  branches: [],
  ci: { known: false },
})

function integration(overrides: Partial<TeamPlaybookIntegrationDeps> = {}) {
  const { data, workspace } = scratch()
  const notes: PlaybookWhyNote[] = []
  const capacity = createReadingHolder<ResourceStatus>()
  const playbook = createTeamPlaybookIntegration({
    agentDataFolder: data,
    workspaceFolder: workspace,
    teamId: 'team',
    laneId: 'team',
    checkAdmission: createCapacityAdmission(capacity),
    hookAdmission: hookAdmission(),
    facts: noFacts,
    events: {
      note: (note) => {
        notes.push(note)
      },
      offerRedesign: () => undefined,
      hookOutput: () => undefined,
      failure: () => undefined,
    },
    ...overrides,
  })
  return { data, workspace, notes, capacity, playbook }
}

const work: PlaybookWork = {
  id: 'task-1',
  module: {
    id: 'team-task-1',
    key: 'src/team',
    files: ['src/team/retry.ts'],
    source: 'team',
  },
  refs: ['refs/heads/main'],
  requester: { agentId: 'team-s1', teamId: 'team' },
  brief: {
    objective: 'Rework the retry helper',
    scope: ['src/team/retry.ts'],
    acceptance: ['own-branch'],
    baseCommit: 'a'.repeat(40),
  },
  commands: [],
}

describe('createTeamPlaybookIntegration', () => {
  it('starts team work against the real policy and journals its brief', () => {
    const { data, workspace, notes, playbook } = integration()
    const managed = playbook.start({
      ...work,
      brief: { ...work.brief },
      module: { ...work.module },
    })
    expect(notes.map((note) => note.code)).toContain('briefRecorded')
    managed.cancel()
    const records = validatedRecords(new FilePlaybookJournal(data, workspace).read())
    expect(records).not.toHaveLength(0)
    const brief = records.find((record) => record.kind === 'note')
    expect(brief).toMatchObject({
      kind: 'note',
      value: { code: 'briefRecorded', module: 'src/team' },
    })
    expect(
      records.some((record) => record.kind === 'work' && record.value.moduleId === 'team-task-1'),
    ).toBe(true)
    expect(
      records.some((record) => record.kind === 'lease' && record.value.status === 'released'),
    ).toBe(true)
  })

  it('picks from the plan lanes with the team facts applied', () => {
    const entries: TeamPlaybookEntryState[] = [{ id: 'e1', running: 0, usable: true }]
    const branches: TeamPlaybookBranchState[] = [{ branch: 'M96:0', mergedIntoTarget: true }]
    const { playbook } = integration({
      facts: () => ({ ...noFacts(), lanes: [lane('0'), lane('1', ['0'])], entries, branches }),
    })
    // Lane 0's branch merged into the target, so lane 1's start on it is
    // satisfied and the first lane in estimate order picks.
    expect(playbook.pick()?.id).toBe('0')
    entries[0] = { id: 'e1', running: 1, usable: true }
    // The board reads the team live: lane order does not depend on workers.
    expect(playbook.pick()?.id).toBe('0')
  })

  it('routes a heavy check to an idle admitted worker, and refuses local checks at pause', async () => {
    const entries: TeamPlaybookEntryState[] = [
      { id: 'e-busy', running: 1, usable: true },
      { id: 'e-idle', running: 0, usable: true },
    ]
    const ci: { current: TeamPlaybookCiState } = { current: { known: false } }
    const { capacity, playbook } = integration({
      facts: () => ({ ...noFacts(), entries, ci: ci.current }),
    })
    const checkTarget = async (): Promise<unknown> => {
      let target: unknown
      await playbook.check({ id: 'quality', heavy: true, fullGate: false }, (run) => {
        target = run
        return Promise.resolve()
      })
      return target
    }
    await expect(checkTarget()).resolves.toEqual({ kind: 'worker', id: 'e-idle' })
    capacity.set(
      resourceStatusSchema.parse({
        level: 'pause',
        sample: null,
        settings: {},
        queued: [],
        overrideUntilMs: null,
      }),
    )
    // A light check still targets local, where the paused machine refuses it.
    await expect(
      playbook.check({ id: 'quality', heavy: false, fullGate: false }, () =>
        Promise.resolve(undefined),
      ),
    ).rejects.toThrow()
    // ...while the heavy check still offloads to the idle worker.
    await expect(checkTarget()).resolves.toEqual({ kind: 'worker', id: 'e-idle' })
  })

  it('merges a lane through the real policy and runs its effect', () => {
    const { playbook } = integration({
      facts: () => ({ ...noFacts(), lanes: [{ ...lane('0'), mergedTrunks: ['main'] }] }),
    })
    let didRun = false
    playbook.merge({ milestoneId: 'M96', id: '0' }, () => {
      didRun = true
    })
    expect(didRun).toBe(true)
  })
})

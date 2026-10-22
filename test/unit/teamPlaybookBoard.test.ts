// M116 (D212): the team runner's playbook board from real team facts, and
// one dispatched task's dispatch work. The work must pass the policy's own
// module and brief schemas: otherwise the integration would refuse every
// team dispatch at recordBrief.
import { describe, expect, it } from 'vitest'
import {
  playbookBriefSchema,
  playbookModuleSchema,
  type PlaybookLane,
} from '../../src/shared/playbook'
import {
  teamPlanPort,
  teamPlaybookBoard,
  teamPlaybookWork,
  type TeamPlaybookFacts,
} from '../../src/core/team/teamPlaybookBoard'

const lane = (id: string): PlaybookLane => ({
  id,
  milestoneId: 'M96',
  kind: 'patch',
  module: { id: 'module-a', key: 'src/core', files: ['src/core/a.ts'], source: 'lane' },
  starts: [],
  estimateHours: 2,
  merged: false,
  reviewed: false,
  addsTestsOrGates: false,
  drills: [],
  integrationTrunk: 'main',
  mergedTrunks: [],
})

const facts = (overrides: Partial<TeamPlaybookFacts> = {}): TeamPlaybookFacts => ({
  lanes: [lane('0')],
  entries: [
    { id: 'entry-idle', running: 0, usable: true },
    { id: 'entry-busy', running: 1, usable: true },
    { id: 'entry-down', running: 0, usable: false },
  ],
  branches: [
    { branch: 'agents/merged-task', mergedIntoTarget: true },
    { branch: 'agents/open-task', mergedIntoTarget: false },
  ],
  ci: { known: true, hasCi: true },
  ...overrides,
})

describe('teamPlaybookBoard', () => {
  it('offers idle admitted entries under their entry ids', () => {
    expect(teamPlaybookBoard(facts()).workers).toEqual([
      { id: 'entry-idle', available: true },
      { id: 'entry-busy', available: false },
      { id: 'entry-down', available: false },
    ])
  })

  it('counts a prerequisite as merged only when its branch merged into the target', () => {
    expect(teamPlaybookBoard(facts()).mergedPrerequisites).toEqual(['agents/merged-task'])
  })

  it('reads unknown CI as false, never true', () => {
    expect(teamPlaybookBoard(facts({ ci: { known: false } })).hasCi).toBe(false)
    expect(teamPlaybookBoard(facts({ ci: { known: true, hasCi: false } })).hasCi).toBe(false)
    expect(teamPlaybookBoard(facts()).hasCi).toBe(true)
  })

  it('passes the plan lanes through and dedupes repeated facts', () => {
    const board = teamPlaybookBoard(
      facts({
        entries: [
          { id: 'entry-idle', running: 0, usable: true },
          { id: 'entry-idle', running: 0, usable: true },
        ],
        branches: [
          { branch: 'agents/merged-task', mergedIntoTarget: true },
          { branch: 'agents/merged-task', mergedIntoTarget: true },
        ],
      }),
    )
    expect(board.lanes.map((entry) => entry.id)).toEqual(['0'])
    expect(board.workers).toEqual([{ id: 'entry-idle', available: true }])
    expect(board.mergedPrerequisites).toEqual(['agents/merged-task'])
  })

  it('reads the team live on every lookup', () => {
    let live = facts()
    const port = teamPlanPort(() => live)
    expect(port.readBoard().workers).toHaveLength(3)
    live = facts({ entries: [] })
    expect(port.readBoard().workers).toEqual([])
  })
})

describe('teamPlaybookWork', () => {
  const task = {
    taskId: 'task-1',
    brief: 'Rework the retry helper',
    files: ['src/core/team/retry.ts'],
    reasonCode: 'own-branch',
    reasonDetail: 'isolated change',
    sessionId: 'session-1',
    teamId: 'team',
  }
  const head = { ref: 'refs/heads/main', commit: 'abc123' }

  it('builds work the policy schemas accept', () => {
    const work = teamPlaybookWork(task, head)
    expect(work).toBeDefined()
    if (work === undefined) throw new Error('unreachable')
    expect(playbookModuleSchema.parse(work.module)).toEqual(work.module)
    expect(work.module.source).toBe('team')
    expect(playbookBriefSchema.parse(work.brief)).toEqual(work.brief)
    expect(work.brief.baseCommit).toBe('abc123')
    expect(work.refs).toEqual(['refs/heads/main'])
    expect(work.commands).toEqual([])
  })

  it('normalises Windows separators before naming the module', () => {
    const work = teamPlaybookWork({ ...task, files: [String.raw`src\core\team\retry.ts`] }, head)
    expect(work?.module.files).toEqual(['src/core/team/retry.ts'])
    expect(work?.module.key).toBe('src/core/team')
  })

  it('leaves a task with no files ungoverned', () => {
    expect(teamPlaybookWork({ ...task, files: [] }, head)).toBeUndefined()
  })

  it('records detached work against the branch namespace and bounds long ids', () => {
    const long = `task-${'x'.repeat(200)}`
    const work = teamPlaybookWork({ ...task, taskId: long }, { ref: undefined, commit: 'abc123' })
    expect(work?.refs).toEqual(['refs/heads'])
    expect(work?.module.id).toMatch(/^[a-f\d]{64}$/u)
    if (work !== undefined) expect(playbookModuleSchema.parse(work.module)).toEqual(work.module)
  })
})

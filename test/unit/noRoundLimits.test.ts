// NOLIMITSTEAM (PLAN.md D121): rounds continue until the work converges or
// the person stops it. Each case below drives the real code with plain data
// and fails on the bounded code (recorded pre-change), then passes after the
// bound is removed at its cause.

import { describe, expect, it } from 'vitest'
import { redesignBlock } from '../../src/core/orchestration/playbook/review'
import type { ModuleState } from '../../src/core/orchestration/playbook/modules'
import {
  changePipeline,
  loadPipelines,
  recordStepResult,
  startPipelineRun,
  type PipelineDefinition,
  type PipelineFileSystem,
} from '../../src/core/team/pipelines'
import { parsePlaybookCommand } from '../../src/runtime/playbook/command'
import { defaultPlaybookSettings, playbookSettingsSchema } from '../../src/shared/playbook'
import { teamBoardTaskSchema } from '../../src/shared/team'

function memoryFs(files: Readonly<Record<string, string>>): PipelineFileSystem {
  return {
    listFiles: (dir) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1)),
    readFile: (path) => files[path],
  }
}

function loadFiles(files: Readonly<Record<string, string>>, isTrusted = true) {
  return loadPipelines({
    personalDir: 'personal',
    projectDir: 'project',
    trusted: isTrusted,
    fs: memoryFs(files),
  })
}

function failingReview(stepId: string, branch: string, round: number) {
  return {
    kind: 'reviewed',
    stepId,
    branch,
    findings: [{ title: 'null dereference on empty input', severity: 'high' }],
    report: `review ${String(round)}`,
  } as const
}

function struckModule(strikes: number): ModuleState {
  return {
    module: { id: 'mod-1', key: 'src/a.ts', files: ['src/a.ts'], source: 'team' },
    counts: new Map(),
    strikes,
    historicalFiles: [],
    linked: new Set(),
    escalated: false,
    leases: new Map(),
  }
}

function boardTask(overrides: { reassignments: number; reviewRounds: number }) {
  return {
    id: 'task-1',
    workspaceId: 'ws-1',
    parentSessionId: 'session-1',
    roleId: 'engineering',
    state: 'ready',
    held: false,
    createdAt: 0,
    currentAttempt: 0,
    attempts: [],
    ...overrides,
  }
}

describe('no round limits: pipelines run until the change passes', () => {
  it('failing rounds repeat past the old third-round stop, naming round and findings', () => {
    const def = changePipeline()
    const branch = 'agents/engineering/t1'
    let run = startPipelineRun(def, 'seeded bug')
    for (let round = 1; round <= 6; round += 1) {
      run = recordStepResult(def, run, {
        kind: 'work-done',
        stepId: 'implement',
        branch,
        report: `work ${String(round)}`,
      }).run
      const moved = recordStepResult(def, run, failingReview('review', branch, round))
      run = moved.run
      expect(moved.decision.status).toBe('repeat')
      if (moved.decision.status !== 'repeat') throw new Error('expected a repeat')
      expect(moved.decision.round).toBe(round + 1)
      expect(moved.decision.findings.map((finding) => finding.title)).toEqual([
        'null dereference on empty input',
      ])
    }
    expect(run.status).toBe('running')
    expect(run.round).toBe(7)
  })

  it('a definition without a round bound loads and runs', () => {
    const def = {
      id: 'docs-flow',
      steps: [{ id: 'draft', role: 'docs', kind: 'work' }],
      reviewSeverity: 'medium',
    }
    const { pipelines, refused } = loadFiles({
      'personal/docs.json': JSON.stringify(def),
    })
    expect(refused).toEqual([])
    expect(pipelines.some((candidate) => candidate.id === 'docs-flow')).toBe(true)
  })

  it('a file that still names a round bound is refused, naming the key', () => {
    const { pipelines, refused } = loadFiles({
      'personal/wide.json': JSON.stringify({
        id: 'wide',
        steps: [{ id: 'only', role: 'research', kind: 'work' }],
        maxRounds: 2,
        reviewSeverity: 'high',
      }),
    })
    expect(pipelines.some((candidate) => candidate.id === 'wide')).toBe(false)
    expect(refused).toEqual([
      { file: 'personal/wide.json', reason: 'unknownKey', detail: 'maxRounds' },
    ])
  })

  it('a project file that still names a round bound is refused whole', () => {
    const { refused } = loadFiles({
      'project/narrow.json': JSON.stringify({ id: 'change', maxRounds: 1 }),
    })
    expect(refused).toEqual([
      { file: 'project/narrow.json', reason: 'unknownKey', detail: 'maxRounds' },
    ])
  })
})

describe('no round limits: the board counts reassignments and review rounds without a ceiling', () => {
  it('a task past the old ceilings still parses', () => {
    const task = teamBoardTaskSchema.parse(boardTask({ reassignments: 5, reviewRounds: 6 }))
    expect(task.reassignments).toBe(5)
    expect(task.reviewRounds).toBe(6)
  })
})

describe('no round limits: fix rounds run until the work converges unless the person sets a number', () => {
  it('a fresh team starts with unlimited fix rounds', () => {
    expect(defaultPlaybookSettings('team-1').patchRoundsMax).toBe(0)
  })

  it('the setting takes 0 for unlimited and any positive number, with no ceiling of ours', () => {
    const base = defaultPlaybookSettings('team-1')
    expect(playbookSettingsSchema.parse({ ...base, patchRoundsMax: 0 }).patchRoundsMax).toBe(0)
    expect(playbookSettingsSchema.parse({ ...base, patchRoundsMax: 50 }).patchRoundsMax).toBe(50)
  })

  it('no bound blocks a fifth strike when nothing is set', () => {
    expect(redesignBlock(struckModule(5), 0)).toBeUndefined()
  })

  it('a person-set number still forces the redesign path past it', () => {
    expect(redesignBlock(struckModule(3), 2)).toBe('redesignRequired')
  })

  it('the CLI and ACP grammar takes 0 for unlimited', () => {
    const command = parsePlaybookCommand(['settings', 'patchRoundsMax', '0'])
    expect(command).toEqual({
      view: 'settings',
      change: { patchRoundsMax: 0 },
    })
  })
})

describe('no round limits: terminal runs still end', () => {
  it('recording on a handed-off run still throws instead of starting another round', async () => {
    const { PipelineTerminalError } = await import('../../src/core/team/pipelines')
    const def: PipelineDefinition = changePipeline()
    const branch = 'agents/engineering/t1'
    let run = startPipelineRun(def, 'seeded bug')
    run = recordStepResult(def, run, {
      kind: 'work-done',
      stepId: 'implement',
      branch,
      report: 'work done',
    }).run
    run = recordStepResult(def, run, {
      kind: 'reviewed',
      stepId: 'review',
      branch,
      findings: [],
      report: 'review clean',
    }).run
    run = recordStepResult(def, run, {
      kind: 'checked',
      stepId: 'verify',
      branch,
      passed: true,
      findings: [],
      report: 'checks pass',
    }).run
    expect(run.status).toBe('handoff')
    expect(() =>
      recordStepResult(def, run, {
        kind: 'work-done',
        stepId: 'implement',
        branch,
        report: 'late work',
      }),
    ).toThrow(PipelineTerminalError)
  })
})

// Lane L: pipelines — built-ins, rounds, `redesign`, loading and the merge
// hand-off (M96 acceptance 21, PLAN.md D75 "Pipelines").

import { describe, expect, it } from 'vitest'
import {
  approvalSteps,
  builtInPipelines,
  changePipeline,
  isFailingSeverity,
  loadPipelines,
  pipelineCeiling,
  PipelineBranchError,
  recordStepResult,
  specPipeline,
  startPipelineRun,
  stepInput,
  validatePipeline,
  PipelineStepError,
  PipelineTerminalError,
  type PipelineDefinition,
  type PipelineFileSystem,
  type PipelineRun,
  type PipelineStepResult,
} from '../../src/core/team/pipelines'

function work(stepId: string, branch: string): PipelineStepResult {
  return { kind: 'work-done', stepId, branch, report: `${stepId} done` }
}

function review(
  stepId: string,
  branch: string,
  severities: readonly (string | undefined)[],
): PipelineStepResult {
  return {
    kind: 'reviewed',
    stepId,
    branch,
    findings: severities.map((severity, index) => ({
      title: `finding ${String(index)}`,
      severity,
    })),
    report: `${stepId} reviewed`,
  }
}

function check(stepId: string, branch: string, isPassed: boolean): PipelineStepResult {
  return {
    kind: 'checked',
    stepId,
    branch,
    passed: isPassed,
    findings: [],
    report: `${stepId} checked`,
  }
}

/** Drive a full Change run, collecting every status and decision. */
function drive(
  def: PipelineDefinition,
  results: readonly PipelineStepResult[],
): {
  readonly run: PipelineRun
  readonly statuses: readonly string[]
  readonly decisions: readonly unknown[]
} {
  let run = startPipelineRun(def, 'seeded bug')
  const statuses: string[] = []
  const decisions: unknown[] = []
  for (const result of results) {
    const moved = recordStepResult(def, run, result)
    run = moved.run
    statuses.push(moved.decision.status)
    decisions.push(moved.decision)
  }
  return { run, statuses, decisions }
}

function memoryFs(files: Readonly<Record<string, string>>): PipelineFileSystem {
  return {
    listFiles: (dir) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1)),
    readFile: (path) => files[path],
  }
}

describe('built-in pipelines', () => {
  it('change runs engineering, code-review and qa, then hands off without merging', () => {
    const def = changePipeline()
    expect(def.steps.map((step) => step.role)).toEqual(['engineering', 'code-review', 'qa'])
    expect(def.steps.map((step) => step.kind)).toEqual(['work', 'review', 'check'])
    expect(validatePipeline(def)).toBeUndefined()
  })

  it('spec runs research then design with no review step', () => {
    const def = specPipeline()
    expect(def.steps.map((step) => step.role)).toEqual(['research', 'design'])
    expect(validatePipeline(def)).toBeUndefined()
  })

  it('both built-ins load', () => {
    expect(builtInPipelines().map((def) => def.id)).toEqual(['change', 'spec'])
  })
})

describe('rounds and redesign', () => {
  it('a clean change run hands the reviewed branch to the orchestrator merge', () => {
    const def = changePipeline()
    const { run, statuses } = drive(def, [
      work('implement', 'agents/engineering/t1'),
      review('review', 'agents/engineering/t1', []),
      check('verify', 'agents/engineering/t1', true),
    ])
    expect(statuses).toEqual(['next', 'next', 'handoff'])
    expect(run.status).toBe('handoff')
  })

  it('no decision ever merges: the full pass and the full fail name no merge', () => {
    const def = changePipeline()
    const pass = drive(def, [
      work('implement', 'agents/engineering/t1'),
      review('review', 'agents/engineering/t1', []),
      check('verify', 'agents/engineering/t1', true),
    ])
    const failingTitle = 'null dereference on empty input'
    const fail = drive(def, [
      work('implement', 'agents/engineering/t2'),
      {
        kind: 'reviewed',
        stepId: 'review',
        branch: 'agents/engineering/t2',
        findings: [{ title: failingTitle, severity: 'high' }],
        report: 'review 1',
      },
      work('implement', 'agents/engineering/t2'),
      {
        kind: 'reviewed',
        stepId: 'review',
        branch: 'agents/engineering/t2',
        findings: [{ title: failingTitle, severity: 'high' }],
        report: 'review 2',
      },
      work('implement', 'agents/engineering/t2'),
      {
        kind: 'reviewed',
        stepId: 'review',
        branch: 'agents/engineering/t2',
        findings: [{ title: failingTitle, severity: 'high' }],
        report: 'review 3',
      },
    ])
    expect([...pass.statuses, ...fail.statuses].toSorted((a, b) => a.localeCompare(b))).toEqual([
      'handoff',
      'next',
      'next',
      'next',
      'next',
      'next',
      'redesign',
      'repeat',
      'repeat',
    ])
    for (const text of [JSON.stringify(pass.decisions), JSON.stringify(fail.decisions)]) {
      expect(text).not.toContain('merge')
    }
  })

  it('a high finding loops back to engineering on the same branch with the findings', () => {
    const def = changePipeline()
    let run = startPipelineRun(def, 'seeded bug')
    run = recordStepResult(def, run, work('implement', 'agents/engineering/t1')).run
    const moved = recordStepResult(def, run, review('review', 'agents/engineering/t1', ['high']))
    expect(moved.decision.status).toBe('repeat')
    if (moved.decision.status !== 'repeat') {
      throw new Error('expected a repeat')
    }
    expect(moved.decision.step.role).toBe('engineering')
    expect(moved.decision.round).toBe(2)
    expect(moved.decision.findings).toHaveLength(1)
    expect(moved.run.branch).toBe('agents/engineering/t1')
    expect(moved.run.round).toBe(2)
  })

  it('medium and lower findings do not loop back', () => {
    const def = changePipeline()
    const { statuses } = drive(def, [
      work('implement', 'agents/engineering/t1'),
      review('review', 'agents/engineering/t1', ['medium', 'low', 'info']),
      check('verify', 'agents/engineering/t1', true),
    ])
    expect(statuses).toEqual(['next', 'next', 'handoff'])
  })

  it('a made-up severity loops back rather than merging blind', () => {
    const def = changePipeline()
    let run = startPipelineRun(def, 'seeded bug')
    run = recordStepResult(def, run, work('implement', 'agents/engineering/t1')).run
    const moved = recordStepResult(def, run, review('review', 'agents/engineering/t1', ['severe']))
    expect(moved.decision.status).toBe('repeat')
  })

  it('a failed check loops back even with no findings', () => {
    const def = changePipeline()
    const first = drive(def, [
      work('implement', 'agents/engineering/t1'),
      review('review', 'agents/engineering/t1', []),
      check('verify', 'agents/engineering/t1', false),
    ])
    expect(first.statuses).toEqual(['next', 'next', 'repeat'])
  })

  it('the third failed round stops at redesign, naming the findings that came back', () => {
    const def = changePipeline()
    const title = 'null dereference on empty input'
    let run = startPipelineRun(def, 'seeded bug')
    let rounds = 0
    for (let round = 1; round <= 3; round += 1) {
      run = recordStepResult(def, run, work('implement', 'agents/engineering/t1')).run
      const moved = recordStepResult(def, run, {
        kind: 'reviewed',
        stepId: 'review',
        branch: 'agents/engineering/t1',
        findings: [{ title, severity: 'high' }],
        report: `review ${String(round)}`,
      })
      run = moved.run
      if (moved.decision.status === 'repeat') {
        rounds = moved.decision.round
      }
    }
    expect(rounds).toBe(3)
    expect(run.status).toBe('redesign')
  })

  it('redesign names the recurring finding', () => {
    const def = changePipeline()
    const title = 'null dereference on empty input'
    let run = startPipelineRun(def, 'seeded bug')
    let last: ReturnType<typeof recordStepResult> | undefined
    for (let round = 1; round <= 3; round += 1) {
      run = recordStepResult(def, run, work('implement', 'agents/engineering/t1')).run
      last = recordStepResult(def, run, {
        kind: 'reviewed',
        stepId: 'review',
        branch: 'agents/engineering/t1',
        findings: [{ title, severity: 'high' }],
        report: `review ${String(round)}`,
      })
      run = last.run
    }
    if (last?.decision.status !== 'redesign') {
      throw new Error('expected redesign')
    }
    expect(last.decision.findings.map((finding) => finding.title)).toEqual([title])
    expect(last.decision.recurring.map((finding) => finding.title)).toEqual([title])
  })

  it('no fourth round starts: recording on a terminal run throws', () => {
    const def = changePipeline()
    let run = startPipelineRun(def, 'seeded bug')
    for (let round = 1; round <= 3; round += 1) {
      run = recordStepResult(def, run, work('implement', 'agents/engineering/t1')).run
      run = recordStepResult(def, run, {
        kind: 'reviewed',
        stepId: 'review',
        branch: 'agents/engineering/t1',
        findings: [{ title: `finding ${String(round)}`, severity: 'critical' }],
        report: `review ${String(round)}`,
      }).run
    }
    expect(run.status).toBe('redesign')
    expect(() => recordStepResult(def, run, work('implement', 'agents/engineering/t1'))).toThrow(
      PipelineTerminalError,
    )
  })

  it('a result for the wrong step throws', () => {
    const def = changePipeline()
    const run = startPipelineRun(def, 'seeded bug')
    expect(() => recordStepResult(def, run, review('review', 'agents/engineering/t1', []))).toThrow(
      PipelineStepError,
    )
  })

  it('a result on another branch throws: every round stays on one branch', () => {
    const def = changePipeline()
    let run = startPipelineRun(def, 'seeded bug')
    run = recordStepResult(def, run, work('implement', 'agents/engineering/t1')).run
    expect(() =>
      recordStepResult(def, run, review('review', 'agents/engineering/other', [])),
    ).toThrow(PipelineBranchError)
  })

  it('a step sees the brief and the earlier reports', () => {
    const def = changePipeline()
    let run = startPipelineRun(def, 'seeded bug')
    expect(stepInput(run)).toEqual({ brief: 'seeded bug', priorReports: [] })
    run = recordStepResult(def, run, work('implement', 'agents/engineering/t1')).run
    const input = stepInput(run)
    expect(input.brief).toBe('seeded bug')
    expect(input.priorReports).toHaveLength(1)
    expect(input.priorReports[0]?.stepId).toBe('implement')
  })
})

describe('thresholds', () => {
  it('critical meets high, high meets high, medium does not', () => {
    expect(isFailingSeverity('critical', 'high')).toBe(true)
    expect(isFailingSeverity('high', 'high')).toBe(true)
    expect(isFailingSeverity('medium', 'high')).toBe(false)
    expect(isFailingSeverity(undefined, 'high')).toBe(true)
  })
})

describe('approval', () => {
  it('one approval names the steps with each step first entry', () => {
    const def = changePipeline()
    expect(approvalSteps(def, ['model-a', 'model-b', 'model-c'])).toEqual([
      { stepId: 'implement', role: 'engineering', firstEntry: 'model-a' },
      { stepId: 'review', role: 'code-review', firstEntry: 'model-b' },
      { stepId: 'verify', role: 'qa', firstEntry: 'model-c' },
    ])
  })

  it('the ceiling is each step ceiling times the rounds', () => {
    expect(pipelineCeiling(changePipeline(), [100, 50, 25])).toBe(525)
  })

  it('mismatched ceilings throw', () => {
    expect(() => pipelineCeiling(changePipeline(), [100])).toThrow(PipelineStepError)
  })
})

describe('loading', () => {
  it('a personal pipeline loads beside the built-ins', () => {
    const fs = memoryFs({
      'personal/docs.json': JSON.stringify({
        id: 'docs-flow',
        steps: [
          { id: 'draft', role: 'docs', kind: 'work' },
          { id: 'edit', role: 'code-review', kind: 'review' },
        ],
        maxRounds: 2,
        reviewSeverity: 'medium',
      }),
      'project/anything.json': JSON.stringify({ id: 'change', maxRounds: 1 }),
    })
    const { pipelines, refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: false,
      fs,
    })
    expect(pipelines.map((def) => def.id).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'change',
      'docs-flow',
      'spec',
    ])
    expect(refused).toEqual([])
  })

  it('an untrusted workspace never reads the project folder', () => {
    const fs = memoryFs({
      'project/narrow.json': JSON.stringify({ id: 'change', maxRounds: 1 }),
    })
    const { pipelines, refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: false,
      fs,
    })
    expect(pipelines.map((def) => def.id).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'change',
      'spec',
    ])
    expect(refused).toEqual([])
  })

  it('a project file may lower the rounds or remove steps', () => {
    const fs = memoryFs({
      'project/narrow.json': JSON.stringify({
        id: 'change',
        maxRounds: 2,
        removeSteps: ['verify'],
      }),
    })
    const { pipelines, refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: true,
      fs,
    })
    expect(refused).toEqual([])
    const narrowed = pipelines.find((def) => def.id === 'change')
    expect(narrowed?.maxRounds).toBe(2)
    expect(narrowed?.steps.map((step) => step.id)).toEqual(['implement', 'review'])
  })

  it('a project file for an unknown pipeline is refused whole', () => {
    const fs = memoryFs({ 'project/new.json': JSON.stringify({ id: 'nope', maxRounds: 1 }) })
    const { refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: true,
      fs,
    })
    expect(refused).toEqual([
      { file: 'project/new.json', reason: 'unknownPipeline', detail: 'nope' },
    ])
  })

  it('a project file that raises the rounds is refused whole', () => {
    const fs = memoryFs({
      'personal/quick.json': JSON.stringify({
        id: 'quick',
        steps: [{ id: 'only', role: 'research', kind: 'work' }],
        maxRounds: 1,
        reviewSeverity: 'high',
      }),
      'project/raise.json': JSON.stringify({ id: 'quick', maxRounds: 2 }),
    })
    const { refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: true,
      fs,
    })
    expect(refused).toHaveLength(1)
    expect(refused[0]?.reason).toBe('widensRounds')
  })

  it('a project file that removes an unknown step is refused whole', () => {
    const fs = memoryFs({
      'project/remove.json': JSON.stringify({ id: 'change', removeSteps: ['deploy'] }),
    })
    const { refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: true,
      fs,
    })
    expect(refused).toHaveLength(1)
    expect(refused[0]?.reason).toBe('widensSteps')
  })

  it('an unknown key refuses the file whole', () => {
    const fs = memoryFs({
      'personal/bad.json': JSON.stringify({
        id: 'bad',
        steps: [{ id: 'only', role: 'research', kind: 'work' }],
        maxRounds: 2,
        reviewSeverity: 'high',
        merge: true,
      }),
    })
    const { pipelines, refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: true,
      fs,
    })
    expect(pipelines.map((def) => def.id).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'change',
      'spec',
    ])
    expect(refused).toEqual([{ file: 'personal/bad.json', reason: 'unknownKey', detail: 'merge' }])
  })

  it('a fourth round cannot be configured: rounds above three are refused', () => {
    const fs = memoryFs({
      'personal/wide.json': JSON.stringify({
        id: 'wide',
        steps: [{ id: 'only', role: 'research', kind: 'work' }],
        maxRounds: 4,
        reviewSeverity: 'high',
      }),
    })
    const { pipelines, refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: true,
      fs,
    })
    expect(pipelines.map((def) => def.id).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'change',
      'spec',
    ])
    expect(refused).toHaveLength(1)
    expect(refused[0]?.reason).toBe('invalid')
  })

  it('a review before any work step is refused', () => {
    const fs = memoryFs({
      'personal/dangling.json': JSON.stringify({
        id: 'dangling',
        steps: [
          { id: 'first', role: 'code-review', kind: 'review' },
          { id: 'then', role: 'engineering', kind: 'work' },
        ],
        maxRounds: 2,
        reviewSeverity: 'high',
      }),
    })
    const { refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: true,
      fs,
    })
    expect(refused).toHaveLength(1)
    expect(refused[0]?.reason).toBe('danglingReview')
  })

  it('a pipeline with no work step is refused', () => {
    expect(
      validatePipeline({
        id: 'reviews-only',
        steps: [{ id: 'r', role: 'code-review', kind: 'review' }],
        maxRounds: 2,
        reviewSeverity: 'high',
      }),
    ).toBe('noWorkStep')
  })

  it('unparseable files are refused, and other files still load', () => {
    const fs = memoryFs({
      'personal/broken.json': '{ not json',
      'personal/notes.txt': 'ignored',
      'personal/ok.json': JSON.stringify({
        id: 'ok',
        steps: [{ id: 'only', role: 'research', kind: 'work' }],
        maxRounds: 1,
        reviewSeverity: 'high',
      }),
    })
    const { pipelines, refused } = loadPipelines({
      personalDir: 'personal',
      projectDir: 'project',
      trusted: true,
      fs,
    })
    expect(pipelines.some((def) => def.id === 'ok')).toBe(true)
    expect(refused).toEqual([
      { file: 'personal/broken.json', reason: 'unparseable', detail: 'not JSON' },
    ])
  })
})

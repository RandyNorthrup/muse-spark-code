import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EVAL_BUDGET_USD,
  EVAL_LONG_EVIDENCE_RECALL_OFFSET,
  EVAL_MODEL_ID,
  EVAL_REPORT_VERSION,
  EVAL_TURN_NOT_RUN,
  EVAL_ROOT_MASK,
  SETTING_DEFAULTS,
} from '../../../src/shared/constants'
import { OBSERVATION_PACKING_ARM } from '../../../src/core/eval/mechanisms'
import { runPairedEval, type EvalArm, type EvalRunDeps } from '../../../src/core/eval/runner'
import { EVAL_TASKS, evalTasksOfSplit, type EvalTask } from '../../../src/core/eval/tasks'
import { listWorkspaceFiles } from '../../../src/core/eval/workspace'
import { fileContextIo } from '../../../src/host/backend/contextIo'
import { CONSERVATIVE_CAPABILITIES } from '../../../src/core/providers/capabilities'
import { FORMAT_QUIRKS } from '../../../src/core/providers/presets'
import { createToolIo } from '../../../src/host/backend/toolIo'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClientSettings,
  type FakeModelApi,
  type ScriptedReply,
} from '../helpers/fakeModelApi'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { logLines } from '../helpers/logText'
import { removeFolder } from '../helpers/temporaryFolders'
import {
  EVAL_CANONICAL_FIXES,
  EVAL_OTHER_FIXES,
  fixesFor,
  longTaskReplies,
  type EvalFix,
} from './evalFixes'

// Made when the suite starts, so a run that skips every test leaves no folder.
const temporary = { scratch: '' }
// Every run starts a harness and a verifier process; slow under coverage.
const RUNS_TIMEOUT_MS = 120_000
// Enough tokens on one reply to spend the run's budget at contributor rates.
const BUDGET_BREAKING_INPUT_TOKENS = 10_000_000

beforeAll(() => {
  temporary.scratch = mkdtempSync(path.join(tmpdir(), 'muse-eval-runner-'))
})

afterAll(async () => {
  await removeFolder(temporary.scratch)
})

const BASELINE: EvalArm = { name: 'baseline' }
const RECHECK: EvalArm = {
  name: 'mechanism',
  mechanism: 'prompt cache kept for 24 hours',
  change: (deps) => ({ ...deps, promptCacheRetention: () => '24h' }),
}
const STRICT_TOOLS: EvalArm = {
  name: 'strict-tools',
  mechanism: 'M101 strict-subset schemas for a capable selected model',
  change: (deps) => ({
    ...deps,
    modelFacts: () => ({
      capabilities: { ...CONSERVATIVE_CAPABILITIES, supportsStrictTools: true },
      quirks: FORMAT_QUIRKS.responses,
    }),
  }),
}
/** A harmful mechanism: the harness drops every write it is asked to make. */
const DROPS_WRITES: EvalArm = {
  name: 'mechanism',
  mechanism: 'writes dropped',
  change: (deps) => ({ ...deps, io: { ...deps.io, writeFile: () => Promise.resolve() } }),
}

/** A run that reads the file it fixes, writes each fix whole, and says so. */
function fixing(task: EvalTask, fixes: readonly EvalFix[]): ScriptedReply[] {
  const first = fixes[0]?.path ?? ''
  return [
    { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: first }) }] },
    ...fixes.map((fix) => ({
      calls: [
        { name: 'write_file', arguments: JSON.stringify({ path: fix.path, content: fix.content }) },
      ],
    })),
    { text: `Fixed ${task.id}.` },
  ]
}

function canonical(task: EvalTask): ScriptedReply[] {
  return fixing(task, fixesFor(EVAL_CANONICAL_FIXES, task))
}

/** A run that changes nothing. */
const IDLE: ScriptedReply[] = [{ text: 'Nothing to change.' }]

interface Rig {
  readonly api: FakeModelApi
  readonly log: FakeLogOutputChannel
  readonly roots: string[]
  readonly deps: EvalRunDeps
}

function rig(): Rig {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const roots: string[] = []
  let ids = 0
  return {
    api,
    log,
    roots,
    deps: {
      fetch: api.fetch,
      client: fakeModelApiClientSettings(log),
      toolIo: (workspace) =>
        createToolIo({
          platform: process.platform,
          listFiles: () => listWorkspaceFiles(workspace),
          systemRoot: process.env['SystemRoot'],
          env: () => process.env,
          // No task searches; the bundled worker is not built for unit tests.
          searchWorkerPath: path.join(temporary.scratch, 'searchWorker.js'),
          log: (message) => {
            log.warn(message)
          },
          unsavedFiles: () => [],
        }),
      contextIo: fileContextIo,
      platform: process.platform,
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      log,
      now: Date.now,
      newId: () => {
        ids += 1
        return `id${String(ids)}`
      },
      generatedAt: '2026-09-28T00:00:00.000Z',
      inspect: (root) => {
        roots.push(root)
        return Promise.resolve()
      },
    },
  }
}

describe('runPairedEval', { timeout: RUNS_TIMEOUT_MS }, () => {
  it('runs the M75 strict-tools fake pair with unchanged tasks, floors and attempt accounting (M106)', async () => {
    const { api, deps } = rig()
    api.script(...EVAL_TASKS.flatMap((task) => [...canonical(task), ...canonical(task)]))
    const report = await runPairedEval(EVAL_TASKS, [BASELINE, STRICT_TOOLS], deps)
    expect(report.verdict).toBe('pass')
    expect(report.floors.every((floor) => floor.held)).toBe(true)
    for (const arm of report.arms) {
      expect(arm.summaries).toMatchObject([
        { split: 'accept', tasks: 7, passed: 7, attempts: 21 },
        { split: 'heldout', tasks: 5, passed: 5, attempts: 15 },
      ])
    }
    const bodies = api.responseBodies()
    expect(bodies).toHaveLength(72)
    for (const index of EVAL_TASKS.keys()) {
      const pair = bodies.slice(index * 6, (index + 1) * 6)
      for (const [request, body] of pair.entries()) {
        const isStrict = index % 2 === 0 ? request >= 3 : request < 3
        const tools = JSON.stringify(body['tools'])
        expect(tools).toContain(`"strict":${String(isStrict)}`)
        expect(tools).not.toContain(`"strict":${String(!isStrict)}`)
      }
    }
  })

  it('passes a clean paired run, counting attempts from the trace', async () => {
    const { api, log, roots, deps } = rig()
    api.script(
      ...EVAL_TASKS.flatMap((task) => [
        ...canonical(task),
        ...fixing(task, fixesFor(EVAL_OTHER_FIXES, task)),
      ]),
    )
    const report = await runPairedEval(EVAL_TASKS, [BASELINE, RECHECK], deps)
    expect(report).toMatchObject({
      version: EVAL_REPORT_VERSION,
      model: EVAL_MODEL_ID,
      generatedAt: '2026-09-28T00:00:00.000Z',
      verdict: 'pass',
    })
    expect(report.arms.map((arm) => [arm.name, arm.mechanism])).toEqual([
      ['baseline', undefined],
      ['mechanism', 'prompt cache kept for 24 hours'],
    ])
    for (const arm of report.arms) {
      expect(arm.results.map((result) => result.failures)).toEqual(EVAL_TASKS.map(() => []))
      expect(arm.results.every((result) => result.terminal === 'completed')).toBe(true)
      // One read, one write, one answer per task: three model calls each.
      expect(arm.summaries).toMatchObject([
        { split: 'accept', tasks: 7, passed: 7, passRate: 1, attempts: 21, requests: 21 },
        { split: 'heldout', tasks: 5, passed: 5, passRate: 1, attempts: 15, requests: 15 },
      ])
      expect(arm.results[0]).toMatchObject({ toolCalls: 2, approvals: 0, inputTokens: 30 })
    }
    expect(api.responseBodies()).toHaveLength(72)
    expect(report.floors.every((floor) => floor.held)).toBe(true)
    // Every run had its own folder, and none is left.
    expect(new Set(roots).size).toBe(24)
    expect(roots.some((root) => existsSync(root))).toBe(false)
    expect(logLines(log)).toContain(
      'Evaluation baseline accept-off-by-one: passed after 3 attempts',
    )
  })

  it('fails the run when the mechanism loses the fixes', async () => {
    const { api, deps } = rig()
    const tasks = [...evalTasksOfSplit('accept').slice(0, 2), ...evalTasksOfSplit('heldout')]
    api.script(...tasks.flatMap((task) => [...canonical(task), ...canonical(task)]))
    const report = await runPairedEval(tasks, [BASELINE, DROPS_WRITES], deps)
    expect(report.verdict).toBe('fail')
    expect(report.floors.map((floor) => [floor.arm, floor.split, floor.held])).toEqual([
      ['baseline', 'accept', true],
      ['baseline', 'heldout', true],
      ['mechanism', 'accept', false],
      ['mechanism', 'heldout', false],
    ])
    const lost = report.arms[1]?.results[0]
    expect(lost?.terminal).toBe('completed')
    expect(lost?.failures[0]).toContain('the verifier failed: ')
  })

  it('holds the held-out floor through one lost task and not through two', async () => {
    const heldout = evalTasksOfSplit('heldout')
    const runWith = async (losses: number) => {
      const { api, deps } = rig()
      api.script(
        ...heldout.flatMap((task, index) => {
          const mechanism = index < losses ? IDLE : canonical(task)
          // The arms take turns going first: odd tasks start with the mechanism.
          return index % 2 === 0
            ? [...canonical(task), ...mechanism]
            : [...mechanism, ...canonical(task)]
        }),
      )
      return await runPairedEval(heldout, [BASELINE, RECHECK], deps)
    }
    const one = await runWith(1)
    // The accept split did not run: every floor that ran held, and that is all.
    expect(one.verdict).toBe('incomplete')
    expect(
      one.floors.find((floor) => floor.arm === 'mechanism' && floor.split === 'heldout'),
    ).toMatchObject({ tasks: 5, passRate: 0.8, held: true })
    expect(one.floors.find((floor) => floor.split === 'accept')).toMatchObject({
      tasks: 0,
      held: false,
    })
    const two = await runWith(2)
    expect(two.verdict).toBe('fail')
    expect(
      two.floors.find((floor) => floor.arm === 'mechanism' && floor.split === 'heldout'),
    ).toMatchObject({ passRate: 0.6, held: false })
  })

  it('lets the arms take turns going first, so no arm inherits the cache another warmed', async () => {
    const { api, deps } = rig()
    const tasks = EVAL_TASKS.slice(0, 4)
    api.script(...tasks.flatMap(() => [...IDLE, ...IDLE]))
    const report = await runPairedEval(tasks, [BASELINE, RECHECK], deps)
    expect(report.arms.map((arm) => arm.results.map((result) => result.order))).toEqual([
      [1, 2, 1, 2],
      [2, 1, 2, 1],
    ])
    // The requests as sent: the mechanism's is the one keeping its cache 24 hours.
    const plain = SETTING_DEFAULTS.modelApiPromptCacheRetention
    expect(api.responseBodies().map((body) => body['prompt_cache_retention'])).toEqual([
      plain,
      '24h',
      '24h',
      plain,
      plain,
      '24h',
      '24h',
      plain,
    ])
  })

  it('masks the task’s folder in a failure the report keeps', async () => {
    const { roots, deps } = rig()
    const [task] = EVAL_TASKS
    if (task === undefined) {
      throw new Error('the task set is empty')
    }
    const naming: EvalArm = {
      name: 'mechanism',
      change: (hostDeps) => {
        throw new Error(`nothing at ${hostDeps.workspaceRoot}`)
      },
    }
    const report = await runPairedEval([task], [naming], deps)
    expect(report.arms[0]?.results[0]?.failures).toEqual([
      `the turn could not run: nothing at ${path.join(EVAL_ROOT_MASK, 'workspace')}`,
    ])
    expect(JSON.stringify(report)).not.toContain(roots[0] ?? 'no root')
  })

  it('fails one task, not the run, when a step of it throws', async () => {
    const { api, deps } = rig()
    const [first, second] = EVAL_TASKS
    if (first === undefined || second === undefined) {
      throw new Error('the task set is too small')
    }
    const broken: EvalTask = {
      ...first,
      id: 'broken-fixture',
      files: [{ path: '../outside.js', content: 'x' }],
    }
    let isFirstScan = true
    api.script(...canonical(first), ...canonical(second))
    const report = await runPairedEval([broken, first, second], [BASELINE], {
      ...deps,
      inspect: () => {
        if (!isFirstScan) {
          return Promise.resolve()
        }
        isFirstScan = false
        return Promise.reject(new Error('the file is busy'))
      },
    })
    const [made, scanned, clean] = report.arms[0]?.results ?? []
    expect(made).toMatchObject({ passed: false, terminal: EVAL_TURN_NOT_RUN, attempts: 0 })
    expect(made?.failures[0]).toContain('the workspace could not be made: ')
    expect(scanned).toMatchObject({ passed: false, terminal: 'completed' })
    expect(scanned?.failures).toEqual(['the folder could not be inspected: the file is busy'])
    expect(clean).toMatchObject({ passed: true, failures: [] })
  })

  it('records the questions it answered', async () => {
    const { api, deps } = rig()
    const [task] = EVAL_TASKS
    if (task === undefined) {
      throw new Error('the task set is empty')
    }
    const question: ScriptedReply = {
      calls: [
        {
          name: 'ask_user',
          arguments: JSON.stringify({
            questions: [
              {
                id: 'q',
                header: 'Which',
                question: 'Which bound?',
                selection: { mode: 'single' },
                options: [{ label: 'The strict one' }],
              },
            ],
          }),
        },
      ],
    }
    api.script(question, ...canonical(task))
    const report = await runPairedEval([task], [BASELINE], deps)
    expect(report.arms[0]?.results[0]).toMatchObject({
      passed: true,
      questions: 1,
      paidRefusals: 0,
    })
  })

  it('counts a retried request as an attempt', async () => {
    const { api, deps } = rig()
    const [task] = EVAL_TASKS
    if (task === undefined) {
      throw new Error('the task set is empty')
    }
    api.script({ httpError: { status: 429 } }, ...canonical(task))
    const report = await runPairedEval([task], [BASELINE], deps)
    expect(report.arms[0]?.results[0]).toMatchObject({ passed: true, attempts: 4, requests: 4 })
  })

  it('records a turn that could not start, and still removes its folder', async () => {
    const { roots, deps } = rig()
    const broken: EvalArm = {
      name: 'mechanism',
      change: () => {
        throw new Error('the mechanism is not wired')
      },
    }
    const [task] = EVAL_TASKS
    if (task === undefined) {
      throw new Error('the task set is empty')
    }
    const report = await runPairedEval([task], [broken], deps)
    expect(report.arms[0]?.results[0]).toMatchObject({
      passed: false,
      terminal: EVAL_TURN_NOT_RUN,
      failures: ['the turn could not run: the mechanism is not wired'],
      attempts: 0,
    })
    expect(roots).toHaveLength(1)
    expect(roots.some((root) => existsSync(root))).toBe(false)
  })

  it('fails a task on which a paid use happened, however it passed', async () => {
    const { api, deps } = rig()
    const [task] = EVAL_TASKS
    if (task === undefined) {
      throw new Error('the task set is empty')
    }
    // A mechanism that bills something beyond tokens on every request.
    const billing: EvalArm = {
      name: 'mechanism',
      change: (hostDeps) => ({
        ...hostDeps,
        promptCacheRetention: () => {
          hostDeps.notePaidUse('webSearch', 1)
          return hostDeps.promptCacheRetention()
        },
      }),
    }
    api.script(...canonical(task))
    const report = await runPairedEval([task], [billing], deps)
    const [result] = report.arms[0]?.results ?? []
    expect(result?.terminal).toBe('completed')
    expect(result?.passed).toBe(false)
    expect(result?.failures).toEqual([expect.stringMatching(/^\d+ paid uses happened$/u)])
  })

  it('stops sending once the budget is spent', async () => {
    const { api, deps } = rig()
    const [first, second] = EVAL_TASKS
    if (first === undefined || second === undefined) {
      throw new Error('the task set is too small')
    }
    api.script({ text: 'Expensive.', usage: { input: BUDGET_BREAKING_INPUT_TOKENS, output: 0 } })
    const report = await runPairedEval([first, second], [BASELINE], deps)
    const [spent, refused] = report.arms[0]?.results ?? []
    expect(spent?.costUsd).toBeGreaterThanOrEqual(EVAL_BUDGET_USD)
    expect(refused).toMatchObject({ passed: false, terminal: 'failed', attempts: 0 })
    expect(refused?.failures).toContain(
      `refused: the evaluation's budget of $${EVAL_BUDGET_USD.toFixed(2)} is spent`,
    )
    expect(api.responseBodies()).toHaveLength(1)
  })

  it('calls a run of no tasks incomplete', async () => {
    const { deps } = rig()
    const report = await runPairedEval([], [BASELINE], deps)
    expect(report.verdict).toBe('incomplete')
    expect(report.floors.every((floor) => floor.tasks === 0 && !floor.held)).toBe(true)
  })

  it('records the packing ledger and the recalls of the long-output tasks (M73)', async () => {
    const { api, deps } = rig()
    const tasks = EVAL_TASKS.filter((task) => task.isLongOutput === true)
    api.script(
      ...tasks.flatMap((task, index) => {
        const plain = longTaskReplies(task, false, EVAL_LONG_EVIDENCE_RECALL_OFFSET)
        const packed = longTaskReplies(task, true, EVAL_LONG_EVIDENCE_RECALL_OFFSET)
        // The arms take turns going first: the second task starts with packing.
        return index % 2 === 0 ? [...plain, ...packed] : [...packed, ...plain]
      }),
    )
    const report = await runPairedEval(tasks, [BASELINE, OBSERVATION_PACKING_ARM], deps)
    expect(report.verdict).toBe('pass')
    const [baseline, packing] = report.arms
    expect(
      baseline?.results.map((result) => [
        result.passed,
        result.packedTokensAvoided,
        result.recalls,
      ]),
    ).toEqual([
      [true, undefined, 0],
      [true, undefined, 0],
    ])
    const packedResults = packing?.results ?? []
    expect(packedResults).toHaveLength(2)
    for (const result of packedResults) {
      expect(result).toMatchObject({ passed: true, recalls: 1 })
      expect(result.packedTokensAvoided).toBeGreaterThan(0)
    }
  })
})

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EVAL_BUDGET_USD,
  MODEL_API_MAX_RETRIES,
  EVAL_LONG_EVIDENCE_RECALL_OFFSET,
  EVAL_MODEL_ID,
  EVAL_REPORT_VERSION,
  EVAL_TURN_NOT_RUN,
  EVAL_ROOT_MASK,
  MODEL_API_MODEL_TEXT,
  SETTING_DEFAULTS,
} from '../../../src/shared/constants'
import {
  AUTO_COMPACTION_ARM,
  BASELINE_ARM,
  freezeEvalHarness,
  OBSERVATION_PACKING_ARM,
  STRICT_TOOLS_ARM,
} from '../../../src/core/eval/mechanisms'
import { Usd, sumUsd } from '../../../src/shared/usd'
import { evalReportSchema } from '../../../src/core/eval/report'
import { runPairedEval, type EvalArm, type EvalRunDeps } from '../../../src/core/eval/runner'
import plan from '../../../src/core/eval/plan.json'
import { withPackingEngagement, withCompactionEngagement } from '../../e2e/evalLiveSupport'
import { EVAL_TASKS, evalTasksOfSplit, type EvalTask } from '../../../src/core/eval/tasks'
import { listWorkspaceFiles } from '../../../src/core/eval/workspace'
import { fileContextIo } from '../../../src/host/backend/contextIo'
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
  compactionArmReplies,
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
  temporary.scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-eval-runner-')))
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
// The frozen strict-tools arm: the pair runs what lane E will count.
const STRICT_TOOLS: EvalArm = STRICT_TOOLS_ARM
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
        { split: 'accept', tasks: 9, passed: 9, attempts: 27 },
        { split: 'heldout', tasks: 7, passed: 7, attempts: 21 },
      ])
    }
    const bodies = api.responseBodies()
    expect(bodies).toHaveLength(96)
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
        { split: 'accept', tasks: 9, passed: 9, passRate: 1, attempts: 27, requests: 27 },
        { split: 'heldout', tasks: 7, passed: 7, passRate: 1, attempts: 21, requests: 21 },
      ])
      expect(arm.results[0]).toMatchObject({ toolCalls: 2, approvals: 0, inputTokens: 30 })
    }
    expect(api.responseBodies()).toHaveLength(96)
    expect(report.floors.every((floor) => floor.held)).toBe(true)
    // Every run had its own folder, and none is left.
    expect(new Set(roots).size).toBe(32)
    expect(roots.some((root) => existsSync(root))).toBe(false)
    expect(logLines(log)).toContain(
      'Evaluation baseline accept-off-by-one: passed after 3 attempts',
    )
  })

  it('fails the run when the mechanism loses the fixes', async () => {
    const { api, deps } = rig()
    const tasks = EVAL_TASKS
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
    ).toMatchObject({ tasks: 7, passRate: 6 / 7, held: true })
    expect(one.floors.find((floor) => floor.split === 'accept')).toMatchObject({
      tasks: 0,
      held: false,
    })
    const two = await runWith(2)
    expect(two.verdict).toBe('incomplete')
    expect(
      two.floors.find((floor) => floor.arm === 'mechanism' && floor.split === 'heldout'),
    ).toMatchObject({ passRate: 5 / 7, held: false })
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

  it('reports restricted arm failures before dispatch and removes every task folder', async () => {
    const { api, deps, roots } = rig()
    const program = path.join(temporary.scratch, 'blocked-arm.ts')
    writeFileSync(
      program,
      "import { readFileSync } from 'node:fs'; export const run = () => readFileSync('undeclared-helper.js', 'utf8')",
    )
    const arm: EvalArm = { name: 'blocked-arm', program }
    const report = await runPairedEval([EVAL_TASKS[0]!], [arm], deps)
    const result = report.arms[0]!.results[0]!
    expect(result).toMatchObject({ passed: false, terminal: EVAL_TURN_NOT_RUN, attempts: 0 })
    expect(result.failures.join('\n')).toContain('ERR_ACCESS_DENIED')
    expect(api.responseBodies()).toHaveLength(0)
    expect(roots).toHaveLength(1)
    expect(roots.some((root) => existsSync(root))).toBe(false)
    expect(evalReportSchema.parse(report)).toHaveProperty('harnessDigest')
  })

  it('executes the frozen program instead of a replacement parent callback', async () => {
    const { api, deps } = rig()
    const task = EVAL_TASKS[0]!
    api.script(...canonical(task))
    const arm: EvalArm = {
      ...STRICT_TOOLS_ARM,
      change: () => {
        throw new Error('parent arm callback must never execute')
      },
    }
    const report = await runPairedEval([task], [arm], deps)
    expect(report.arms[0]!.results[0]).toMatchObject({ passed: true, attempts: 3 })
    expect(
      api.responseBodies().every((body) => JSON.stringify(body).includes('"strict":true')),
    ).toBe(true)
    expect(evalReportSchema.parse(report)).toHaveProperty('harnessDigest')
  })

  it('binds the receipt to the exact selected task fixture data', async () => {
    const { api, deps } = rig()
    const original = EVAL_TASKS[0]!
    const altered: EvalTask = {
      ...original,
      prompt: original.prompt + '\nAn extra fixture condition.',
    }
    api.script(...canonical(altered))
    const report = await runPairedEval([altered], [BASELINE_ARM], deps)
    expect(report.arms[0]!.results[0]).toMatchObject({ passed: true, attempts: 3 })
    const receipt = evalReportSchema.parse(report)
    if (receipt.version !== EVAL_REPORT_VERSION) throw new Error('the run returned a legacy report')
    expect(receipt.harnessDigest).toBe(freezeEvalHarness([BASELINE_ARM], [altered]).sha256)
    expect(receipt.harnessDigest).not.toBe(freezeEvalHarness([BASELINE_ARM], [original]).sha256)
  })

  it('holds the same frozen arm bytes when source changes after freeze', async () => {
    const { api, deps } = rig()
    const program = path.join(temporary.scratch, 'snapshot-arm.ts')
    writeFileSync(program, 'export const run = name => ({ name, observationPacking: true })')
    const task = EVAL_TASKS[0]!
    api.script(...canonical(task))
    const report = await runPairedEval([task], [{ name: 'snapshot-arm', program }], {
      ...deps,
      toolIo: (workspace) => {
        writeFileSync(
          program,
          "export const run = () => { throw new Error('unfrozen source executed') }",
        )
        return deps.toolIo(workspace)
      },
    })
    expect(report.arms[0]!.results[0]).toMatchObject({ passed: true, attempts: 3 })
    expect(evalReportSchema.parse(report)).toHaveProperty('harnessDigest')
  })

  it('refuses malformed frozen options and never gives unfrozen callbacks a frozen receipt', async () => {
    const { api, deps } = rig()
    const task = EVAL_TASKS[0]!
    const program = path.join(temporary.scratch, 'invalid-arm.ts')
    for (const options of [
      { name: 'invalid-arm', workspaceRoot: '/outside' },
      { name: 'other-arm' },
      { name: 'invalid-arm', autoCompaction: 'yes' },
    ]) {
      writeFileSync(program, `export const run = () => (${JSON.stringify(options)})`)
      const report = await runPairedEval([task], [{ name: 'invalid-arm', program }], deps)
      expect(report.arms[0]!.results[0]).toMatchObject({ passed: false, attempts: 0 })
      expect(report.arms[0]!.results[0]!.failures).not.toHaveLength(0)
    }
    expect(api.responseBodies()).toHaveLength(0)
    api.script(...canonical(task))
    const unfrozen = await runPairedEval([task], [RECHECK], deps)
    expect(unfrozen).not.toHaveProperty('harnessDigest')
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
    expect(Number(spent?.costUsd)).toBeGreaterThanOrEqual(EVAL_BUDGET_USD)
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

  it('runs the M101 auto-compaction fake pair: the arm compacts the long-context tasks and both arms hold the floors', async () => {
    const { api, deps, log } = rig()
    const longIds = new Set(
      EVAL_TASKS.filter((task) => task.isLongContext === true).map((task) => task.id),
    )
    expect([...longIds].toSorted((a, b) => a.localeCompare(b))).toEqual([
      'accept-long-compaction',
      'heldout-long-compaction',
    ])
    api.script(
      ...EVAL_TASKS.flatMap((task, index) => {
        const base = canonical(task)
        const arm = longIds.has(task.id) ? compactionArmReplies(task) : canonical(task)
        // The arms take turns going first: odd tasks start with the mechanism.
        return index % 2 === 0 ? [...base, ...arm] : [...arm, ...base]
      }),
    )
    const report = await runPairedEval(EVAL_TASKS, [BASELINE, AUTO_COMPACTION_ARM], deps)
    expect(report.verdict).toBe('pass')
    expect(report.floors.every((floor) => floor.held)).toBe(true)
    for (const arm of report.arms) {
      expect(arm.results.every((result) => result.passed)).toBe(true)
      expect(arm.summaries).toMatchObject([
        { split: 'accept', tasks: 9, passed: 9 },
        { split: 'heldout', tasks: 7, passed: 7 },
      ])
    }
    // Fourteen small tasks at three attempts on both arms, plus two
    // long-context tasks at three on the baseline and six on the arm.
    expect(api.responseBodies()).toHaveLength(102)
    // Exactly the arm's two long-context runs compacted: one summary each.
    const summaries = api
      .responseBodies()
      .filter((body) =>
        JSON.stringify(body).includes(MODEL_API_MODEL_TEXT.compactionPrompt.slice(0, 40)),
      )
    expect(summaries).toHaveLength(2)
    // Each compaction settled through the real admission against the run
    // budget — never the paid-use failure counter — and the run says so.
    for (const taskId of ['accept-long-compaction', 'heldout-long-compaction']) {
      expect(logLines(log)).toContain(
        `Evaluation auto-compaction ${taskId}: 1 admitted compaction attempt settled against the run budget`,
      )
    }
    // The settled-admission count rides on every task result: one on each
    // long-context run of the arm, zero everywhere else — the baseline
    // settled nothing on any task.
    if (report.version !== EVAL_REPORT_VERSION) throw new Error('unexpected report version')
    const [baselineArm, compactionArm] = report.arms
    const baselineResults = baselineArm?.results ?? []
    for (const result of baselineResults) {
      expect(result.compactionsSettled).toBe(0)
    }
    const compactionResults = compactionArm?.results ?? []
    for (const result of compactionResults) {
      expect(result.compactionsSettled).toBe(longIds.has(result.taskId) ? 1 : 0)
      expect(result.compactionsApplied).toBe(longIds.has(result.taskId) ? 1 : 0)
    }
    const money = report.compactionLedger
    expect(Number(money?.reservedUsd)).toBeGreaterThan(0)
    expect(Number(money?.settledUsd)).toBeGreaterThan(0)
    expect(money?.outstandingUsd).toBe(Usd.from(0).toAmount())
    expect(money?.retainedUsd).toBe(Usd.from(0).toAmount())
    const armedMoney = compactionArm?.compactionLedger
    expect(armedMoney).toEqual(money)
    expect(baselineArm?.compactionLedger?.reservedUsd).toBe(Usd.from(0).toAmount())
    expect(
      sumUsd(
        ...compactionResults.map(
          (result) => result.compactionLedger?.reservedUsd ?? Usd.from(0).toAmount(),
        ),
      ),
    ).toBe(money?.reservedUsd)
    expect(
      sumUsd(
        ...compactionResults.map(
          (result) => result.compactionLedger?.settledUsd ?? Usd.from(0).toAmount(),
        ),
      ),
    ).toBe(money?.settledUsd)
    const parsed = evalReportSchema.parse(structuredClone(report))
    expect(parsed.version === EVAL_REPORT_VERSION ? parsed.compactionLedger : undefined).toEqual(
      money,
    )
    // A full run names no early stop.
    expect(report.stoppedEarly).toBeUndefined()
  })

  it('calls a run that hits its call ceiling incomplete, with the reason', async () => {
    const { api, deps } = rig()
    const [first, second] = EVAL_TASKS
    if (first === undefined || second === undefined) {
      throw new Error('the task set is too small')
    }
    api.script(...canonical(first), ...canonical(second))
    const report = await runPairedEval([first, second], [BASELINE], { ...deps, maxAttempts: 1 })
    // Refusals manufacture failures, so the truncated run decides nothing:
    // incomplete, never a pass — and the receipt says why.
    expect(report.verdict).toBe('incomplete')
    expect(report.version === EVAL_REPORT_VERSION ? report.stoppedEarly : undefined).toEqual([
      'the run stopped at its call ceiling of 1 model calls',
    ])
    const parsed = evalReportSchema.parse(structuredClone(report))
    expect(parsed.version === EVAL_REPORT_VERSION ? parsed.stoppedEarly : undefined).toEqual([
      'the run stopped at its call ceiling of 1 model calls',
    ])
    const [one, two] = report.arms[0]?.results ?? []
    expect(one?.failures.some((failure) => failure.includes('call ceiling of 1'))).toBe(true)
    expect(two?.attempts).toBe(0)
  })

  it.each(['empty', 'tool', 'rate-limited'] as const)(
    'leaves a rejected %s summary unengaged on a fake pair',
    async (kind) => {
      const { api, deps } = rig()
      const task = EVAL_TASKS.find((candidate) => candidate.id === 'accept-long-compaction')
      if (task === undefined) throw new Error('missing long task')
      const arm = compactionArmReplies(task)
      const rejections: Record<typeof kind, { reply: ScriptedReply; count: number }> = {
        empty: { reply: { text: '' }, count: 1 },
        tool: {
          reply: {
            calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'package.json' }) }],
          },
          count: 2,
        },
        'rate-limited': {
          reply: { httpError: { status: 429, retryAfter: '0' } },
          count: MODEL_API_MAX_RETRIES + 1,
        },
      }
      const rejected = rejections[kind]
      api.script(
        ...canonical(task),
        arm[0] ?? {},
        ...Array.from({ length: rejected.count }, () => rejected.reply),
        { text: 'Continue without compaction.' },
      )
      const raw = await runPairedEval([task], [BASELINE, AUTO_COMPACTION_ARM], deps)
      const result = raw.arms[1]?.results[0]
      expect(result?.compactionsSettled).toBeGreaterThan(0)
      expect(result?.compactionsApplied).toBe(0)
      const report = withCompactionEngagement(raw, 'auto-compaction', 'baseline', [task])
      expect(
        report.version === EVAL_REPORT_VERSION ? report.compactionEngagement?.unengaged : undefined,
      ).toEqual([task.id])
    },
  )

  it('records module-fact visibility and a digest for each writing request without prompt contents', async () => {
    const { api, deps } = rig()
    const task = EVAL_TASKS.find((candidate) => candidate.id === 'accept-long-middle-value')
    if (task === undefined) throw new Error('missing packing task')
    const fix = fixesFor(EVAL_CANONICAL_FIXES, task)[0]
    api.script(
      { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'package.json' }) }] },
      { calls: [{ name: 'write_file', arguments: JSON.stringify(fix) }] },
      { text: 'Complete.' },
    )
    const report = await runPairedEval([task], [BASELINE], deps)
    const evidence = report.arms[0]?.results[0]?.requestEvidence
    expect(evidence).toHaveLength(3)
    expect(evidence?.map((request) => request.packageTypeModuleVisible)).toEqual([
      false,
      true,
      true,
    ])
    expect(evidence?.[1]?.responseTools).toEqual(['write_file'])
    for (const [index, body] of api.responseBodies().entries()) {
      expect(evidence?.[index]?.sha256).toBe(
        createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      )
    }
    const json = JSON.stringify(evidence)
    expect(json).not.toContain(task.prompt)
    expect(json).not.toContain(task.files.find((file) => file.path === 'package.json')?.content)
    expect(json).not.toContain(fix?.content)
    const parsed = evalReportSchema.parse(structuredClone(report))
    expect(parsed.arms[0]?.results[0]?.requestEvidence).toEqual(evidence)
  })

  it.each(['money', 'unknown'])('records a %s stop even on the very last call', async (kind) => {
    const { api, deps } = rig()
    const lastReply: ScriptedReply =
      kind === 'money'
        ? { text: 'Complete.', usage: { input: BUDGET_BREAKING_INPUT_TOKENS, output: 0 } }
        : { text: 'Complete.', omitUsage: true }
    api.script(
      ...EVAL_TASKS.flatMap((task, index) =>
        index === EVAL_TASKS.length - 1
          ? [...canonical(task).slice(0, -1), lastReply]
          : canonical(task),
      ),
    )
    const raw = await runPairedEval(EVAL_TASKS, [BASELINE], deps)
    expect(raw.floors.every((floor) => floor.held)).toBe(true)
    expect(raw.verdict).toBe('incomplete')
    expect(raw.version === EVAL_REPORT_VERSION ? raw.stoppedEarly : undefined).toEqual([
      kind === 'money'
        ? `the run stopped after its budget of $${EVAL_BUDGET_USD.toFixed(2)} was spent`
        : 'the run stopped because a sent model call has unknown usage',
    ])
    expect(
      withCompactionEngagement(
        withPackingEngagement(raw, 'packing', EVAL_TASKS),
        'auto-compaction',
        'baseline',
        EVAL_TASKS,
      ).verdict,
    ).toBe('incomplete')
  })

  it('records a local overrun and still runs the next task', async () => {
    const { api, deps } = rig()
    const tasks = EVAL_TASKS.filter((task) =>
      ['accept-off-by-one', 'heldout-strict-equal'].includes(task.id),
    )
    const [first, next] = tasks
    if (first === undefined || next === undefined) throw new Error('missing task')
    // The first task consumes its one call on a read; its write is refused.
    // The refusal consumes no scripted reply, leaving the next task intact.
    api.script(canonical(first)[0] ?? {}, {
      calls: [
        { name: 'write_file', arguments: JSON.stringify(fixesFor(EVAL_CANONICAL_FIXES, next)[0]) },
      ],
    })
    const report = await runPairedEval(tasks, [BASELINE], { ...deps, maxTaskAttempts: 1 })
    expect(report.arms[0]?.results[0]).toMatchObject({
      passed: false,
      overBudget: true,
      callBudget: 1,
      attempts: 1,
    })
    expect(report.arms[0]?.results[0]?.failures.join(' ')).toContain('task over budget')
    // A one-call write also needs a closing response, so grant the second
    // task its real measured allowance in the independent full-run case below.
    expect(report.arms[0]?.results[1]?.attempts).toBe(1)
    expect(api.responseBodies()).toHaveLength(2)
    expect(report.version === EVAL_REPORT_VERSION ? report.stoppedEarly : undefined).toBeUndefined()
  })

  it('reaches both compaction tasks before talkative small tasks, on every arm', async () => {
    const { api, deps } = rig()
    const arms = [BASELINE, OBSERVATION_PACKING_ARM, AUTO_COMPACTION_ARM, STRICT_TOOLS_ARM] as const
    api.script(
      ...EVAL_TASKS.flatMap((task, index) => {
        const order = [...arms.slice(index % arms.length), ...arms.slice(0, index % arms.length)]
        return order.flatMap((arm) => {
          if (task.isLongContext === true)
            return arm === AUTO_COMPACTION_ARM ? compactionArmReplies(task) : canonical(task)
          if (task.isLongOutput === true)
            return longTaskReplies(
              task,
              arm === OBSERVATION_PACKING_ARM,
              EVAL_LONG_EVIDENCE_RECALL_OFFSET,
            )
          if (task.id !== 'accept-off-by-one') return canonical(task)
          const allowance = plan.tasks.find((row) => row.id === task.id)?.callBudget ?? 1
          return Array.from({ length: allowance }, (_, step) => ({
            calls: [
              {
                name: 'todo_write',
                arguments: JSON.stringify({
                  items: [
                    { id: String(step), text: `Step ${String(step)}`, status: 'in_progress' },
                  ],
                }),
              },
            ],
          }))
        })
      }),
    )
    const report = await runPairedEval(EVAL_TASKS, arms, { ...deps, maxAttempts: 548 })
    for (const arm of report.arms) {
      expect(arm.results.slice(0, 4).map((task) => task.taskId)).toEqual([
        'accept-long-compaction',
        'heldout-long-compaction',
        'accept-long-middle-value',
        'heldout-long-middle-rule',
      ])
      expect(arm.results.slice(0, 4).every((task) => task.passed)).toBe(true)
      expect(arm.results.find((task) => task.taskId === 'accept-off-by-one')).toMatchObject({
        overBudget: true,
        passed: false,
      })
      expect(arm.results.slice(5).every((task) => task.passed)).toBe(true)
    }
    expect(
      report.arms
        .find((arm) => arm.name === 'auto-compaction')
        ?.results.slice(0, 2)
        .map((task) => task.compactionsApplied),
    ).toEqual([1, 1])
    expect(report.version === EVAL_REPORT_VERSION ? report.stoppedEarly : undefined).toBeUndefined()
    expect(report.verdict).toBe('pass')
  })

  it('calls the six-task selection incomplete even when every floor and mechanism holds', async () => {
    const { api, deps } = rig()
    const tasks = EVAL_TASKS.filter(
      (task) =>
        task.isLongContext === true ||
        task.isLongOutput === true ||
        ['accept-off-by-one', 'heldout-strict-equal'].includes(task.id),
    )
    api.script(...tasks.flatMap((task) => canonical(task)))
    const raw = await runPairedEval(tasks, [BASELINE], deps)
    if (raw.version !== EVAL_REPORT_VERSION) throw new Error('unexpected legacy report')
    expect(raw.floors.every((floor) => floor.held)).toBe(true)
    // Accepted and packed evidence is supplied here to isolate selection.
    const report = {
      ...raw,
      arms: [
        ...raw.arms,
        {
          ...raw.arms[0],
          name: 'packing',
          results:
            raw.arms[0]?.results.map((result) => ({ ...result, packedTokensAvoided: 1 })) ?? [],
          summaries: [],
        },
        {
          name: 'auto-compaction',
          results:
            raw.arms[0]?.results.map((result) => ({
              ...result,
              compactionsApplied: 1,
              compactionsSettled: 1,
            })) ?? [],
          summaries: [],
        },
      ],
    }
    const engaged = withCompactionEngagement(
      withPackingEngagement(report, 'packing', tasks),
      'auto-compaction',
      'baseline',
      tasks,
    )
    if (engaged.version !== EVAL_REPORT_VERSION) throw new Error('unexpected report version')
    expect(engaged.packingEngagement?.held).toBe(true)
    expect(engaged.compactionEngagement?.held).toBe(true)
    expect(engaged.verdict).toBe('incomplete')
    expect(raw.incompleteReasons).toEqual(['narrowed selection'])
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
    expect(report.verdict).toBe('incomplete')
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

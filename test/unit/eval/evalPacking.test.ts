// Observation packing (M73, PLAN.md D49) as an M75 arm: the arm turns
// packing on for the eval host, a long output then rides whole twice and
// packs, and the long-output tasks can be finished through recall_output.

import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { OBSERVATION_PACKING_ARM } from '../../../src/core/eval/mechanisms'
import { EVAL_TASKS, type EvalTask } from '../../../src/core/eval/tasks'
import {
  EVAL_LONG_EVIDENCE_RECALL_OFFSET,
  MODEL_API_TOOLS,
  OBS_PACK_THRESHOLD_CHARS,
} from '../../../src/shared/constants'
import { driveEvalTurn, EVAL_TURN_ROOT } from '../helpers/evalTurn'
import { responseOutputsByCall, type FakeModelApi } from '../helpers/fakeModelApi'
import { fixesFor, EVAL_CANONICAL_FIXES, longTaskReplies, readReply as read } from './evalFixes'

const LONG_TASKS = EVAL_TASKS.filter((task) => task.isLongOutput === true)
const BIG = Array.from(
  { length: 400 },
  (_, index) => `line ${String(index)} ${'x'.repeat(20)}`,
).join('\n')
const MIDDLE_RECORDS: Readonly<Record<string, string>> = {
  'accept-long-middle-value': 'required_value=314159',
  'heldout-long-middle-rule': 'required mapping: multiply the input by 7, then add 11',
}

const toolListSchema = z.array(z.object({ name: z.optional(z.string()), type: z.string() }))

function toolsOffered(api: FakeModelApi, requestIndex = 0): string[] {
  return toolListSchema
    .parse(api.responseBodies()[requestIndex]?.['tools'])
    .map((tool) => tool.name ?? tool.type)
}

/** Reads big.txt, then small.txt twice: big.txt is in four requests. */
async function readBigThenSmall(isPacking: boolean): Promise<FakeModelApi> {
  const { api, outcome } = await driveEvalTurn({
    replies: [
      read('big.txt', 'c1'),
      read('small.txt', 'c2'),
      read('small.txt', 'c3'),
      { text: 'Done.' },
    ],
    files: { 'big.txt': BIG, 'small.txt': 'export const one = 1\n' },
    prompt: 'Read big.txt, then small.txt twice.',
    change: isPacking ? OBSERVATION_PACKING_ARM.change : undefined,
  })
  expect(outcome.terminal).toBe('completed')
  expect(api.responseBodies()).toHaveLength(4)
  return api
}

async function runLongTask(task: EvalTask, isPacking: boolean, offset: number) {
  return await driveEvalTurn({
    prompt: task.prompt,
    files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
    change: isPacking ? OBSERVATION_PACKING_ARM.change : undefined,
    replies: longTaskReplies(task, isPacking, offset),
  })
}

describe('the observation packing arm', () => {
  it('names the mechanism the M75 run measures', () => {
    expect(OBSERVATION_PACKING_ARM.name).toBe('packing')
    expect(OBSERVATION_PACKING_ARM.mechanism).toContain('recall_output')
  })

  it('packs nothing on the baseline, which is never offered recall_output', async () => {
    const api = await readBigThenSmall(false)
    expect(toolsOffered(api)).not.toContain(MODEL_API_TOOLS.recallOutput)
    expect(responseOutputsByCall(api, 3).get('c1')).toContain('line 399')
    expect(responseOutputsByCall(api, 3).get('c1')).toContain('line 200')
  })

  it('offers recall_output and packs the long output on its third send', async () => {
    const api = await readBigThenSmall(true)
    expect(toolsOffered(api)).toContain(MODEL_API_TOOLS.recallOutput)
    // M101: the declaration and prefix digest are identical before and after the swap.
    const bodies = api.responseBodies()
    expect(new Set(bodies.map((body) => JSON.stringify(body['tools']))).size).toBe(1)
    expect(new Set(bodies.map((body) => body['prompt_cache_key'])).size).toBe(1)
    // Whole on the two requests after the read…
    expect(responseOutputsByCall(api, 1).get('c1')).toContain('line 200')
    expect(responseOutputsByCall(api, 2).get('c1')).toContain('line 200')
    // …then a placeholder naming its id and keeping its edges, while the
    // newer, short output still rides whole.
    const packed = responseOutputsByCall(api, 3).get('c1') ?? ''
    expect(packed).toContain('"c1"')
    expect(packed).toContain('line 0')
    expect(packed).toContain('line 399')
    expect(packed).not.toContain('line 200')
    expect(responseOutputsByCall(api, 3).get('c2')).toContain('export const one')
  })

  it('has two long-output tasks, one per split, whose evidence packs', () => {
    expect(LONG_TASKS.map((task) => [task.id, task.split])).toEqual([
      ['accept-long-middle-value', 'accept'],
      ['heldout-long-middle-rule', 'heldout'],
    ])
    for (const task of LONG_TASKS) {
      const evidence = task.files.find((file) => file.path === 'evidence.txt')?.content ?? ''
      expect(evidence.length).toBeGreaterThan(OBS_PACK_THRESHOLD_CHARS)
      expect(evidence).toContain(MIDDLE_RECORDS[task.id] ?? 'a middle record')
    }
  })

  it.each(LONG_TASKS.map((task) => [task.id, task] as const))(
    '%s: the evidence packs on its third send and a recall from the named offset recovers the middle record',
    async (id, task) => {
      const record = MIDDLE_RECORDS[id] ?? 'a middle record'
      const { api, io, outcome } = await runLongTask(task, true, EVAL_LONG_EVIDENCE_RECALL_OFFSET)
      expect(outcome.terminal).toBe('completed')
      expect(api.responseBodies()).toHaveLength(6)
      expect(responseOutputsByCall(api, 1).get('evidence')).toContain(record)
      expect(responseOutputsByCall(api, 2).get('evidence')).toContain(record)
      const packed = responseOutputsByCall(api, 3).get('evidence') ?? ''
      expect(packed).toContain('"evidence"')
      expect(packed).not.toContain(record)
      expect(packed.length).toBeLessThanOrEqual(OBS_PACK_THRESHOLD_CHARS)
      expect(outcome.packedTokensAvoided).toBeGreaterThan(0)
      expect(outcome.recalledOutputs).toHaveLength(1)
      expect(outcome.recalledOutputs[0]).toContain(record)
      const [fix] = fixesFor(EVAL_CANONICAL_FIXES, task)
      expect(io.files.has(`${EVAL_TURN_ROOT}/${fix?.path ?? ''}`)).toBe(true)
    },
  )

  it('records no ledger and no recall on the baseline of a long-output task', async () => {
    const [task] = LONG_TASKS
    if (task === undefined) {
      throw new Error('no long-output task')
    }
    const { outcome } = await runLongTask(task, false, EVAL_LONG_EVIDENCE_RECALL_OFFSET)
    expect(outcome.terminal).toBe('completed')
    expect(outcome.packedTokensAvoided).toBeUndefined()
    expect(outcome.recalledOutputs).toEqual([])
  })

  it('counts only a recall that succeeded', async () => {
    const [task] = LONG_TASKS
    if (task === undefined) {
      throw new Error('no long-output task')
    }
    // An offset past the end is refused: the row fails, nothing is recalled.
    const { outcome } = await runLongTask(task, true, Number.MAX_SAFE_INTEGER)
    expect(outcome.terminal).toBe('completed')
    expect(outcome.packedTokensAvoided).toBeGreaterThan(0)
    expect(outcome.tools).toContain(MODEL_API_TOOLS.recallOutput)
    expect(outcome.recalledOutputs).toEqual([])
  })
})

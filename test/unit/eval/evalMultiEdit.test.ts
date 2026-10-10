// Multi-edit (M101 item 20) as a task-level M75 pair: each multi-edit task
// carries two defects in one file. One `edits[]` call fixes both in one
// round; two single `find`/`replace` calls fix them in two. Both spellings
// pass the same behavioural verifier (comparability), and the single call
// sends one fewer request. There is no host seam to arm on — `edits[]` is
// always declared — so the frozen pair varies the model's calls, not the
// harness.

import { describe, expect, it } from 'vitest'
import { EVAL_TASKS, type EvalTask } from '../../../src/core/eval/tasks'
import { MODEL_API_TOOLS } from '../../../src/shared/constants'
import { driveEvalTurn, EVAL_TURN_ROOT } from '../helpers/evalTurn'
import type { ScriptedReply } from '../helpers/fakeModelApi'
import { EVAL_CANONICAL_FIXES, fixesFor } from './evalFixes'

const MULTI_TASKS = EVAL_TASKS.filter(
  (task) => task.id === 'accept-multi-edit' || task.id === 'heldout-multi-edit',
)

/** The two single-edit spellings, one `find`/`replace` pair per defect. */
const SINGLES: Readonly<Record<string, readonly { find: string; replace: string }[]>> = {
  'accept-multi-edit': [
    {
      find: "return text.toLowerCase() + '!!!'",
      replace: "return text.toUpperCase() + '!!!'",
    },
    {
      find: "return text.toUpperCase() + '...'",
      replace: "return text.toLowerCase() + '...'",
    },
  ],
  'heldout-multi-edit': [
    { find: 'return value < min ? min + 1 : value', replace: 'return value < min ? min : value' },
    { find: 'return value > max ? max - 1 : value', replace: 'return value > max ? max : value' },
  ],
}

function editCall(args: unknown, callId: string): ScriptedReply {
  return {
    calls: [{ name: MODEL_API_TOOLS.editFile, arguments: JSON.stringify(args), callId }],
  }
}

function readCall(path: string): ScriptedReply {
  return {
    calls: [{ name: MODEL_API_TOOLS.readFile, arguments: JSON.stringify({ path }), callId: 'r1' }],
  }
}

function runTask(task: EvalTask, replies: readonly ScriptedReply[]) {
  return driveEvalTurn({
    prompt: task.prompt,
    files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
    replies,
  })
}

describe('the multi-edit pair', () => {
  it('freezes one multi-edit task per split', () => {
    expect(MULTI_TASKS.map((task) => [task.id, task.split])).toEqual([
      ['accept-multi-edit', 'accept'],
      ['heldout-multi-edit', 'heldout'],
    ])
  })

  it.each(MULTI_TASKS.map((task) => [task.id, task] as const))(
    '%s: one edits[] call and repeated single edits both fix it, the single call in one fewer request',
    async (_id, task) => {
      const [fix] = fixesFor(EVAL_CANONICAL_FIXES, task)
      if (fix === undefined) {
        throw new Error(`no canonical fix for ${task.id}`)
      }
      const singles = SINGLES[task.id]
      if (singles === undefined) {
        throw new Error(`no single edits for ${task.id}`)
      }
      const multi = await runTask(task, [
        readCall(fix.path),
        editCall({ path: fix.path, edits: singles }, 'e1'),
        { text: 'Fixed both in one call.' },
      ])
      expect(multi.outcome.terminal).toBe('completed')
      expect(multi.outcome.tools).toEqual([MODEL_API_TOOLS.readFile, MODEL_API_TOOLS.editFile])
      expect(multi.io.files.get(`${EVAL_TURN_ROOT}/${fix.path}`)).toBe(fix.content)
      expect(multi.api.responseBodies()).toHaveLength(3)
      const single = await runTask(task, [
        readCall(fix.path),
        ...singles.map((entry, index) =>
          editCall({ path: fix.path, ...entry }, `e${String(index + 1)}`),
        ),
        { text: 'Fixed one at a time.' },
      ])
      expect(single.outcome.terminal).toBe('completed')
      expect(single.outcome.tools).toEqual([
        MODEL_API_TOOLS.readFile,
        MODEL_API_TOOLS.editFile,
        MODEL_API_TOOLS.editFile,
      ])
      expect(single.io.files.get(`${EVAL_TURN_ROOT}/${fix.path}`)).toBe(fix.content)
      expect(single.api.responseBodies()).toHaveLength(4)
    },
  )
})

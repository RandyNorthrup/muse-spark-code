// Automatic compaction (M74) as an M75 arm: the arm compacts at its first
// settled tool boundary, restores the exact host todos behind a hidden
// follow-up, and the long-context tasks still pass. A refused memory write,
// Stop and a classified overflow are evidenced on the same harness.

import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  ModelApiHost,
  type ModelApiHostDeps,
} from '../../../src/core/backends/modelapi/ModelApiHost'
import type { MemoryStore } from '../../../src/core/memory/memoryStore'
import type { ApprovalMode } from '../../../src/shared/permissionModes'
import { AUTO_COMPACTION_ARM, EVAL_ARMS } from '../../../src/core/eval/mechanisms'
import { EVAL_TASKS, evalWindowTokens, type EvalTask } from '../../../src/core/eval/tasks'
import {
  EVAL_COMPACT_BULK_LINE_CHARS,
  EVAL_COMPACT_BULK_LINES,
  EVAL_COMPACT_WINDOW_TOKENS,
  EVAL_LONG_EVIDENCE_RECALL_OFFSET,
  EVAL_TURN_TIMED_OUT,
  MODEL_API_MODEL_TEXT,
  MODEL_API_TOOLS,
} from '../../../src/shared/constants'
import { bindEvalAdmission } from '../../../src/core/eval/driver'
import { driveEvalTurn, testEvalAdmission, EVAL_TURN_ROOT } from '../helpers/evalTurn'
import { FakeLogOutputChannel } from '../helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClient,
  responseOutputsByCall,
  type ScriptedReply,
} from '../helpers/fakeModelApi'
import { memoryStoreOver } from '../helpers/fakeMemoryIo'
import { memoryToolIo } from '../helpers/fakeToolIo'
import { fakeModelApiHostDeps } from '../helpers/modelApiHostDeps'
import { startWatchedSession } from '../helpers/sessionTurns'
import {
  COMPACTION_TODOS_OPEN,
  EVAL_CANONICAL_FIXES,
  compactionArmReplies,
  fixesFor,
  longTaskReplies,
  overflowFixReplies,
} from './evalFixes'

const LONG_TASKS = EVAL_TASKS.filter((task) => task.isLongContext === true)
const SUMMARY = 'Summary of the long-log turn [untrusted].'

/** The shared arm script's first reply: the todos the run registers. */
function openTodos(): ScriptedReply {
  return {
    calls: [
      {
        name: MODEL_API_TOOLS.todoWrite,
        arguments: JSON.stringify({ items: COMPACTION_TODOS_OPEN }),
        callId: 't1',
      },
    ],
  }
}

/**
 * A long-context task as the counted run drives it: the window is harness
 * condition, so both arms share it and the pair isolates compaction alone
 * (M101 R2). Every caller passes the task's resolved window, including the
 * baseline runs below.
 */
function runLongTask(
  task: EvalTask,
  replies: readonly ScriptedReply[],
  options: { turnTimeoutMs?: number | undefined } = {},
) {
  return driveEvalTurn({
    prompt: task.prompt,
    files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
    change: AUTO_COMPACTION_ARM.change,
    windowTokens: evalWindowTokens(task) ?? EVAL_COMPACT_WINDOW_TOKENS,
    turnTimeoutMs: options.turnTimeoutMs,
    replies,
  })
}

/**
 * A small task through the classified-overflow flow: read the file, take
 * the 400 overflow, take the summary the arm compacts into, write the fix
 * and close. The memory tests and the overflow recovery share this drive;
 * only the store, the approval mode and the closing text vary.
 */
async function runOverflowTurn(options: {
  readonly memory?: MemoryStore | undefined
  readonly approvalMode?: ApprovalMode | undefined
  readonly closing: string
}) {
  const task = EVAL_TASKS.find((candidate) => candidate.id === 'accept-off-by-one')
  if (task === undefined) {
    throw new Error('no small task')
  }
  const [fix] = fixesFor(EVAL_CANONICAL_FIXES, task)
  if (fix === undefined) {
    throw new Error(`no canonical fix for ${task.id}`)
  }
  const driven = await driveEvalTurn({
    prompt: task.prompt,
    files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
    change: AUTO_COMPACTION_ARM.change,
    memory: options.memory,
    approvalMode: options.approvalMode,
    replies: overflowFixReplies(fix, options.closing),
  })
  return { task, fix, ...driven }
}

/**
 * The summary request went out, with (`hasContinuation`) or without its
 * continuation: the shared shape of the compaction-engagement assertions.
 */
function expectSummaryRequest(
  api: { responseBodies: () => readonly Record<string, unknown>[] },
  hasContinuation: boolean,
): void {
  const bodies = bodyTexts(api)
  expect(
    bodies.some((body) => body.includes(MODEL_API_MODEL_TEXT.compactionPrompt.slice(0, 40))),
  ).toBe(true)
  expect(
    bodies.some((body) => body.includes(MODEL_API_MODEL_TEXT.autoCompactionFollowup.slice(0, 40))),
  ).toBe(hasContinuation)
}

function bodyTexts(api: { responseBodies: () => readonly Record<string, unknown>[] }): string[] {
  return api.responseBodies().map((body) => JSON.stringify(body))
}

const flushCallSchema = z.object({ type: z.string(), name: z.optional(z.string()) })

/**
 * The host's automatic memory flush calls in the requests sent: a
 * function_call input item naming add_memory. Model-originated calls never
 * name it in these suites, so any match is the flush — unlike a body
 * substring, which also matches the tool declaration.
 */
function flushCallsOf(api: { responseBodies: () => readonly Record<string, unknown>[] }): number {
  let count = 0
  for (const body of api.responseBodies()) {
    const input: unknown = body['input']
    if (!Array.isArray(input)) {
      continue
    }
    for (const item of input) {
      const parsed = flushCallSchema.safeParse(item)
      if (
        parsed.success &&
        parsed.data.type === 'function_call' &&
        parsed.data.name === MODEL_API_TOOLS.addMemory
      ) {
        count += 1
      }
    }
  }
  return count
}

describe('the automatic compaction arm', () => {
  it('is the frozen third mechanism after the baseline and packing', () => {
    expect(AUTO_COMPACTION_ARM.name).toBe('auto-compaction')
    expect(AUTO_COMPACTION_ARM.mechanism).toContain('evaluated')
    expect(EVAL_ARMS.map((arm) => arm.name)).toEqual([
      'baseline',
      'packing',
      'auto-compaction',
      'strict-tools',
    ])
  })

  it('has one long-context task per split, each carrying its log in the prompt', () => {
    expect(LONG_TASKS.map((task) => [task.id, task.split])).toEqual([
      ['accept-long-compaction', 'accept'],
      ['heldout-long-compaction', 'heldout'],
    ])
    const records: Readonly<Record<string, string>> = {
      'accept-long-compaction': 'required_build=781924',
      'heldout-long-compaction': 'required mapping: add 4 to the input, then multiply by 6',
    }
    for (const task of LONG_TASKS) {
      // The prompt carries the whole numbered log, value line included.
      expect(task.prompt.length).toBeGreaterThan(
        EVAL_COMPACT_BULK_LINES * EVAL_COMPACT_BULK_LINE_CHARS,
      )
      expect(task.prompt).toContain(records[task.id] ?? 'a middle record')
      expect(task.files.map((file) => file.path)).toEqual(['package.json'])
    }
  })

  it.each(LONG_TASKS.map((task) => [task.id, task] as const))(
    '%s: compacts at the first boundary and restores the exact host todos',
    async (_id, task) => {
      const { api, io, outcome } = await runLongTask(task, compactionArmReplies(task))
      expect(outcome.terminal).toBe('completed')
      expect(outcome.tools).toEqual([
        MODEL_API_TOOLS.todoWrite,
        MODEL_API_TOOLS.todoWrite,
        MODEL_API_TOOLS.writeFile,
        MODEL_API_TOOLS.todoWrite,
      ])
      // The fix the verifier judges is on disk, byte-exact.
      const [fix] = fixesFor(EVAL_CANONICAL_FIXES, task)
      expect(io.files.get(`${EVAL_TURN_ROOT}/${fix?.path ?? ''}`)).toBe(fix?.content)
      const bodies = bodyTexts(api)
      // One prompt, one todo round, the summary, then three small rounds.
      expect(bodies).toHaveLength(6)
      // The first request fills the window without tripping preflight: the
      // band between near-window and the full window, in bytes.
      const firstBytes = Buffer.byteLength(bodies[0] ?? '')
      expect(firstBytes).toBeGreaterThan(EVAL_COMPACT_WINDOW_TOKENS * 4 * 0.9)
      expect(firstBytes).toBeLessThanOrEqual(EVAL_COMPACT_WINDOW_TOKENS * 4)
      // The second request is the summary round trip over the same history.
      expect(bodies[1]).toContain(MODEL_API_MODEL_TEXT.compactionPrompt.slice(0, 40))
      expect(bodies[1]).not.toContain(MODEL_API_MODEL_TEXT.autoCompactionFollowup.slice(0, 40))
      // Every later request rides the compacted history: the hidden
      // follow-up replays the full host todo list, never generated prose.
      for (const body of bodies.slice(2)) {
        expect(body).toContain(MODEL_API_MODEL_TEXT.autoCompactionFollowup.slice(0, 40))
        for (const todo of COMPACTION_TODOS_OPEN) {
          expect(body).toContain(todo.text)
        }
      }
      expect(bodies[2]).toContain(SUMMARY)
    },
  )

  it('sends no compaction on the baseline of a long-context task under the same window', async () => {
    const [task] = LONG_TASKS
    if (task === undefined) {
      throw new Error('no long-context task')
    }
    const [fix] = fixesFor(EVAL_CANONICAL_FIXES, task)
    const { api, outcome } = await driveEvalTurn({
      prompt: task.prompt,
      files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
      // The same window the arm runs under: the pair differs in compaction
      // alone, so the baseline's silence is the mechanism's absence, not a
      // wider window (M101 R2).
      windowTokens: evalWindowTokens(task) ?? EVAL_COMPACT_WINDOW_TOKENS,
      replies: [
        openTodos(),
        {
          calls: [
            {
              name: MODEL_API_TOOLS.writeFile,
              arguments: JSON.stringify(fix),
              callId: 'w1',
            },
          ],
        },
        { text: 'Recovered and fixed.' },
      ],
    })
    expect(outcome.terminal).toBe('completed')
    const bodies = bodyTexts(api)
    expect(bodies).toHaveLength(3)
    for (const body of bodies) {
      expect(body).not.toContain(MODEL_API_MODEL_TEXT.compactionPrompt.slice(0, 40))
      expect(body).not.toContain(MODEL_API_MODEL_TEXT.autoCompactionFollowup.slice(0, 40))
    }
  })

  it('delivers the same evidence on both arms of a long-output task', async () => {
    // M101 R2: the window is harness condition, so the mechanism arm reads
    // with the same budget as the baseline. The same scripted run on both
    // arms must see the same evidence bytes, record included.
    const task = EVAL_TASKS.find((candidate) => candidate.id === 'accept-long-middle-value')
    if (task === undefined) {
      throw new Error('no long-output task')
    }
    const runOn = (change: typeof AUTO_COMPACTION_ARM.change) =>
      driveEvalTurn({
        prompt: task.prompt,
        files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
        change,
        replies: longTaskReplies(task, false, EVAL_LONG_EVIDENCE_RECALL_OFFSET),
      })
    const baseline = await runOn(undefined)
    const mechanism = await runOn(AUTO_COMPACTION_ARM.change)
    expect(baseline.outcome.terminal).toBe('completed')
    expect(mechanism.outcome.terminal).toBe('completed')
    for (const index of [1, 2]) {
      const plain = responseOutputsByCall(baseline.api, index).get('evidence') ?? ''
      const armed = responseOutputsByCall(mechanism.api, index).get('evidence') ?? ''
      expect(plain).toContain('required_value=314159')
      expect(armed).toBe(plain)
    }
  })

  it('writes the automatic memory snapshot through the real flush', async () => {
    // M101 R2: with a real store the arm runs the real flushCompactionMemory
    // path (not a model-originated unknown tool), and the labelled snapshot
    // lands beside the compacted turn. A small task with a classified
    // overflow drives the same flush the long-context boundary runs: the
    // long-context prompt already fills the evaluation window, so its first
    // send leaves no room for the memory tool declarations.
    const files = new Map<string, string>()
    const { store } = memoryStoreOver(files)
    const { api, fix, io, outcome } = await runOverflowTurn({
      memory: store,
      closing: 'Fixed with overflow recovery.',
    })
    expect(outcome.terminal).toBe('completed')
    // The host's own flush call rides between the model's read and write:
    // the recorded add_memory is the automatic flush, not a model request.
    expect(outcome.tools).toEqual([
      MODEL_API_TOOLS.readFile,
      MODEL_API_TOOLS.addMemory,
      MODEL_API_TOOLS.writeFile,
    ])
    expect(io.files.get(`${EVAL_TURN_ROOT}/${fix.path}`)).toBe(fix.content)
    expectSummaryRequest(api, true)
    // The real flush wrote exactly one snapshot carrying the flush text.
    const snapshots = [...files].filter(([name]) => name.includes('auto-compact-'))
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.[1]).toContain(MODEL_API_MODEL_TEXT.autoCompactionMemory)
  })

  it('refuses the automatic memory flush without blocking the turn or the compaction', async () => {
    // M101 R2: under a denying approval mode the real flush is refused at
    // the policy (no snapshot is written), yet the host's flush call still
    // rides the replay and the turn compacts and completes. Removing the
    // flush invocation removes that call, so this proof — unlike an
    // unknown-tool refusal — covers the automatic path. The fix write is
    // refused in this mode too, so this test proves survival, not the fix;
    // the companion tests prove the fix lands.
    const files = new Map<string, string>()
    const { store } = memoryStoreOver(files)
    const { api, outcome } = await runOverflowTurn({
      memory: store,
      approvalMode: 'denyUnmatched',
      closing: 'Recovered despite the refused flush.',
    })
    expect(outcome.terminal).toBe('completed')
    expect(outcome.approvals).toBe(0)
    // The flush was attempted and refused (the store stayed empty), while
    // the turn still compacted. The host's flush call is a function_call
    // item in a later request's input — not the tool declaration, which
    // also names add_memory — so removing the flush removes this item.
    expect(files.size).toBe(0)
    expect(flushCallsOf(api)).toBeGreaterThan(0)
    expectSummaryRequest(api, true)
  })

  it('recovers one classified overflow inside the turn and still passes', async () => {
    // A small task, not a long-context one: every body stays far below
    // near-window, so the run's only possible compaction is the overflow's
    // own recovery. (On a long-context task the first boundary would compact
    // first and eat the scripted overflow as its summary response.)
    const { api, fix, io, outcome } = await runOverflowTurn({
      closing: 'Fixed with overflow recovery.',
    })
    expect(outcome.terminal).toBe('completed')
    expect(outcome.tools).toEqual([MODEL_API_TOOLS.readFile, MODEL_API_TOOLS.writeFile])
    expect(io.files.get(`${EVAL_TURN_ROOT}/${fix.path}`)).toBe(fix.content)
    const bodies = bodyTexts(api)
    // The prompt, the failed send, the summary, then two small rounds. No
    // body reaches near-window: only the classified overflow compacted.
    expect(bodies).toHaveLength(5)
    for (const body of bodies) {
      expect(Buffer.byteLength(body)).toBeLessThan(EVAL_COMPACT_WINDOW_TOKENS * 4 * 0.9)
    }
    expect(bodies[2]).toContain(MODEL_API_MODEL_TEXT.compactionPrompt.slice(0, 40))
    expect(bodies[3]).toContain(MODEL_API_MODEL_TEXT.autoCompactionFollowup.slice(0, 40))
  })

  it('stops a streaming turn with no compaction dispatched', async () => {
    const [task] = LONG_TASKS
    if (task === undefined) {
      throw new Error('no long-context task')
    }
    const { api, outcome } = await runLongTask(
      task,
      [
        {
          ...openTodos(),
          holdEof: new Promise(() => undefined),
        },
      ],
      { turnTimeoutMs: 1000 },
    )
    expect(outcome.terminal).toBe(EVAL_TURN_TIMED_OUT)
    const bodies = bodyTexts(api)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).not.toContain(MODEL_API_MODEL_TEXT.compactionPrompt.slice(0, 40))
  })

  it('cancels an in-flight compaction without dispatching its continuation', async () => {
    const [task] = LONG_TASKS
    if (task === undefined) {
      throw new Error('no long-context task')
    }
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, EVAL_TURN_ROOT)
    // The evaluation window is harness condition, spelled here as in the
    // driver: the arm under test no longer carries a window of its own.
    const atEvalWindow: Pick<ModelApiHostDeps, 'contextModel'> = {
      contextModel: () => ({ format: 'responses', contextTokens: EVAL_COMPACT_WINDOW_TOKENS }),
    }
    // The arm's spend authority is bound over the armed dependencies, as
    // the driver binds it: the change alone declares the mechanism, and
    // without the parent's admission it fails closed.
    const unbound =
      AUTO_COMPACTION_ARM.change === undefined
        ? {
            ...fakeModelApiHostDeps({
              client: fakeModelApiClient(api, log),
              workspaceRoot: EVAL_TURN_ROOT,
              io,
              log,
            }),
            ...atEvalWindow,
          }
        : {
            ...AUTO_COMPACTION_ARM.change(
              fakeModelApiHostDeps({
                client: fakeModelApiClient(api, log),
                workspaceRoot: EVAL_TURN_ROOT,
                io,
                log,
              }),
            ),
            ...atEvalWindow,
          }
    const host = new ModelApiHost(
      bindEvalAdmission(unbound, testEvalAdmission(), log, () => unbound),
    )
    try {
      const { session, events, turnDone } = await startWatchedSession(
        host,
        EVAL_TURN_ROOT,
        'onRequest',
      )
      const fallback = Promise.withResolvers<undefined>()
      const fallbackTimer = setTimeout(() => {
        fallback.resolve(undefined)
      }, 10_000)
      fallbackTimer.unref()
      api.script(
        openTodos(),
        {
          text: SUMMARY,
          holdEof: fallback.promise,
          onRequest: () => {
            void session.cancel()
          },
        },
        { text: 'The continuation must not run.' },
      )
      const done = turnDone()
      await session.sendTurn([{ type: 'text', text: task.prompt }])
      await done
      clearTimeout(fallbackTimer)
      const completed = events.findLast((event) => event.type === 'turnCompleted')
      expect(completed).toMatchObject({ terminal: 'cancelled' })
      // The summary went out, but Stop won before its continuation did.
      expectSummaryRequest(api, false)
    } finally {
      await host.close()
    }
  })
})

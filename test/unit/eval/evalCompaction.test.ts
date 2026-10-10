// Automatic compaction (M74) as an M75 arm: the arm compacts at its first
// settled tool boundary, restores the exact host todos behind a hidden
// follow-up, and the long-context tasks still pass. A refused memory write,
// Stop and a classified overflow are evidenced on the same harness.

import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../../src/core/backends/modelapi/ModelApiHost'
import { AUTO_COMPACTION_ARM, EVAL_ARMS } from '../../../src/core/eval/mechanisms'
import { EVAL_TASKS, type EvalTask } from '../../../src/core/eval/tasks'
import {
  EVAL_COMPACT_BULK_LINE_CHARS,
  EVAL_COMPACT_BULK_LINES,
  EVAL_COMPACT_WINDOW_TOKENS,
  EVAL_TURN_TIMED_OUT,
  MODEL_API_MODEL_TEXT,
  MODEL_API_TOOLS,
} from '../../../src/shared/constants'
import { driveEvalTurn, EVAL_TURN_ROOT } from '../helpers/evalTurn'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { fakeModelApi, fakeModelApiClient, type ScriptedReply } from '../helpers/fakeModelApi'
import { memoryToolIo } from '../helpers/fakeToolIo'
import { fakeModelApiHostDeps } from '../helpers/modelApiHostDeps'
import { startWatchedSession } from '../helpers/sessionTurns'
import {
  COMPACTION_TODOS_OPEN,
  EVAL_CANONICAL_FIXES,
  compactionArmReplies,
  fixesFor,
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

function runLongTask(task: EvalTask, replies: readonly ScriptedReply[]) {
  return driveEvalTurn({
    prompt: task.prompt,
    files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
    change: AUTO_COMPACTION_ARM.change,
    replies,
  })
}

function bodyTexts(api: { responseBodies: () => readonly Record<string, unknown>[] }): string[] {
  return api.responseBodies().map((body) => JSON.stringify(body))
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

  it('sends no compaction on the baseline of a long-context task', async () => {
    const [task] = LONG_TASKS
    if (task === undefined) {
      throw new Error('no long-context task')
    }
    const [fix] = fixesFor(EVAL_CANONICAL_FIXES, task)
    const { api, outcome } = await driveEvalTurn({
      prompt: task.prompt,
      files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
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

  it('refuses a memory write without blocking the turn or the compaction', async () => {
    const [task] = LONG_TASKS
    if (task === undefined) {
      throw new Error('no long-context task')
    }
    const [fix] = fixesFor(EVAL_CANONICAL_FIXES, task)
    const { api, outcome } = await driveEvalTurn({
      prompt: task.prompt,
      files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
      change: AUTO_COMPACTION_ARM.change,
      replies: [
        {
          calls: [
            {
              name: MODEL_API_TOOLS.addMemory,
              arguments: JSON.stringify({ content: 'the build number' }),
              callId: 'm1',
            },
          ],
        },
        ...compactionArmReplies(task),
      ],
    })
    expect(outcome.terminal).toBe('completed')
    expect(outcome.tools[0]).toBe(MODEL_API_TOOLS.addMemory)
    expect(outcome.tools).toContain(MODEL_API_TOOLS.writeFile)
    const bodies = bodyTexts(api)
    // The refusal rides in a later request's outputs; the fix still lands.
    expect(bodies.some((body) => body.includes('unknown tool'))).toBe(true)
    expect(
      bodies.some((body) => body.includes(MODEL_API_MODEL_TEXT.compactionPrompt.slice(0, 40))),
    ).toBe(true)
    expect(fix?.path).not.toBe(undefined)
  })

  it('recovers one classified overflow inside the turn and still passes', async () => {
    // A small task, not a long-context one: every body stays far below
    // near-window, so the run's only possible compaction is the overflow's
    // own recovery. (On a long-context task the first boundary would compact
    // first and eat the scripted overflow as its summary response.)
    const task = EVAL_TASKS.find((candidate) => candidate.id === 'accept-off-by-one')
    if (task === undefined) {
      throw new Error('no small task')
    }
    const [fix] = fixesFor(EVAL_CANONICAL_FIXES, task)
    if (fix === undefined) {
      throw new Error(`no canonical fix for ${task.id}`)
    }
    const { api, io, outcome } = await driveEvalTurn({
      prompt: task.prompt,
      files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
      change: AUTO_COMPACTION_ARM.change,
      replies: [
        {
          calls: [
            {
              name: MODEL_API_TOOLS.readFile,
              arguments: JSON.stringify({ path: fix.path }),
              callId: 'r1',
            },
          ],
        },
        {
          httpError: {
            status: 400,
            body: { error: { message: 'maximum context length exceeded' } },
          },
        },
        { text: SUMMARY },
        {
          calls: [
            {
              name: MODEL_API_TOOLS.writeFile,
              arguments: JSON.stringify(fix),
              callId: 'w1',
            },
          ],
        },
        { text: 'Fixed with overflow recovery.' },
      ],
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
    const { api, outcome } = await driveEvalTurn({
      prompt: task.prompt,
      files: Object.fromEntries(task.files.map((file) => [file.path, file.content])),
      change: AUTO_COMPACTION_ARM.change,
      turnTimeoutMs: 1000,
      replies: [
        {
          ...openTodos(),
          holdEof: new Promise(() => undefined),
        },
      ],
    })
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
    const host = new ModelApiHost(
      AUTO_COMPACTION_ARM.change === undefined
        ? fakeModelApiHostDeps({
            client: fakeModelApiClient(api, log),
            workspaceRoot: EVAL_TURN_ROOT,
            io,
            log,
          })
        : AUTO_COMPACTION_ARM.change(
            fakeModelApiHostDeps({
              client: fakeModelApiClient(api, log),
              workspaceRoot: EVAL_TURN_ROOT,
              io,
              log,
            }),
          ),
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
      const bodies = bodyTexts(api)
      // The summary went out, but Stop won before its continuation did.
      expect(
        bodies.some((body) => body.includes(MODEL_API_MODEL_TEXT.compactionPrompt.slice(0, 40))),
      ).toBe(true)
      expect(
        bodies.some((body) =>
          body.includes(MODEL_API_MODEL_TEXT.autoCompactionFollowup.slice(0, 40)),
        ),
      ).toBe(false)
    } finally {
      await host.close()
    }
  })
})

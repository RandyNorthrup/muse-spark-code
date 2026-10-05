import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import type { ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'
import type { Usage } from '../../src/core/backends/modelapi/schemas'
import { MODEL_API_MODEL_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memoryStoreOver } from './helpers/fakeMemoryIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'

const TODOS = [
  { text: 'already completed history', status: 'completed' },
  { text: 'original task', status: 'inProgress' },
  { text: 'future task [untrusted]', status: 'pending' },
]
const TOOL = { name: 'todo_write', arguments: JSON.stringify({ items: TODOS }) }
const OVERFLOW = {
  httpError: { status: 400, body: { error: { message: 'maximum context length exceeded' } } },
}

async function setup(
  changes: Partial<ModelApiHostDeps> = {},
  mode = 'onRequest',
  hasStableIds = false,
) {
  const api = fakeModelApi()
  // The shared fake's ids are global; this wire fixture makes each local response
  // deterministic so OFF requests can be compared byte-for-byte.
  let responseNumber = 0
  const clientApi = hasStableIds
    ? {
        ...api,
        fetch: async (...args: Parameters<typeof api.fetch>) => {
          const response = await api.fetch(...args)
          responseNumber += 1
          const rawWire = await response.text()
          const wire = rawWire.replaceAll(
            /(resp|msg|fc|call|rs)_\d+/g,
            (match) => `${match.split('_', 1)[0] ?? ''}_${String(responseNumber)}`,
          )
          return new Response(wire, { status: response.status, headers: response.headers })
        },
      }
    : api
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, '/ws')
  const model = { window: 100_000 }
  const settled: (Usage | undefined)[] = []
  const settlements: string[] = []
  let admissions = 0
  let starts = 0
  const guard: ResponseAttemptGuard = Object.assign(() => undefined, {
    onRequestStarted: () => {
      starts += 1
    },
  })
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: fakeModelApiClient(clientApi, log),
      workspaceRoot: '/ws',
      io,
      log,
    }),
    contextModel: () => ({ format: 'responses', contextTokens: model.window }),
    autoCompaction: () => true,
    autoCompactionEvaluated: () => true,
    admitAutoCompaction: () => {
      admissions += 1
      return Promise.resolve({
        guard,
        settle: (_modelId, usage, outcome) => {
          settled.push(usage)
          settlements.push(outcome)
        },
      })
    },
    ...changes,
  })
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: mode,
  })
  const watched = watchSessionTurns(session)
  async function send(text = 'continue') {
    const done = watched.turnDone()
    await session.sendTurn([{ type: 'text', text }])
    await done
  }
  async function seed() {
    api.script({ text: 'earlier response' })
    await send('earlier history '.repeat(8000))
  }
  function nearWindow() {
    const body = api.responseBodies()[0]
    const input = body?.['input']
    if (!Array.isArray(input)) throw new Error('seed input missing')
    const tokens = [body?.['instructions'], body?.['tools'], ...input].reduce<number>(
      (sum, value) => sum + Math.ceil(Buffer.byteLength(JSON.stringify(value)) / 4),
      0,
    )
    model.window = Math.ceil(tokens / 0.92)
  }
  return {
    api,
    io,
    host,
    session,
    model,
    settled,
    settlements,
    send,
    seed,
    nearWindow,
    ...watched,
    admissions: () => admissions,
    starts: () => starts,
  }
}

describe('automatic compaction in the shared Model API loop', () => {
  it('compacts at a settled tool boundary and restores the exact host list before continuation', async () => {
    const t = await setup()
    await t.seed()
    t.nearWindow()
    t.api.script({ calls: [TOOL] }, { text: 'summary [untrusted]' }, { text: 'finished' })
    await t.send()
    expect(t.admissions()).toBe(1)
    expect(t.starts()).toBe(1)
    expect(t.settled).toHaveLength(1)
    const final = JSON.stringify(t.api.responseBodies().at(-1)?.['input'])
    expect(final).toContain(MODEL_API_MODEL_TEXT.autoCompactionFollowup)
    expect(final).toContain('summary [untrusted]')
    for (const todo of TODOS) expect(final).toContain(todo.text)
    const input = z
      .array(
        z.object({
          type: z.string(),
          content: z.optional(z.array(z.object({ text: z.optional(z.string()) }))),
        }),
      )
      .parse(t.api.responseBodies().at(-1)?.['input'])
    const followup = input
      .flatMap((item) => item.content?.flatMap((part) => part.text ?? []) ?? [])
      .findLast((text) => text.startsWith(MODEL_API_MODEL_TEXT.autoCompactionFollowup))
    expect(followup).toBe(
      `${MODEL_API_MODEL_TEXT.autoCompactionFollowup}\n${JSON.stringify({ todos: TODOS })}`,
    )
    expect(t.events.findLast((event) => event.type === 'todoChanged')).toMatchObject({
      items: TODOS,
    })
    expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    await t.host.close()
  })

  it('never considers compaction after a final answer ends the turn', async () => {
    const t = await setup()
    await t.seed()
    t.nearWindow()
    t.api.script({ text: 'final answer' })
    await t.send()
    expect(t.admissions()).toBe(0)
    expect(t.api.responseBodies()).toHaveLength(2)
    await t.host.close()
  })

  it('keeps automatic compaction reachable after ordinary preflight refuses an overfull body', async () => {
    const t = await setup()
    await t.seed()
    t.model.window = 9000
    t.api.script({ text: 'summary' }, { text: 'done' })
    await t.send()
    expect(t.starts()).toBe(1)
    expect(t.api.responseBodies()).toHaveLength(3)
    expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    await t.host.close()
  })

  it('recovers one classified overflow inside the turn and refuses a second overflow', async () => {
    const t = await setup()
    await t.seed()
    t.api.script(OVERFLOW, { text: 'summary' }, OVERFLOW)
    await t.send()
    expect(t.admissions()).toBe(1)
    expect(t.starts()).toBe(1)
    expect(t.api.responseBodies()).toHaveLength(4)
    expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      errorKind: 'context_overflow',
    })
    await t.host.close()
  })

  it('allows only one overflow recovery even when real tool work separates the errors', async () => {
    const t = await setup()
    await t.seed()
    t.api.script(
      OVERFLOW,
      { text: 'summary' },
      { calls: [TOOL] },
      OVERFLOW,
      { text: 'second summary must not run' },
      { text: 'extra continuation must not run' },
    )
    await t.send()
    expect(t.starts()).toBe(1)
    expect(t.api.responseBodies()).toHaveLength(5)
    expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      errorKind: 'context_overflow',
    })
    await t.host.close()
  })

  it('settles every HTTP attempt, including a summary retry and a tool-less fallback', async () => {
    const t = await setup()
    await t.seed()
    t.api.script(
      OVERFLOW,
      { httpError: { status: 429, body: { error: { message: 'rate limited' } } } },
      { calls: [{ name: 'read_file', arguments: '{"path":"never-read.txt"}' }] },
      { text: 'usable summary' },
      { text: 'done' },
    )
    await t.send()
    expect(t.starts()).toBe(3)
    expect(t.settled).toHaveLength(3)
    expect(t.settled[0]).toBeUndefined()
    expect(t.settled[1]).toBeDefined()
    expect(t.settled[2]).toBeDefined()
    expect(t.settlements).toEqual(['rate-limited', 'returned', 'returned'])
    expect(t.api.responseBodies()[3]?.['tools']).not.toEqual([])
    expect(t.api.responseBodies()[4]?.['tools']).toEqual([])
    expect(
      t.events.some((event) => event.type === 'itemStarted' && event.item.tool === 'read_file'),
    ).toBe(false)
    await t.host.close()
  })

  it('rechecks admission after consent and immediately before the extra POST', async () => {
    let canSend = true
    let starts = 0
    const guard: ResponseAttemptGuard = Object.assign(
      () => {
        if (!canSend) throw new Error('admission withdrawn')
      },
      {
        onRequestStarted: () => {
          starts += 1
        },
      },
    )
    const t = await setup({
      admitAutoCompaction: () => {
        canSend = false
        return Promise.resolve({ guard, settle: () => undefined })
      },
    })
    await t.seed()
    t.api.script(OVERFLOW)
    await t.send()
    expect(starts).toBe(0)
    expect(t.api.responseBodies()).toHaveLength(2)
    await t.host.close()
  })

  it('ends the turn if the shared paid ledger cannot settle a dispatched summary', async () => {
    const t = await setup({
      admitAutoCompaction: () =>
        Promise.resolve({
          guard: () => undefined,
          settle: () => {
            throw new Error('ledger unavailable')
          },
        }),
    })
    await t.seed()
    t.api.script(OVERFLOW, { text: 'summary' }, { text: 'must not continue' })
    await t.send()
    expect(t.api.responseBodies()).toHaveLength(3)
    expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'failed',
      reason: EN.sessionBudgetStoreUnavailable,
    })
    await t.host.close()
  })

  it('honours Stop while the first paid consent is pending', async () => {
    const consent = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const t = await setup({
      admitAutoCompaction: () => {
        entered.resolve(undefined)
        return consent.promise
      },
    })
    await t.seed()
    t.api.script(OVERFLOW)
    const done = t.send()
    await entered.promise
    await t.session.cancel()
    consent.resolve(undefined)
    await done
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'cancelled',
    })
    await t.host.close()
  })

  it('does not compact without dispatched removable history', async () => {
    const t = await setup()
    t.api.script(OVERFLOW)
    await t.send()
    expect(t.admissions()).toBe(0)
    expect(t.api.responseBodies()).toHaveLength(1)
    await t.host.close()
  })

  it.each([
    { name: 'missing gate', admitAutoCompaction: undefined },
    { name: 'declined gate', admitAutoCompaction: () => Promise.resolve(undefined) },
  ])('refuses extra dispatch with $name', async ({ admitAutoCompaction }) => {
    const t = await setup({ admitAutoCompaction })
    await t.seed()
    t.api.script(OVERFLOW)
    await t.send()
    expect(t.starts()).toBe(0)
    expect(t.api.responseBodies()).toHaveLength(2)
    await t.host.close()
  })

  it('keeps original context after an incomplete summary and settles the paid attempt', async () => {
    const t = await setup()
    await t.seed()
    t.nearWindow()
    t.api.script(
      { calls: [TOOL] },
      { text: 'cut off', incomplete: { reason: 'max_output_tokens' } },
      { text: 'continued' },
    )
    await t.send()
    expect(t.settled).toHaveLength(1)
    expect(JSON.stringify(t.api.responseBodies().at(-1)?.['input'])).toContain('earlier history')
    expect(t.events).toContainEqual(
      expect.objectContaining({ type: 'backendNotice', text: EN.autoCompactionFailed }),
    )
    await t.host.close()
  })

  it('honours Stop in a dispatched compaction and records uncertain usage', async () => {
    const t = await setup()
    await t.seed()
    const request = Promise.withResolvers<undefined>()
    const hold = Promise.withResolvers<undefined>()
    t.api.script(OVERFLOW, {
      text: 'summary',
      hold: hold.promise,
      onRequest: () => {
        request.resolve(undefined)
      },
    })
    const done = t.send()
    await request.promise
    await t.session.cancel()
    hold.resolve(undefined)
    await done
    expect(t.settled).toEqual([undefined])
    expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'cancelled',
    })
    expect(t.api.responseBodies()).toHaveLength(3)
    await t.host.close()
  })

  it.each([
    { mode: 'denyUnmatched', trusted: true },
    { mode: 'onRequest', trusted: false },
  ])(
    'refuses memory writes in $mode, trusted=$trusted while allowing compaction',
    async ({ mode, trusted }) => {
      const files = new Map<string, string>()
      const { store } = memoryStoreOver(files)
      const t = await setup({ memory: store, isWorkspaceTrusted: () => trusted }, mode)
      await t.seed()
      t.api.script(OVERFLOW, { text: 'summary' }, { text: 'done' })
      await t.send()
      expect(files.size).toBe(0)
      expect(t.starts()).toBe(1)
      expect(t.events.some((event) => event.type === 'approvalRequested')).toBe(false)
      await t.host.close()
    },
  )

  it('asks Manual before a flush, keeps untrusted labels, and preserves compaction after refusal', async () => {
    const files = new Map<string, string>()
    const { store } = memoryStoreOver(files)
    const t = await setup({ memory: store }, 'promptUnmatched')
    t.session.onEvent((event) => {
      if (event.type === 'approvalRequested')
        void t.session.decideApproval({
          approvalId: event.approvalId,
          requirementId: event.requirementId,
          choiceId: 'abort',
        })
    })
    await t.seed()
    t.api.script(OVERFLOW, { text: 'summary' }, { text: 'done' })
    await t.send()
    expect(t.events.some((event) => event.type === 'approvalRequested')).toBe(true)
    expect(files.size).toBe(0)
    expect(t.starts()).toBe(1)
    expect(JSON.stringify(t.api.responseBodies()[2]?.['input'])).toContain('[untrusted]')
    await t.host.close()
  })

  it('writes a labelled snapshot through MemoryStore in Auto mode', async () => {
    const files = new Map<string, string>()
    const { store } = memoryStoreOver(files)
    const t = await setup({ memory: store })
    await t.seed()
    t.api.script(OVERFLOW, { text: 'summary' }, { text: 'done' })
    await t.send()
    let note: string | undefined
    for (const [name, content] of files) {
      if (!name.includes('auto-compact-')) continue
      note = content
      break
    }
    expect(note).toContain(MODEL_API_MODEL_TEXT.autoCompactionMemory)
    expect(note).toContain('[untrusted]')
    expect(t.starts()).toBe(1)
    await t.host.close()
  })

  it('keeps request bytes identical when disabled, irrespective of evaluation readiness', async () => {
    const off = await setup({ autoCompaction: () => false }, 'onRequest', true)
    const pending = await setup(
      {
        autoCompaction: () => false,
        autoCompactionEvaluated: () => false,
      },
      'onRequest',
      true,
    )
    for (const t of [off, pending]) {
      await t.seed()
      t.nearWindow()
      t.api.script({ calls: [TOOL] }, { text: 'done' })
      await t.send()
      expect(t.admissions()).toBe(0)
    }
    expect(JSON.stringify(off.api.responseBodies())).toBe(
      JSON.stringify(pending.api.responseBodies()),
    )
    await off.host.close()
    await pending.host.close()
  })

  it('reports awaiting evaluation and sends no automatic request with the production latch', async () => {
    const t = await setup({ autoCompactionEvaluated: undefined })
    await t.seed()
    t.api.script(OVERFLOW)
    await t.send()
    expect(t.events).toContainEqual({
      type: 'backendNotice',
      level: 'info',
      text: EN.autoCompactionAwaitingEvaluation,
    })
    expect(t.admissions()).toBe(0)
    await t.host.close()
  })
})

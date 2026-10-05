import { usageRecordSchema } from '../../src/shared/usageJournal'
import { describe, expect, it, vi } from 'vitest'
import {
  createUsageRecording,
  isUsageWriterBundle,
  type UsageWriter,
  type UsageRecording,
  type RecordedCall,
} from '../../src/core/usage/recording'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'

const call: RecordedCall = {
  backend: 'modelApi',
  provider: 'meta',
  model: 'muse-spark-1.3',
  kind: 'turn',
  startedAt: 1,
  outcome: 'completed',
}
function recording() {
  return {
    note: vi.fn<UsageRecording['note']>(),
    limit: vi.fn<UsageRecording['limit']>(),
    today: vi.fn<UsageRecording['today']>().mockResolvedValue([]),
    flush: vi.fn<UsageRecording['flush']>().mockResolvedValue(undefined),
  }
}
function writer(): UsageWriter {
  return {
    noteUsage: vi.fn(),
    append: vi.fn(),
    read: vi.fn().mockResolvedValue({ records: [] }),
    flush: vi.fn().mockResolvedValue(undefined),
  }
}
async function hostRun(isRecording: boolean, isSideChat = false, hasSubagents = false) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const tap = recording()
  const client = fakeModelApiClient(api, log)
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client,
      workspaceRoot: '/workspace',
      io: memoryToolIo({}, '/workspace'),
      log,
    }),
    ...(isRecording && { usageRecording: tap }),
    ...(hasSubagents && {
      isPaidFeatureOn: (feature) => feature === 'subagents',
      allowsPaidUse: () => Promise.resolve(true),
    }),
  })
  const session = await host.startSession({
    workspaceRoot: '/workspace',
    modelId: 'muse-spark-1.3',
    approvalMode: hasSubagents ? 'onRequest' : 'promptUnmatched',
    ...(isSideChat && { sideChat: true }),
  })
  const turns = watchSessionTurns(session)
  return { api, tap, host, session, turns, client }
}

describe('recording taps', () => {
  it('rejects a missing writer factory and accepts only a callable injected factory', () => {
    for (const value of [null, undefined, 0, {}, { createUsageWriter: 1 }])
      expect(isUsageWriterBundle(value)).toBe(false)
    expect(isUsageWriterBundle({ createUsageWriter: vi.fn() })).toBe(true)
  })
  it('fails a history read explicitly, logging its private error only as fixed words', async () => {
    const journal = writer()
    vi.mocked(journal.read).mockRejectedValue(new Error('private history path'))
    const log = new FakeLogOutputChannel()
    const port = createUsageRecording({
      client: 'cli',
      now: () => 100,
      newId: () => 'record',
      isEnabled: () => true,
      writer: () => Promise.resolve(journal),
      log,
    })
    await expect(port.today()).rejects.toThrow('Usage history unavailable')
    await expect(port.today()).rejects.toThrow('Usage history unavailable')
    expect(log.warn).toHaveBeenCalledExactlyOnceWith('Usage history could not be recorded')
  })
  it('never waits for a writer and logs failed writes once without their content', async () => {
    const log = new FakeLogOutputChannel()
    const journal = writer()
    const held = Promise.withResolvers<UsageWriter>()
    const port = createUsageRecording({
      client: 'Zed',
      now: () => 100,
      newId: () => 'record',
      isEnabled: () => true,
      writer: () => held.promise,
      log,
    })
    const note: (...args: Parameters<UsageRecording['note']>) => unknown = port.note
    expect(note({ input_tokens: 12 }, call)).toBeUndefined()
    expect(journal.noteUsage).not.toHaveBeenCalled()
    held.resolve(journal)
    await port.flush()
    expect(journal.noteUsage).toHaveBeenCalledWith(
      { input_tokens: 12 },
      { ...call, id: 'record', at: 100, client: 'Zed' },
    )
    vi.mocked(journal.noteUsage).mockImplementation(() => {
      throw new Error('private path and prompt')
    })
    port.note(undefined, call)
    port.note(undefined, call)
    await port.flush()
    expect(log.warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('private path')
    vi.mocked(journal.flush).mockRejectedValue(new Error('private flush path'))
    await expect(port.flush()).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledOnce()
  })
  it('history off never loads or writes the journal', async () => {
    const load = vi.fn().mockResolvedValue(writer())
    const port = createUsageRecording({
      client: 'cli',
      now: () => 100,
      newId: () => 'record',
      isEnabled: () => false,
      writer: load,
      log: new FakeLogOutputChannel(),
    })
    port.note(undefined, call)
    port.limit({
      backend: 'museCode',
      provider: 'museCode',
      source: 'museCode',
      observedAt: 100,
      windows: [],
    })
    await port.flush()
    expect(load).not.toHaveBeenCalled()
  })
  it('rechecks history after lazy loading and shares one diagnostic with the writer', async () => {
    let isEnabled = true
    const held = Promise.withResolvers<UsageWriter>()
    const journal = writer()
    const log = new FakeLogOutputChannel()
    let onWriteError: () => void = () => undefined
    const port = createUsageRecording({
      client: 'cli',
      now: () => 100,
      newId: () => 'id',
      isEnabled: () => isEnabled,
      log,
      writer: (report) => {
        onWriteError = report
        return held.promise
      },
    })
    port.note(undefined, call)
    await Promise.resolve()
    isEnabled = false
    held.resolve(journal)
    await port.flush()
    expect(journal.noteUsage).not.toHaveBeenCalled()
    onWriteError()
    onWriteError()
    expect(log.warn).toHaveBeenCalledOnce()
  })
  it('reads today from the journal and keeps old days out of the modal', async () => {
    const journal = writer()
    const base = usageRecordSchema.parse({
      v: 1,
      type: 'usage',
      id: 'today',
      at: 100,
      startedAt: 1,
      day: '2026-10-05',
      timezoneOffsetMins: 0,
      client: 'cli',
      backend: 'modelApi',
      provider: 'meta',
      model: 'muse-spark-1.3',
      kind: 'turn',
      tokens: {},
      cost: { certainty: 'unpriced' },
      outcome: 'completed',
    })
    vi.mocked(journal.read).mockResolvedValue({
      records: [base, { ...base, id: 'old', day: '2026-10-04' }],
    })
    const port = createUsageRecording({
      client: 'VSCodium',
      now: () => new Date(2026, 9, 5).getTime(),
      newId: () => 'record',
      isEnabled: () => true,
      writer: () => Promise.resolve(journal),
      log: new FakeLogOutputChannel(),
    })
    expect(await port.today()).toEqual([base])
  })
  it('records changed rate headers and every 429 even when headers are unchanged', async () => {
    const journal = writer()
    const port = createUsageRecording({
      client: 'cli',
      now: () => 100,
      newId: () => 'record',
      isEnabled: () => true,
      writer: () => Promise.resolve(journal),
      log: new FakeLogOutputChannel(),
    })
    const context: Parameters<UsageRecording['limit']>[0] = {
      backend: 'modelApi',
      provider: 'openai',
      source: 'headers',
      observedAt: 100,
      windows: [],
      raw: { 'retry-after': '2' },
    }
    port.limit(context)
    port.limit(context)
    port.limit(context, true)
    port.limit({ ...context, raw: { 'retry-after': '3' } })
    await port.flush()
    expect(journal.append).toHaveBeenCalledTimes(3)
  })
  it('records exactly one settled turn and keeps request bodies byte identical', async () => {
    const plain = await hostRun(false)
    const tapped = await hostRun(true)
    for (const run of [plain, tapped]) {
      run.api.script({
        text: 'answer',
        usage: {
          input: 100,
          output: 10,
          cached: 20,
        },
      })
      await run.session.sendTurn([{ type: 'text', text: 'private prompt' }])
      await run.turns.turnDone()
    }
    expect(tapped.api.responseBodies().map((body) => JSON.stringify(body))).toEqual(
      plain.api.responseBodies().map((body) => JSON.stringify(body)),
    )
    expect(tapped.tap.note).toHaveBeenCalledOnce()
    expect(tapped.tap.note).toHaveBeenCalledWith(
      expect.objectContaining({ input_tokens: 100, output_tokens: 10 }),
      expect.objectContaining({
        provider: 'meta',
        model: 'muse-spark-1.3',
        served: 'muse-spark-1.3',
        kind: 'turn',
        outcome: 'completed',
        durationMs: expect.any(Number),
      }),
    )
    expect(JSON.stringify(tapped.tap.note.mock.calls)).not.toContain('private prompt')
    await plain.host.close()
    await tapped.host.close()
  })
  it('attributes compaction, free token counting and side chat separately', async () => {
    const run = await hostRun(true)
    await answer(run)
    run.api.script({ text: 'summary' })
    await run.session.compact()
    expect(run.tap.note.mock.calls.map(([, context]) => context.kind)).toEqual([
      'turn',
      'compaction',
      'count',
    ])
    expect(run.tap.note.mock.calls.at(-1)?.[1].providerCostUsd).toBe(0)
    await run.host.close()
    const side = await hostRun(true, true)
    side.api.script({ text: 'side answer' })
    await side.session.sendTurn([{ type: 'text', text: 'question' }])
    await side.turns.turnDone()
    expect(side.tap.note.mock.calls[0]?.[1].kind).toBe('sideChat')
    await side.host.close()
  })
  it('keeps sent calls with missing usage uncertain and records failure once', async () => {
    const run = await hostRun(true)
    run.api.script({ text: 'answer', omitUsage: true })
    await run.session.sendTurn([{ type: 'text', text: 'hello' }])
    await run.turns.turnDone()
    expect(run.tap.note).toHaveBeenCalledOnce()
    expect(run.tap.note.mock.calls[0]).toEqual([
      undefined,
      expect.objectContaining({ uncertain: true }),
    ])
    await run.host.close()
  })
  it('records an uncapped pre-stream refusal without claiming uncertain billing', async () => {
    const run = await hostRun(true)
    run.api.script({ httpError: { status: 400 } })
    await run.session.sendTurn([{ type: 'text', text: 'hello' }])
    await run.turns.turnDone()
    expect(run.tap.note).toHaveBeenCalledExactlyOnceWith(
      undefined,
      expect.objectContaining({ outcome: 'refused', uncertain: false }),
    )
    await run.host.close()
  })
  it('records a 429 snapshot even without a reported limit header', async () => {
    const run = await hostRun(true)
    run.api.script({ httpError: { status: 429 } }, { text: 'answer' })
    await run.session.sendTurn([{ type: 'text', text: 'hello' }])
    await run.turns.turnDone()
    expect(run.tap.limit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'meta',
        source: 'headers',
        raw: {},
        windows: [],
      }),
      true,
    )
    expect(run.tap.note.mock.calls[0]?.[1]).toMatchObject({ rateLimited: true, retries: 1 })
    await run.host.close()
  })
  it('records the shared host child as a subagent once, outside the parent tally', async () => {
    const run = await hostRun(true, false, true)
    const held = Promise.withResolvers<undefined>()
    run.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"explorer","objective":"Read tests"}',
            callId: 'spawn',
          },
        ],
      },
      { text: 'parent answer', hold: held.promise },
      { text: 'child answer', usage: { input: 30, output: 7, cached: 4 } },
    )
    try {
      await run.session.sendTurn([{ type: 'text', text: 'delegate the review' }])
      await vi.waitFor(() => {
        expect(run.tap.note.mock.calls.filter(([, call]) => call.kind === 'subagent')).toHaveLength(
          1,
        )
      })
    } finally {
      held.resolve(undefined)
    }
    await run.turns.turnDone()
    expect(run.tap.note.mock.calls.filter(([, call]) => call.kind === 'turn')).toHaveLength(2)
    expect(run.tap.note.mock.calls.find(([, call]) => call.kind === 'subagent')?.[0]).toMatchObject(
      { input_tokens: 30, output_tokens: 7, input_tokens_details: { cached_tokens: 4 } },
    )
    await run.host.close()
  })
  it('records Stop on a sent stream without terminal usage as cancelled and uncertain', async () => {
    const run = await hostRun(true)
    const entered = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<undefined>()
    run.api.script({
      text: 'partial answer',
      omitTerminal: true,
      omitUsage: true,
      holdEof: held.promise,
      onEofHeld: () => {
        entered.resolve(undefined)
      },
    })
    try {
      await run.session.sendTurn([{ type: 'text', text: 'hello' }])
      await entered.promise
      await run.session.cancel()
    } finally {
      held.resolve(undefined)
    }
    await run.turns.turnDone()
    expect(run.tap.note).toHaveBeenCalledExactlyOnceWith(
      undefined,
      expect.objectContaining({ outcome: 'cancelled', uncertain: true }),
    )
    await run.host.close()
  })
  it('records failed free token counting once without undoing successful compaction', async () => {
    const run = await hostRun(true)
    await answer(run)
    vi.spyOn(run.client, 'countInputTokens').mockRejectedValue(new Error('count failed'))
    run.api.script({ text: 'summary' })
    await run.session.compact()
    expect(run.tap.note.mock.calls.filter(([, call]) => call.kind === 'count')).toEqual([
      [undefined, expect.objectContaining({ outcome: 'failed', providerCostUsd: 0 })],
    ])
    await run.host.close()
  })
})

async function answer(run: Awaited<ReturnType<typeof hostRun>>): Promise<void> {
  run.api.script({ text: 'answer' })
  await run.session.sendTurn([{ type: 'text', text: 'hello' }])
  await run.turns.turnDone()
}

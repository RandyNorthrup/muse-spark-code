// Observation packing (M73, PLAN.md D49) on the real `ModelApiHost` over
// the fake Model API: the whole-twice-then-packed swap across requests,
// `recall_output` paging the original back, the ledger in `tokenUsage`, and
// nothing packed or offered by default.

import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { MODEL_API_TOOLS, MODEL_TEXT, OBS_PACK_THRESHOLD_CHARS } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient, type ModelApiClientDeps } from '../../src/core/backends/modelapi/client'
import { estimatePackTokens } from '../../src/core/backends/modelapi/observationPack'
import {
  parseStoredSession,
  type StoredSession,
} from '../../src/core/backends/modelapi/sessionStore'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  type FakeModelApi,
  responseOutputsByCall,
} from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { recalledParts } from './helpers/recalledOutput'
import { watchSessionTurns } from './helpers/sessionTurns'

const ROOT = '/ws'
const BIG = Array.from(
  { length: 400 },
  (_, index) => `line ${String(index)} ${'x'.repeat(20)}`,
).join('\n')
const SMALL = 'export const one = 1\n'

const toolNameSchema = z.object({ name: z.optional(z.string()), type: z.string() })

interface Harness {
  readonly api: FakeModelApi
  readonly host: ModelApiHost
  readonly events: AgentEvent[]
  readonly turnDone: () => Promise<void>
  readonly session: ModelApiSession
}

async function setup(
  isPacking: boolean,
  clientChanges: Partial<ModelApiClientDeps> = {},
): Promise<Harness> {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'big.txt': BIG, 'small.txt': SMALL }, ROOT)
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: api.fetch,
    ...clientChanges,
  })
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log }),
    ...(isPacking && { observationPacking: () => true }),
  })
  const session = await host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: 'onRequest',
  })
  if (!(session instanceof ModelApiSession)) {
    throw new TypeError('expected the Model API session')
  }
  return { api, host, session, ...watchSessionTurns(session) }
}

async function sendText(harness: Harness, text: string): Promise<void> {
  await harness.session.sendTurn([{ type: 'text', text }])
  await harness.turnDone()
}

/** The model reads the long file, then answers. */
function scriptReadBig(api: FakeModelApi, reply: string, shouldRetryRead = false): void {
  api.script(
    {
      calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'big.txt' }), callId: 'c1' }],
    },
    ...(shouldRetryRead ? [{ httpError: { status: 429 } }] : []),
    { text: reply },
  )
}

/** The model reads the long file once; the output as it was first sent. */
async function readBigOnce(harness: Harness): Promise<string | undefined> {
  scriptReadBig(harness.api, 'read it')
  await sendText(harness, 'read big.txt')
  return responseOutputsByCall(harness.api, 1).get('c1')
}

/**
 * After an attempt that never went out: nothing was sent, the next request
 * still carries the output whole, and the ledger saved nothing.
 */
async function expectUncounted(harness: Harness, full: string | undefined): Promise<void> {
  expect(harness.api.responseBodies()).toHaveLength(2)
  harness.api.script({ text: 'now allowed' })
  await sendText(harness, 'resume')
  expect(responseOutputsByCall(harness.api, 2).get('c1')).toBe(full)
  expect(ledgerOf(harness.events).at(-1)).toBe(0)
  await harness.host.close()
}

/** The long read, then three text turns: whole, whole, then packed (or whole by default). */
async function readThenAsk(harness: Harness): Promise<void> {
  scriptReadBig(harness.api, 'read it')
  await sendText(harness, 'read big.txt')
  harness.api.script({ text: 'again' })
  await sendText(harness, 'and?')
  harness.api.script({ text: 'once more' })
  await sendText(harness, 'and?')
}

/** The model pages a packed output back, then answers. */
function scriptRecall(
  api: FakeModelApi,
  id: string,
  offset: number,
  callId: string,
  reply: string,
): void {
  api.script(
    {
      calls: [{ name: 'recall_output', arguments: JSON.stringify({ id, offset }), callId }],
    },
    { text: reply },
  )
}

/** The tool names the `index`th request offered. */
function toolsOf(api: FakeModelApi, index: number): string[] {
  const tools = api.responseBodies()[index]?.['tools']
  return Array.isArray(tools)
    ? tools.map((tool) => {
        const parsed = toolNameSchema.safeParse(tool)
        return parsed.success ? (parsed.data.name ?? parsed.data.type) : '?'
      })
    : []
}

function ledgerOf(events: readonly AgentEvent[]): (number | undefined)[] {
  const values: (number | undefined)[] = []
  for (const event of events) {
    if (event.type === 'tokenUsage') {
      values.push(event.packedTokensAvoided)
    }
  }
  return values
}

/** A recalled page without its lead and frame. */
function pageOf(text: string): string {
  return recalledParts(text).page
}

/** The session's stored form as a window's file brings it back: through its schema. */
function reloaded(stored: unknown): StoredSession {
  const parsed = parseStoredSession(structuredClone(stored))
  if (!parsed.ok) {
    throw new Error(parsed.reason)
  }
  return parsed.session
}

describe('observation packing on the host', () => {
  it('offers recall_output only while packing runs', async () => {
    const packed = await setup(true)
    packed.api.script({ text: 'hi' })
    await sendText(packed, 'hi')
    expect(toolsOf(packed.api, 0)).toContain(MODEL_API_TOOLS.recallOutput)
    await packed.host.close()

    const plain = await setup(false)
    plain.api.script({ text: 'hi' })
    await sendText(plain, 'hi')
    expect(toolsOf(plain.api, 0)).not.toContain(MODEL_API_TOOLS.recallOutput)
    await plain.host.close()
  })

  it('sends a long output whole twice, then as a sticky placeholder', async () => {
    const harness = await setup(true)
    expect(BIG.length).toBeGreaterThan(OBS_PACK_THRESHOLD_CHARS)
    await readThenAsk(harness)
    const bodies = harness.api.responseBodies()
    expect(bodies).toHaveLength(4)
    const first = responseOutputsByCall(harness.api, 1).get('c1') ?? ''
    const second = responseOutputsByCall(harness.api, 2).get('c1') ?? ''
    const third = responseOutputsByCall(harness.api, 3).get('c1') ?? ''
    expect(first).toContain('line 399')
    expect(second).toBe(first)
    expect(third).not.toBe(first)
    expect(third).toContain('"c1"')
    expect(third).toContain(`${String(first.length)} characters`)
    expect(third).toContain('line 0')
    expect(third).toContain('line 399')
    // The transcript still shows the whole output.
    const completed = harness.events.find(
      (event) => event.type === 'itemCompleted' && event.item.tool === 'read_file',
    )
    expect(
      completed?.type === 'itemCompleted' ? (completed.item.visibleOutput ?? '') : '',
    ).toContain('line 399')
    await harness.host.close()
  })

  it('recalls the original bytes back, page by page', async () => {
    const harness = await setup(true)
    scriptReadBig(harness.api, 'read it')
    await sendText(harness, 'read big.txt')
    harness.api.script({ text: 'again' })
    await sendText(harness, 'and?')
    const full = responseOutputsByCall(harness.api, 1).get('c1') ?? ''
    expect(full.length).toBeGreaterThan(OBS_PACK_THRESHOLD_CHARS)
    scriptRecall(harness.api, 'c1', 0, 'r1', 'got a page')
    await sendText(harness, 'show me the start')
    const firstPage = responseOutputsByCall(harness.api, 4).get('r1') ?? ''
    expect(firstPage).toContain('"c1"')
    expect(firstPage).toContain('call recall_output again')
    // Framed as untrusted tool data, naming the tool its call named.
    const { lead } = recalledParts(firstPage)
    expect(lead).toContain(fill(MODEL_TEXT.packSourceTool, { tool: MODEL_API_TOOLS.readFile }))
    expect(lead).toContain(MODEL_TEXT.packRecalledUntrusted)
    const next = /offset (\d+)/.exec(firstPage)?.[1] ?? ''
    expect(next).not.toBe('')
    scriptRecall(harness.api, 'c1', Number(next), 'r2', 'got the rest')
    await sendText(harness, 'and the rest')
    const bodies = harness.api.responseBodies()
    const secondPage = responseOutputsByCall(harness.api, bodies.length - 1).get('r2') ?? ''
    // Walk on from each page's named offset until the end of the output.
    let rebuilt = [firstPage, secondPage].map((page) => pageOf(page)).join('')
    let offset = Number(/characters \d+ to (\d+) of/.exec(secondPage)?.[1] ?? full.length)
    let pages = 2
    while (offset < full.length) {
      expect(pages).toBeLessThan(10)
      scriptRecall(harness.api, 'c1', offset, `r${String(offset)}`, 'more')
      await sendText(harness, 'more')
      const index = harness.api.responseBodies().length - 1
      const output = responseOutputsByCall(harness.api, index).get(`r${String(offset)}`) ?? ''
      rebuilt += pageOf(output)
      offset = Number(/characters \d+ to (\d+) of/.exec(output)?.[1] ?? full.length)
      pages += 1
    }
    expect(rebuilt).toBe(full)
    await harness.host.close()
  })

  it('counts the ledger in tokenUsage: the tokens the packed sends left out', async () => {
    const harness = await setup(true)
    scriptReadBig(harness.api, 'read it')
    await sendText(harness, 'read big.txt')
    expect(ledgerOf(harness.events).at(-1)).toBe(0)
    harness.api.script({ text: 'again' })
    await sendText(harness, 'and?')
    expect(ledgerOf(harness.events).at(-1)).toBe(0)
    harness.api.script({ text: 'once more' })
    await sendText(harness, 'and?')
    const full = responseOutputsByCall(harness.api, 1).get('c1') ?? ''
    const placeholder = responseOutputsByCall(harness.api, 3).get('c1') ?? ''
    expect(placeholder).not.toBe(full)
    expect(ledgerOf(harness.events).at(-1)).toBe(
      estimatePackTokens(full.length) - estimatePackTokens(placeholder.length),
    )
    await harness.host.close()
  })

  it('does not count an attempt refused while the SecretStorage key is missing', async () => {
    let isKeyMissing = false
    const harness = await setup(true, {
      apiKey: () => Promise.resolve(isKeyMissing ? undefined : 'LLM|1|secret'),
    })
    const full = await readBigOnce(harness)
    isKeyMissing = true
    await sendText(harness, 'this attempt is refused')
    isKeyMissing = false
    await expectUncounted(harness, full)
  })

  it('does not count Stop while the final SecretStorage key read is held', async () => {
    let shouldHoldKey = false
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const harness = await setup(true, {
      apiKey: async () => {
        if (shouldHoldKey) {
          entered.resolve(undefined)
          await released.promise
        }
        return 'LLM|1|secret'
      },
    })
    const full = await readBigOnce(harness)
    shouldHoldKey = true
    await harness.session.sendTurn([{ type: 'text', text: 'stopped preparation' }])
    await entered.promise
    const stopping = harness.session.cancel()
    released.resolve(undefined)
    await stopping
    await harness.turnDone()
    shouldHoldKey = false
    await expectUncounted(harness, full)
  })

  it('counts an HTTP retry of a whole send as the one request it is', async () => {
    const harness = await setup(true)
    scriptReadBig(harness.api, 'read it', true)
    await sendText(harness, 'read big.txt')
    // The refused attempt and its retry: one request, one whole send.
    const full = responseOutputsByCall(harness.api, 1).get('c1')
    expect(responseOutputsByCall(harness.api, 2).get('c1')).toBe(full)
    harness.api.script({ text: 'again' })
    await sendText(harness, 'and?')
    expect(responseOutputsByCall(harness.api, 3).get('c1')).toBe(full)
    harness.api.script({ text: 'once more' })
    await sendText(harness, 'and?')
    const packed = responseOutputsByCall(harness.api, 4).get('c1')
    expect(packed).not.toBe(full)
    expect(packed).toContain('Packed output')
    await harness.host.close()
  })

  it('counts an HTTP retry of a packed send once in the ledger', async () => {
    const harness = await setup(true)
    await readThenAsk(harness)
    const full = responseOutputsByCall(harness.api, 1).get('c1') ?? ''
    const packed = responseOutputsByCall(harness.api, 3).get('c1') ?? ''
    const avoided = estimatePackTokens(full.length) - estimatePackTokens(packed.length)
    const previous = ledgerOf(harness.events).at(-1) ?? 0
    harness.api.script({ httpError: { status: 429 } }, { text: 'after retry' })
    await sendText(harness, 'and?')
    expect(harness.api.responseBodies()).toHaveLength(6)
    expect(ledgerOf(harness.events).at(-1)).toBe(previous + avoided)
    await harness.host.close()
  })

  it('packs nothing and reports no ledger by default', async () => {
    const harness = await setup(false)
    await readThenAsk(harness)
    const bodies = harness.api.responseBodies()
    expect(bodies).toHaveLength(4)
    const outputs = [1, 2, 3].map((index) => responseOutputsByCall(harness.api, index).get('c1'))
    expect(new Set(outputs).size).toBe(1)
    expect(outputs[0] ?? '').toContain('line 399')
    expect(ledgerOf(harness.events).every((value) => value === undefined)).toBe(true)
    await harness.host.close()
  })

  it('keeps the stored replay whole: placeholders never commit', async () => {
    const harness = await setup(true)
    await readThenAsk(harness)
    const replayed = harness.session.snapshot().replay.flatMap((entry) => {
      const item = entry.item
      return item.type === 'function_call_output' &&
        typeof item.output === 'string' &&
        item.call_id === 'c1'
        ? [item.output]
        : []
    })
    expect(replayed).toHaveLength(1)
    expect(replayed[0] ?? '').toContain('line 399')
    expect(replayed[0] ?? '').not.toContain('Packed output')
    await harness.host.close()
  })

  it('keeps the ledger across a save and resume, the outputs starting fresh', async () => {
    const first = await setup(true)
    await readThenAsk(first)
    const saved = ledgerOf(first.events).at(-1) ?? 0
    expect(saved).toBeGreaterThan(0)
    const stored = reloaded(first.session.snapshot())
    expect(stored.packedTokensAvoided).toBe(saved)
    await first.host.close()

    const resumed = await setup(true)
    resumed.session.adopt(stored)
    resumed.api.script({ text: 'back' })
    await sendText(resumed, 'still there?')
    // The total carries on; the output rides whole again after the resume.
    expect(ledgerOf(resumed.events).at(-1)).toBe(saved)
    const full = responseOutputsByCall(resumed.api, 0).get('c1') ?? ''
    expect(full).toContain('line 399')
    expect(full).not.toContain('Packed output')
    expect(resumed.session.snapshot().packedTokensAvoided).toBe(saved)
    await resumed.host.close()
  })

  it('resumes a session saved before the ledger was kept at zero', async () => {
    const first = await setup(true)
    await readThenAsk(first)
    const { packedTokensAvoided: _kept, ...older } = first.session.snapshot()
    await first.host.close()
    const resumed = await setup(true)
    resumed.session.adopt(reloaded(older))
    resumed.api.script({ text: 'back' })
    await sendText(resumed, 'still there?')
    expect(ledgerOf(resumed.events).at(-1)).toBe(0)
    await resumed.host.close()
  })

  it('keeps a stored ledger through a window that does not pack', async () => {
    const first = await setup(true)
    await readThenAsk(first)
    const stored = first.session.snapshot()
    await first.host.close()
    const plain = await setup(false)
    plain.session.adopt(reloaded(stored))
    plain.api.script({ text: 'back' })
    await sendText(plain, 'still there?')
    expect(ledgerOf(plain.events).every((value) => value === undefined)).toBe(true)
    expect(plain.session.snapshot().packedTokensAvoided).toBe(stored.packedTokensAvoided)
    await plain.host.close()
  })

  it.each([-1, 1.5, '12'])(
    'loads a session with a bad ledger (%j), restarting at zero',
    async (bad) => {
      const first = await setup(true)
      await readThenAsk(first)
      const stored = first.session.snapshot()
      expect(stored.packedTokensAvoided).toBeGreaterThan(0)
      await first.host.close()

      const loaded = reloaded({ ...stored, packedTokensAvoided: bad })
      expect(loaded).not.toHaveProperty('packedTokensAvoided')
      expect(loaded.replay).toEqual(stored.replay)
      expect(loaded.transcript).toEqual(stored.transcript)
      expect(loaded.outputs).toEqual(stored.outputs)
      const resumed = await setup(true)
      resumed.session.adopt(loaded)
      expect(resumed.session.snapshot().packedTokensAvoided).toBe(0)
      resumed.api.script({ text: 'back' })
      await sendText(resumed, 'still there?')
      expect(ledgerOf(resumed.events).at(-1)).toBe(0)
      expect(responseOutputsByCall(resumed.api, 0).get('c1')).toContain('line 399')
      await resumed.host.close()
    },
  )

  it('tells a model that calls recall_output uninvited that it is unknown', async () => {
    const harness = await setup(false)
    scriptRecall(harness.api, 'c1', 0, 'r1', 'tried')
    await sendText(harness, 'recall it')
    const output = responseOutputsByCall(harness.api, 1).get('r1') ?? ''
    expect(output).toContain('unknown tool recall_output')
    await harness.host.close()
  })
})

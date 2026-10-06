// Lane M91-G: golden "hooks off" requests (PLAN.md M91 acceptance 14g,
// SoL-Pi rule 7). Every request body the fake Model API receives with hooks
// OFF is recorded as a fixture under `test/fixtures/golden-requests/`, and
// this test compares raw fetch body strings, preserving key order and all
// formatting, except for the documented generated-id tokens below. Every
// later M91 lane compares against these fixtures, so they were captured on
// the lane-0 tree before any lane changed request building.
//
// Regeneration is explicit and never the default: set
// `MUSE_SPARK_UPDATE_GOLDEN_REQUESTS=1` (like the eval probes read
// `MUSE_EVAL_PROBE`) to rewrite the fixtures, then review the diff. The
// update refuses to run under CI.
//
// Normalisation covers only real nondeterminism, each with its reason:
// - Wire item ids (`fc_N`, `rs_N`, `msg_N`, `ws_N`): the fake Model API
//   numbers every streamed item from a module-global counter, and the host
//   replays those ids in later request inputs. The ids name nothing the
//   test chose. Only those types' direct `input[*].id` fields with the fake's
//   matching numeric prefix are replaced. One map spans every request in a
//   scenario: distinct ids get distinct aliases (`fc_A`, `msg_B`, …), and
//   repeated references retain their alias. No keys are sorted or reserialized.
// - Scripted call ids (`c1`, `spawn1`, …) stay: the test chose them, and a
//   lane that renamed or dropped a call must fail loudly.
// - Dates: the instructions carry `today` from the host's `now()` dep, and
//   the harness clock counts up from local midnight on 1970-01-01, so `today` is always
//   1970-01-01. No wall clock, no temporary path and no random marker
//   reaches these request bodies (observation-pack markers are per recall
//   response, and this tree has no checkpoint shadow repository without the
//   verify dep), so nothing else is normalised. If a later lane puts a
//   timestamp or path on the wire, the byte comparison fails first and the
//   normalisation list grows only with a documented reason.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings, type FakeModelApi } from './helpers/fakeModelApi'
import { memoryToolIo, type MemoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'
import { editThenRunCall } from './helpers/shellTurns'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { promptCacheKey } from '../../src/core/backends/modelapi/promptCache'
import { isJudgeEngineOn } from '../../src/core/judge/engine'
import { JudgeUse, type JudgeAdvisory } from '../../src/core/judge/use'
import type { JudgeEntryHandle } from '../../src/core/judge/entries'
import { redactSecrets } from '../../src/core/redact'
import {
  ModelApiSameJudge,
  type ModelApiJudgeTransport,
} from '../../src/host/judge/modelApiSameJudge'
import { JudgeResultCache } from '../../src/core/judge/same/resultCache'
import { judgeJob, judgeOnce, SpyJudgeStore, startJudgeEntry } from './helpers/judgeSameRig'
import * as z from 'zod/mini'
import { CONSERVATIVE_CAPABILITIES } from '../../src/core/providers/capabilities'
import { FORMAT_QUIRKS } from '../../src/core/providers/presets'

const ROOT = '/ws'
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'golden-requests')

/** Rewrite the fixtures instead of comparing: explicit, never the default, never in CI. */
function isRegenerate(): boolean {
  if (process.env['MUSE_SPARK_UPDATE_GOLDEN_REQUESTS'] !== '1') {
    return false
  }
  if (process.env['CI'] !== undefined) {
    throw new Error('MUSE_SPARK_UPDATE_GOLDEN_REQUESTS=1 is refused under CI')
  }
  return true
}

interface Harness {
  readonly shouldUseStrictTools: boolean
  readonly api: FakeModelApi
  readonly rawBodies: string[]
  readonly host: ModelApiHost
  readonly io: MemoryToolIo
  readonly session: ModelApiSession
  readonly turnDone: () => Promise<void>
}

async function setup(
  files: Record<string, string>,
  options: {
    readonly paidSubagents?: boolean
    readonly judge?: JudgeAdvisory
    readonly shouldUseStrictTools?: boolean
  } = {},
): Promise<Harness> {
  const api = fakeModelApi()
  const rawBodies: string[] = []
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo(files, ROOT)
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/v1/responses' && init?.method === 'POST') {
        if (typeof init.body !== 'string') {
          throw new TypeError('expected a raw Model API request body string')
        }
        rawBodies.push(init.body)
      }
      return api.fetch(input, init)
    },
  })
  const base = fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log })
  const deps: ModelApiHostDeps = {
    ...base,
    // A's date is local; preserve the same captured day on every test rig.
    now: () => new Date(1970, 0, 1).getTime() + base.now(),
    judge: options.judge,
    // Hooks OFF: the golden baseline every later M91 lane must not move.
    isHooksEnabled: () => false,
    // Packing stays on (it is not a hook): scenario 4 watches a long output
    // ride whole twice, then as a placeholder.
    observationPacking: () => true,
    // Integration resolves the session setting AND model record before building the prefix.
    ...(options.shouldUseStrictTools !== undefined && {
      modelFacts: () => ({
        capabilities: {
          ...CONSERVATIVE_CAPABILITIES,
          supportsStrictTools: options.shouldUseStrictTools,
        },
        quirks: FORMAT_QUIRKS.responses,
      }),
    }),
    ...(options.paidSubagents === true && {
      isPaidFeatureOn: () => true,
      allowsPaidUse: () => Promise.resolve(true),
    }),
  }
  const host = new ModelApiHost(deps)
  const session = await host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  if (!(session instanceof ModelApiSession)) {
    throw new TypeError('expected the Model API session')
  }
  return {
    api,
    rawBodies,
    host,
    io,
    session,
    shouldUseStrictTools: options.shouldUseStrictTools === true,
    ...watchSessionTurns(session),
  }
}

/** One user text turn, driven to completion. */
async function runTurn(harness: Harness, text: string): Promise<void> {
  const submitted = harness.session.sendTurn([{ type: 'text', text }])
  await submitted
  await harness.turnDone()
}

/** Only the generated wire-item ids documented by the shared fake are eligible. */
function wireIdPrefix(type: unknown): string | undefined {
  switch (type) {
    case 'function_call': {
      return 'fc'
    }
    case 'reasoning': {
      return 'rs'
    }
    case 'message': {
      return 'msg'
    }
    case 'web_search_call': {
      return 'ws'
    }
    default: {
      return undefined
    }
  }
}

// Consume whole string tokens, including escaped quotes, so text/arguments
// containing JSON-looking ids or braces cannot be treated as wire fields.
const JSON_TOKENS = /"(?:\\.|[^"\\])*"|[{}[\]:,]/g

function normalizeItem(raw: string, ids: Map<string, string>): string {
  const item: unknown = JSON.parse(raw)
  if (typeof item !== 'object' || item === null || !('type' in item) || !('id' in item)) {
    return raw
  }
  const prefix = wireIdPrefix(item.type)
  if (
    prefix === undefined ||
    typeof item.id !== 'string' ||
    !new RegExp(`^${prefix}_[0-9]+$`).test(item.id)
  ) {
    return raw
  }
  const alias =
    ids.get(item.id) ?? `${prefix}_${String.fromCodePoint('A'.codePointAt(0)! + ids.size)}`
  ids.set(item.id, alias)
  let depth = 0
  let previous = ''
  let beforePrevious = ''
  return raw.replaceAll(JSON_TOKENS, (token: string) => {
    const isId = depth === 1 && previous === ':' && beforePrevious === '"id"'
    if (token === '{' || token === '[') depth += 1
    else if (token === '}' || token === ']') depth -= 1
    beforePrevious = previous
    previous = token
    return isId ? JSON.stringify(alias) : token
  })
}

/** Replace only direct input-item id tokens; every other raw byte is retained. */
function normalizeBodies(bodies: readonly string[]): string[] {
  const ids = new Map<string, string>()
  return bodies.map((body) => {
    let depth = 0
    let isInput = false
    let itemStart: number | undefined
    let keptUntil = 0
    let previous = ''
    let beforePrevious = ''
    const parts: string[] = []
    for (const match of body.matchAll(JSON_TOKENS)) {
      const token = match[0]
      if (token === '[' && depth === 1 && previous === ':' && beforePrevious === '"input"') {
        isInput = true
      }
      if (token === '{' && isInput && depth === 2) itemStart = match.index
      if (token === '}' && isInput && depth === 3 && itemStart !== undefined) {
        const end = match.index + 1
        parts.push(body.slice(keptUntil, itemStart), normalizeItem(body.slice(itemStart, end), ids))
        keptUntil = end
        itemStart = undefined
      }
      if (token === ']' && isInput && depth === 2) isInput = false
      if (token === '{' || token === '[') depth += 1
      else if (token === '}' || token === ']') depth -= 1
      beforePrevious = previous
      previous = token
    }
    parts.push(body.slice(keptUntil))
    return parts.join('')
  })
}

function checkGolden(scenario: string, harness: Harness): void {
  expect(harness.rawBodies).toHaveLength(harness.api.responseBodies().length)
  // The fixture envelope is formatted JSON; each entry is the raw request
  // string, not a parsed/reserialized body. Its whitespace and order survive.
  const doc = { scenario, requests: normalizeBodies(harness.rawBodies) }
  const text = `${JSON.stringify(doc, undefined, 2)}\n`
  const directory = harness.shouldUseStrictTools ? path.join(FIXTURE_DIR, 'strict') : FIXTURE_DIR
  const file = path.join(directory, `${scenario}.json`)
  if (harness.shouldUseStrictTools) {
    const baseline = z
      .object({ requests: z.array(z.string()) })
      .parse(JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${scenario}.json`), 'utf8')))
    expect(doc.requests).toHaveLength(baseline.requests.length)
    const fields = z.object({ tools: z.unknown(), prompt_cache_key: z.string() })
    for (const [index, raw] of doc.requests.entries()) {
      const offRaw = baseline.requests[index]
      const on = fields.parse(JSON.parse(raw))
      const off = fields.parse(JSON.parse(offRaw ?? ''))
      // Only rewritten schemas/flags and their existing cache digest may differ.
      expect(
        raw
          .replace(JSON.stringify(on.tools), () => JSON.stringify(off.tools))
          .replace(JSON.stringify(on.prompt_cache_key), () => JSON.stringify(off.prompt_cache_key)),
      ).toBe(offRaw)
    }
  }
  if (isRegenerate()) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(file, text)
    return
  }
  const expected = readFileSync(file, 'utf8')
  expect(text).toBe(expected)
}

const BIG = Array.from(
  { length: 400 },
  (_, index) => `line ${String(index)} ${'x'.repeat(20)}`,
).join('\n')

const skillFile = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`

describe('golden request normalization boundaries', () => {
  it('preserves raw formatting and key order', () => {
    const bodies = [
      '{ "input" : [ { "id" : "fc_91", "type" : "function_call" } ], "model" : "muse-spark-1.3" }\n',
      '{"model":"muse-spark-1.3","input":[{"type":"function_call","id":"fc_91"}]}',
    ]
    expect(normalizeBodies(bodies)).toEqual(bodies.map((body) => body.replace('fc_91', 'fc_A')))
    expect(normalizeBodies(bodies)[0]).not.toBe(normalizeBodies(bodies)[1])
  })

  it('keeps distinct ids and repeated references across the whole scenario', () => {
    const bodies = [
      '{"input":[{"type":"function_call","id":"fc_91"},{"type":"function_call","id":"fc_92"}]}',
      '{"input":[{"type":"function_call","id":"fc_92"},{"type":"function_call","id":"fc_91"}]}',
    ]
    const expected = bodies.map((body) =>
      body.replaceAll('fc_91', 'fc_A').replaceAll('fc_92', 'fc_B'),
    )
    expect(normalizeBodies(bodies)).toEqual(expected)
    expect(normalizeBodies([bodies[0]!, bodies[1]!.replace('fc_91', 'fc_93')])).not.toEqual(
      expected,
    )
  })

  it('normalizes only matching direct wire-item ids, leaving other fields and text intact', () => {
    // Synthetic scope probes, not additional claimed provider wire shapes.
    const body = JSON.stringify({
      id: 'fc_91',
      tools: [{ type: 'function_call', id: 'fc_91' }],
      input: [
        { type: 'function_call', id: 'fc_91', call_id: 'fc_91', arguments: '{"id":"fc_91"}' },
        { type: 'reasoning', id: 'rs_92' },
        {
          type: 'message',
          id: 'msg_93',
          content: [{ type: 'output_text', text: '{"id":"msg_93"}' }],
        },
        { type: 'web_search_call', id: 'ws_94' },
        { type: 'function_call_output', id: 'fc_95', output: 'fc_95' },
        { type: 'message', id: 'scripted-message' },
        { type: 'message', id: 'fc_96' },
      ],
    })
    expect(normalizeBodies([body])).toEqual([
      body
        .replace('"id":"fc_91","call_id"', '"id":"fc_A","call_id"')
        .replace('"id":"rs_92"', '"id":"rs_B"')
        .replace('"id":"msg_93"', '"id":"msg_C"')
        .replace('"id":"ws_94"', '"id":"ws_D"'),
    ])
  })
})

async function plainGolden(harness: Harness): Promise<void> {
  harness.api.script({ text: 'Hello back.' })
  await runTurn(harness, 'Hello.')
  expect(harness.api.responseBodies()).toHaveLength(1)
  checkGolden('01-plain-turn', harness)
}

async function readGolden(harness: Harness): Promise<void> {
  harness.api.script(
    { calls: [{ name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'c1' }] },
    { text: 'It says alpha.' },
  )
  await runTurn(harness, 'What is in a.txt?')
  expect(harness.api.responseBodies()).toHaveLength(2)
  checkGolden('02-tool-call', harness)
}

describe.each([false, true])(
  'golden requests with hooks off and strict tools %s',
  (shouldUseStrictTools) => {
    it('records a plain one-turn reply', async () => {
      const harness = await setup({}, { shouldUseStrictTools })
      await plainGolden(harness)
      await harness.host.close()
    })

    it('records a turn with one tool call and its result', async () => {
      const harness = await setup({ 'a.txt': 'Alpha.\n' }, { shouldUseStrictTools })
      await readGolden(harness)
      await harness.host.close()
    })

    it('records an edit_file with then_run', async () => {
      const harness = await setup(
        { 'owned.ts': 'export const one = 1\n' },
        { shouldUseStrictTools },
      )
      harness.api.script({ calls: [editThenRunCall()] }, { text: 'Renamed, and the command ran.' })
      await runTurn(harness, 'Rename one to two, then run echo then.')
      expect(harness.api.responseBodies()).toHaveLength(2)
      checkGolden('03-edit-then-run', harness)
      await harness.host.close()
    })

    it('records a long tool output whole twice, then as a placeholder', async () => {
      const harness = await setup({ 'big.txt': BIG }, { shouldUseStrictTools })
      harness.api.script(
        {
          calls: [{ name: 'read_file', arguments: '{"path":"big.txt"}', callId: 'c1' }],
        },
        { text: 'Read it.' },
      )
      await runTurn(harness, 'Read big.txt.')
      harness.api.script({ text: 'Again.' })
      await runTurn(harness, 'And?')
      harness.api.script({ text: 'Once more.' })
      await runTurn(harness, 'And?')
      expect(harness.api.responseBodies()).toHaveLength(4)
      checkGolden('04-packed-output', harness)
      await harness.host.close()
    })

    it('records a manual compaction and the turn after it', async () => {
      const harness = await setup({}, { shouldUseStrictTools })
      harness.api.script({ text: 'First reply.' })
      await runTurn(harness, 'First.')
      harness.api.inputTokens = 77
      harness.api.script({ text: 'THE SUMMARY' })
      await expect(harness.session.compact()).resolves.toEqual({
        status: 'accepted',
        reason: undefined,
      })
      harness.api.script({ text: 'Later.' })
      await runTurn(harness, 'Next.')
      expect(harness.api.responseBodies()).toHaveLength(3)
      checkGolden('05-manual-compaction', harness)
      await harness.host.close()
    })

    it('records a subagent child turn', async () => {
      const harness = await setup({}, { paidSubagents: true, shouldUseStrictTools })
      harness.api.script(
        {
          calls: [
            {
              name: 'subagent_spawn',
              arguments: '{"role":"worker","objective":"Map the workspace files"}',
              callId: 'spawn1',
            },
          ],
        },
        { text: 'Mapped.' },
        { text: 'Parent continues.' },
      )
      await harness.session.sendTurn([{ type: 'text', text: 'Delegate.' }])
      await vi.waitFor(() => {
        expect(harness.api.responseBodies()).toHaveLength(3)
        expect(harness.session.status).toBe('idle')
      })
      checkGolden('06-subagent-child', harness)
      await harness.host.close()
    })

    it('records a turn with skills and rules loaded', async () => {
      const harness = await setup(
        {
          'AGENTS.md': 'End every reply with PINEAPPLE.\n',
          '.agents/skills/shout/SKILL.md': skillFile('shout', 'Repeat in caps', 'UPPER CASE.'),
        },
        { shouldUseStrictTools },
      )
      harness.api.script({ text: 'Done.' })
      await runTurn(harness, 'Go.')
      expect(harness.api.responseBodies()).toHaveLength(1)
      checkGolden('07-skills-and-rules', harness)
      await harness.host.close()
    })
  },
)

// Lane M98-G: the judge's invariance over the M91-G harness (PLAN.md M98
// acceptance item 1). No independent baseline: every main-body comparison
// below reads the fixtures above. Both engine cases install the approval
// interface on the real host; direct allows must not start its runner.
const G_NOUL = { id: 'risk', kind: 'noul' as const, text: 'Is deleting this risky?' }

describe('M98 integrated Model API source', () => {
  it.each(['complete', 'missing', 'partial', 'invalid'] as const)(
    'reads the actual sent body and keeps a %s receipt honest without changing the main replay',
    async (receipt) => {
      const harness = await setup({})
      const held = Promise.withResolvers<undefined>()
      harness.api.script(
        { text: 'Hello back.', hold: held.promise },
        {
          text: '{"answer":"yes","confidence":99}',
          ...(receipt === 'missing' && { omitUsage: true }),
          ...(receipt === 'partial' && { usageOverride: { input_tokens: 10, output_tokens: 2 } }),
          ...(receipt === 'invalid' && {
            usageOverride: {
              input_tokens: -1,
              output_tokens: 2,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          }),
        },
      )
      const submitted = await harness.session.sendTurn([{ type: 'text', text: 'Hello.' }])
      await vi.waitFor(() => {
        expect(harness.rawBodies).toHaveLength(1)
      })
      checkGolden('01-plain-turn', harness)
      const connection = harness.host.judgeConnection(harness.session.sessionId, submitted.turnId)
      if (connection === undefined) throw new Error('the live source is absent')
      const main = connection.source.readMainBody()
      expect(JSON.stringify(main)).toBe(harness.rawBodies[0])
      const snapshot = JSON.stringify(main)
      const history = JSON.stringify(harness.session.history())
      expect(connection.source.keyPrefix(main)).toBe(main.prompt_cache_key)
      const admitted = vi.fn()
      const pending = connection.transport.send(
        { ...main, tools: [], input: [], instructions: 'Judge this action.' },
        new AbortController().signal,
        admitted,
      )
      if (receipt === 'invalid') await expect(pending).rejects.toThrow('Invalid Judge usage')
      else {
        const response = await pending
        expect(response.text).toBe('{"answer":"yes","confidence":99}')
        if (receipt === 'complete') expect(response.usage?.inputTokens).toBeGreaterThan(0)
        else expect(response.usage).toBeUndefined()
      }
      expect(admitted).toHaveBeenCalledWith(connection.keyDigest)
      expect(JSON.stringify(main)).toBe(snapshot)
      expect(JSON.stringify(harness.session.history())).toBe(history)
      await expect(connection.transport.send(main, new AbortController().signal)).rejects.toThrow(
        'requires admission',
      )
      expect(harness.host.judgeConnection('absent', 'turn')).toBeUndefined()
      held.resolve(undefined)
      await harness.turnDone()
      await harness.host.close()
      expect(() => connection.source.readMainBody()).toThrow('source changed')
    },
  )
})

function judgeOverMain(main: CreateResponseBody): {
  readonly entries: SpyJudgeStore
  readonly sent: CreateResponseBody[]
  readonly errors: unknown[]
  readonly judge: ModelApiSameJudge
} {
  const entries = new SpyJudgeStore()
  const cache = new JudgeResultCache()
  const sent: CreateResponseBody[] = []
  const errors: unknown[] = []
  const transport: ModelApiJudgeTransport = {
    send: (body, _signal) => {
      sent.push(body)
      return Promise.resolve({
        text: '{"answer":"yes","confidence":95}',
        inputTokens: 10,
        outputTokens: 5,
      })
    },
  }
  const judge = new ModelApiSameJudge({
    modelId: main.model,
    timeoutMs: 2000,
    measureTokens: (text) => text.length,
    entries,
    cache,
    onError: (error) => {
      errors.push(error)
    },
    redact: (text) => redactSecrets(text),
    source: {
      readMainBody: () => main,
      keyPrefix: (prefix) => promptCacheKey(prefix),
      prefixTokens: () => 4357,
    },
    transport,
  })
  return { entries, sent, errors, judge }
}

/** The body as the client serializes it, with `input` rebuilt in wire order. */
function wireString(body: CreateResponseBody, input: readonly unknown[]): string {
  const rebuilt: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    rebuilt[key] = key === 'input' ? input : value
  }
  return JSON.stringify(rebuilt)
}

function heldKey(entries: SpyJudgeStore): JudgeEntryHandle {
  return startJudgeEntry(entries, {
    backend: 'model-api',
    turnId: 't1',
    tool: 'run_shell',
    args: { command: 'rm -rf /tmp/x' },
  })
}

async function capturedPlain(harness: Harness): Promise<{ main: CreateResponseBody; raw: string }> {
  await plainGolden(harness)
  const raw = harness.rawBodies[0]
  if (raw === undefined) throw new Error('no main request recorded')
  const main: CreateResponseBody = JSON.parse(raw)
  return { main, raw }
}

async function sideJudge(main: CreateResponseBody) {
  const before = structuredClone(main)
  const rig = judgeOverMain(main)
  const key = heldKey(rig.entries)
  expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'rm -rf /tmp/x', [G_NOUL]))).toBe(
    'caution',
  )
  expect(rig.sent).toHaveLength(1)
  const sent = rig.sent[0]
  if (sent === undefined) throw new Error('no side request sent')
  return { before, rig, sent }
}

function directAllowJudge(engine: 'off' | 'same') {
  const start = vi.fn(() => {
    throw new Error('a direct allow started the judge')
  })
  const judge = new JudgeUse({
    isOn: () => isJudgeEngineOn(engine),
    createRunner: start,
    prepare: () => Promise.resolve(true),
    question: () => G_NOUL,
    onError: (error) => {
      throw error
    },
  })
  return { judge, start }
}

describe('M98-G judge invariance (Model API)', () => {
  it('engine off sends nothing beyond the golden bytes', async () => {
    const rig = directAllowJudge('off')
    const harness = await setup({}, { judge: rig.judge })
    await plainGolden(harness)
    expect(rig.start).not.toHaveBeenCalled()
    await harness.host.close()
  })

  it('engine same with no hint keeps the golden bytes', async () => {
    const rig = directAllowJudge('same')
    const harness = await setup({ 'a.txt': 'Alpha.\n' }, { judge: rig.judge })
    await readGolden(harness)
    expect(rig.start).not.toHaveBeenCalled()
    await harness.host.close()
  })

  it('a side request shares the main cached prefix byte-exact', async () => {
    const harness = await setup({})
    const { main, raw: mainRaw } = await capturedPlain(harness)
    const { before, rig, sent } = await sideJudge(main)
    // The side prefix is the main body byte for byte; only the tail is new.
    expect(wireString(sent, sent.input.slice(0, -1))).toBe(mainRaw)
    // The side request reads the main cached prefix: the same cache key over
    // the same model, instructions and tools triple.
    expect(sent.prompt_cache_key).toBe(main.prompt_cache_key)
    expect(
      promptCacheKey({ model: sent.model, instructions: sent.instructions, tools: sent.tools }),
    ).toBe(
      promptCacheKey({ model: main.model, instructions: main.instructions, tools: main.tools }),
    )
    expect(sent.input).toHaveLength(main.input.length + 1)
    // The main body is never edited, reordered or trimmed.
    expect(main).toEqual(before)
    expect(rig.errors).toEqual([])
    await harness.host.close()
  })

  it('redaction sends a standalone side body carrying only the tail', async () => {
    const harness = await setup({})
    const { main: clean } = await capturedPlain(harness)
    const main: CreateResponseBody = {
      ...clean,
      instructions: `${clean.instructions} key: LLM_abcdefghijklmnop`,
    }
    const { before, rig, sent } = await sideJudge(main)
    // Standalone: the redacted prefix is not reused; only the tail is sent.
    expect(sent.input).toHaveLength(1)
    expect(sent.instructions).toBe('')
    expect(sent.tools).toEqual([])
    expect(sent.model).toBe(main.model)
    expect(sent.prompt_cache_key).toBe(
      promptCacheKey({ model: main.model, instructions: '', tools: [] }),
    )
    expect(JSON.stringify(sent)).not.toContain('LLM_abcdefghijklmnop')
    expect(main).toEqual(before)
    expect(rig.errors).toEqual([])
    await harness.host.close()
  })
})
